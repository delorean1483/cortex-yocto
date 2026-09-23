# Fleet Map + System Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Coming soon" Fleet map and System config pages with a map of admin-assigned unit locations (OpenStreetMap) and a per-unit settings page (reporting interval + guarded reboot + unit info).

**Architecture:** A new DynamoDB table `unit-locations` behind three new API routes (`GET /fleet/locations`, `PATCH|DELETE /fleet/units/{unit}/location`) with pure, unit-tested helpers in `locations-view.js`. The web app adds a Leaflet map page (pins colored by the existing `unitView` status) and a settings page built on the existing `POST /fleet/config` + `GET /fleet/shadow`. No firmware/agent changes.

**Tech Stack:** Node 20 Lambda (CommonJS, `node:assert` tests), AWS SDK v3 DocumentClient, Terraform (S3 remote state), React 18 + Vite + vitest + @tanstack/react-query v5, `leaflet@1.9.4` + `react-leaflet@4.2.1`.

**Spec:** `docs/superpowers/specs/2026-09-23-fleet-map-and-system-config-design.md`

**Repo root:** `~/dev/cortex-yocto` (NOT the iCloud folder under `~/Documents`). Branch: `feat/fleet-map-system-config` (already exists, holds the spec).

## Global Constraints

- Location table name: `${var.project}-${var.env}-unit-locations` (prod: `ecofleet-prod-unit-locations`), hash key `unit` (S), PAY_PER_REQUEST.
- Location item fields: `unit`, `lat` (−90…90), `lon` (−180…180), optional `label` (≤ 60 chars), `updated_by`, `updated_at` (epoch ms).
- Routes: `GET /fleet/locations`, `PATCH /fleet/units/{unit}/location`, `DELETE /fleet/units/{unit}/location`. Do **not** use PUT (CORS allows only `GET, POST, PATCH, DELETE, OPTIONS`).
- Role action `location`: admin ✓, fm ✓, maint ✗, eu ✗ — in **both** `cloud/lambda/api/permissions.js` and `cloud/frontend/src/api/permissions.js`.
- Demo units (`APU-DEMO-*`) are never stored; they get fixed demo positions and can't be edited.
- `source` values: `"assigned"`, `"demo"` (`"gps"` reserved, not produced).
- Map tiles: OpenStreetMap standard tiles `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png` with attribution `&copy; OpenStreetMap contributors`. No API keys.
- Page copy: **"Assigned locations — units don't report GPS yet."**
- Reporting interval choices: **5, 10, 15, 20** seconds only. Pending timeout: **2 minutes** (120 000 ms).
- Reboot confirmation copy: **"The unit restarts via a cold power cycle and will be offline for about 1–2 minutes."**
- Settings roles: interval = `config` (admin, fm, maint); reboot = `ota` (admin, fm). Demo units read-only: **"Demo units can't be configured."**
- Never show `report_mode` or setpoints (the agent doesn't act on them).
- Never commit `cloud/terraform/terraform.tfvars` (secrets; already gitignored) or any `*.tfplan`.
- Terraform is **planned** in Task 3 but **applied only in Task 7 after the user's explicit OK**.

## Review Focus

1. **A fleet with no placed units** (prod today: TRUCK-001 unplaced, demo off) — map shows the neutral US view, every unit sits under "Not placed yet", nothing crashes. → Task 5 test "no locations".
2. **Hand-typed coordinates** — blank, `abc`, `32,77` (comma decimal), `200` — must show a field error and never call the API. → Task 4 `validateLatLon` tests + Task 5 "invalid coordinates" test.
3. **A unit reporting an interval outside 5/10/15/20** (e.g. 30 set via the API) or no shadow at all — show the value as-is (or "—") and keep the controls working. → Task 6 tests "reported 30" and "no shadow".
4. **A unit that never confirms an interval change** (offline) — status moves from Pending to "Not confirmed yet" after 2 minutes, no retry loop. → Task 6 `intervalStatus` tests.
5. **Demo units and read-only roles on write paths** — demo rows never show Set/Remove, maint sees no location editing and no Reboot, eu sees no controls; the API rejects demo edits (400) and wrong roles (403). → Task 1 permission tests, Task 5 and Task 6 role tests, Task 7 live checks.

---

## File Structure

**Backend (`cloud/lambda/api/`)**
- Create `locations-view.js` — pure: `validateLocation(body)`, `mergeLocations(items, demoUnits)`, `DEMO_LOCATIONS`, `LABEL_MAX`.
- Create `locations-view.test.js`.
- Modify `permissions.js` (+`location`), `permissions.test.js`.
- Modify `api.js` — env `LOCATIONS_TABLE`, three handlers, routing.

**Infrastructure (`cloud/terraform/`)**
- Modify `dynamodb.tf` (table + IAM statement), `lambda.tf` (env var), `api.tf` (three routes).

**Frontend (`cloud/frontend/`)**
- Modify `package.json`/`package-lock.json` (+leaflet, react-leaflet).
- Modify `src/api/permissions.js` (+`location`), `src/api/permissions.test.js`.
- Modify `src/api/client.js` (+`getLocations`, `setLocation`, `clearLocation`), `src/api/mock.js` (locations + interval echo).
- Create `src/api/locations.js` + `src/api/locations.test.js` — pure: `parseCoord`, `validateLatLon`, `orderMapRows`.
- Create `src/api/settings.js` + `src/api/settings.test.js` — pure: `INTERVAL_CHOICES`, `intervalStatus`.
- Modify `src/data/hooks.js` (+`useLocations`, `useSetLocation`, `useClearLocation`, `useFleetLatest`, `useSetConfig`).
- Create `src/components/map/FleetMap.jsx` — Leaflet wrapper only.
- Create `src/pages/FleetMapPage.jsx` + `src/pages/FleetMapPage.test.jsx`.
- Create `src/pages/SystemConfigPage.jsx` + `src/pages/SystemConfigPage.test.jsx`.
- Modify `src/App.jsx` (routes), `src/index.css` (map + settings styles).
- Delete `src/pages/StubPage.jsx` (no remaining users after Tasks 5–6).

---

### Task 1: Backend location rules + `location` permission

**Files:**
- Create: `cloud/lambda/api/locations-view.js`
- Create: `cloud/lambda/api/locations-view.test.js`
- Modify: `cloud/lambda/api/permissions.js` (MATRIX, header comment)
- Modify: `cloud/lambda/api/permissions.test.js`

**Interfaces:**
- Produces: `validateLocation(body) -> { ok: true, value: { lat:number, lon:number, label:string|null } } | { ok: false, error:string }`; `mergeLocations(items:Array, demoUnits:string[]) -> Array<{ unit, lat, lon, label, source, updated_by, updated_at }>` sorted by `unit`; `DEMO_LOCATIONS`; `LABEL_MAX = 60`; `canWrite(role, 'location')`.

- [ ] **Step 1: Write the failing tests**

`cloud/lambda/api/locations-view.test.js`:
```js
'use strict';
// Run: node cloud/lambda/api/locations-view.test.js
const assert = require('node:assert');
const { validateLocation, mergeLocations, DEMO_LOCATIONS, LABEL_MAX } = require('./locations-view');

// ── validateLocation ──────────────────────────────────────────────────────
{
  assert.deepStrictEqual(validateLocation({ lat: 32.9, lon: -97.04 }),
    { ok: true, value: { lat: 32.9, lon: -97.04, label: null } });
  assert.deepStrictEqual(validateLocation({ lat: 90, lon: -180, label: '  Dallas yard ' }),
    { ok: true, value: { lat: 90, lon: -180, label: 'Dallas yard' } }, 'bounds inclusive, label trimmed');
  assert.strictEqual(validateLocation({ lat: 1, lon: 2, label: '' }).value.label, null, 'empty label -> null');
  assert.strictEqual(validateLocation({ lat: 1, lon: 2, label: '   ' }).value.label, null, 'blank label -> null');

  const bad = (body, re) => {
    const r = validateLocation(body);
    assert.strictEqual(r.ok, false, JSON.stringify(body));
    assert.match(r.error, re);
  };
  bad(null, /body required/);
  bad({ lat: '32.9', lon: -97 }, /lat/);          // strings are not numbers
  bad({ lat: 91, lon: 0 }, /lat/);
  bad({ lat: NaN, lon: 0 }, /lat/);
  bad({ lat: 0, lon: 180.5 }, /lon/);
  bad({ lat: 0 }, /lon/);
  bad({ lat: 0, lon: 0, label: 7 }, /label must be a string/);
  bad({ lat: 0, lon: 0, label: 'x'.repeat(LABEL_MAX + 1) }, /60 characters/);
  assert.strictEqual(validateLocation({ lat: 0, lon: 0, label: 'x'.repeat(LABEL_MAX) }).ok, true);
}

// ── mergeLocations ────────────────────────────────────────────────────────
{
  const items = [
    { unit: 'TRUCK-002', lat: 30, lon: -90, updated_by: 'a@x.io', updated_at: 5 },
    { unit: 'TRUCK-001', lat: 32.9, lon: -97, label: 'Yard', updated_by: 'b@x.io', updated_at: 9 },
  ];
  const out = mergeLocations(items, ['APU-DEMO-01']);
  assert.deepStrictEqual(out.map((l) => l.unit), ['APU-DEMO-01', 'TRUCK-001', 'TRUCK-002'], 'sorted by unit');
  assert.deepStrictEqual(out[1], { unit: 'TRUCK-001', lat: 32.9, lon: -97, label: 'Yard',
    source: 'assigned', updated_by: 'b@x.io', updated_at: 9 });
  assert.strictEqual(out[2].label, null, 'missing label -> null');
  assert.strictEqual(out[0].source, 'demo');
  assert.strictEqual(out[0].lat, DEMO_LOCATIONS['APU-DEMO-01'].lat);
  assert.deepStrictEqual(mergeLocations([], []), [], 'nothing stored, demo off');
  assert.deepStrictEqual(mergeLocations(undefined, ['NOT-A-DEMO']), [], 'unknown demo ids ignored');
}

console.log('locations-view.test.js: all assertions passed');
```

Append to `cloud/lambda/api/permissions.test.js` **before** the final `console.log(...)` / `process.exit(...)` lines:
```js
check('location: admin and fm can set unit locations; maint and eu cannot', () => {
  assert.strictEqual(canWrite('admin', 'location'), true);
  assert.strictEqual(canWrite('fm', 'location'), true);
  assert.strictEqual(canWrite('maint', 'location'), false);
  assert.strictEqual(canWrite('eu', 'location'), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/dev/cortex-yocto && node cloud/lambda/api/locations-view.test.js; node cloud/lambda/api/permissions.test.js | tail -3`
Expected: first command fails with `Cannot find module './locations-view'`; permissions shows `[FAIL] location: ...` and exits non-zero.

- [ ] **Step 3: Implement**

`cloud/lambda/api/locations-view.js`:
```js
'use strict';

// Pure helpers for assigned unit locations (Fleet map). No I/O.
// Units have no GPS yet, so an admin assigns each unit a location.

const LABEL_MAX = 60;

// Fixed positions for demo units so the map isn't empty in demos. Never stored.
const DEMO_LOCATIONS = {
  'APU-DEMO-01': { lat: 32.7767, lon: -96.7970, label: 'Dallas, TX (demo)' },
  'APU-DEMO-02': { lat: 35.4676, lon: -97.5164, label: 'Oklahoma City, OK (demo)' },
  'APU-DEMO-03': { lat: 29.7604, lon: -95.3698, label: 'Houston, TX (demo)' },
};

const inRange = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

// PATCH body -> { ok: true, value: { lat, lon, label } } | { ok: false, error }
function validateLocation(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'location body required' };
  if (!inRange(body.lat, -90, 90))   return { ok: false, error: 'lat must be a number between -90 and 90' };
  if (!inRange(body.lon, -180, 180)) return { ok: false, error: 'lon must be a number between -180 and 180' };
  let label = null;
  if (body.label !== undefined && body.label !== null) {
    if (typeof body.label !== 'string') return { ok: false, error: 'label must be a string' };
    const t = body.label.trim();
    if (t.length > LABEL_MAX) return { ok: false, error: `label must be ${LABEL_MAX} characters or fewer` };
    label = t || null;
  }
  return { ok: true, value: { lat: body.lat, lon: body.lon, label } };
}

// Stored items + enabled demo unit ids -> the GET /fleet/locations list.
function mergeLocations(items, demoUnits) {
  const stored = (items || []).map((it) => ({
    unit: it.unit,
    lat: Number(it.lat),
    lon: Number(it.lon),
    label: it.label || null,
    source: 'assigned',
    updated_by: it.updated_by || null,
    updated_at: it.updated_at != null ? Number(it.updated_at) : null,
  }));
  const demo = (demoUnits || [])
    .filter((u) => DEMO_LOCATIONS[u])
    .map((u) => ({ unit: u, ...DEMO_LOCATIONS[u], source: 'demo', updated_by: null, updated_at: null }));
  return [...stored, ...demo].sort((a, b) => a.unit.localeCompare(b.unit));
}

module.exports = { validateLocation, mergeLocations, DEMO_LOCATIONS, LABEL_MAX };
```

In `cloud/lambda/api/permissions.js`, change the MATRIX and extend the header comment's action list:
```js
// Actions: heater, setpoint, apu, diag, ota, apu_ota, config, users, location.
// ...
// `location` gates assigning a unit's map location (Fleet map): admin/fm only.
const MATRIX = {
  admin: new Set(['heater', 'setpoint', 'apu', 'diag', 'ota', 'apu_ota', 'config', 'users', 'location']),
  fm:    new Set(['heater', 'setpoint', 'apu', 'diag', 'ota', 'apu_ota', 'config', 'users', 'location']),
  maint: new Set(['heater', 'setpoint', 'diag', 'config']),
  eu:    new Set([]),
};
```
(Replace only the `// Actions:` line and the `MATRIX` block; add the `location` comment line after the existing `apu_ota` paragraph.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/dev/cortex-yocto/cloud/lambda/api && for t in *.test.js; do node $t >/dev/null 2>&1 && echo "ok $t" || echo "FAIL $t"; done`
Expected: every line `ok ...`, including `ok locations-view.test.js` and `ok permissions.test.js`.

- [ ] **Step 5: Commit**

```bash
cd ~/dev/cortex-yocto
git add cloud/lambda/api/locations-view.js cloud/lambda/api/locations-view.test.js cloud/lambda/api/permissions.js cloud/lambda/api/permissions.test.js
git commit -m "feat(api): unit-location validation/merge helpers + location permission"
```

---

### Task 2: API handlers and routing for locations

**Files:**
- Modify: `cloud/lambda/api/api.js` (requires, env constant, three handlers, router)

**Interfaces:**
- Consumes: `validateLocation`, `mergeLocations` (Task 1); `canWrite` from `./permissions`; existing `isDemoUnit`, `listDemoUnits` (`./demo`), `ddb`, `resp`, `err`, `ScanCommand`, `PutCommand`, `DeleteCommand`.
- Produces (HTTP): `GET /fleet/locations -> 200 { locations: [...] }`; `PATCH /fleet/units/{unit}/location {lat,lon,label?} -> 200 { location } | 400 | 403`; `DELETE /fleet/units/{unit}/location -> 200 { unit, cleared: true } | 404 | 400 | 403`.

`api.js` has no handler-level test harness (its AWS clients are created at module load and `authenticate()` calls Secrets Manager); the logic lives in Task 1's tested pure helpers, and the HTTP behavior is verified live in Task 7.

- [ ] **Step 1: Add requires and the table constant**

In `cloud/lambda/api/api.js`:
- Change the permissions require to:
```js
const { validateCommand, authorizeCommand, authorizeConfig, canWrite } = require('./permissions');
```
- After the `require('./flux')` line add:
```js
const { validateLocation, mergeLocations }                         = require('./locations-view');
```
- After `const USERS_TABLE = ...` add:
```js
const LOCATIONS_TABLE   = process.env.LOCATIONS_TABLE   || 'ecofleet-prod-unit-locations';
```

- [ ] **Step 2: Add the three handlers**

Insert directly above the `// ── Main handler ──` comment:
```js
// ── Unit locations (Fleet map) ────────────────────────────────────────────────
// GET /fleet/locations — assigned locations for every unit (+ fixed demo spots)
async function handleListLocations() {
  const res = await ddb.send(new ScanCommand({ TableName: LOCATIONS_TABLE }));
  return resp(200, { locations: mergeLocations(res.Items || [], listDemoUnits()) });
}

// Shared guard for location writes: path param, role, demo units.
function locationWriteGuard(event, claims) {
  const unit = (event.pathParameters || {}).unit;
  if (!unit) return { error: err(400, 'unit path parameter required') };
  if (!canWrite(claims.role || 'eu', 'location'))
    return { error: err(403, `role "${claims.role || 'eu'}" not permitted to set unit locations`) };
  if (isDemoUnit(unit)) return { error: err(400, 'demo units have fixed demo locations') };
  return { unit };
}

// PATCH /fleet/units/{unit}/location — set or move a unit's assigned location
async function handleSetLocation(event, claims) {
  const g = locationWriteGuard(event, claims);
  if (g.error) return g.error;
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return err(400, 'Invalid JSON'); }
  const v = validateLocation(body);
  if (!v.ok) return err(400, v.error);

  const item = {
    unit: g.unit,
    lat: v.value.lat,
    lon: v.value.lon,
    updated_by: claims.email || null,
    updated_at: Date.now(),
  };
  if (v.value.label) item.label = v.value.label;
  await ddb.send(new PutCommand({ TableName: LOCATIONS_TABLE, Item: item }));
  return resp(200, { location: { ...item, label: item.label || null, source: 'assigned' } });
}

// DELETE /fleet/units/{unit}/location — remove a unit's assigned location
async function handleClearLocation(event, claims) {
  const g = locationWriteGuard(event, claims);
  if (g.error) return g.error;
  const res = await ddb.send(new DeleteCommand({
    TableName: LOCATIONS_TABLE,
    Key: { unit: g.unit },
    ReturnValues: 'ALL_OLD',
  }));
  if (!res.Attributes) return err(404, 'no location set for this unit');
  return resp(200, { unit: g.unit, cleared: true });
}
```

- [ ] **Step 3: Route them**

In `exports.handler`, after the `/fleet/releases` line add:
```js
    if (method === 'GET'  && path.endsWith('/fleet/locations')) return await handleListLocations();
```
Inside the `if (path.includes('/fleet/units/')) {` block, as its first lines:
```js
      if (path.endsWith('/location')) {
        if (method === 'PATCH')  return await handleSetLocation(event, claims);
        if (method === 'DELETE') return await handleClearLocation(event, claims);
      }
```

- [ ] **Step 4: Verify**

Run: `cd ~/dev/cortex-yocto/cloud/lambda/api && node --check api.js && grep -n "handleListLocations\|handleSetLocation\|handleClearLocation\|LOCATIONS_TABLE" api.js && for t in *.test.js; do node $t >/dev/null 2>&1 && echo "ok $t" || echo "FAIL $t"; done`
Expected: no syntax error; each handler name appears twice (definition + route) and `LOCATIONS_TABLE` three times; all tests `ok`.

- [ ] **Step 5: Commit**

```bash
cd ~/dev/cortex-yocto
git add cloud/lambda/api/api.js
git commit -m "feat(api): GET /fleet/locations and PATCH/DELETE unit location"
```

---

### Task 3: Terraform — table, IAM, env var, routes (plan only)

**Files:**
- Modify: `cloud/terraform/dynamodb.tf`
- Modify: `cloud/terraform/lambda.tf` (API Lambda `environment.variables`)
- Modify: `cloud/terraform/api.tf`

**Interfaces:**
- Produces: table `ecofleet-prod-unit-locations`; API Lambda env `LOCATIONS_TABLE`; routes `GET /fleet/locations`, `PATCH /fleet/units/{unit}/location`, `DELETE /fleet/units/{unit}/location` → existing `aws_apigatewayv2_integration.api`.

- [ ] **Step 1: Add the table and IAM statement**

In `cloud/terraform/dynamodb.tf`, after the `users` table resource add:
```hcl
# ── DynamoDB: assigned unit locations (Fleet map) ─────────────────────────────
# One item per unit. Units have no GPS yet, so an admin assigns each a location.
resource "aws_dynamodb_table" "unit_locations" {
  name         = "${var.project}-${var.env}-unit-locations"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "unit"

  attribute {
    name = "unit"
    type = "S"
  }

  tags = { Project = var.project }
}
```
In `aws_iam_role_policy.lambda_dynamodb`, add this statement after the `DynamoDBUsers` statement:
```hcl
      {
        Sid    = "DynamoDBUnitLocations"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
          "dynamodb:Scan",
        ]
        Resource = aws_dynamodb_table.unit_locations.arn
      },
```

- [ ] **Step 2: Add the env var and routes**

In `cloud/terraform/lambda.tf`, in the API Lambda's `environment { variables = { ... } }` (the block containing `USERS_TABLE`), after `USERS_TABLE` add:
```hcl
      LOCATIONS_TABLE      = aws_dynamodb_table.unit_locations.name
```
In `cloud/terraform/api.tf`, after the `fleet_releases` route add:
```hcl
resource "aws_apigatewayv2_route" "fleet_locations" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /fleet/locations"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_route" "fleet_unit_location_set" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "PATCH /fleet/units/{unit}/location"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_route" "fleet_unit_location_clear" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "DELETE /fleet/units/{unit}/location"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}
```

- [ ] **Step 3: Provide variables (secrets stay local)**

`terraform.tfvars` holds secrets and lives only in the old folder. Copy it without printing it, and confirm git ignores it:
```bash
cp /Users/sungkang/Documents/github/ecofleet-firmware/cloud/terraform/terraform.tfvars ~/dev/cortex-yocto/cloud/terraform/terraform.tfvars
cd ~/dev/cortex-yocto && git check-ignore -q cloud/terraform/terraform.tfvars && echo "ignored: OK"
```
Expected: `ignored: OK`. (If `cp` hangs, the file is iCloud-evicted — stop and ask the user to open the old folder in Finder so it downloads.)

- [ ] **Step 4: Format, validate, plan (no apply)**

```bash
cd ~/dev/cortex-yocto/cloud/terraform
terraform fmt dynamodb.tf lambda.tf api.tf
AWS_PROFILE=default terraform init -input=false
AWS_PROFILE=default terraform validate
AWS_PROFILE=default terraform plan -input=false -out="$TMPDIR/locations.tfplan" | tail -40
```
Expected: `validate` → "Success! The configuration is valid."; plan summary **`4 to add, 2 to change, 0 to destroy`** — adds: `aws_dynamodb_table.unit_locations`, `aws_apigatewayv2_route.fleet_locations`, `…fleet_unit_location_set`, `…fleet_unit_location_clear`; changes: `aws_iam_role_policy.lambda_dynamodb`, the API `aws_lambda_function` (env var only). **If the plan shows any other change or any destroy, stop and report the full plan to the user — do not proceed.** Do not run `terraform apply` in this task.

- [ ] **Step 5: Commit**

```bash
cd ~/dev/cortex-yocto
git status --short cloud/terraform   # must NOT list terraform.tfvars or any tfplan
git add cloud/terraform/dynamodb.tf cloud/terraform/lambda.tf cloud/terraform/api.tf
git commit -m "infra: unit-locations table, API routes and env var (not yet applied)"
```

---

### Task 4: Frontend data layer — permissions, client, mock, pure helpers, hooks

**Files:**
- Modify: `cloud/frontend/package.json`, `package-lock.json` (via npm)
- Modify: `cloud/frontend/src/api/permissions.js`, `src/api/permissions.test.js`
- Modify: `cloud/frontend/src/api/client.js`, `src/api/mock.js`
- Create: `cloud/frontend/src/api/locations.js`, `src/api/locations.test.js`
- Modify: `cloud/frontend/src/data/hooks.js`

**Interfaces:**
- Consumes: `byAttention` from `src/api/contract.js`.
- Produces:
  - `api.getLocations() -> Promise<{ locations: Location[] }>`; `api.setLocation(unit, { lat, lon, label }) -> Promise<{ location }>`; `api.clearLocation(unit) -> Promise<{ unit, cleared }>`.
  - `parseCoord(str) -> number | null`
  - `validateLatLon(latStr, lonStr, label) -> { ok: boolean, value?: { lat, lon, label: string|null }, errors: { lat?: string, lon?: string, label?: string } }`
  - `orderMapRows(rows: Array<{ u, view, location }>) -> { placed: rows[], unplaced: rows[] }`
  - hooks: `useLocations() -> useQuery result (data: Location[])`, `useSetLocation() -> useMutation ({ unit, lat, lon, label })`, `useClearLocation() -> useMutation (unit)`, `useFleetLatest(units: string[]) -> { byUnit: Record<string, tele|undefined>, pending: Record<string, boolean> }`, `useSetConfig() -> useMutation ({ unit, config })`.
  - `canWrite(role, 'location')` true for admin/fm.

- [ ] **Step 1: Install map libraries**

```bash
cd ~/dev/cortex-yocto/cloud/frontend && npm ci --no-audit --no-fund && npm install --save leaflet@1.9.4 react-leaflet@4.2.1 --no-audit --no-fund
grep -n '"leaflet"\|"react-leaflet"' package.json
```
Expected: both appear under `dependencies` (`"leaflet": "^1.9.4"`, `"react-leaflet": "^4.2.1"`).

- [ ] **Step 2: Write the failing tests**

`cloud/frontend/src/api/locations.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { parseCoord, validateLatLon, orderMapRows } from './locations.js'

describe('parseCoord', () => {
  it('parses decimal strings', () => {
    expect(parseCoord('32.7767')).toBe(32.7767)
    expect(parseCoord(' -96.8 ')).toBe(-96.8)
  })
  it('rejects blanks, words and comma decimals', () => {
    expect(parseCoord('')).toBeNull()
    expect(parseCoord('   ')).toBeNull()
    expect(parseCoord('abc')).toBeNull()
    expect(parseCoord('32,77')).toBeNull()
    expect(parseCoord('1e3x')).toBeNull()
  })
})

describe('validateLatLon', () => {
  it('accepts in-range values and trims the label', () => {
    expect(validateLatLon('32.9', '-97.04', ' Yard ')).toEqual({
      ok: true, value: { lat: 32.9, lon: -97.04, label: 'Yard' }, errors: {},
    })
  })
  it('empty label becomes null', () => {
    expect(validateLatLon('1', '2', '').value.label).toBeNull()
  })
  it('reports each bad field', () => {
    const r = validateLatLon('abc', '200', 'x'.repeat(61))
    expect(r.ok).toBe(false)
    expect(r.errors.lat).toMatch(/Latitude/)
    expect(r.errors.lon).toMatch(/Longitude/)
    expect(r.errors.label).toMatch(/60/)
  })
  it('range edges', () => {
    expect(validateLatLon('90', '180', '').ok).toBe(true)
    expect(validateLatLon('-90.01', '0', '').errors.lat).toBeTruthy()
  })
})

describe('orderMapRows', () => {
  const row = (unit, tone, location) => ({ u: { unit }, view: tone ? { tone } : undefined, location })
  it('splits placed and unplaced, each fault-first', () => {
    const { placed, unplaced } = orderMapRows([
      row('A', 'ok', { lat: 1, lon: 1 }),
      row('B', 'ok', undefined),
      row('C', 'err', { lat: 2, lon: 2 }),
      row('D', 'off', undefined),
    ])
    expect(placed.map((r) => r.u.unit)).toEqual(['C', 'A'])
    expect(unplaced.map((r) => r.u.unit)).toEqual(['D', 'B'])
  })
})
```

Append to `cloud/frontend/src/api/permissions.test.js` (inside the file's existing `describe`, or as a new block — match the file's style):
```js
describe('location permission', () => {
  it('admin and fm can set locations; maint and eu cannot', () => {
    expect(canWrite('admin', 'location')).toBe(true)
    expect(canWrite('fm', 'location')).toBe(true)
    expect(canWrite('maint', 'location')).toBe(false)
    expect(canWrite('eu', 'location')).toBe(false)
  })
})
```
(Ensure `describe`, `it`, `expect` and `canWrite` are imported at the top of that file; add any that are missing.)

- [ ] **Step 3: Run to verify failure**

Run: `cd ~/dev/cortex-yocto/cloud/frontend && npx vitest run src/api/locations.test.js src/api/permissions.test.js 2>&1 | grep -E "×|Tests |Error" | head`
Expected: `locations.test.js` fails to import `./locations.js`; the location-permission test fails.

- [ ] **Step 4: Implement the pure helpers and permission**

`cloud/frontend/src/api/locations.js`:
```js
import { byAttention } from './contract.js'

// Strict decimal parser for hand-typed coordinates: "32.77", "-96.8".
// Returns null for blanks, words or comma decimals ("32,77") rather than guessing.
export function parseCoord(str) {
  const s = String(str ?? '').trim()
  if (!/^-?\d{1,3}(\.\d+)?$/.test(s)) return null
  return Number(s)
}

export const LABEL_MAX = 60

// Location editor fields -> { ok, value, errors } (mirrors the API's rules).
export function validateLatLon(latStr, lonStr, label) {
  const errors = {}
  const lat = parseCoord(latStr)
  const lon = parseCoord(lonStr)
  if (lat == null || lat < -90 || lat > 90) errors.lat = 'Latitude must be a number from -90 to 90'
  if (lon == null || lon < -180 || lon > 180) errors.lon = 'Longitude must be a number from -180 to 180'
  const t = String(label ?? '').trim()
  if (t.length > LABEL_MAX) errors.label = `Label must be ${LABEL_MAX} characters or fewer`
  const ok = Object.keys(errors).length === 0
  return ok ? { ok, value: { lat, lon, label: t || null }, errors } : { ok, errors }
}

// Map side-list order: placed units first, then "Not placed yet"; each group
// fault-first (same comparator as the Dashboard).
export function orderMapRows(rows) {
  const placed = rows.filter((r) => r.location).sort(byAttention)
  const unplaced = rows.filter((r) => !r.location).sort(byAttention)
  return { placed, unplaced }
}
```

In `cloud/frontend/src/api/permissions.js`, add `'location'` to admin and fm (and mention it in the header comment: "`location` = assign a unit's map location, admin/fm"):
```js
const MATRIX = {
  admin: new Set(['heater', 'setpoint', 'apu', 'diag', 'ota', 'apu_ota', 'config', 'users', 'location']),
  fm:    new Set(['heater', 'setpoint', 'apu', 'diag', 'ota', 'apu_ota', 'config', 'users', 'location']),
  maint: new Set(['heater', 'setpoint', 'diag', 'config']),
  eu:    new Set([]),
}
```

- [ ] **Step 5: Client, mock and hooks**

In `cloud/frontend/src/api/client.js`, add to `realApi` after `getReports`:
```js
  getLocations: () => apiFetch('/fleet/locations'),

  setLocation: (unit, { lat, lon, label }) =>
    apiFetch(`/fleet/units/${encodeURIComponent(unit)}/location`, {
      method: 'PATCH', body: JSON.stringify({ lat, lon, label }),
    }),

  clearLocation: (unit) =>
    apiFetch(`/fleet/units/${encodeURIComponent(unit)}/location`, { method: 'DELETE' }),
```

In `cloud/frontend/src/api/mock.js`:
- Above `export const mockApi = {` add:
```js
// Assigned map locations (mock). The real unit starts unplaced; demo units
// have fixed spots, mirroring the API's demo behaviour.
const LOCATIONS = {}
const DEMO_LOCATIONS = {
  'APU-DEMO-01': { lat: 32.7767, lon: -96.7970, label: 'Dallas, TX (demo)' },
  'APU-DEMO-02': { lat: 35.4676, lon: -97.5164, label: 'Oklahoma City, OK (demo)' },
  'APU-DEMO-03': { lat: 29.7604, lon: -95.3698, label: 'Houston, TX (demo)' },
}
// Reporting interval per unit; a change "confirms" ~8s later, like a real
// unit picking up its shadow delta on the next cycle.
const INTERVALS = {}
function reportedInterval(unit) {
  const c = INTERVALS[unit]
  if (!c) return 10
  return Date.now() >= c.at ? c.next : c.prev
}
```
- In `getShadow`, replace `poll_interval_s: 10,` with `poll_interval_s: reportedInterval(unit),`.
- Replace the `setConfig` mock with:
```js
  setConfig: (unit, config) => {
    if (config.poll_interval_s !== undefined) {
      INTERVALS[unit] = { prev: reportedInterval(unit), next: config.poll_interval_s, at: Date.now() + 8000 }
    }
    return delay({ unit, shadow_version: 13, desired: config, message: 'Config queued (mock).' })
  },
```
- Add to `mockApi`:
```js
  getLocations: () => delay({ locations: [
    ...Object.entries(LOCATIONS).map(([unit, l]) => ({ unit, ...l, source: 'assigned' })),
    ...DEMO_UNITS.map((unit) => ({ unit, ...DEMO_LOCATIONS[unit], source: 'demo' })),
  ] }),
  setLocation: (unit, { lat, lon, label }) => {
    LOCATIONS[unit] = { lat, lon, label: label || null, updated_by: 'demo@ecofleet.io', updated_at: Date.now() }
    return delay({ location: { unit, ...LOCATIONS[unit], source: 'assigned' } })
  },
  clearLocation: (unit) => { delete LOCATIONS[unit]; return delay({ unit, cleared: true }) },
```

In `cloud/frontend/src/data/hooks.js`:
- Change the react-query import to include `useQueries`:
```js
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query'
```
- Append:
```js
// Assigned map locations for every unit (Fleet map).
export function useLocations() {
  return useQuery({
    queryKey: ['locations'],
    queryFn: () => api.getLocations(),
    select: (d) => d.locations || [],
  })
}

export function useSetLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ unit, lat, lon, label }) => api.setLocation(unit, { lat, lon, label }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['locations'] }),
  })
}

export function useClearLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (unit) => api.clearLocation(unit),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['locations'] }),
  })
}

// Latest telemetry for many units in one hook (shares the ['latest', unit]
// cache and poll rate with useUnitLatest).
export function useFleetLatest(units) {
  const results = useQueries({
    queries: (units || []).map((unit) => ({
      queryKey: ['latest', unit],
      queryFn: () => api.getLatest(unit),
      refetchInterval: LATEST_POLL_MS,
      select: (d) => d.latest,
    })),
  })
  const byUnit = {}
  const pending = {}
  ;(units || []).forEach((unit, i) => {
    byUnit[unit] = results[i]?.data
    pending[unit] = !!results[i]?.isLoading
  })
  return { byUnit, pending }
}

// Writes device-shadow config (reporting interval, reboot) for one unit.
export function useSetConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ unit, config }) => api.setConfig(unit, config),
    onSuccess: (_r, { unit }) => qc.invalidateQueries({ queryKey: ['shadow', unit] }),
  })
}
```
(Confirm `useShadow`'s query key is `['shadow', unit]`: `grep -n "queryKey: \['shadow'" src/data/hooks.js`.)

- [ ] **Step 6: Run the tests and build**

Run: `cd ~/dev/cortex-yocto/cloud/frontend && npx vitest run 2>&1 | grep -E "×|Tests |Test Files" && npm run build 2>&1 | grep -E "built|rror"`
Expected: all tests pass (previous 144 + new); `✓ built`.

- [ ] **Step 7: Commit**

```bash
cd ~/dev/cortex-yocto
git add cloud/frontend/package.json cloud/frontend/package-lock.json cloud/frontend/src/api/permissions.js cloud/frontend/src/api/permissions.test.js cloud/frontend/src/api/client.js cloud/frontend/src/api/mock.js cloud/frontend/src/api/locations.js cloud/frontend/src/api/locations.test.js cloud/frontend/src/data/hooks.js
git commit -m "feat(web): location/config data layer (client, mock, hooks, validation)"
```

---

### Task 5: Fleet map page

**Files:**
- Create: `cloud/frontend/src/components/map/FleetMap.jsx`
- Create: `cloud/frontend/src/pages/FleetMapPage.jsx`
- Create: `cloud/frontend/src/pages/FleetMapPage.test.jsx`
- Modify: `cloud/frontend/src/App.jsx` (route `/map`)
- Modify: `cloud/frontend/src/index.css` (append map styles)

**Interfaces:**
- Consumes: `useUnits`, `useLocations`, `useSetLocation`, `useClearLocation`, `useFleetLatest` (Task 4); `validateLatLon`, `orderMapRows`, `LABEL_MAX` (Task 4); `unitView` (`src/api/contract.js`); `useCan` (`src/components/RoleGate.jsx`); `ConfirmDialog`.
- Produces: `<FleetMap pins selected placing onPick onOpen />` where `pins: Array<{ unit, lat, lon, tone, status, headline, label, source }>`, `selected: string|null`, `placing: { unit, lat: number|null, lon: number|null } | null`, `onPick(lat, lon)`, `onOpen(unit)`.

- [ ] **Step 1: Write the failing page tests**

`cloud/frontend/src/pages/FleetMapPage.test.jsx`:
```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const state = vi.hoisted(() => ({
  role: 'admin',
  locations: [],
  setMutate: null,
  clearMutate: null,
  mapProps: null,
}))

vi.mock('../contexts/AuthContext.jsx', () => ({ useAuth: () => ({ role: state.role }) }))

vi.mock('../data/hooks.js', () => ({
  useUnits: () => ({ data: [{ unit: 'TRUCK-001', demo: false }, { unit: 'APU-DEMO-01', demo: true }], isLoading: false }),
  useLocations: () => ({ data: state.locations, isLoading: false, error: null, refetch: vi.fn() }),
  useFleetLatest: () => ({
    byUnit: {
      'TRUCK-001': { ts: Date.now(), error_n: 0, error: 'none', batt_v: 12.6, oil_ok: true, mode: 'off', control_status: 'off', engine_status: 'off', rpm: 0 },
      'APU-DEMO-01': { ts: Date.now(), error_n: 1, error: 'Low oil pressure', batt_v: 13, oil_ok: false, mode: 'off', control_status: 'off', engine_status: 'off', rpm: 0 },
    },
    pending: {},
  }),
  useSetLocation: () => ({ mutate: state.setMutate, isPending: false }),
  useClearLocation: () => ({ mutate: state.clearMutate, isPending: false }),
}))

// Leaflet needs real layout; the page is tested against a stand-in map that
// records its props and lets the test "click" a map position.
vi.mock('../components/map/FleetMap.jsx', () => ({
  default: (props) => {
    state.mapProps = props
    return (
      <div data-testid="map">
        {props.pins.map((p) => <span key={p.unit} data-testid="pin">{p.unit}</span>)}
        <button onClick={() => props.onPick(40.1, -95.2)}>test-pick</button>
      </div>
    )
  },
}))

import FleetMapPage from './FleetMapPage.jsx'

const DEMO_LOC = { unit: 'APU-DEMO-01', lat: 32.77, lon: -96.79, label: 'Dallas, TX (demo)', source: 'demo' }
const renderPage = () => render(<MemoryRouter><FleetMapPage /></MemoryRouter>)

describe('FleetMapPage', () => {
  beforeEach(() => {
    state.role = 'admin'
    state.locations = [DEMO_LOC]
    state.setMutate = vi.fn()
    state.clearMutate = vi.fn()
    state.mapProps = null
  })

  it('says locations are assigned, not GPS', () => {
    renderPage()
    expect(screen.getByText("Assigned locations — units don't report GPS yet.")).toBeTruthy()
  })

  it('lists placed units on the map and the rest under "Not placed yet"', () => {
    renderPage()
    const placed = screen.getByRole('region', { name: 'On the map' })
    const unplaced = screen.getByRole('region', { name: 'Not placed yet' })
    expect(within(placed).getByText('APU-DEMO-01')).toBeTruthy()
    expect(within(unplaced).getByText('TRUCK-001')).toBeTruthy()
    expect(screen.getAllByTestId('pin').map((p) => p.textContent)).toEqual(['APU-DEMO-01'])
    expect(state.mapProps.pins[0]).toMatchObject({ unit: 'APU-DEMO-01', tone: 'err', source: 'demo' })
  })

  it('no locations at all: empty map, every unit under "Not placed yet"', () => {
    state.locations = []
    renderPage()
    expect(state.mapProps.pins).toEqual([])
    expect(screen.queryByRole('region', { name: 'On the map' })).toBeNull()
    const unplaced = screen.getByRole('region', { name: 'Not placed yet' })
    expect(within(unplaced).getByText('TRUCK-001')).toBeTruthy()
    expect(within(unplaced).getByText('APU-DEMO-01')).toBeTruthy()
  })

  it('sets a location from typed coordinates', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Set location for TRUCK-001' }))
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '32.9' } })
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '-97.04' } })
    fireEvent.change(screen.getByLabelText('Label (optional)'), { target: { value: 'Yard' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save location' }))
    expect(state.setMutate).toHaveBeenCalledTimes(1)
    expect(state.setMutate.mock.calls[0][0]).toEqual({ unit: 'TRUCK-001', lat: 32.9, lon: -97.04, label: 'Yard' })
  })

  it('clicking the map fills the coordinates', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Set location for TRUCK-001' }))
    fireEvent.click(screen.getByText('test-pick'))
    expect(screen.getByLabelText('Latitude').value).toBe('40.1')
    expect(screen.getByLabelText('Longitude').value).toBe('-95.2')
    expect(state.mapProps.placing).toMatchObject({ unit: 'TRUCK-001', lat: 40.1, lon: -95.2 })
  })

  it('invalid coordinates show field errors and are not sent', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Set location for TRUCK-001' }))
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '32,77' } })
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '200' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save location' }))
    expect(screen.getByText(/Latitude must be/)).toBeTruthy()
    expect(screen.getByText(/Longitude must be/)).toBeTruthy()
    expect(state.setMutate).not.toHaveBeenCalled()
  })

  it('removes a placed location after confirmation', () => {
    state.locations = [DEMO_LOC, { unit: 'TRUCK-001', lat: 33, lon: -97, label: null, source: 'assigned' }]
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Remove location for TRUCK-001' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(state.clearMutate.mock.calls[0][0]).toBe('TRUCK-001')
  })

  it('demo units never get edit controls, even for admins', () => {
    renderPage()
    expect(screen.getByRole('button', { name: 'Set location for TRUCK-001' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /location for APU-DEMO-01/ })).toBeNull()
  })

  it('read-only roles (maint, eu) get no edit controls', () => {
    for (const role of ['maint', 'eu']) {
      state.role = role
      const { unmount } = renderPage()
      expect(screen.queryAllByRole('button', { name: /Set location for|Remove location for/ })).toHaveLength(0)
      unmount()
    }
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ~/dev/cortex-yocto/cloud/frontend && npx vitest run src/pages/FleetMapPage.test.jsx 2>&1 | grep -E "×|Tests |Error" | head -5`
Expected: fails to import `./FleetMapPage.jsx`.

- [ ] **Step 3: Implement the Leaflet wrapper**

`cloud/frontend/src/components/map/FleetMap.jsx`:
```jsx
import { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Neutral continental-US view when no unit has a location yet.
const US_CENTER = [39.5, -98.35]
const US_ZOOM = 4

// A glyph as well as a color, so status isn't conveyed by color alone.
const TONE_GLYPH = { err: '!', warn: '!', ok: '✓', off: '–' }

function pinIcon(tone, extra = '') {
  return L.divIcon({
    className: '',
    html: `<span class="map-pin t-${tone} ${extra}" aria-hidden="true">${TONE_GLYPH[tone] || ''}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14],
  })
}

