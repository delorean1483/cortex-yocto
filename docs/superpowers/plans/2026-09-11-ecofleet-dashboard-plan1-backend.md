# EcoFleet Dashboard — Plan 1: Contract + Backend Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile the cloud ingest + API Lambdas to the real `gobi-agent` telemetry contract, store and serve the full field set, add a role-guarded remote-control command endpoint, and provide synthetic demo peers — all covered by host tests.

**Architecture:** Extract the pure, testable logic (field mapping, response normalization, permission checks, command validation, demo generation) into small standalone modules tested with `node:assert` (matching the existing `faults.js` / `faults.test.js` pattern), then wire the thin AWS-SDK handlers to those modules. One golden fixture (`cloud/fixtures/telemetry.sample.json`) is the shared source of truth for both the ingest mapper test and the API view test.

**Tech Stack:** Node.js (CommonJS), `@influxdata/influxdb-client`, `@aws-sdk/client-iot-data-plane`, `node:assert` test scripts (no test framework — run with `node <file>.test.js`).

**Spec:** `docs/superpowers/specs/2026-09-11-ecofleet-web-dashboard-design.md`

## Global Constraints

- **No firmware / gobi-agent changes.** The agent's `build_telemetry_json()` output is frozen and authoritative.
- **Test pattern:** plain `node:assert` self-running scripts named `*.test.js`, runnable as `node path/to/file.test.js`, exit 0 on pass / non-zero on fail. These are excluded from the deploy zip by `deploy-lambda.sh` (`--exclude "*.test.js"`).
- **CommonJS** (`require`/`module.exports`), `'use strict';` at top of every file, matching existing Lambda style.
- **Field names are the contract** — the ingest mapper (what gets written to InfluxDB) and the API view mapper (what gets read back) MUST use identical field names. Both are asserted against the same golden fixture.
- **No new runtime dependencies** — use only packages already in each Lambda's `package.json`.
- **Deploys are user-run.** This plan produces code + passing host tests only; it does not run `deploy-lambda.sh`, terraform, or touch live AWS.

---

### Task 1: Data contract + golden fixture

**Files:**
- Create: `cloud/CONTRACT.md`
- Create: `cloud/fixtures/telemetry.sample.json`
- Create: `cloud/fixtures/fixture.test.js`

**Interfaces:**
- Produces: `cloud/fixtures/telemetry.sample.json` — a complete telemetry payload with every field from `build_telemetry_json()`. Consumed by Tasks 2 and 3.

- [ ] **Step 1: Write the failing test**

Create `cloud/fixtures/fixture.test.js`:

```javascript
'use strict';
// Guards that the golden telemetry fixture carries every contract field.
// Run: node cloud/fixtures/fixture.test.js
const assert = require('node:assert');
const fx = require('./telemetry.sample.json');

const REQUIRED = [
  'unit', 'ts',
  'cabin_temp_f', 'ext_temp_f', 'batt_v', 'rpm', 'oil_ok', 'ignition',
  'mode', 'mode_n', 'engine_status', 'engine_status_n',
  'control_status', 'control_status_n', 'error', 'error_n',
  'oil_change', 'oil_change_n',
  'engine_hrs', 'oil_hrs', 'machine_hrs',
  'clmt_setpoint_f', 'batt_setpoint_v', 'fan_speed', 'fan_auto',
  'diag_active', 'diag_outputs', 'apu_fw_version',
  'heater_present', 'heater_state', 'heater_target_level', 'heater_active_level',
  'heater_error', 'heater_supply_v', 'heater_fan_rpm', 'heater_pump_hz',
  'heater_exchanger', 'heater_state_seconds', 'heater_age_ms', 'heater_flags',
  'heater_safe_off', 'heater_comms_ok',
  'heater_valid_frames', 'heater_checksum_failures', 'heater_transport_errors',
];

let failed = 0;
for (const k of REQUIRED) {
  try { assert.ok(k in fx, `missing key: ${k}`); }
  catch (e) { failed++; console.error(`  [FAIL] ${e.message}`); }
}
console.log(`\n${REQUIRED.length - failed}/${REQUIRED.length} keys present`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node cloud/fixtures/fixture.test.js`
Expected: FAIL — `Cannot find module './telemetry.sample.json'`.

- [ ] **Step 3: Create the golden fixture**

Create `cloud/fixtures/telemetry.sample.json` (values reflect a battery-mode idle APU with the heater present but off and no one-wire bridge — matching bench state: cabin ~96°F, batt 12.6 V, heater flags `0x10` xport-fault, comms_ok false):

