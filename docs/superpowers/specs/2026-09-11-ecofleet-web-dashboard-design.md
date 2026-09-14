# EcoFleet Web Dashboard — Design Spec

**Date:** 2026-09-11
**Status:** Draft (pending user review)
**Author:** skang@protekweb.com (with Claude)

---

## Summary

Turn the skeletal `cloud/frontend/` React app into the finished, professional,
EcoFleet-branded fleet dashboard, wired **live end-to-end** to the real device
telemetry, and surfacing **every feature already built on the firmware side**
(APU control, sensor suite, VEVOR diesel heater, component test, climate,
firmware/OTA, remote control).

The firmware and on-device agent are **already complete**: `gobi-agent`
publishes a rich telemetry JSON to AWS IoT Core (`ecofleet/<serial>/telemetry`)
every cycle — the same payload it writes to `latest.json` — and consumes a
device-shadow control plane (`desired.heater`, `desired.apu_command`,
`desired.firmware_target`, …) with a seq/ack compare-and-clear pattern. **No
firmware or agent changes are in scope.** All work is in the cloud pipeline and
the web app.

The build is **contract-first, three layers**:

1. **Data contract** — write the agent's payload down once as the canonical
   schema + a golden JSON fixture shared by all tests.
2. **Backend pipeline** — reconcile the ingest Lambda to the real field names,
   store the full field set in InfluxDB, and extend the API Lambda to return
   everything plus role-guarded remote-control shadow writes.
3. **Web dashboard** — the branded React app: fleet overview + deep unit
   detail, guarded/confirmed write actions, light/dark themes, deployed to the
   existing Vercel project.

---

## Goals

- Live, end-to-end dashboard for the real `.86` unit — telemetry, faults,
  history, and remote control all flowing through the real pipeline.
- Surface **all** firmware features (see §5) at professional visual quality.
- EcoFleet-branded (official logo + palette), replacing the current unrelated
  amber theme.
- Guarded + confirmed remote control (APU start/stop, heater on/level, climate
  & battery setpoints, component test, OTA), role-gated, honoring firmware
  safety refusals.
- Fleet framing that scales to N units; today shows the one real unit plus
  clearly-labeled `(demo)` peers so fleet screens are populated honestly.

## Non-goals

- No firmware or `gobi-agent` changes.
- No new AWS infrastructure beyond the existing IoT Core / Lambda / InfluxDB /
  API Gateway / DynamoDB / Cognito-style auth / `ecofleet-ota` S3 stack.
- No GPS/mapping data source yet (telemetry carries no lat/lng) — the Fleet Map
  ships as an honest placeholder with a wiring note.
- No new user-facing auth flows beyond the existing token + refresh model.
- Not a native/mobile app; responsive web down to tablet width.

---

## Architecture overview

```
STM32 APU + VEVOR heater ──Modbus──▶ gobi-agent (device) ──MQTT/TLS──▶ AWS IoT Core
        (unchanged)                        │                                │
                                  latest.json (local Qt UI)         IoT Rule ─▶ ingest Lambda ─▶ InfluxDB
                                                                                       │
     Vercel: React dashboard ◀── API Gateway ◀── api Lambda ◀── InfluxDB + Device Shadow + DynamoDB
                     │                                                   ▲
                     └────────── remote control (shadow desired) ───────┘
```

- **Device → cloud** telemetry and control contracts already exist and are
  frozen by the firmware; the cloud conforms to them.
- **Backend** lives in `cloud/lambda/{ingest,api,fault}` + `cloud/terraform`,
  deployed to the existing AWS account (user runs deploys; needs creds).
- **Frontend** lives in `cloud/frontend/`, deployed to the existing Vercel
  project (`prj_ikOUiWJImDPeb61ts075JGqeq07l`).

---

## Layer 1 — The data contract

**Deliverable:** `cloud/CONTRACT.md` + `cloud/fixtures/telemetry.sample.json`
(a real capture of `latest.json` from the `.86` unit), used as the golden
fixture by both the ingest tests and the frontend normalizer tests. This kills
the current field-name drift (the ingest Lambda today reads `oil_psi`,
`coolant_t`, `dc_v`, `batt_soc` — **none of which the agent emits**).

### 1a. Telemetry — topic `ecofleet/<serial>/telemetry`

Emitted by `build_telemetry_json()` in `gobi-agent/files/main.c`. Every field
below is authoritative. Enum fields carry **both** a string label and a raw
`_n` integer; the UI renders the label and keys logic off `_n`.

