'use strict';

const { SecretsManagerClient, GetSecretValueCommand }             = require('@aws-sdk/client-secrets-manager');
const { CognitoIdentityProviderClient, InitiateAuthCommand }      = require('@aws-sdk/client-cognito-identity-provider');
const { IoTDataPlaneClient, GetThingShadowCommand,
        UpdateThingShadowCommand }                                  = require('@aws-sdk/client-iot-data-plane');
const { InfluxDB }                                                 = require('@influxdata/influxdb-client');
const jwt                                                          = require('jsonwebtoken');

// ── Environment ───────────────────────────────────────────────────────────────
const REGION       = process.env.AWS_REGION || 'us-east-1';
const INFLUX_URL   = `http://${process.env.INFLUX_PRIVATE_IP}:8086`;
const INFLUX_ORG   = process.env.INFLUX_ORG || 'ecofleet';
const POOL_ID      = process.env.COGNITO_USER_POOL_ID;
const CLIENT_ID    = process.env.COGNITO_CLIENT_ID;
const JWT_EXPIRY   = '1h';

// ── AWS clients ───────────────────────────────────────────────────────────────
const sm      = new SecretsManagerClient({ region: REGION });
const cognito = new CognitoIdentityProviderClient({ region: REGION });
const iotdata = new IoTDataPlaneClient({ region: REGION });

// ── Secret cache (reused across warm invocations) ─────────────────────────────
let _jwtSecret    = null;
let _influxToken  = null;

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
    return jwt.verify(token, secret);
  } catch (e) {
    throw Object.assign(new Error('Invalid or expired token'), { statusCode: 401 });
  }
}

// ── Route handlers ────────────────────────────────────────────────────────────

// POST /auth/login
// Body: { email, password }
// Returns: { token, refresh_token, expires_in }
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

  const secret = await getJwtSecret();
  const token  = jwt.sign({ email, sub: email }, secret, { expiresIn: JWT_EXPIRY });

  return resp(200, {
    token,
    refresh_token: cognitoResult.RefreshToken,
    expires_in: 3600,
  });
}

// POST /auth/refresh
// Body: { refresh_token }
// Returns: { token, expires_in }
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

  // Decode email from Cognito ID token (we don't store it server-side)
  let email = 'unknown';
  try {
    const idPayload = JSON.parse(Buffer.from(cognitoResult.IdToken.split('.')[1], 'base64').toString());
    email = idPayload.email || idPayload['cognito:username'] || 'unknown';
  } catch { /* non-fatal */ }

  const secret = await getJwtSecret();
  const token  = jwt.sign({ email, sub: email }, secret, { expiresIn: JWT_EXPIRY });

  return resp(200, { token, expires_in: 3600 });
}

// GET /fleet/units
// Returns list of distinct units that have sent telemetry in the last 30 days.
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

  const rows = await queryApi.collectRows(flux);
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

  const rows = await queryApi.collectRows(flux);
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
// Body: { unit, config: { poll_interval_s?, report_mode?, firmware_target?, reboot? } }
const ALLOWED_CONFIG_KEYS = new Set(['poll_interval_s', 'report_mode', 'firmware_target', 'reboot']);

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

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod || '';
  const path   = event.requestContext?.http?.path   || event.path       || '';

  try {
    // Public routes
    if (method === 'POST' && path.endsWith('/auth/login'))   return await handleLogin(event);
    if (method === 'POST' && path.endsWith('/auth/refresh')) return await handleRefresh(event);

    // Protected routes — authenticate first
    await authenticate(event);

    if (method === 'GET'  && path.endsWith('/fleet/units'))           return await handleListUnits();
    if (method === 'GET'  && path.includes('/fleet/units/') && path.endsWith('/telemetry')) return await handleGetTelemetry(event);
    if (method === 'GET'  && path.includes('/fleet/units/') && path.endsWith('/faults'))    return await handleGetFaults(event);
    if (method === 'GET'  && path.endsWith('/fleet/shadow'))          return await handleGetShadow(event);
    if (method === 'POST' && path.endsWith('/fleet/config'))          return await handleSetConfig(event);

    return err(404, `No route for ${method} ${path}`);

  } catch (e) {
    if (e.statusCode) return err(e.statusCode, e.message);
    console.error('Unhandled error:', e);
    return err(500, 'Internal server error');
  }
};