```json
{
  "unit": "APU-000123",
  "ts": 1757563200000,
  "cabin_temp_f": 96.1,
  "ext_temp_f": 71.4,
  "batt_v": 12.64,
  "rpm": 0,
  "oil_ok": true,
  "ignition": false,
  "mode": "battery",
  "mode_n": 2,
  "engine_status": "off",
  "engine_status_n": 0,
  "control_status": "idle",
  "control_status_n": 0,
  "error": "none",
  "error_n": 0,
  "oil_change": "ok",
  "oil_change_n": 0,
  "engine_hrs": 4,
  "oil_hrs": 4,
  "machine_hrs": 128,
  "clmt_setpoint_f": 72,
  "batt_setpoint_v": 12.8,
  "fan_speed": 0,
  "fan_auto": true,
  "diag_active": false,
  "diag_outputs": 0,
  "apu_fw_version": 10240,
  "heater_present": true,
  "heater_state": "off",
  "heater_target_level": 3,
  "heater_active_level": 0,
  "heater_error": 0,
  "heater_supply_v": 0.0,
  "heater_fan_rpm": 0,
  "heater_pump_hz": 0.0,
  "heater_exchanger": 0,
  "heater_state_seconds": 0,
  "heater_age_ms": 0,
  "heater_flags": 16,
  "heater_safe_off": false,
  "heater_comms_ok": false,
  "heater_valid_frames": 0,
  "heater_checksum_failures": 0,
  "heater_transport_errors": 4213
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node cloud/fixtures/fixture.test.js`
Expected: PASS — `45/45 keys present`.

- [ ] **Step 5: Write CONTRACT.md**

Create `cloud/CONTRACT.md` documenting the three payloads. Copy the telemetry field table from the spec (§1a), the fault payload (§1b: `{unit, ts, error, error_n, status}`), and the shadow desired/reported contract (§1c). Add one line at top: "Authoritative source: `gobi-agent/files/main.c` `build_telemetry_json()`. The golden fixture `fixtures/telemetry.sample.json` is asserted by both the ingest and API host tests."

- [ ] **Step 6: Commit**

```bash
git add cloud/CONTRACT.md cloud/fixtures/telemetry.sample.json cloud/fixtures/fixture.test.js
git commit -m "feat(cloud): telemetry contract doc + golden fixture"
```

---

### Task 2: Ingest — reconcile field mapping to real contract

**Files:**
- Create: `cloud/lambda/ingest/telemetry-map.js`
- Create: `cloud/lambda/ingest/telemetry-map.test.js`
- Modify: `cloud/lambda/ingest/index.js` (replace inline Point building)

**Interfaces:**
- Produces: `mapTelemetry(msg)` → `{ measurement: 'telemetry', tags: {unit, mode, engine_status, control_status, error, oil_change, heater_state}, fields: {<name>: {type:'float'|'int'|'bool'|'string', value:number|boolean|string}}, timestamp: number }`. Consumed by `index.js`.

- [ ] **Step 1: Write the failing test**

Create `cloud/lambda/ingest/telemetry-map.test.js`:

```javascript
'use strict';
// Run: node cloud/lambda/ingest/telemetry-map.test.js
const assert = require('node:assert');
const path = require('node:path');
const { mapTelemetry } = require('./telemetry-map');
const fx = require(path.join('..', '..', 'fixtures', 'telemetry.sample.json'));

const p = mapTelemetry(fx);

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  [PASS] ${name}`); }
  catch (e) { failed++; console.error(`  [FAIL] ${name}: ${e.message}`); }
};

check('measurement + timestamp', () => {
  assert.strictEqual(p.measurement, 'telemetry');
  assert.strictEqual(p.timestamp, fx.ts);
});
check('unit + enum tags', () => {
  assert.strictEqual(p.tags.unit, 'APU-000123');
  assert.strictEqual(p.tags.mode, 'battery');
  assert.strictEqual(p.tags.heater_state, 'off');
});
check('float field batt_v', () => {
  assert.deepStrictEqual(p.fields.batt_v, { type: 'float', value: 12.64 });
});
check('int field rpm', () => {
  assert.deepStrictEqual(p.fields.rpm, { type: 'int', value: 0 });
});
check('bool field oil_ok', () => {
  assert.deepStrictEqual(p.fields.oil_ok, { type: 'bool', value: true });
});
check('heater field carried', () => {
  assert.deepStrictEqual(p.fields.heater_transport_errors, { type: 'int', value: 4213 });
});
check('legacy names NOT present', () => {
  assert.ok(!('oil_psi' in p.fields), 'oil_psi should be gone');
  assert.ok(!('dc_v' in p.fields), 'dc_v should be gone');
  assert.ok(!('coolant_t' in p.fields), 'coolant_t should be gone');
});
check('missing fields tolerated', () => {
  const bare = mapTelemetry({ unit: 'X', ts: 1 });
  assert.strictEqual(bare.tags.unit, 'X');
  assert.strictEqual(bare.fields.batt_v.value, 0);
});