| Field | Type | Meaning |
|---|---|---|
| `unit` | string | Device serial |
| `ts` | number (ms) | Sample timestamp |
| `cabin_temp_f`, `ext_temp_f` | number | Cabin / external temp (°F) |
| `batt_v` | number | Battery voltage |
| `rpm` | number | Engine RPM |
| `oil_ok` | bool | Oil pressure OK |
| `ignition` | bool | Ignition sense |
| `mode` / `mode_n` | string / int | APU op mode (e.g. `battery`) |
| `engine_status` / `_n` | string / int | Engine status |
| `control_status` / `_n` | string / int | Control status |
| `error` / `_n` | string / int | Active error/fault label |
| `oil_change` / `_n` | string / int | Oil-change state |
| `engine_hrs`, `oil_hrs`, `machine_hrs` | number | Runtime hour counters |
| `clmt_setpoint_f` | number | Climate setpoint (°F) |
| `batt_setpoint_v` | number | Battery-mode setpoint (V) |
| `fan_speed` | number | Fan duty (0–100%) |
| `fan_auto` | bool | Auto-fan enabled |
| `diag_active` | bool | Component-Test (OP_DIAG) mode active |
| `diag_outputs` | int (bitmask) | Energized output bitmask |
| `apu_fw_version` | int | APU firmware version (encoded) |
| `heater_present` | bool | Heater block answered Modbus |
| `heater_state` | string | off/preheat/ignition/running/cooldown |
| `heater_target_level`, `heater_active_level` | int | Requested / active level |
| `heater_error` | int | Heater ECU error code |
| `heater_supply_v` | number | Heater supply voltage |
| `heater_fan_rpm` | int | Heater blower RPM |
| `heater_pump_hz` | number | Fuel pump frequency (Hz) |
| `heater_exchanger` | int | Exchanger temp (raw) |
| `heater_state_seconds` | int | Seconds in current state |
| `heater_age_ms` | int | Age of last good heater read |
| `heater_flags` | int (bitmask) | fresh/cooldown/safe_off/comms_fault/xport_fault |
| `heater_safe_off`, `heater_comms_ok` | bool | Derived from flags |
| `heater_valid_frames`, `heater_checksum_failures`, `heater_transport_errors` | int | Link health counters |

### 1b. Fault — topic `ecofleet/<serial>/faults`

`{ unit, ts, error, error_n, status }` — published on every change including
the transition back to `none`, so the cloud can auto-resolve.

### 1c. Device shadow — control plane

- **`desired`** (writes from the dashboard): `apu_command`, `heater:{on,level}`
  (`on`∈{0,1}, `level`∈[1,10]), `firmware_target`, `reboot`, `poll_interval_s`,
  `report_mode`∈{normal,eco,debug}, plus setpoint fields.
- **`reported`** (device acks): applied values + `heater_desired_seq` (monotonic;
  bumped when a heater desired is accepted; the agent nulls `desired.heater`
  once applied — compare-and-clear). The UI tracks pending → applied off this.

### 1d. OTA

Shadow `desired.firmware_target=<version>` → agent downloads
`https://ecofleet-ota.s3.amazonaws.com/releases/<version>/ecofleet-<version>.swu`,
runs `swupdate`, reboots on success. The dashboard triggers by setting
`firmware_target`; progress is inferred from `reported` fw version + connection.

---

## Layer 2 — Backend pipeline

### 2a. ingest Lambda (`cloud/lambda/ingest/index.js`)

Rewrite the field mapping to the real agent schema (§1a). Write the full field
set to InfluxDB measurement `telemetry`, tagged by `unit` (+ enum string tags
for `mode`/`engine_status`/`control_status`/`error` for cheap filtering);
numeric/bool values as fields. Faults → measurement `faults`. Unknown/absent
fields are tolerated (older firmware). Host tests assert the golden fixture maps
correctly and that missing fields don't throw.

### 2b. api Lambda (`cloud/lambda/api/api.js`)

