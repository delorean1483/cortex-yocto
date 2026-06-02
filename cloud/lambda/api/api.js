'use strict';

const { SecretsManagerClient, GetSecretValueCommand }             = require('@aws-sdk/client-secrets-manager');
const { CognitoIdentityProviderClient, InitiateAuthCommand,
        AdminCreateUserCommand, AdminDeleteUserCommand,
        AdminSetUserPasswordCommand, ListUsersCommand }            = require('@aws-sdk/client-cognito-identity-provider');
const { IoTDataPlaneClient, GetThingShadowCommand,
        UpdateThingShadowCommand }                                  = require('@aws-sdk/client-iot-data-plane');
const { DynamoDBClient }                                           = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand,
        GetCommand, DeleteCommand, UpdateCommand, ScanCommand }    = require('@aws-sdk/lib-dynamodb');
const { InfluxDB }                                                 = require('@influxdata/influxdb-client');
const jwt                                                          = require('jsonwebtoken');
const { randomUUID }                                               = require('crypto');

// ── Environment ───────────────────────────────────────────────────────────────
const REGION            = process.env.AWS_REGION || 'us-east-1';
const INFLUX_URL        = `http://${process.env.INFLUX_PRIVATE_IP}:8086`;
const INFLUX_ORG        = process.env.INFLUX_ORG || 'ecofleet';
const POOL_ID           = process.env.COGNITO_USER_POOL_ID;
const CLIENT_ID         = process.env.COGNITO_CLIENT_ID;
const MAINTENANCE_TABLE = process.env.MAINTENANCE_TABLE || 'ecofleet-prod-maintenance';
const USERS_TABLE       = process.env.USERS_TABLE       || 'ecofleet-prod-users';
const JWT_EXPIRY        = '1h';

// ── AWS clients ───────────────────────────────────────────────────────────────
const sm      = new SecretsManagerClient({ region: REGION });
const cognito = new CognitoIdentityProviderClient({ region: REGION });
const iotdata = new IoTDataPlaneClient({
  region: REGION,
  endpoint: process.env.IOT_ENDPOINT_URL || undefined,
});
const ddbRaw  = new DynamoDBClient({ region: REGION });
const ddb     = DynamoDBDocumentClient.from(ddbRaw);

// ── Secret cache ──────────────────────────────────────────────────────────────
let _jwtSecret   = null;
let _influxToken = null;

async function getJwtSecret() {
  if (_jwtSecret) return _jwtSecret;
  const res = await sm.send(new GetSecretValueCommand({ SecretId: process.env.JWT_SECRET_ARN }));
  _jwtSecret = res.SecretString;
  return _jwtSecret;
}

async function getInfluxToken() {
  if (_influxToken) return _influxToken;
  const res = await sm.send(new GetSecretValueCommand({ SecretId: process.env.INFLUX_SECRET_ARN }));
  _influxToken = res.SecretString;
  return _influxToken;
}

function getInfluxClient() {
  if (!_influxToken) throw new Error('influxToken not initialised');
  return new InfluxDB({ url: INFLUX_URL, token: _influxToken });
}

// ── Response helpers ──────────────────────────────────────────────────────────
const resp = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const err = (status, message) => resp(status, { error: message });

// ── Auth middleware ───────────────────────────────────────────────────────────
async function authenticate(event) {
  const authHeader = (event.headers || {})['authorization'] ||
                     (event.headers || {})['Authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) throw Object.assign(new Error('Missing Bearer token'), { statusCode: 401 });

  const secret = await getJwtSecret();
  try {
    return jwt.verify(token, secret); // returns { email, role, sub, iat, exp }
  } catch (e) {
    throw Object.assign(new Error('Invalid or expired token'), { statusCode: 401 });
  }
}

function requireRole(claims, ...allowed) {
  if (!allowed.includes(claims.role)) {
    throw Object.assign(
      new Error(`Role '${claims.role}' cannot perform this action`),
      { statusCode: 403 }
    );
  }
}

// ── Route handlers ────────────────────────────────────────────────────────────

// POST /auth/login
async function handleLogin(event) {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return err(400, 'Invalid JSON'); }

  const { email, password } = body;
  if (!email || !password) return err(400, 'email and password required');

  let cognitoResult;
  try {
    const res = await cognito.send(new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: email, PASSWORD: password },
      ClientId: CLIENT_ID,
    }));
    cognitoResult = res.AuthenticationResult;
  } catch (e) {
    if (e.name === 'NotAuthorizedException' || e.name === 'UserNotFoundException')
      return err(401, 'Invalid credentials');
    if (e.name === 'UserNotConfirmedException')
      return err(403, 'Email not verified — check your inbox');
    if (e.name === 'PasswordResetRequiredException')
      return err(403, 'Password reset required');
    console.error('Cognito auth error:', e.message);
    throw e;
  }

  // Look up role from DynamoDB (defaults to 'eu' if not found)
  let role = 'eu';
  try {
    const r = await ddb.send(new GetCommand({ TableName: USERS_TABLE, Key: { email } }));
    if (r.Item?.role) role = r.Item.role;
  } catch { /* non-fatal — default role applies */ }

  const secret = await getJwtSecret();
  const token  = jwt.sign({ email, sub: email, role }, secret, { expiresIn: JWT_EXPIRY });

  return resp(200, {
    token,
    refresh_token: cognitoResult.RefreshToken,
    expires_in: 3600,
  });
}