console.log(`\n${8 - failed}/8 checks passed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node cloud/lambda/ingest/telemetry-map.test.js`
Expected: FAIL — `Cannot find module './telemetry-map'`.

- [ ] **Step 3: Write the mapper**

Create `cloud/lambda/ingest/telemetry-map.js`:

```javascript
'use strict';

// Pure telemetry mapper: gobi-agent build_telemetry_json() payload ->
// InfluxDB point descriptor. No I/O. Field names ARE the contract (see
// cloud/CONTRACT.md); they must match cloud/lambda/api/telemetry-view.js.

const TAGS = ['mode', 'engine_status', 'control_status', 'error', 'oil_change', 'heater_state'];

const FLOAT = [
  'cabin_temp_f', 'ext_temp_f', 'batt_v', 'clmt_setpoint_f', 'batt_setpoint_v',
  'heater_supply_v', 'heater_pump_hz',
];
const INT = [
  'rpm', 'mode_n', 'engine_status_n', 'control_status_n', 'error_n', 'oil_change_n',
  'engine_hrs', 'oil_hrs', 'machine_hrs', 'fan_speed', 'diag_outputs', 'apu_fw_version',
  'heater_target_level', 'heater_active_level', 'heater_error', 'heater_fan_rpm',
  'heater_exchanger', 'heater_state_seconds', 'heater_age_ms', 'heater_flags',
  'heater_valid_frames', 'heater_checksum_failures', 'heater_transport_errors',
];
const BOOL = [
  'oil_ok', 'ignition', 'fan_auto', 'diag_active', 'heater_present',
  'heater_safe_off', 'heater_comms_ok',
];

function mapTelemetry(msg) {
  const tags = { unit: String(msg.unit) };
  for (const t of TAGS) tags[t] = msg[t] != null ? String(msg[t]) : 'unknown';

  const fields = {};
  for (const f of FLOAT) fields[f] = { type: 'float', value: Number(msg[f] ?? 0) };
  for (const f of INT)   fields[f] = { type: 'int',   value: Math.trunc(Number(msg[f] ?? 0)) };
  for (const f of BOOL)  fields[f] = { type: 'bool',  value: Boolean(msg[f] ?? false) };

  return { measurement: 'telemetry', tags, fields, timestamp: msg.ts };
}

module.exports = { mapTelemetry, TAGS, FLOAT, INT, BOOL };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node cloud/lambda/ingest/telemetry-map.test.js`
Expected: PASS — `8/8 checks passed`.

- [ ] **Step 5: Wire index.js to the mapper**

In `cloud/lambda/ingest/index.js`, replace the inline `new Point('telemetry')…` block (lines ~39–53) with descriptor-driven building. Add near the top: `const { mapTelemetry } = require('./telemetry-map');`. Replace the point construction with:

```javascript
  const desc  = mapTelemetry(msg);
  const point = new Point(desc.measurement).timestamp(desc.timestamp);
  for (const [k, v] of Object.entries(desc.tags)) point.tag(k, v);
  for (const [k, f] of Object.entries(desc.fields)) {
    if (f.type === 'float')      point.floatField(k, f.value);
    else if (f.type === 'int')   point.intField(k, f.value);
    else if (f.type === 'bool')  point.booleanField(k, f.value);
    else                         point.stringField(k, String(f.value));
  }
```

Also update the stale comment at lines ~25–27 to reference `cloud/CONTRACT.md`.

- [ ] **Step 6: Sanity-run the mapper test again (regression)**

Run: `node cloud/lambda/ingest/telemetry-map.test.js`
Expected: PASS — `8/8 checks passed`.

- [ ] **Step 7: Commit**

```bash
git add cloud/lambda/ingest/telemetry-map.js cloud/lambda/ingest/telemetry-map.test.js cloud/lambda/ingest/index.js
git commit -m "feat(ingest): map full agent telemetry contract to InfluxDB"
```

---

### Task 3: API — full telemetry view + latest snapshot

**Files:**
- Create: `cloud/lambda/api/telemetry-view.js`
- Create: `cloud/lambda/api/telemetry-view.test.js`
- Modify: `cloud/lambda/api/api.js` (`handleGetTelemetry`, add `handleGetLatest`, router)

**Interfaces:**
- Consumes: field names from Task 2 (identical set).
- Produces: `mapTelemetryRow(r)` → normalized telemetry object (all contract fields + `ts`); `TELEMETRY_FIELD_NAMES` (string[]). Consumed by `handleGetTelemetry` and `handleGetLatest`.

- [ ] **Step 1: Write the failing test**

Create `cloud/lambda/api/telemetry-view.test.js`:

```javascript
'use strict';
// Run: node cloud/lambda/api/telemetry-view.test.js
const assert = require('node:assert');
const path = require('node:path');
const { mapTelemetryRow } = require('./telemetry-view');
const fx = require(path.join('..', '..', 'fixtures', 'telemetry.sample.json'));

// A pivoted InfluxDB row looks like the fixture plus a _time column and no ts.
const row = { ...fx, _time: '2025-09-11T04:00:00Z' };
delete row.ts;

const out = mapTelemetryRow(row);

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  [PASS] ${name}`); }
  catch (e) { failed++; console.error(`  [FAIL] ${name}: ${e.message}`); }
};