| Method + path | Purpose | Notes |
|---|---|---|
| `POST /auth/login`, `/auth/refresh` | Auth | unchanged |
| `GET /fleet/units` | Unit list + latest snapshot + role scope | includes `(demo)` flag |
| `GET /fleet/units/{unit}/latest` | Full latest snapshot (all §1a fields) | new |
| `GET /fleet/units/{unit}/telemetry?fields=&range=` | Time series | selectable fields |
| `GET /fleet/units/{unit}/faults?range=&limit=` | Fault history | keep |
| `GET /fleet/shadow?unit=` | Reported + desired shadow | keep, extend fields |
| `POST /fleet/units/{unit}/command` | **Role-guarded** shadow-desired write | new; body `{heater?,apu_command?,firmware_target?,reboot?,setpoints?}`; returns pending seq |
| `POST /fleet/config` | poll/report_mode/setpoint writes | keep, extend |
| `GET /fleet/reports`, `/maintenance`, `POST /maintenance` | keep |
| `GET/POST/PATCH/DELETE /fleet/users` | keep |

### 2c. Roles & write-permission matrix

Roles from the existing DynamoDB lookup: `admin`, `fm` (fleet manager),
`maint` (maintenance), `eu` (end user).

| Action | admin | fm | maint | eu |
|---|---|---|---|---|
| View telemetry / history / faults | ✓ | ✓ (own fleet) | ✓ | ✓ (own unit) |
| Heater on/level, climate & battery setpoints | ✓ | ✓ | ✓ (with note) | ✗ |
| APU start/stop | ✓ | ✓ | ✗ (supervisor sign-off) | ✗ |
| Component Test (OP_DIAG) | ✓ | ✓ | ✓ (passcode) | ✗ |
| OTA / firmware_target | ✓ | ✓ | ✗ | ✗ |
| Manage users / system config | ✓ | ✓ (own fleet) | ✗ | ✗ |

Enforced **server-side** in the api Lambda (the UI also gates for UX, but the
server is authoritative).

### 2d. Demo peers

The api Lambda serves a handful of `(demo)`-flagged units from a **synthetic
generator module** (`cloud/lambda/api/demo.js`): deterministic-but-varying
latest snapshots and short telemetry series, merged into `GET /fleet/units`,
`/latest`, and `/telemetry` responses with `demo:true`. Nothing is written to
InfluxDB — demo data never mixes with real measurements. The real `.86` unit is
never flagged. Demo units are visibly badged in the UI and reject all control
writes (the command endpoint returns 4xx for `demo:true` units). A single env
flag (`DEMO_UNITS=on|off`) turns the peers off entirely.

---

## Layer 3 — Web dashboard

### 3a. Stack

React 18 + Vite + react-router (existing). **Add:**
`@tanstack/react-query` (background polling, retry, stale-while-revalidate for
live telemetry) and `recharts` (history charts, built following the `dataviz`
skill). `@tabler/icons-react` already present. Vitest + React Testing Library
for tests.

### 3b. Structure

```
src/
  theme/         design tokens (brand palette, light/dark), global.css
  api/           client.js (extend), contract.js (raw→view-model normalizers + enum labels)
  data/          react-query hooks: useUnits, useUnitLatest, useTelemetrySeries,
                 useFaults, useShadow, useCommand
  components/    AppShell (branded topbar+sidebar), StatCard, StatusBadge, Pill,
                 DataTable, Gauge, Sparkline, Toggle, LevelStepper, ConfirmDialog,
                 ThemeToggle, EmptyState, OfflineBanner, RoleGate
  pages/         fleet: DashboardPage, FleetMapPage, AlertsPage, ReportsPage,
                 UsersPage, ConfigPage
                 unit:  UnitDetailPage (+ tab panels below)
  contexts/      AuthContext (extend with role)
```

### 3c. Information architecture

**Fleet level**
- **Dashboard** — KPIs (online / active faults / avg runtime / fleet
  efficiency), unit-status list (click → unit detail), recent events.
- **Fleet map** — honest placeholder (no GPS field yet) with wiring note.
- **Alerts** — active alerts from faults + threshold rules; thresholds editable
  by role.
- **Reports** — runtime / fuel-saved / MTBF / fault-count aggregates + operator
  activity; CSV/PDF export.
- **Users** — role & fleet-scope management (admin/fm).
- **System config** — infra settings (admin).

**Unit detail** (`/units/:id`, tabbed):
- **Overview** — live sensor suite (cabin/ext temp, battery V, RPM, oil OK,
  ignition), engine/oil/machine hours, mode + engine/control status + active
  error, fw version, connection/stale indicator.
- **Telemetry** — Recharts history (battery V, RPM, temps, heater metrics) with
  range selector.
- **Heater** — full VEVOR card: present/state/target+active level, exchanger
  temp, fan RPM, pump Hz, supply V, flags (cooldown/safe-off/comms/xport),
  comms-ok badge, error code, frame health counters, **+ on/off + level
  control**.