// POST /auth/refresh
async function handleRefresh(event) {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return err(400, 'Invalid JSON'); }

  const { refresh_token } = body;
  if (!refresh_token) return err(400, 'refresh_token required');

  let cognitoResult;
  try {
    const res = await cognito.send(new InitiateAuthCommand({
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      AuthParameters: { REFRESH_TOKEN: refresh_token },
      ClientId: CLIENT_ID,
    }));
    cognitoResult = res.AuthenticationResult;
  } catch (e) {
    if (e.name === 'NotAuthorizedException') return err(401, 'Refresh token expired or invalid');
    console.error('Cognito refresh error:', e.message);
    throw e;
  }

  let email = 'unknown';
  try {
    const idPayload = JSON.parse(Buffer.from(cognitoResult.IdToken.split('.')[1], 'base64').toString());
    email = idPayload.email || idPayload['cognito:username'] || 'unknown';
  } catch { /* non-fatal */ }

  let role = 'eu';
  try {
    const r = await ddb.send(new GetCommand({ TableName: USERS_TABLE, Key: { email } }));
    if (r.Item?.role) role = r.Item.role;
  } catch { /* non-fatal */ }

  const secret = await getJwtSecret();
  const token  = jwt.sign({ email, sub: email, role }, secret, { expiresIn: JWT_EXPIRY });

  return resp(200, { token, expires_in: 3600 });
}

// GET /fleet/units
async function handleListUnits() {
  await getInfluxToken();
  const queryApi = getInfluxClient().getQueryApi(INFLUX_ORG);

  const flux = `
    import "influxdata/influxdb/schema"
    schema.tagValues(
      bucket: "telemetry",
      tag: "unit",
      predicate: (r) => r._measurement == "telemetry",
      start: -30d,
    )
  `;

  const rows  = await queryApi.collectRows(flux);
  const units = rows.map(r => r._value).filter(Boolean).sort();
  return resp(200, { units });
}

// GET /fleet/units/{unit}/telemetry?start=-1h&limit=200
async function handleGetTelemetry(event) {
  const unit  = (event.pathParameters || {}).unit;
  const qs    = event.queryStringParameters || {};
  const start = qs.start  || '-1h';
  const limit = Math.min(parseInt(qs.limit || '200', 10), 1000);

  if (!unit) return err(400, 'unit path parameter required');

  await getInfluxToken();
  const queryApi = getInfluxClient().getQueryApi(INFLUX_ORG);

  const flux = `
    from(bucket: "telemetry")
      |> range(start: ${start})
      |> filter(fn: (r) => r._measurement == "telemetry" and r.unit == "${unit.replace(/"/g, '')}")
      |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"], desc: true)
      |> limit(n: ${limit})
  `;

  const rows = await queryApi.collectRows(flux);
  const telemetry = rows.map(r => ({
    ts:          new Date(r._time).getTime(),
    dc_v:        r.dc_v,
    dc_a:        r.dc_a,
    batt_v:      r.batt_v,
    batt_soc:    r.batt_soc,
    batt_t:      r.batt_t,
    apu_state:   r.apu_state,
    runtime_hrs: r.runtime_hrs,
    watts:       r.watts,
    rpm:         r.rpm,
    oil_psi:     r.oil_psi,
    coolant_t:   r.coolant_t,
    fault:       r.fault,
  }));

  return resp(200, { unit, count: telemetry.length, telemetry });
}