check('ts from _time', () => assert.strictEqual(out.ts, new Date(row._time).getTime()));
check('carries batt_v', () => assert.strictEqual(out.batt_v, 12.64));
check('carries heater block', () => {
  assert.strictEqual(out.heater_state, 'off');
  assert.strictEqual(out.heater_transport_errors, 4213);
  assert.strictEqual(out.heater_comms_ok, false);
});
check('carries enum label + n', () => {
  assert.strictEqual(out.mode, 'battery');
  assert.strictEqual(out.mode_n, 2);
});
check('no _time leaks through', () => assert.ok(!('_time' in out)));

console.log(`\n${5 - failed}/5 checks passed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node cloud/lambda/api/telemetry-view.test.js`
Expected: FAIL — `Cannot find module './telemetry-view'`.

- [ ] **Step 3: Write the view mapper**

Create `cloud/lambda/api/telemetry-view.js`:

```javascript
'use strict';

// Pure mapper: a pivoted InfluxDB telemetry row -> API response object.
// Field names MUST match cloud/lambda/ingest/telemetry-map.js (the contract).

const TELEMETRY_FIELD_NAMES = [
  'cabin_temp_f', 'ext_temp_f', 'batt_v', 'rpm', 'oil_ok', 'ignition',
  'mode', 'mode_n', 'engine_status', 'engine_status_n',
  'control_status', 'control_status_n', 'error', 'error_n',
  'oil_change', 'oil_change_n',
  'engine_hrs', 'oil_hrs', 'machine_hrs',
  'clmt_setpoint_f', 'batt_setpoint_v', 'fan_speed', 'fan_auto',
  'diag_active', 'diag_outputs', 'apu_fw_version',
  'heater_present', 'heater_state', 'heater_target_level', 'heater_active_level',
  'heater_error', 'heater_supply_v', 'heater_fan_rpm', 'heater_pump_hz',
  'heater_exchanger', 'heater_state_seconds', 'heater_age_ms', 'heater_flags',
  'heater_safe_off', 'heater_comms_ok',
  'heater_valid_frames', 'heater_checksum_failures', 'heater_transport_errors',
];

function mapTelemetryRow(r) {
  const out = { ts: r._time ? new Date(r._time).getTime() : r.ts };
  for (const k of TELEMETRY_FIELD_NAMES) if (k in r) out[k] = r[k];
  return out;
}

module.exports = { mapTelemetryRow, TELEMETRY_FIELD_NAMES };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node cloud/lambda/api/telemetry-view.test.js`
Expected: PASS — `5/5 checks passed`.

- [ ] **Step 5: Use the mapper in handleGetTelemetry + add handleGetLatest**

In `cloud/lambda/api/api.js`: add `const { mapTelemetryRow } = require('./telemetry-view');` near the top. In `handleGetTelemetry`, replace the `rows.map(r => ({ ts…, dc_v… }))` block (lines ~219–233) with `const telemetry = rows.map(mapTelemetryRow);`. Then add a new handler after it:

```javascript
// GET /fleet/units/{unit}/latest — most recent full snapshot
async function handleGetLatest(event) {
  const unit = (event.pathParameters || {}).unit;
  if (!unit) return err(400, 'unit path parameter required');
  await getInfluxToken();
  const queryApi = getInfluxClient().getQueryApi(INFLUX_ORG);
  const flux = `
    from(bucket: "telemetry")
      |> range(start: -24h)
      |> filter(fn: (r) => r._measurement == "telemetry" and r.unit == "${unit.replace(/"/g, '')}")
      |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"], desc: true)
      |> limit(n: 1)
  `;
  const rows = await queryApi.collectRows(flux);
  if (!rows.length) return resp(200, { unit, latest: null });
  return resp(200, { unit, latest: mapTelemetryRow(rows[0]) });
}
```

Register it in the router (inside the `if (path.includes('/fleet/units/'))` block): `if (path.endsWith('/latest')) return await handleGetLatest(event);`.

- [ ] **Step 6: Run the view test again (regression)**

