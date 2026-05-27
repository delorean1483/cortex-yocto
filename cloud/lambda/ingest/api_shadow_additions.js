// cloud/lambda/ingest/api.js — shadow additions
//
// ADD these two functions to your existing api.js, then wire them
// into the exports.handler route table at the bottom.
//
// New routes:
//   GET  /fleet/shadow?unit=TRUCK-001        — read current shadow (reported + desired + delta)
//   POST /fleet/config                       — push desired config to a device's shadow
//
// Requires: add IoTDataPlaneClient to imports at top of api.js

/*
 * ── New import (add alongside existing @aws-sdk imports) ─────────────────────
 *
 * const {
 *   IoTDataPlaneClient,
 *   GetThingShadowCommand,
 *   UpdateThingShadowCommand,
 * } = require('@aws-sdk/client-iot-data-plane');
 *
 * const iotdata = new IoTDataPlaneClient({ region: AWS_REGION });
 *
 * ── New package.json dependency ───────────────────────────────────────────────
 *   "@aws-sdk/client-iot-data-plane": "^3.540.0"
 */

// ── GET /fleet/shadow?unit=TRUCK-001 ─────────────────────────────────────────
async function handleGetShadow(event, iotdata) {
  const claims = await authenticate(event);
  const qs     = event.queryStringParameters || {};
  const unit   = qs.unit || '';

  if (!unit) return err(400, 'unit query parameter required');

  const thingName = `gobi-apu-${unit}`;

  let shadowRaw;
  try {
    const cmd = new GetThingShadowCommand({ thingName });
    const res = await iotdata.send(cmd);
    // payload is a Uint8Array
    shadowRaw = JSON.parse(Buffer.from(res.payload).toString('utf8'));
  } catch (e) {
    if (e.name === 'ResourceNotFoundException') {
      // Shadow doesn't exist yet — device has never connected
      return resp(200, {
        unit,
        shadow_exists: false,
        message: 'Shadow not yet created — device has not connected since provisioning.',
      });
    }
    throw e;
  }

  const state    = shadowRaw.state    || {};
  const metadata = shadowRaw.metadata || {};

  // Surface the most useful fields directly for the dashboard
  const reported = state.reported || {};
  const desired  = state.desired  || {};
  const delta    = state.delta    || {};

  // Work out how stale the reported state is
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
      online: staleSec !== null && staleSec < 30,  // missed ≤ 6 poll cycles
    },
    desired,
    delta,                    // fields where desired ≠ reported (pending delivery)
    last_updated: shadowRaw.timestamp || null,
  });
}

// ── POST /fleet/config ────────────────────────────────────────────────────────
// Body: { unit: "TRUCK-001", config: { poll_interval_s: 10, report_mode: "eco" } }
// Config keys that are valid to set:
const ALLOWED_CONFIG_KEYS = new Set([
  'poll_interval_s',
  'report_mode',
  'firmware_target',
  'reboot',
]);

async function handleSetConfig(event, iotdata) {
  const claims = await authenticate(event);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return err(400, 'Invalid JSON'); }

  const { unit, config } = body;
  if (!unit)   return err(400, 'unit required');
  if (!config || typeof config !== 'object') return err(400, 'config object required');

  // Whitelist check — never forward unknown keys to shadow
  const badKeys = Object.keys(config).filter(k => !ALLOWED_CONFIG_KEYS.has(k));
  if (badKeys.length > 0)
    return err(400, `Unknown config key(s): ${badKeys.join(', ')}. Allowed: ${[...ALLOWED_CONFIG_KEYS].join(', ')}`);

  // Validate individual values
  if (config.poll_interval_s !== undefined) {
    const v = config.poll_interval_s;
    if (typeof v !== 'number' || v < 5 || v > 60)
      return err(400, 'poll_interval_s must be a number 5–60');
  }
  if (config.report_mode !== undefined) {
    const allowed = ['normal', 'eco', 'debug'];
    if (!allowed.includes(config.report_mode))
      return err(400, `report_mode must be one of: ${allowed.join(', ')}`);
  }
  if (config.reboot !== undefined && typeof config.reboot !== 'boolean') {
    return err(400, 'reboot must be a boolean');
  }

  const thingName = `gobi-apu-${unit}`;
  const payload   = JSON.stringify({ state: { desired: config } });

  try {
    const cmd = new UpdateThingShadowCommand({
      thingName,
      payload: Buffer.from(payload, 'utf8'),
    });
    const res = await iotdata.send(cmd);
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

/*
 * ── Wire into exports.handler route table ────────────────────────────────────
 * Add these two cases inside the try{} block in your existing handler:
 *
 *   // Shadow endpoints
 *   if (method === 'GET'  && path.endsWith('/fleet/shadow'))  return await handleGetShadow(event, iotdata);
 *   if (method === 'POST' && path.endsWith('/fleet/config'))  return await handleSetConfig(event, iotdata);
 *
 * ── Lambda execution role — add this IAM permission to api_lambda_role ────────
 * The Lambda that runs api.js needs these IoT permissions (add to Terraform):
 *
 *   {
 *     Effect   = "Allow"
 *     Action   = ["iot:GetThingShadow", "iot:UpdateThingShadow"]
 *     Resource = "arn:aws:iot:${region}:${account_id}:thing/gobi-apu-*"
 *   }
 */

module.exports = { handleGetShadow, handleSetConfig };