// GET /fleet/units/{unit}/faults?start=-7d&limit=100
async function handleGetFaults(event) {
  const unit  = (event.pathParameters || {}).unit;
  const qs    = event.queryStringParameters || {};
  const start = qs.start || '-7d';
  const limit = Math.min(parseInt(qs.limit || '100', 10), 500);

  if (!unit) return err(400, 'unit path parameter required');

  await getInfluxToken();
  const queryApi = getInfluxClient().getQueryApi(INFLUX_ORG);

  const flux = `
    from(bucket: "faults")
      |> range(start: ${start})
      |> filter(fn: (r) => r._measurement == "faults" and r.unit == "${unit.replace(/"/g, '')}")
      |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"], desc: true)
      |> limit(n: ${limit})
  `;

  const rows   = await queryApi.collectRows(flux);
  const faults = rows.map(r => ({
    ts:          new Date(r._time).getTime(),
    fault:       r.fault,
    state:       r.state,
    description: r.description,
  }));

  return resp(200, { unit, count: faults.length, faults });
}

// GET /fleet/shadow?unit=TRUCK-001
async function handleGetShadow(event) {
  const qs   = event.queryStringParameters || {};
  const unit = qs.unit || '';
  if (!unit) return err(400, 'unit query parameter required');

  const thingName = `gobi-apu-${unit}`;

  let shadowRaw;
  try {
    const res = await iotdata.send(new GetThingShadowCommand({ thingName }));
    shadowRaw = JSON.parse(Buffer.from(res.payload).toString('utf8'));
  } catch (e) {
    if (e.name === 'ResourceNotFoundException') {
      return resp(200, {
        unit,
        shadow_exists: false,
        message: 'Shadow not yet created — device has not connected since provisioning.',
      });
    }
    throw e;
  }

  const state    = shadowRaw.state    || {};
  const reported = state.reported     || {};
  const desired  = state.desired      || {};
  const delta    = state.delta        || {};

  const lastSeenTs = reported.last_seen_ts || null;
  const staleSec   = lastSeenTs
    ? Math.round((Date.now() - lastSeenTs) / 1000)
    : null;

  return resp(200, {
    unit,
    shadow_exists: true,
    version: shadowRaw.version,
    reported: {
      ...reported,
      stale_seconds: staleSec,
      online: staleSec !== null && staleSec < 30,
    },
    desired,
    delta,
    last_updated: shadowRaw.timestamp || null,
  });
}

// POST /fleet/config
const ALLOWED_CONFIG_KEYS = new Set(['poll_interval_s', 'report_mode', 'firmware_target', 'reboot', 'apu_command']);

async function handleSetConfig(event) {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return err(400, 'Invalid JSON'); }

  const { unit, config } = body;
  if (!unit)   return err(400, 'unit required');
  if (!config || typeof config !== 'object') return err(400, 'config object required');

  const badKeys = Object.keys(config).filter(k => !ALLOWED_CONFIG_KEYS.has(k));
  if (badKeys.length) return err(400, `Unknown config key(s): ${badKeys.join(', ')}`);

  if (config.poll_interval_s !== undefined) {
    const v = config.poll_interval_s;
    if (typeof v !== 'number' || v < 5 || v > 60)
      return err(400, 'poll_interval_s must be a number 5–60');
  }
  if (config.report_mode !== undefined) {
    if (!['normal', 'eco', 'debug'].includes(config.report_mode))
      return err(400, 'report_mode must be one of: normal, eco, debug');
  }
  if (config.reboot !== undefined && typeof config.reboot !== 'boolean')
    return err(400, 'reboot must be a boolean');
  if (config.apu_command !== undefined && !['start', 'stop'].includes(config.apu_command))
    return err(400, 'apu_command must be "start" or "stop"');

  const thingName = `gobi-apu-${unit}`;
  const payload   = JSON.stringify({ state: { desired: config } });

  try {
    const res     = await iotdata.send(new UpdateThingShadowCommand({
      thingName,
      payload: Buffer.from(payload, 'utf8'),
    }));
    const updated = JSON.parse(Buffer.from(res.payload).toString('utf8'));

    return resp(200, {
      unit,
      shadow_version: updated.version,
      desired: config,
      message: 'Config queued. Device will apply on next connection or within one poll cycle.',
    });
  } catch (e) {
    if (e.name === 'ResourceNotFoundException')
      return err(404, `Shadow not found for ${unit} — has the device connected yet?`);
    throw e;
  }
}

// ── Maintenance ───────────────────────────────────────────────────────────────