Run: `node cloud/lambda/api/telemetry-view.test.js`
Expected: PASS — `5/5 checks passed`.

- [ ] **Step 7: Commit**

```bash
git add cloud/lambda/api/telemetry-view.js cloud/lambda/api/telemetry-view.test.js cloud/lambda/api/api.js
git commit -m "feat(api): serve full telemetry contract + latest snapshot"
```

---

### Task 4: API — command validation + role permissions

**Files:**
- Create: `cloud/lambda/api/permissions.js`
- Create: `cloud/lambda/api/permissions.test.js`

**Interfaces:**
- Produces:
  - `canWrite(role, action)` → boolean. `role` ∈ {admin, fm, maint, eu}; `action` ∈ {heater, setpoint, apu, diag, ota, users}.
  - `validateCommand(body)` → `{ ok: boolean, error?: string, desired?: object }` — validates a command body and returns the shadow-`desired` object to write.
  - `commandActions(desired)` → string[] — the permission actions a desired object requires.

- [ ] **Step 1: Write the failing test**

Create `cloud/lambda/api/permissions.test.js`:

```javascript
'use strict';
// Run: node cloud/lambda/api/permissions.test.js
const assert = require('node:assert');
const { canWrite, validateCommand, commandActions } = require('./permissions');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  [PASS] ${name}`); }
  catch (e) { failed++; console.error(`  [FAIL] ${name}: ${e.message}`); }
};

check('admin can do everything', () => {
  for (const a of ['heater','setpoint','apu','diag','ota','users'])
    assert.strictEqual(canWrite('admin', a), true, a);
});
check('eu is read-only', () => {
  for (const a of ['heater','setpoint','apu','diag','ota','users'])
    assert.strictEqual(canWrite('eu', a), false, a);
});
check('maint: heater/setpoint/diag yes, apu/ota no', () => {
  assert.strictEqual(canWrite('maint', 'heater'), true);
  assert.strictEqual(canWrite('maint', 'diag'), true);
  assert.strictEqual(canWrite('maint', 'apu'), false);
  assert.strictEqual(canWrite('maint', 'ota'), false);
});
check('unknown role denied', () => assert.strictEqual(canWrite('nobody', 'heater'), false));

check('valid heater command', () => {
  const r = validateCommand({ heater: { on: 1, level: 3 } });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.desired, { heater: { on: 1, level: 3 } });
  assert.deepStrictEqual(commandActions(r.desired), ['heater']);
});
check('heater level out of range rejected', () => {
  assert.strictEqual(validateCommand({ heater: { on: 1, level: 11 } }).ok, false);
});
check('apu start valid, requires apu action', () => {
  const r = validateCommand({ apu_command: 'start' });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(commandActions(r.desired), ['apu']);
});
check('bad apu_command rejected', () => {
  assert.strictEqual(validateCommand({ apu_command: 'explode' }).ok, false);
});
check('ota firmware_target valid', () => {
  const r = validateCommand({ firmware_target: '1.2.41' });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(commandActions(r.desired), ['ota']);
});
check('empty command rejected', () => {
  assert.strictEqual(validateCommand({}).ok, false);
});