// Fit all pins once, then pan to whichever unit gets selected.
function Viewport({ pins, selected }) {
  const map = useMap()
  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current || pins.length === 0) return
    fitted.current = true
    if (pins.length === 1) map.setView([pins[0].lat, pins[0].lon], 10)
    else map.fitBounds(pins.map((p) => [p.lat, p.lon]), { padding: [40, 40] })
  }, [pins, map])
  useEffect(() => {
    const p = pins.find((x) => x.unit === selected)
    if (p) map.setView([p.lat, p.lon], Math.max(map.getZoom(), 9))
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

function ClickToPlace({ active, onPick }) {
  useMapEvents({ click(e) { if (active) onPick(e.latlng.lat, e.latlng.lng) } })
  return null
}

export default function FleetMap({ pins, selected, placing, onPick, onOpen }) {
  const placingReady = placing && placing.lat != null && placing.lon != null
  return (
    <MapContainer center={US_CENTER} zoom={US_ZOOM} className={`fleet-map${placing ? ' is-placing' : ''}`} scrollWheelZoom>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OpenStreetMap contributors"
      />
      <Viewport pins={pins} selected={selected} />
      <ClickToPlace active={!!placing} onPick={onPick} />
      {pins.filter((p) => !(placing && p.unit === placing.unit)).map((p) => (
        <Marker key={p.unit} position={[p.lat, p.lon]} icon={pinIcon(p.tone)} title={`${p.unit}: ${p.status}`}>
          <Popup>
            <div className="map-pop">
              <div className="map-pop-unit">{p.unit}</div>
              <div className={`badge badge-sm t-${p.tone}`}>{p.status}</div>
              <div className="map-pop-line">{p.headline}</div>
              {p.label && <div className="map-pop-line">{p.label}</div>}
              <div className="map-pop-src">{p.source === 'demo' ? 'Demo location' : 'Assigned location'}</div>
              <button className="btn btn-sm btn-primary" onClick={() => onOpen(p.unit)}>Open unit</button>
            </div>
          </Popup>
        </Marker>
      ))}
      {placingReady && (
        <Marker
          position={[placing.lat, placing.lon]}
          icon={pinIcon('ok', 'placing')}
          draggable
          eventHandlers={{ dragend: (e) => { const ll = e.target.getLatLng(); onPick(ll.lat, ll.lng) } }}
          title={`New location for ${placing.unit}`}
        />
      )}
    </MapContainer>
  )
}
```

- [ ] **Step 4: Implement the page**

`cloud/frontend/src/pages/FleetMapPage.jsx`:
```jsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconMapPin, IconMapPinOff } from '@tabler/icons-react'
import {
  useUnits, useLocations, useSetLocation, useClearLocation, useFleetLatest,
} from '../data/hooks.js'
import { unitView } from '../api/contract.js'
import { validateLatLon, orderMapRows, LABEL_MAX } from '../api/locations.js'
import { useCan } from '../components/RoleGate.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import FleetMap from '../components/map/FleetMap.jsx'

const round = (n) => String(Math.round(n * 1e5) / 1e5)

function UnitRow({ r, canEdit, onShow, onEdit, onRemove }) {
  const demo = r.location?.source === 'demo' || r.u.demo
  return (
    <div className="map-row">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="map-row-unit">{r.u.unit}</span>
          {r.u.demo && <span className="badge badge-sm t-off">demo</span>}
          {r.view && <span className={`badge badge-sm t-${r.view.tone}`}>{r.view.status}</span>}
        </div>
        {r.location?.label && <div className="map-row-sub">{r.location.label}</div>}
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {r.location && <button className="btn btn-sm" onClick={() => onShow(r.u.unit)}>Show</button>}
        {canEdit && !demo && (
          <button className="btn btn-sm" aria-label={`Set location for ${r.u.unit}`} onClick={() => onEdit(r)}>
            {r.location ? 'Move' : 'Set location'}
          </button>
        )}
        {canEdit && !demo && r.location && (
          <button className="btn btn-sm btn-red" aria-label={`Remove location for ${r.u.unit}`} onClick={() => onRemove(r.u.unit)}>
            Remove
          </button>
        )}
      </div>
    </div>
  )
}

export default function FleetMapPage() {
  const navigate = useNavigate()
  const { data: units, isLoading: unitsLoading } = useUnits()
  const { data: locations, error: locError, refetch } = useLocations()
  const setLoc = useSetLocation()
  const clearLoc = useClearLocation()
  const { allowed: canEdit } = useCan('location')
  const list = units || []
  const { byUnit, pending } = useFleetLatest(list.map((u) => u.unit))

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t) }, [])

  const [selected, setSelected] = useState(null)
  const [editing, setEditing] = useState(null) // { unit, lat, lon, label, errors, apiError }
  const [removing, setRemoving] = useState(null)

  const locByUnit = Object.fromEntries((locations || []).map((l) => [l.unit, l]))
  const rows = list.map((u) => ({
    u,
    tele: byUnit[u.unit],
    view: pending[u.unit] ? undefined : unitView(byUnit[u.unit], now),
    location: locByUnit[u.unit],
  }))
  const { placed, unplaced } = orderMapRows(rows)
  const pins = placed.map((r) => ({
    unit: r.u.unit,
    lat: r.location.lat,
    lon: r.location.lon,
    tone: r.view?.tone || 'off',
    status: r.view?.status || 'Loading',
    headline: r.view?.headline || '',
    label: r.location.label,
    source: r.location.source,
  }))

  const startEdit = (r) => setEditing({
    unit: r.u.unit,
    lat: r.location ? round(r.location.lat) : '',
    lon: r.location ? round(r.location.lon) : '',
    label: r.location?.label || '',
    errors: {},
    apiError: '',
  })
  const onPick = (lat, lon) => setEditing((e) => (e ? { ...e, lat: round(lat), lon: round(lon), errors: {} } : e))
  const save = () => {
    const v = validateLatLon(editing.lat, editing.lon, editing.label)
    if (!v.ok) { setEditing({ ...editing, errors: v.errors }); return }
    setLoc.mutate({ unit: editing.unit, ...v.value }, {
      onSuccess: () => { setSelected(editing.unit); setEditing(null) },
      onError: (e) => setEditing((cur) => cur && { ...cur, apiError: e.message }),
    })
  }

  const placingLat = editing ? Number(editing.lat) : null
  const placingLon = editing ? Number(editing.lon) : null
  const placing = editing ? {
    unit: editing.unit,
    lat: editing.lat !== '' && Number.isFinite(placingLat) ? placingLat : null,
    lon: editing.lon !== '' && Number.isFinite(placingLon) ? placingLon : null,
  } : null

  return (
    <>
      <p className="map-note">
        <IconMapPin size={16} aria-hidden="true" />
        Assigned locations — units don't report GPS yet.
      </p>

      {locError && (
        <div className="notice" style={{ color: 'var(--err)' }}>
          Couldn't load locations: {locError.message}
          <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => refetch()}>Retry</button>
        </div>
      )}

      <div className="map-layout">
        <div className="map-wrap">
          {editing && <div className="map-hint">Click the map to place {editing.unit}, or enter coordinates.</div>}
          <FleetMap pins={pins} selected={selected} placing={placing} onPick={onPick}
            onOpen={(unit) => navigate('/units/' + encodeURIComponent(unit))} />
        </div>

        <aside className="map-side">
          {editing && (
            <section className="group" aria-labelledby="loc-edit-h">
              <h2 id="loc-edit-h" className="group-hd" style={{ margin: 0 }}>Place {editing.unit}</h2>
              <div className="field">
                <label htmlFor="loc-lat">Latitude</label>
                <input id="loc-lat" className="control" inputMode="decimal" value={editing.lat}
                  onChange={(e) => setEditing({ ...editing, lat: e.target.value, errors: {} })} />
                {editing.errors.lat && <span className="msg-err">{editing.errors.lat}</span>}
              </div>
              <div className="field">
                <label htmlFor="loc-lon">Longitude</label>
                <input id="loc-lon" className="control" inputMode="decimal" value={editing.lon}
                  onChange={(e) => setEditing({ ...editing, lon: e.target.value, errors: {} })} />
                {editing.errors.lon && <span className="msg-err">{editing.errors.lon}</span>}
              </div>
              <div className="field">
                <label htmlFor="loc-label">Label (optional)</label>
                <input id="loc-label" className="control" maxLength={LABEL_MAX} value={editing.label}
                  placeholder="e.g. Dallas yard"
                  onChange={(e) => setEditing({ ...editing, label: e.target.value, errors: {} })} />
                {editing.errors.label && <span className="msg-err">{editing.errors.label}</span>}
              </div>
              {editing.apiError && <div className="msg-err" role="alert">{editing.apiError}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={save} disabled={setLoc.isPending}>Save location</button>
                <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </section>
          )}

          {placed.length > 0 && (
            <section className="panel" aria-label="On the map">
              <h2 className="map-side-h">On the map</h2>
              {placed.map((r) => (
                <UnitRow key={r.u.unit} r={r} canEdit={canEdit} onShow={setSelected} onEdit={startEdit} onRemove={setRemoving} />
              ))}
            </section>
          )}

          {unplaced.length > 0 && (
            <section className="panel" aria-label="Not placed yet">
              <h2 className="map-side-h"><IconMapPinOff size={16} aria-hidden="true" /> Not placed yet</h2>
              {unplaced.map((r) => (
                <UnitRow key={r.u.unit} r={r} canEdit={canEdit} onShow={setSelected} onEdit={startEdit} onRemove={setRemoving} />
              ))}
            </section>
          )}

          {!unitsLoading && list.length === 0 && <div className="notice">No units yet.</div>}
        </aside>
      </div>

      <ConfirmDialog
        open={!!removing}
        title={`Remove location for ${removing}?`}
        body="The unit will move to Not placed yet. You can set a new location any time."
        confirmLabel="Remove"
        danger
        pending={clearLoc.isPending}
        onConfirm={() => clearLoc.mutate(removing, { onSettled: () => setRemoving(null) })}
        onCancel={() => setRemoving(null)}
      />
    </>
  )
}
```

- [ ] **Step 5: Route and styles**

In `cloud/frontend/src/App.jsx`: add `import FleetMapPage from './pages/FleetMapPage.jsx'` and change the `/map` route to:
```jsx
                  <Route path="/map"         element={<FleetMapPage />} />