// GET /fleet/units/{unit}/maintenance?limit=20
async function handleGetMaintenance(event) {
  const unit  = (event.pathParameters || {}).unit;
  const qs    = event.queryStringParameters || {};
  const limit = Math.min(parseInt(qs.limit || '20', 10), 100);

  if (!unit) return err(400, 'unit path parameter required');

  const res = await ddb.send(new QueryCommand({
    TableName:              MAINTENANCE_TABLE,
    KeyConditionExpression: '#u = :unit',
    ExpressionAttributeNames:  { '#u': 'unit' },
    ExpressionAttributeValues: { ':unit': unit },
    ScanIndexForward: false,
    Limit: limit,
  }));

  return resp(200, { unit, count: res.Items.length, records: res.Items });
}

// POST /fleet/maintenance
const MAINT_TYPES = ['oil_change', 'filter', 'inspection', 'repair', 'firmware', 'other'];

async function handleAddMaintenance(event, claims) {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return err(400, 'Invalid JSON'); }

  const { unit, type, notes, technician } = body;
  if (!unit) return err(400, 'unit required');
  if (!type) return err(400, 'type required');
  if (!MAINT_TYPES.includes(type))
    return err(400, `type must be one of: ${MAINT_TYPES.join(', ')}`);

  const ts     = Date.now();
  const record = {
    unit,
    ts,
    id:         randomUUID(),
    type,
    notes:      notes       || '',
    technician: technician  || claims.email,
    created_by: claims.email,
  };

  await ddb.send(new PutCommand({ TableName: MAINTENANCE_TABLE, Item: record }));
  return resp(201, { record });
}

// ── User management ───────────────────────────────────────────────────────────

// GET /fleet/users  (admin, fm)
async function handleListUsers(claims) {
  requireRole(claims, 'admin', 'fm');

  const cognitoRes = await cognito.send(new ListUsersCommand({
    UserPoolId:      POOL_ID,
    Limit:           60,
    AttributesToGet: ['email'],
  }));

  const cognitoEmails = (cognitoRes.Users || []).map(u => {
    const emailAttr = (u.Attributes || []).find(a => a.Name === 'email');
    return { email: emailAttr?.Value || '', status: u.UserStatus, created: u.UserCreateDate };
  }).filter(u => u.email);

  const roleMap = {};
  try {
    const scanRes = await ddb.send(new ScanCommand({ TableName: USERS_TABLE }));
    (scanRes.Items || []).forEach(item => { roleMap[item.email] = item.role; });
  } catch { /* non-fatal */ }

  const users = cognitoEmails.map(u => ({ ...u, role: roleMap[u.email] || 'eu' }));
  return resp(200, { count: users.length, users });
}

// POST /fleet/users  (admin only)
async function handleCreateUser(event, claims) {
  requireRole(claims, 'admin');

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return err(400, 'Invalid JSON'); }

  const { email, role, password } = body;
  if (!email)    return err(400, 'email required');
  if (!password) return err(400, 'password required');
  if (!['admin', 'fm', 'maint', 'eu'].includes(role || ''))
    return err(400, 'role must be one of: admin, fm, maint, eu');

  try {
    await cognito.send(new AdminCreateUserCommand({
      UserPoolId:        POOL_ID,
      Username:          email,
      TemporaryPassword: password,
      MessageAction:     'SUPPRESS',
      UserAttributes: [
        { Name: 'email',          Value: email },
        { Name: 'email_verified', Value: 'true' },
      ],
    }));
  } catch (e) {
    if (e.name === 'UsernameExistsException') return err(409, 'User already exists');
    throw e;
  }

  // Make permanent so no FORCE_CHANGE_PASSWORD challenge on first login
  await cognito.send(new AdminSetUserPasswordCommand({
    UserPoolId: POOL_ID,
    Username:   email,
    Password:   password,
    Permanent:  true,
  }));

  await ddb.send(new PutCommand({
    TableName: USERS_TABLE,
    Item: { email, role, created_by: claims.email, created_at: Date.now() },
  }));

  return resp(201, { email, role, message: 'User created.' });
}

// DELETE /fleet/users/{email}  (admin only)
async function handleDeleteUser(event, claims) {
  requireRole(claims, 'admin');

  const email = decodeURIComponent((event.pathParameters || {}).email || '');
  if (!email) return err(400, 'email path parameter required');
  if (email === claims.email) return err(400, 'Cannot delete your own account');

  try {
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId: POOL_ID, Username: email }));
  } catch (e) {
    if (e.name === 'UserNotFoundException') return err(404, 'User not found');
    throw e;
  }

  await ddb.send(new DeleteCommand({ TableName: USERS_TABLE, Key: { email } }));
  return resp(200, { email, message: 'User deleted.' });
}

