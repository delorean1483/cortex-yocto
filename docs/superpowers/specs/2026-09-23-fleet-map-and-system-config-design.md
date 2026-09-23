# Fleet map (assigned locations) + System config (per-unit settings) — design

**Date:** 2026-09-23
**Status:** approved in conversation; awaiting spec review
**Scope:** web dashboard (`cloud/frontend`), API Lambda (`cloud/lambda/api`), Terraform (`cloud/terraform`). No firmware or gobi-agent changes.

## Goal

Replace the two remaining "Coming soon" pages with working features:

1. **Fleet map** — show every unit on a map. Units have **no GPS** today (no GNSS/LTE hardware), so each unit gets an **assigned location** set by an admin. When units later report GPS, live position takes over and the assigned location becomes the fallback.
2. **System config** — per-unit settings that the gobi-agent *actually applies*: telemetry reporting interval and a guarded reboot, plus read-only unit info.

**Primary users:** technicians / support staff, small fleet (< 20 units) — same audience as the dashboard redesign.

## Context and constraints (verified in code)

- Telemetry (`cloud/CONTRACT.md`) has no position fields.
- `POST /fleet/config` already writes `desired` to the unit's IoT shadow and accepts `poll_interval_s` (5–60), `report_mode`, `clmt_setpoint_f`, `batt_setpoint_v`, `reboot`, `firmware_target`.
- The gobi-agent (`meta-ecofleet/.../gobi-agent/files/shadow.c`, `main.c`) **applies** `poll_interval_s` (main loop cadence), `reboot` (PMIC cold reset via the root worker) and `firmware_target`. It **stores and echoes but never acts on** `report_mode`, and **ignores** the setpoints. It reports `poll_interval_s`, `report_mode`, `firmware_version`, `ota_status` back in `reported`.
- The dashboard's Offline rule is a fixed 60 s since last report (`unitView` in `contract.js`).
- Roles (`permissions.js`, mirrored in the frontend): `config` → admin, fm, maint; `ota` (includes reboot) → admin, fm; eu → no writes.
- DynamoDB pattern exists: `maintenance` and `users` tables in `cloud/terraform/dynamodb.tf`, IAM via `aws_iam_role_policy.lambda_dynamodb`, table names passed to the API Lambda by env var.
- Terraform state is remote (S3 bucket `ecofleet-terraform-state-472125992122`, key `apu/terraform.tfstate`).

## Part 1 — Fleet map

### Data

New DynamoDB table **`${project}-${env}-unit-locations`** (PAY_PER_REQUEST), hash key `unit` (S). Item:

| attribute | type | notes |
|---|---|---|
| `unit` | S | unit id |
| `lat` | N | −90…90 |
| `lon` | N | −180…180 |
| `label` | S | optional, ≤ 60 chars (e.g. "Dallas yard") |
| `updated_by` | S | caller email from the JWT |
| `updated_at` | N | epoch ms |

Demo units (`APU-DEMO-*`) are never stored; the API returns fixed demo positions for them so the map is never empty in demos.

### API

- **`GET /fleet/locations`** — any signed-in role. Returns `{ locations: [{ unit, lat, lon, label, source, updated_by, updated_at }] }` for every stored unit plus the demo units. `source` is `"assigned"` (stored) or `"demo"`; `"gps"` is reserved for when devices report position.
- **`PATCH /fleet/units/{unit}/location`** — role action **`location`** (admin, fm). Body `{ lat, lon, label? }` sets (or moves) it. Validation (400): `lat`/`lon` finite numbers in range; `label` string ≤ 60 chars; unit must not be a demo unit (400 "demo units have fixed demo locations").
- **`DELETE /fleet/units/{unit}/location`** — role action `location`; removes the stored location (404 if none).
- PATCH/DELETE rather than PUT because the API's CORS config already allows `GET, POST, PATCH, DELETE, OPTIONS` and not PUT — no CORS change needed.
- Pure helpers in a new `locations-view.js` (validation + demo positions + merge), unit-tested with `node:assert` like the other `*-view.js` modules.

### Permissions

Add action **`location`** to the role matrix in both `cloud/lambda/api/permissions.js` and `cloud/frontend/src/api/permissions.js`: admin ✓, fm ✓, maint ✗, eu ✗.

### Infrastructure (Terraform)

- `aws_dynamodb_table.unit_locations` in `dynamodb.tf`.
- Extend `aws_iam_role_policy.lambda_dynamodb` with `GetItem`, `PutItem`, `DeleteItem`, `Scan` on the new table.
- Env var `LOCATIONS_TABLE` on the API Lambda.
- API Gateway routes are explicit (`cloud/terraform/api.tf`), so add three `aws_apigatewayv2_route` resources targeting the existing API integration: `GET /fleet/locations`, `PATCH /fleet/units/{unit}/location`, `DELETE /fleet/units/{unit}/location`.
- Applied only after showing `terraform plan` to the user; the plan must show only these additions/changes.