- **Component Test** — passcode-gated OP_DIAG: `diag_active` state,
  `diag_outputs` bitmask as per-output tiles with actuation, mode keepalive.
- **Remote control** — APU start/stop, climate setpoint + fan (auto/manual),
  battery setpoint, LED color (all guarded + confirm).
- **Firmware / OTA** — current vs available version, A/B slot, trigger OTA
  (guarded + confirm), progress + reboot-expected banner.
- **History** — per-unit event log.

### 3d. Remote-control UX (guarded + confirm)

Each write: **RoleGate** (disabled + reason tooltip when not permitted) →
**ConfirmDialog** naming action + unit ("Start APU on `<serial>`?") →
`POST /fleet/units/{id}/command` (shadow desired) → button shows **Pending**
until shadow `reported` reflects it (heater via `heater_desired_seq`; others via
applied value), then **Applied**. Firmware safety refusals (refuse-while-engine,
crank, comms loss) surface as clear rejection toasts. Demo units never issue
real writes. OTA shows download/apply progress and a reboot-expected banner.

### 3e. States & resilience

react-query polling (telemetry ~5 s, lists ~30 s). Per-query loading skeletons,
empty states, an **offline/stale** banner when the latest sample age exceeds a
threshold, and non-blocking error toasts. Optimistic pending for commands,
reconciled against shadow `reported`.

### 3f. Branding & design system

- **Logo**: navy-"Eco" transparent variant in the topbar on light backgrounds /
  white-knockout on dark; full logo on login/boot; favicon from the mark.
- **Palette** (sampled exactly from the logo PNG during build): brand-blue
  `≈#29ABE2` (primary/interactive), eco-green `≈#8DC63F` (positive/eco/online),
  energy-orange `≈#F26522` (accent/warning), navy `≈#1B2A3A` (dark text /
  surfaces). Semantic: success=green, info=blue, warning=orange, danger=red.
  **Replaces amber `#BA7517`** everywhere.
- Clean sans typography, full **light + dark** themes with a toggle, responsive
  to tablet. Visual execution via the `frontend-design` skill during
  implementation.

---

## Testing strategy

- **Backend (host, jest):** ingest field-mapping against the golden fixture
  (all §1a fields land; missing fields tolerated); api normalizers &
  role-permission enforcement; extend existing `fault/faults.test.js` pattern.
- **Frontend (Vitest + RTL):** `contract.js` normalizers against the **same**
  golden fixture (shared contract test); card rendering (heater states, fault
  badges, stale banner); RoleGate hides/disables per role; ConfirmDialog gates
  writes.
- **Contract test:** one fixture, asserted by both sides, so device→cloud→web
  field names can never silently drift again.

---

## Phasing (feeds the implementation plan)

1. **Contract** — `CONTRACT.md` + golden fixture (capture from `.86`).
2. **Backend** — ingest reconcile + api extend (+ command endpoint + roles) +
   host tests.
3. **App shell** — branding, design system/theme, data layer, auth+role.
4. **Fleet overview** — Dashboard, Alerts, Reports, Users, Map placeholder,
   demo-peer seed.
5. **Unit detail** — Overview, Telemetry charts, Heater, Component Test,
   History.
6. **Remote control + OTA** — guarded/confirmed writes, pending/applied,
   firmware page.
7. **Deploy & verify** — Vercel build + Lambda deploy; verify live against the
   `.86` unit.

Each phase is independently reviewable; phases 4–6 can be split further in the
plan if a single plan grows too large.

---

## Risks & mitigations

- **Deploys need live AWS/Vercel creds** — user runs `deploy-lambda.sh` /
  `vercel` / terraform; the build produces the diffs and verifies host tests
  first. (Note the known spurious `ResourceConflictException` on lambda deploy.)
- **InfluxDB field/tag cardinality** — enum strings as tags are low-cardinality
  (bounded enums); numeric telemetry as fields. Reviewed in phase 2.
- **Real writes to a real APU** — guarded + confirmed + role-gated + server
  enforced; demo units inert; firmware safety refusals surfaced. Bench-verify
  before enabling APU start/stop broadly.
- **One real unit** — `(demo)` peers clearly labeled; real data never faked.
- **Exact brand hexes** — sampled from the PNG during build via an in-browser
  canvas read; approximate values above are placeholders until then.

---

## Out of scope

- Firmware / gobi-agent changes.
- GPS/live map data source.
- New AWS infrastructure or auth providers.
- Native/mobile apps.
- Animated logo / custom web fonts (system sans is fine).