// PATCH /fleet/users/{email}  (admin only)
async function handleUpdateUser(event, claims) {
  requireRole(claims, 'admin');

  const email = decodeURIComponent((event.pathParameters || {}).email || '');
  if (!email) return err(400, 'email path parameter required');

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return err(400, 'Invalid JSON'); }

  const { role } = body;
  if (!['admin', 'fm', 'maint', 'eu'].includes(role || ''))
    return err(400, 'role must be one of: admin, fm, maint, eu');

  await ddb.send(new UpdateCommand({
    TableName:                 USERS_TABLE,
    Key:                       { email },
    UpdateExpression:          'SET #r = :role',
    ExpressionAttributeNames:  { '#r': 'role' },
    ExpressionAttributeValues: { ':role': role },
  }));

  return resp(200, { email, role, message: 'Role updated.' });
}

// ── Reports ───────────────────────────────────────────────────────────────────

// GET /fleet/reports?start=-7d
async function handleGetReports(event) {
  const qs        = event.queryStringParameters || {};
  const start     = qs.start || '-7d';
  const safeStart = start.replace(/[^-0-9a-z]/gi, '');

  await getInfluxToken();
  const queryApi = getInfluxClient().getQueryApi(INFLUX_ORG);

  const [avgRows, runtimeRows, faultRows] = await Promise.all([
    queryApi.collectRows(`
      from(bucket: "telemetry")
        |> range(start: ${safeStart})
        |> filter(fn: (r) => r._measurement == "telemetry" and
           (r._field == "dc_v" or r._field == "batt_soc"))
        |> group(columns: ["unit", "_field"])
        |> mean()
    `),
    queryApi.collectRows(`
      from(bucket: "telemetry")
        |> range(start: ${safeStart})
        |> filter(fn: (r) => r._measurement == "telemetry" and r._field == "runtime_hrs")
        |> group(columns: ["unit"])
        |> last()
    `),
    queryApi.collectRows(`
      from(bucket: "faults")
        |> range(start: ${safeStart})
        |> filter(fn: (r) => r._measurement == "faults" and r._field == "fault")
        |> group(columns: ["unit"])
        |> count()
    `),
  ]);

  const unitMap = {};
  const ensure  = u => { if (!unitMap[u]) unitMap[u] = { unit: u }; return unitMap[u]; };

  avgRows.forEach(r => {
    const u = ensure(r.unit);
    if (r._field === 'dc_v')     u.avg_dc_v    = r._value;
    if (r._field === 'batt_soc') u.avg_batt_soc = r._value;
  });
  runtimeRows.forEach(r => { ensure(r.unit).runtime_hrs = r._value; });
  faultRows.forEach(r =>   { ensure(r.unit).fault_count  = r._value; });

  const units = Object.values(unitMap).sort((a, b) => a.unit.localeCompare(b.unit));
  return resp(200, { start: safeStart, generated_at: Date.now(), units });
}

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod || '';
  const path   = event.requestContext?.http?.path   || event.path       || '';

  try {
    // Public routes
    if (method === 'POST' && path.endsWith('/auth/login'))   return await handleLogin(event);
    if (method === 'POST' && path.endsWith('/auth/refresh')) return await handleRefresh(event);

    // Protected routes
    const claims = await authenticate(event);

    if (method === 'GET'  && path.endsWith('/fleet/units'))    return await handleListUnits();
    if (method === 'GET'  && path.endsWith('/fleet/shadow'))   return await handleGetShadow(event);
    if (method === 'POST' && path.endsWith('/fleet/config'))   return await handleSetConfig(event);
    if (method === 'POST' && path.endsWith('/fleet/maintenance')) return await handleAddMaintenance(event, claims);
    if (method === 'GET'  && path.endsWith('/fleet/users'))    return await handleListUsers(claims);
    if (method === 'POST' && path.endsWith('/fleet/users'))    return await handleCreateUser(event, claims);
    if (method === 'GET'  && path.endsWith('/fleet/reports'))  return await handleGetReports(event);

    if (path.includes('/fleet/units/')) {
      if (path.endsWith('/telemetry'))    return await handleGetTelemetry(event);
      if (path.endsWith('/faults'))       return await handleGetFaults(event);
      if (path.endsWith('/maintenance'))  return await handleGetMaintenance(event);
    }

    if (path.includes('/fleet/users/')) {
      if (method === 'DELETE') return await handleDeleteUser(event, claims);
      if (method === 'PATCH')  return await handleUpdateUser(event, claims);
    }

    return err(404, `No route for ${method} ${path}`);

  } catch (e) {
    if (e.statusCode) return err(e.statusCode, e.message);
    console.error('Unhandled error:', e);
    return err(500, 'Internal server error');
  }
};