```
Append to `cloud/frontend/src/index.css`:
```css
/* ── Fleet map ─────────────────────────────────────────────────────────────── */
.map-note { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 14px; color: var(--color-text-secondary); }
.map-layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; align-items: start; }
.map-wrap { position: relative; }
.fleet-map { height: min(70vh, 640px); min-height: 360px; border-radius: 12px; border: 1px solid var(--color-border-secondary); z-index: 0; }
.fleet-map.is-placing { cursor: crosshair; }
.map-hint { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 500; background: var(--color-background-primary); border: 1px solid var(--accent); border-radius: 8px; padding: 8px 14px; font-size: 14px; font-weight: 600; }
.map-side { display: flex; flex-direction: column; gap: 16px; }
.map-side-h { display: flex; align-items: center; gap: 8px; margin: 0; padding: 14px 16px 6px; font-size: 15px; font-weight: 600; color: var(--color-text-secondary); }
.map-row { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-top: 1px solid var(--color-border-tertiary); }
.map-row-unit { font-size: 15px; font-weight: 600; }
.map-row-sub { font-size: 13px; color: var(--color-text-tertiary); margin-top: 2px; }
.map-pin { display: flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 50%; font: 700 14px 'IBM Plex Sans', sans-serif; color: #fff; border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,.4); }
.map-pin.t-err { background: #B42318; }
.map-pin.t-warn { background: #9A4E00; }
.map-pin.t-ok { background: #2E7D32; }
.map-pin.t-off { background: #5F6A74; }
.map-pin.placing { background: var(--accent-fill); outline: 3px solid rgba(11,127,174,.35); }
.map-pop { display: flex; flex-direction: column; gap: 6px; min-width: 180px; font-family: 'IBM Plex Sans', sans-serif; }
.map-pop-unit { font-size: 15px; font-weight: 600; }
.map-pop-line { font-size: 13px; }
.map-pop-src { font-size: 12px; color: #5F6A74; }
.map-pop .badge { align-self: flex-start; }
@media (max-width: 900px) {
  .map-layout { grid-template-columns: minmax(0, 1fr); }
  .fleet-map { height: 55vh; }
}
```
(Pin fills use fixed hex values because Leaflet renders markers outside the themed page tree.)

- [ ] **Step 6: Run tests and build**

Run: `cd ~/dev/cortex-yocto/cloud/frontend && npx vitest run 2>&1 | grep -E "×|Tests |Test Files" && npm run build 2>&1 | grep -E "built|rror"`
Expected: all pass; `✓ built`.

- [ ] **Step 7: Visual check against the mock**

```bash
cd ~/dev/cortex-yocto/cloud/frontend && (VITE_MOCK=on npx vite --port 5199 --strictPort > /dev/null 2>&1 &) && sleep 3
```
Open `http://localhost:5199/map` (log in with any email). Check: three demo pins around TX/OK, APU-000123 under "Not placed yet"; "Set location" → click the map places a draggable pin and fills the fields → Save → pin appears and the row moves to "On the map"; Remove → confirm → back to "Not placed yet"; pin popup shows status + Open unit. Check dark mode and a ~390px-wide viewport (list stacks under the map). Then stop the server: `pkill -f "vite --port 5199"`.

- [ ] **Step 8: Commit**

```bash
cd ~/dev/cortex-yocto
git add cloud/frontend/src/components/map/FleetMap.jsx cloud/frontend/src/pages/FleetMapPage.jsx cloud/frontend/src/pages/FleetMapPage.test.jsx cloud/frontend/src/App.jsx cloud/frontend/src/index.css
git commit -m "feat(web): Fleet map with assigned unit locations (OpenStreetMap)"
```

---

### Task 6: System config page

**Files:**
- Create: `cloud/frontend/src/api/settings.js`, `src/api/settings.test.js`
- Create: `cloud/frontend/src/pages/SystemConfigPage.jsx`, `src/pages/SystemConfigPage.test.jsx`
- Modify: `cloud/frontend/src/App.jsx` (route `/config`, remove `StubPage` import)
- Delete: `cloud/frontend/src/pages/StubPage.jsx`

**Interfaces:**
- Consumes: `useUnits`, `useShadow`, `useUnitLatest`, `useSetConfig` (Task 4); `UnitPicker`, `ConfirmDialog`, `useCan`; `unitView`, `apuVersionLabel` (`contract.js`); `useAuth` (`selectedUnit`, `setSelectedUnit`).
- Produces: `INTERVAL_CHOICES = [5, 10, 15, 20]`; `intervalStatus({ reported, requested, sentAt, now }) -> 'idle' | 'pending' | 'confirmed' | 'unconfirmed'`; `PENDING_TIMEOUT_MS = 120000`.

- [ ] **Step 1: Write the failing tests**

`cloud/frontend/src/api/settings.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { INTERVAL_CHOICES, intervalStatus, PENDING_TIMEOUT_MS } from './settings.js'

describe('settings', () => {
  it('offers 5, 10, 15 and 20 seconds', () => expect(INTERVAL_CHOICES).toEqual([5, 10, 15, 20]))

  it('idle when nothing was requested', () => {
    expect(intervalStatus({ reported: 10, requested: null, sentAt: null, now: 0 })).toBe('idle')
  })
  it('pending until the unit reports the requested value', () => {
    expect(intervalStatus({ reported: 10, requested: 15, sentAt: 1000, now: 5000 })).toBe('pending')
  })
  it('confirmed once reported matches', () => {
    expect(intervalStatus({ reported: 15, requested: 15, sentAt: 1000, now: 5000 })).toBe('confirmed')
  })
  it('unconfirmed after the 2-minute timeout', () => {
    expect(PENDING_TIMEOUT_MS).toBe(120000)
    expect(intervalStatus({ reported: 10, requested: 15, sentAt: 0, now: 120001 })).toBe('unconfirmed')
    expect(intervalStatus({ reported: 10, requested: 15, sentAt: 0, now: 119999 })).toBe('pending')
  })
  it('no reported value yet counts as pending, then unconfirmed', () => {
    expect(intervalStatus({ reported: undefined, requested: 5, sentAt: 0, now: 1 })).toBe('pending')
    expect(intervalStatus({ reported: undefined, requested: 5, sentAt: 0, now: 200000 })).toBe('unconfirmed')
  })
})
```

`cloud/frontend/src/pages/SystemConfigPage.test.jsx`:
```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const state = vi.hoisted(() => ({ role: 'admin', unit: 'TRUCK-001', shadow: null, mutate: null }))

vi.mock('../contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ role: state.role, selectedUnit: state.unit, setSelectedUnit: vi.fn() }),
}))
vi.mock('../data/hooks.js', () => ({
  useUnits: () => ({ data: [{ unit: 'TRUCK-001', demo: false }, { unit: 'APU-DEMO-01', demo: true }] }),
  useShadow: () => ({ data: state.shadow }),
  useUnitLatest: () => ({ data: { ts: Date.now(), apu_fw_version: 10104, error_n: 0, error: 'none', batt_v: 12.5, oil_ok: true, mode: 'off', control_status: 'off', engine_status: 'off', rpm: 0 } }),
  useSetConfig: () => ({ mutate: state.mutate, isPending: false }),
}))

import SystemConfigPage from './SystemConfigPage.jsx'

describe('SystemConfigPage', () => {
  beforeEach(() => {
    state.role = 'admin'
    state.unit = 'TRUCK-001'
    state.shadow = { reported: { poll_interval_s: 10, firmware_version: '1.2.57', ota_status: 'idle' } }
    state.mutate = vi.fn((vars, opts) => opts?.onSuccess?.())
  })

  it('shows the interval the unit reports and unit info', () => {
    render(<SystemConfigPage />)
    expect(screen.getByText('Every 10 seconds')).toBeTruthy()
    expect(screen.getByText('1.2.57')).toBeTruthy()
    expect(screen.getByText('1.1.4')).toBeTruthy()
    expect(screen.queryByText(/report mode/i)).toBeNull()
  })

  it('changes the interval through a confirmation and shows Pending', () => {
    render(<SystemConfigPage />)
    fireEvent.click(screen.getByRole('radio', { name: '15 s' }))
    fireEvent.click(screen.getByRole('button', { name: 'Change interval' }))            // opens the dialog
    expect(state.mutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Change interval' }).at(-1)) // dialog's confirm
    expect(state.mutate.mock.calls[0][0]).toEqual({ unit: 'TRUCK-001', config: { poll_interval_s: 15 } })
    expect(screen.getByText(/Pending — waiting for the unit to confirm/)).toBeTruthy()
  })

  it('shows an out-of-range reported interval as-is', () => {
    state.shadow = { reported: { poll_interval_s: 30, firmware_version: '1.2.57' } }
    render(<SystemConfigPage />)
    expect(screen.getByText('Every 30 seconds')).toBeTruthy()
    expect(screen.getByText(/set outside this page/)).toBeTruthy()
    expect(screen.getByRole('radio', { name: '5 s' })).toBeTruthy()
  })

  it('no shadow yet: dashes, no crash', () => {
    state.shadow = undefined
    render(<SystemConfigPage />)
    expect(screen.getByText('Not reported yet')).toBeTruthy()
  })

  it('reboot asks first, then sends reboot', () => {
    render(<SystemConfigPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Reboot unit' }))
    expect(screen.getByText(/cold power cycle and will be offline for about 1–2 minutes/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reboot' }))
    expect(state.mutate.mock.calls[0][0]).toEqual({ unit: 'TRUCK-001', config: { reboot: true } })
  })

  it('maint can change the interval but not reboot; eu can do neither', () => {
    state.role = 'maint'
    const { unmount } = render(<SystemConfigPage />)
    expect(screen.getByRole('radio', { name: '15 s' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reboot unit' })).toBeNull()
    unmount()
    state.role = 'eu'
    render(<SystemConfigPage />)
    expect(screen.queryByRole('radio', { name: '15 s' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reboot unit' })).toBeNull()
  })

  it('demo units are read-only', () => {
    state.unit = 'APU-DEMO-01'
    render(<SystemConfigPage />)
    expect(screen.getByText("Demo units can't be configured.")).toBeTruthy()
    expect(screen.queryByRole('radio', { name: '15 s' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reboot unit' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ~/dev/cortex-yocto/cloud/frontend && npx vitest run src/api/settings.test.js src/pages/SystemConfigPage.test.jsx 2>&1 | grep -E "×|Tests |Error" | head -5`
Expected: both fail to import their modules.

- [ ] **Step 3: Implement the helper**

`cloud/frontend/src/api/settings.js`:
```js
// Reporting-interval choices. The Dashboard marks a unit Offline after 60 s of
// silence, so <= 20 s always leaves room for three missed reports.
export const INTERVAL_CHOICES = [5, 10, 15, 20]
export const PENDING_TIMEOUT_MS = 120000

// State of a requested interval change, from what the unit reports back.
export function intervalStatus({ reported, requested, sentAt, now }) {
  if (requested == null) return 'idle'
  if (Number(reported) === Number(requested)) return 'confirmed'
  if (sentAt != null && now - sentAt > PENDING_TIMEOUT_MS) return 'unconfirmed'
  return 'pending'
}
```

- [ ] **Step 4: Implement the page**

`cloud/frontend/src/pages/SystemConfigPage.jsx`:
```jsx
import { useState, useEffect } from 'react'
import { IconClockHour4, IconPower, IconInfoCircle } from '@tabler/icons-react'
import { useUnits, useShadow, useUnitLatest, useSetConfig } from '../data/hooks.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useCan } from '../components/RoleGate.jsx'
import { unitView, apuVersionLabel } from '../api/contract.js'
import { INTERVAL_CHOICES, intervalStatus } from '../api/settings.js'
import UnitPicker from '../components/UnitPicker.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'

const STATUS_TEXT = {
  pending: 'Pending — waiting for the unit to confirm',
  unconfirmed: 'Not confirmed yet — the unit may be offline',
  confirmed: 'Confirmed by the unit',
}

function Row({ label, children }) {
  return (
    <div className="rd">
      <span className="rl">{label}</span>
      <span className="rv sm">{children}</span>
    </div>
  )
}

export default function SystemConfigPage() {
  const { selectedUnit, setSelectedUnit } = useAuth()
  const { data: units } = useUnits()
  const list = units || []
  const unit = selectedUnit || list[0]?.unit || null
  useEffect(() => { if (!selectedUnit && list[0]) setSelectedUnit(list[0].unit) }, [selectedUnit, list.length])

  const { data: shadow } = useShadow(unit)
  const { data: tele } = useUnitLatest(unit)
  const setConfig = useSetConfig()
  const canInterval = useCan('config').allowed
  const canReboot = useCan('ota').allowed
  const isDemo = (unit || '').startsWith('APU-DEMO-')

  const reported = shadow?.reported?.poll_interval_s
  const [choice, setChoice] = useState(null)
  const [request, setRequest] = useState(null) // { value, sentAt }
  const [confirmInterval, setConfirmInterval] = useState(false)
  const [confirmReboot, setConfirmReboot] = useState(false)
  const [msg, setMsg] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t) }, [])
  useEffect(() => { setChoice(null); setRequest(null); setMsg(null) }, [unit])

  const status = intervalStatus({ reported, requested: request?.value ?? null, sentAt: request?.sentAt ?? null, now })
  const selectedChoice = choice ?? (INTERVAL_CHOICES.includes(Number(reported)) ? Number(reported) : null)
  const outside = reported != null && !INTERVAL_CHOICES.includes(Number(reported))

  const sendInterval = () => {
    const value = choice
    setConfirmInterval(false)
    setConfig.mutate({ unit, config: { poll_interval_s: value } }, {
      onSuccess: () => { setRequest({ value, sentAt: Date.now() }); setMsg(null) },
      onError: (e) => setMsg({ ok: false, text: `Couldn't change the interval: ${e.message}` }),
    })
  }
  const sendReboot = () => {
    setConfirmReboot(false)
    setConfig.mutate({ unit, config: { reboot: true } }, {
      onSuccess: () => setMsg({ ok: true, text: 'Reboot requested. The unit will be offline for about 1–2 minutes.' }),
      onError: (e) => setMsg({ ok: false, text: `Couldn't request a reboot: ${e.message}` }),
    })
  }

  return (
    <>
      <div className="toolbar">
        <UnitPicker units={list} value={unit} onChange={setSelectedUnit} />
      </div>

      {isDemo && <div className="notice">Demo units can't be configured.</div>}
      {msg && <div role="status" className={msg.ok ? 'msg-ok' : 'msg-err'}>{msg.text}</div>}

      {unit && (
        <div className="ov-layout">
          <div className="ov-groups" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
            <section className="group" aria-labelledby="int-h">
              <h2 id="int-h" className="group-hd" style={{ margin: 0 }}>
                <IconClockHour4 size={18} aria-hidden="true" /> Reporting interval
              </h2>
              <div style={{ fontSize: 22, fontWeight: 500 }}>
                {reported != null ? `Every ${reported} seconds` : 'Not reported yet'}
              </div>
              {outside && <div className="stat-cap">This interval was set outside this page.</div>}
              <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-secondary)' }}>
                How often the unit reads the APU and sends telemetry. Shorter intervals give fresher data but add database load.
              </p>

              {canInterval && !isDemo && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div className="seg" role="radiogroup" aria-label="Reporting interval">
                    {INTERVAL_CHOICES.map((s) => (
                      <label key={s}>
                        <input type="radio" name="poll-interval" value={s}
                          checked={selectedChoice === s} onChange={() => setChoice(s)} />
                        {s} s
                      </label>
                    ))}
                  </div>
                  <button className="btn btn-primary" onClick={() => setConfirmInterval(true)}
                    disabled={choice == null || choice === Number(reported) || setConfig.isPending}>
                    Change interval
                  </button>
                </div>
              )}
              {status !== 'idle' && (
                <div role="status" className={status === 'unconfirmed' ? 'msg-err' : status === 'confirmed' ? 'msg-ok' : 'stat-cap'}>
                  {STATUS_TEXT[status]}
                </div>
              )}
            </section>

            {canReboot && !isDemo && (
              <section className="group" aria-labelledby="reboot-h">
                <h2 id="reboot-h" className="group-hd" style={{ margin: 0 }}>
                  <IconPower size={18} aria-hidden="true" /> Restart
                </h2>
                <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-secondary)' }}>
                  Restarts the unit's computer. The APU controller keeps running.
                </p>
                <div><button className="btn btn-red" onClick={() => setConfirmReboot(true)}>Reboot unit</button></div>
              </section>
            )}
          </div>

          <div className="ov-side">
            <section className="group" aria-labelledby="info-h">
              <h2 id="info-h" className="group-hd" style={{ margin: 0 }}>
                <IconInfoCircle size={18} aria-hidden="true" /> Unit info
              </h2>
              <div>
                <Row label="System image">{shadow?.reported?.firmware_version || '—'}</Row>
                <Row label="APU firmware">{apuVersionLabel(tele?.apu_fw_version)}</Row>
                <Row label="Last report">{tele ? unitView(tele, now).seen : '—'}</Row>
                {shadow?.reported?.ota_status && shadow.reported.ota_status !== 'idle' && (
                  <Row label="Update status">{shadow.reported.ota_status}</Row>
                )}
              </div>
            </section>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmInterval}
        title={`Change reporting interval to ${choice} s?`}
        body={`${unit} will read the APU and send telemetry every ${choice} seconds.`}
        confirmLabel="Change interval"
        pending={setConfig.isPending}
        onConfirm={sendInterval}
        onCancel={() => setConfirmInterval(false)}
      />
      <ConfirmDialog
        open={confirmReboot}
        title={`Reboot ${unit}?`}
        body="The unit restarts via a cold power cycle and will be offline for about 1–2 minutes."
        confirmLabel="Reboot"
        danger
        pending={setConfig.isPending}
        onConfirm={sendReboot}
        onCancel={() => setConfirmReboot(false)}
      />
    </>
  )
}
```
(The page button and the dialog's confirm button share the label "Change interval"; the test clicks the page button, then the last match, which is the dialog's.)

- [ ] **Step 5: Route, remove the stub, run tests**

In `cloud/frontend/src/App.jsx`: add `import SystemConfigPage from './pages/SystemConfigPage.jsx'`; change the `/config` route to `element={<SystemConfigPage />}`; remove the `StubPage` import. Then:
```bash
cd ~/dev/cortex-yocto/cloud/frontend
grep -rn "StubPage" src | grep -v "src/pages/StubPage.jsx" || echo "no users"
git rm -q src/pages/StubPage.jsx
npx vitest run 2>&1 | grep -E "×|Tests |Test Files" && npm run build 2>&1 | grep -E "built|rror"
```
Expected: `no users`; all tests pass; `✓ built`.

- [ ] **Step 6: Visual check against the mock**

Start the mock server as in Task 5 Step 7, open `/config`: interval shows "Every 10 seconds"; pick 15 s → Change interval → confirm → "Pending — waiting…" → within ~8 s "Confirmed by the unit" and "Every 15 seconds"; Reboot unit opens the danger dialog; switch "View as" to Maintenance (no Reboot) and End User (no controls); select a demo unit (read-only note). Check dark mode and ~390 px width. Stop the server.

- [ ] **Step 7: Commit**

```bash
cd ~/dev/cortex-yocto
git add cloud/frontend/src/api/settings.js cloud/frontend/src/api/settings.test.js cloud/frontend/src/pages/SystemConfigPage.jsx cloud/frontend/src/pages/SystemConfigPage.test.jsx cloud/frontend/src/App.jsx
git commit -m "feat(web): System config — per-unit reporting interval, reboot, unit info"
```

---

### Task 7: Rollout and live verification (user-gated)

**Files:** none (deploy + checks). Every step that changes production waits for the user's explicit OK.

- [ ] **Step 1: PR and merge**

```bash
cd ~/dev/cortex-yocto && git push -q -u origin feat/fleet-map-system-config
gh pr create -R delorean1483/cortex-yocto --base main --head feat/fleet-map-system-config \
  --title "Fleet map (assigned locations) + System config" --body "$(cat <<'BODY'
## Summary
Replaces the last two "Coming soon" pages. Spec: `docs/superpowers/specs/2026-09-23-fleet-map-and-system-config-design.md`.

**Fleet map** — admin-assigned unit locations on OpenStreetMap (units have no GPS yet). New DynamoDB table `ecofleet-prod-unit-locations`, `GET /fleet/locations`, `PATCH|DELETE /fleet/units/{unit}/location` (role action `location`: admin/fm). Pins colored by dashboard status; set/move by clicking the map or typing coordinates; demo units have fixed demo spots.

**System config** — per-unit reporting interval (5/10/15/20 s, pending until the unit confirms), guarded reboot, unit info. Uses the existing `/fleet/config` + `/fleet/shadow`; report mode and setpoints are omitted because the agent doesn't act on them.

## Rollout (after merge, each step confirmed)
1. `terraform apply` (expected plan: 4 to add, 2 to change, 0 to destroy)
2. API Lambda deploy (`scripts/deploy-lambda.sh api`, CodeSha256 check)
3. `vercel --prod`

## Test plan
- [x] Backend: all `cloud/lambda/api/*.test.js` pass (new `locations-view`, `location` permission)
- [x] Frontend: vitest all pass, `vite build` clean
- [x] Visual check against the dev mock (desktop + phone, light + dark)
- [ ] Live: set/move/remove TRUCK-001's location; change its interval and see it confirmed

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```
Ask the user to approve the merge; then `gh pr merge <n> -R delorean1483/cortex-yocto --merge --delete-branch` and `git checkout main && git pull`.

- [ ] **Step 2: Terraform apply (ask first)**

Re-run `AWS_PROFILE=default terraform plan -input=false -out="$TMPDIR/locations.tfplan"` from `cloud/terraform` on `main`, show the user the summary (expected `4 to add, 2 to change, 0 to destroy`), and only after an explicit yes:
```bash
AWS_PROFILE=default terraform apply -input=false "$TMPDIR/locations.tfplan"
aws dynamodb describe-table --table-name ecofleet-prod-unit-locations --query "Table.TableStatus" --output text   # ACTIVE
aws lambda get-function-configuration --function-name ecofleet-prod-api --query "Environment.Variables.LOCATIONS_TABLE" --output text   # ecofleet-prod-unit-locations
```

- [ ] **Step 3: Deploy the API Lambda (ask first)**

```bash
cd ~/dev/cortex-yocto && AWS_PROFILE=default bash scripts/deploy-lambda.sh api
```
Confirm the printed `sha` equals `openssl dgst -sha256 -binary cloud/terraform/dist/api.zip | base64`.

- [ ] **Step 4: Web deploy (user runs)**

Ask the user to run: `! cd ~/dev/cortex-yocto/cloud/frontend && vercel --prod`

- [ ] **Step 5: Live checks (browser, signed-in session)**

1. `/map`: `GET /fleet/locations` → 200; TRUCK-001 under "Not placed yet"; demo pins shown.
2. Set TRUCK-001's location (click the map, label "Bench") → `PATCH …/location` 200; reload → pin persists; Remove → `DELETE` 200 → back under "Not placed yet".
3. `/config` for TRUCK-001: interval matches the unit; change it (e.g. to 10 s) → Pending → Confirmed within ~2 poll cycles; then set it back to its original value.
4. **Do not press Reboot** on TRUCK-001 unless the user explicitly asks — it power-cycles the bench unit.
5. `aws logs filter-log-events --log-group-name /aws/lambda/ecofleet-prod-api --start-time $(( ($(date +%s) - 900) * 1000 )) --filter-pattern '?ERROR ?"Task timed out"'` — expect only the known Node-version SDK notice.

- [ ] **Step 6: Record**

Update the project memory (`project-web-dashboard.md` in both memory folders) with the PR number, merge commit, table name, and Lambda sha.