### Frontend

- Dependencies: `leaflet` + `react-leaflet` (MIT). Tiles: OpenStreetMap standard tiles with the required "© OpenStreetMap contributors" attribution. No API key.
- **Layout:** map on the left/top, a unit list beside it (below it on phones).
  - **Pins:** one per placed unit, colored by the dashboard status tone (`unitView`: fault / warning / running / offline) with an icon, not color alone. Clicking a pin opens a popup: unit id, status line (same wording as the Dashboard card headline), label, "Assigned location" / "Demo location", and **Open unit**.
  - **Unit list:** every unit with its status badge; placed units first (fault-first order, like the Dashboard), then a **"Not placed yet"** group. Selecting a placed unit centres the map on it.
  - **Initial view:** fits all pins; with no pins, a neutral continental-US view.
- **Set location** (roles with `location`): choose a unit → the map enters placing mode ("Click the map to place APU-…") → click places a draggable pin; lat/lon fields and an optional label field sit beside it for exact entry → **Save** / **Cancel**. **Remove location** on a placed unit (confirmation dialog). Read-only roles see no edit controls.
- A persistent note on the page: **"Assigned locations — units don't report GPS yet."**
- Live status comes from the existing per-unit latest-telemetry polling (15 s); locations are fetched once and refetched after a save.

## Part 2 — System config (per-unit settings)

### What it shows

Unit picker (shared `UnitPicker`), then for the selected unit:

- **Reporting interval** — the value the unit **reports** (`reported.poll_interval_s` from the shadow).
  - Choices: **5, 10, 15, 20 s** (segmented control). Rationale: the Offline rule is a fixed 60 s, so ≤ 20 s keeps at least three reports inside it without changing offline logic. Helper text: shorter = fresher data, more database load.
  - Changing it sends `POST /fleet/config { unit, config: { poll_interval_s } }` behind a confirmation. Until `reported.poll_interval_s` matches, show **"Pending — waiting for the unit to confirm"**; after a timeout (2 minutes) show "Not confirmed yet — the unit may be offline" (no automatic retry).
  - If the unit reports a value outside the choices (e.g. 30 s set elsewhere), show it as-is with a note, and the choices still work.
- **Reboot unit** — *Deferred at implementation (2026-09-23 review): the gobi-agent nulls `desired.reboot` only in its next report, after the root worker has already cold-reset the board, and it re-applies a stale `desired.reboot` on startup — so a reboot sent from the UI can loop. The button ships once the agent clears the request before handing off to the worker.* Original design: button behind a confirmation: "The unit restarts via a cold power cycle and will be offline for about 1–2 minutes." Sends `config: { reboot: true }`. Role action `ota` (admin, fm).
- **Unit info** (read-only): system image version (`reported.firmware_version`), APU firmware (`apu_fw_version` from telemetry, semver), last report age, current OTA status if not idle.
- **Not shown:** `report_mode` and setpoints (the agent doesn't act on them).

### Permissions

Interval: action `config` (admin, fm, maint). Reboot: action `ota` (admin, fm). Controls a role can't use are replaced by read-only values (no disabled-button clutter); demo units are read-only with "Demo units can't be configured."

### API

No changes — reuses `POST /fleet/config` and `GET /fleet/shadow?unit=…`.

## Error handling

- API failures on the map show an inline error with Retry; the map still renders pins it has.
- Save failures keep the form open with the API's message.
- Settings: a rejected config write (403/400) shows the message and leaves the displayed value unchanged.

## Testing

- **Backend:** `locations-view.test.js` — coordinate/label validation, demo-unit rejection, demo positions, merge output shape; permissions test for the `location` action.
- **Frontend (vitest):**
  - Map page: list ordering (placed fault-first, then "Not placed yet"), set-location flow (enter placing mode → coordinates → save calls the API with `{lat, lon, label}`), read-only role sees no edit controls. Leaflet is mocked in tests (jsdom has no canvas/layout).
  - Settings page: shows the reported interval; selecting a new value → confirm → API called with `poll_interval_s`; pending state until reported matches; reboot confirmation; read-only and demo states.
- **Visual:** dev mock (mock API gains `getLocations`/`setLocation` and shadow `poll_interval_s` echo) at desktop and phone widths, light and dark.

## Rollout

1. Terraform plan → user OK → apply (table, IAM, env var, three routes).
2. API Lambda deploy (`scripts/deploy-lambda.sh api`, verify CodeSha256).
3. Web deploy (`vercel --prod`, user-run).

## Out of scope

- Live GPS (needs device hardware; the `source: "gps"` slot is reserved).
- Address search / geocoding (lat/lon + click-to-place only).
- Fleet-wide settings table or bulk apply.
- Changing the Offline rule or the agent.