console.log(`\n${10 - failed}/10 checks passed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node cloud/lambda/api/permissions.test.js`
Expected: FAIL — `Cannot find module './permissions'`.

- [ ] **Step 3: Write permissions.js**

Create `cloud/lambda/api/permissions.js`:

```javascript
'use strict';

// Role → write-action permission matrix + command-body validation.
// Roles: admin, fm (fleet manager), maint (maintenance), eu (end user).
// Actions: heater, setpoint, apu, diag, ota, users.

const MATRIX = {
  admin: new Set(['heater', 'setpoint', 'apu', 'diag', 'ota', 'users']),
  fm:    new Set(['heater', 'setpoint', 'apu', 'diag', 'ota', 'users']),
  maint: new Set(['heater', 'setpoint', 'diag']),
  eu:    new Set([]),
};

function canWrite(role, action) {
  const set = MATRIX[role];
  return set ? set.has(action) : false;
}

function validateCommand(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'command body required' };
  const desired = {};

  if (body.heater !== undefined) {
    const h = body.heater;
    if (!h || typeof h !== 'object') return { ok: false, error: 'heater must be an object' };
    const out = {};
    if (h.on !== undefined) {
      if (h.on !== 0 && h.on !== 1) return { ok: false, error: 'heater.on must be 0 or 1' };
      out.on = h.on;
    }
    if (h.level !== undefined) {
      if (!Number.isInteger(h.level) || h.level < 1 || h.level > 10)
        return { ok: false, error: 'heater.level must be an integer 1–10' };
      out.level = h.level;
    }
    if (Object.keys(out).length === 0) return { ok: false, error: 'heater needs on and/or level' };
    desired.heater = out;
  }

  if (body.apu_command !== undefined) {
    if (!['start', 'stop'].includes(body.apu_command))
      return { ok: false, error: 'apu_command must be "start" or "stop"' };
    desired.apu_command = body.apu_command;
  }

  if (body.firmware_target !== undefined) {
    if (typeof body.firmware_target !== 'string' || !/^\d+\.\d+\.\d+$/.test(body.firmware_target))
      return { ok: false, error: 'firmware_target must be a semver string (e.g. 1.2.41)' };
    desired.firmware_target = body.firmware_target;
  }

  if (body.clmt_setpoint_f !== undefined) {
    const v = body.clmt_setpoint_f;
    if (typeof v !== 'number' || v < 50 || v > 90)
      return { ok: false, error: 'clmt_setpoint_f must be 50–90' };
    desired.clmt_setpoint_f = v;
  }

  if (body.batt_setpoint_v !== undefined) {
    const v = body.batt_setpoint_v;
    if (typeof v !== 'number' || v < 10 || v > 15)
      return { ok: false, error: 'batt_setpoint_v must be 10–15' };
    desired.batt_setpoint_v = v;
  }

  if (Object.keys(desired).length === 0)
    return { ok: false, error: 'no recognized command fields' };
  return { ok: true, desired };
}

function commandActions(desired) {
  const actions = new Set();
  if (desired.heater) actions.add('heater');
  if (desired.apu_command) actions.add('apu');
  if (desired.firmware_target) actions.add('ota');
  if (desired.clmt_setpoint_f !== undefined || desired.batt_setpoint_v !== undefined)
    actions.add('setpoint');
  return [...actions];
}

module.exports = { canWrite, validateCommand, commandActions, MATRIX };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node cloud/lambda/api/permissions.test.js`
Expected: PASS — `10/10 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add cloud/lambda/api/permissions.js cloud/lambda/api/permissions.test.js
git commit -m "feat(api): role permission matrix + command validation"
```

---

### Task 5: API — guarded command endpoint

**Files:**
- Modify: `cloud/lambda/api/api.js` (add `handleCommand`, router entry; extend `ALLOWED_CONFIG_KEYS`)

**Interfaces:**
- Consumes: `validateCommand`, `authorizeCommand` (Task 4). `authenticate(event)` returns `claims` with `claims.role`. (The demo-unit rejection guard is added in Task 6, once `demo.js` exists.)
- Produces: `POST /fleet/units/{unit}/command` route.

- [ ] **Step 1: Write the failing test (pure guard logic)**

The endpoint itself calls AWS; the testable core is the authorize step. Add to `cloud/lambda/api/permissions.test.js` a block for a helper `authorizeCommand(role, desired)` → `{ ok, error? }`:

```javascript
// --- authorizeCommand ---
const { authorizeCommand } = require('./permissions');
check('maint denied apu command', () => {
  const r = authorizeCommand('maint', { apu_command: 'start' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /not permitted/);
});
check('fm allowed heater command', () => {
  assert.strictEqual(authorizeCommand('fm', { heater: { on: 1 } }).ok, true);
});
```
(Update the printed total from `10` to `12`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node cloud/lambda/api/permissions.test.js`
Expected: FAIL — `authorizeCommand is not a function`.

- [ ] **Step 3: Add authorizeCommand to permissions.js**

Append to `cloud/lambda/api/permissions.js` before `module.exports`:

```javascript
function authorizeCommand(role, desired) {
  for (const action of commandActions(desired)) {
    if (!canWrite(role, action))
      return { ok: false, error: `role "${role}" not permitted to ${action}` };
  }
  return { ok: true };
}
```
Add `authorizeCommand` to the `module.exports` object.

- [ ] **Step 4: Run test to verify it passes**

Run: `node cloud/lambda/api/permissions.test.js`
Expected: PASS — `12/12 checks passed`.

- [ ] **Step 5: Add the endpoint in api.js**

In `cloud/lambda/api/api.js`: import at top: `const { validateCommand, authorizeCommand } = require('./permissions');`. Add the handler (the demo-unit guard is inserted in Task 6):

```javascript
// POST /fleet/units/{unit}/command — role-guarded remote control (shadow desired)
async function handleCommand(event, claims) {
  const unit = (event.pathParameters || {}).unit;
  if (!unit) return err(400, 'unit path parameter required');

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return err(400, 'Invalid JSON'); }

  const v = validateCommand(body);
  if (!v.ok) return err(400, v.error);

  const authz = authorizeCommand(claims.role || 'eu', v.desired);
  if (!authz.ok) return err(403, authz.error);

  const thingName = `gobi-apu-${unit}`;
  const payload   = JSON.stringify({ state: { desired: v.desired } });
  try {
    const res     = await iotdata.send(new UpdateThingShadowCommand({
      thingName, payload: Buffer.from(payload, 'utf8'),
    }));
    const updated = JSON.parse(Buffer.from(res.payload).toString('utf8'));
    return resp(200, { unit, shadow_version: updated.version, desired: v.desired,
      message: 'Command queued. Device applies on next poll; watch shadow reported for ack.' });
  } catch (e) {
    if (e.name === 'ResourceNotFoundException')
      return err(404, `Shadow not found for ${unit} — has the device connected yet?`);
    throw e;
  }
}
```

Register in the router `if (path.includes('/fleet/units/'))` block: `if (method === 'POST' && path.endsWith('/command')) return await handleCommand(event, claims);`. Also add `'clmt_setpoint_f'` and `'batt_setpoint_v'` to `ALLOWED_CONFIG_KEYS` so `/fleet/config` accepts setpoints too.

- [ ] **Step 6: Commit**

```bash
git add cloud/lambda/api/api.js cloud/lambda/api/permissions.js cloud/lambda/api/permissions.test.js
git commit -m "feat(api): guarded remote-control command endpoint"
```

---

### Task 6: API — synthetic demo peers

**Files:**
- Create: `cloud/lambda/api/demo.js`
- Create: `cloud/lambda/api/demo.test.js`
- Modify: `cloud/lambda/api/api.js` (`handleListUnits`, `handleGetLatest`, `handleGetTelemetry`)

**Interfaces:**
- Consumes: the telemetry field set (Task 1 fixture / Task 3 `TELEMETRY_FIELD_NAMES`) — demo snapshots must carry the same field names; `handleCommand` (Task 5), into which the demo-unit rejection guard is inserted here.
- Produces: `demoEnabled()`, `listDemoUnits()` → string[], `isDemoUnit(unit)` → bool, `demoLatest(unit)` → telemetry object, `demoSeries(unit, n)` → telemetry[].

- [ ] **Step 1: Write the failing test**

Create `cloud/lambda/api/demo.test.js`:

```javascript
'use strict';
// Run: DEMO_UNITS=on node cloud/lambda/api/demo.test.js
const assert = require('node:assert');
process.env.DEMO_UNITS = 'on';
const { demoEnabled, listDemoUnits, isDemoUnit, demoLatest, demoSeries } = require('./demo');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  [PASS] ${name}`); }
  catch (e) { failed++; console.error(`  [FAIL] ${name}: ${e.message}`); }
};

check('enabled by env', () => assert.strictEqual(demoEnabled(), true));
check('lists >=3 demo units', () => assert.ok(listDemoUnits().length >= 3));
check('isDemoUnit true for a demo id', () => assert.strictEqual(isDemoUnit(listDemoUnits()[0]), true));
check('isDemoUnit false for real id', () => assert.strictEqual(isDemoUnit('APU-000123'), false));
check('demoLatest is deterministic', () => {
  const u = listDemoUnits()[0];
  assert.deepStrictEqual(demoLatest(u), demoLatest(u));
});
check('demoLatest has contract fields', () => {
  const l = demoLatest(listDemoUnits()[0]);
  assert.ok('batt_v' in l && 'heater_state' in l && 'ts' in l);
});
check('demoSeries length', () => assert.strictEqual(demoSeries(listDemoUnits()[0], 12).length, 12));

console.log(`\n${7 - failed}/7 checks passed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DEMO_UNITS=on node cloud/lambda/api/demo.test.js`
Expected: FAIL — `Cannot find module './demo'`.

- [ ] **Step 3: Write demo.js**

Create `cloud/lambda/api/demo.js`:

```javascript
'use strict';

// Synthetic demo peers so fleet screens are populated without a real fleet.
// Deterministic per (unit, hour) so repeated calls agree. Never written to
// InfluxDB; never controllable (see handleCommand). Toggle via DEMO_UNITS env.

const DEMO_UNITS = ['APU-DEMO-01', 'APU-DEMO-02', 'APU-DEMO-03'];

function demoEnabled() {
  return (process.env.DEMO_UNITS || 'off').toLowerCase() === 'on';
}
function listDemoUnits() { return demoEnabled() ? [...DEMO_UNITS] : []; }
function isDemoUnit(unit) { return DEMO_UNITS.includes(unit); }

// Tiny deterministic PRNG (mulberry32) seeded from unit+bucket.
function seed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function snapshot(unit, tsMs) {
  const bucket = Math.floor(tsMs / 3600000); // per-hour determinism
  const r = seed(`${unit}:${bucket}`);
  const running = r() > 0.4;
  return {
    ts: tsMs,
    unit,
    demo: true,
    cabin_temp_f: Math.round((68 + r() * 20) * 10) / 10,
    ext_temp_f: Math.round((50 + r() * 40) * 10) / 10,
    batt_v: Math.round((12.2 + r() * 1.6) * 100) / 100,
    rpm: running ? 1800 + Math.round(r() * 200) : 0,
    oil_ok: r() > 0.1,
    ignition: running,
    mode: running ? 'engine' : 'battery', mode_n: running ? 1 : 2,
    engine_status: running ? 'running' : 'off', engine_status_n: running ? 1 : 0,
    control_status: running ? 'climate' : 'idle', control_status_n: running ? 3 : 0,
    error: 'none', error_n: 0,
    oil_change: 'ok', oil_change_n: 0,
    engine_hrs: 100 + bucket % 900, oil_hrs: bucket % 250, machine_hrs: 500 + bucket % 4000,
    clmt_setpoint_f: 72, batt_setpoint_v: 12.8,
    fan_speed: running ? 40 + Math.round(r() * 50) : 0, fan_auto: true,
    diag_active: false, diag_outputs: 0, apu_fw_version: 10240,
    heater_present: true, heater_state: 'off',
    heater_target_level: 3, heater_active_level: 0, heater_error: 0,
    heater_supply_v: 0, heater_fan_rpm: 0, heater_pump_hz: 0, heater_exchanger: 0,
    heater_state_seconds: 0, heater_age_ms: 0, heater_flags: 16,
    heater_safe_off: false, heater_comms_ok: false,
    heater_valid_frames: 0, heater_checksum_failures: 0, heater_transport_errors: 0,
  };
}

function demoLatest(unit) { return snapshot(unit, Date.now() - (Date.now() % 3600000)); }
function demoSeries(unit, n) {
  const now = Date.now() - (Date.now() % 3600000);
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(snapshot(unit, now - i * 3600000));
  return out;
}

module.exports = { demoEnabled, listDemoUnits, isDemoUnit, demoLatest, demoSeries, DEMO_UNITS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DEMO_UNITS=on node cloud/lambda/api/demo.test.js`
Expected: PASS — `7/7 checks passed`.

- [ ] **Step 5: Merge demo peers into the read handlers**

In `cloud/lambda/api/api.js` add the import at top: `const { isDemoUnit, listDemoUnits, demoLatest, demoSeries } = require('./demo');`. Then:

- `handleCommand` (from Task 5): insert as the first line after the `unit` null-check: `if (isDemoUnit(unit)) return err(400, 'demo units cannot be controlled');`
- `handleListUnits`: after building the real `units` array, append demo units:
  ```javascript
  const all = [...units.map(u => ({ unit: u, demo: false })), ...listDemoUnits().map(u => ({ unit: u, demo: true }))];
  return resp(200, { units: all });
  ```
- `handleGetLatest`: at the very top, `if (isDemoUnit(unit)) return resp(200, { unit, latest: demoLatest(unit) });`
- `handleGetTelemetry`: at the very top (after unit check), `if (isDemoUnit(unit)) { const s = demoSeries(unit, Math.min(parseInt((event.queryStringParameters||{}).limit||'48',10), 168)); return resp(200, { unit, count: s.length, telemetry: s }); }`

- [ ] **Step 6: Run the demo test again (regression)**

Run: `DEMO_UNITS=on node cloud/lambda/api/demo.test.js`
Expected: PASS — `7/7 checks passed`.

- [ ] **Step 7: Run the full backend test suite**

Run each and confirm all pass:
```bash
node cloud/fixtures/fixture.test.js
node cloud/lambda/ingest/telemetry-map.test.js
node cloud/lambda/api/telemetry-view.test.js
node cloud/lambda/api/permissions.test.js
DEMO_UNITS=on node cloud/lambda/api/demo.test.js
```
Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add cloud/lambda/api/demo.js cloud/lambda/api/demo.test.js cloud/lambda/api/api.js
git commit -m "feat(api): synthetic labeled demo peers"
```

---

## Notes for the executor

- **`{unit}` route matching:** the existing router matches suffixes (`path.endsWith('/telemetry')`). `/latest` and `/command` follow the same convention — ensure the `/command` check (POST) is inside `if (path.includes('/fleet/units/'))`.
- **Deploy (user-run, out of scope here):** after review, deploy with `cloud/lambda/deploy-lambda.sh` (excludes `*.test.js`); watch for the known spurious `ResourceConflictException` (verify via `CodeSha256`). Set `DEMO_UNITS=on` on the api Lambda's env to show peers.
- **Live verification (user-run):** `GET /fleet/units/APU-<serial>/latest` should return the full heater/sensor block once the ingest Lambda is redeployed and the `.86` unit has published once.
```
