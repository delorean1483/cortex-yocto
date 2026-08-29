# EcoFleet dashboard — Claude Code handoff

## What this is

EcoFleet is a commercial IoT fleet monitoring system for truck APUs (Auxiliary Power Units).
The full stack runs: Yocto C agent on device → AWS IoT Core MQTT → Lambda ingest → InfluxDB →
React dashboard. This handoff covers the **dashboard** only.

A working interactive prototype exists at:
**https://claude.ai/chat/d2e3171e-18a3-49ad-a122-e0f996b96a4c**
(scroll to the second widget — the one with the role switcher)

---

## Repo

```
github.com/delorean1483/cortex-yocto
```

Dashboard source is at `dashboard/` in the repo root.
It is a Vite + React SPA. Run with `npm run dev`.

---

## Deployed infrastructure (already live)

| Resource | Value |
|----------|-------|
| API endpoint | `https://tphro82ot9.execute-api.us-east-1.amazonaws.com` |
| Cognito pool | `us-east-1_YdCgVyNVp` |
| Cognito client | `6fs8i8645p4hs0pk1daj758mb1` |
| AWS region | `us-east-1` |
| AWS account | `472125992122` |

Dashboard `.env.production`:
```
VITE_API_URL=https://tphro82ot9.execute-api.us-east-1.amazonaws.com
VITE_COGNITO_CLIENT_ID=6fs8i8645p4hs0pk1daj758mb1
```

---

## API routes (Lambda — api.js)

All routes except `/auth/login` require `Authorization: Bearer <jwt>`.

| Method | Path | What it does |
|--------|------|-------------|
| POST | `/auth/login` | Cognito auth → returns `{token, fleet_id}` |
| GET | `/fleet/units` | List units for caller's fleet |
| GET | `/fleet/telemetry?unit=TRUCK-001&start=-1h&fields=dc_v,batt_soc` | InfluxDB time-range query |
| GET | `/fleet/faults?unit=TRUCK-001&start=-24h` | Fault event history |
| GET | `/fleet/shadow?unit=TRUCK-001` | Device Shadow: reported + desired + delta + staleness |
| POST | `/fleet/config` | Push desired config to device via Shadow `{unit, config:{poll_interval_s, report_mode, reboot}}` |
| GET | `/health` | Liveness check |

JWT payload after login:
```json
{ "sub": "user@email.com", "email": "...", "fleet_id": "FLEET-001", "exp": ... }
```

The `fleet_id` claim scopes all queries — the API enforces it server-side.

---

## Telemetry fields available

From InfluxDB `telemetry` bucket (all numeric unless noted):

| Field | Unit | Notes |
|-------|------|-------|
| `dc_v` | V | DC bus voltage |
| `dc_a` | A | DC current |
| `batt_v` | V | Battery voltage |
| `batt_soc` | % | Battery state of charge |
| `batt_t` | °C | Battery temperature |
| `oil_psi` | PSI | Oil pressure |
| `coolant_t` | °C | Coolant temperature |
| `watts` | W | Power output |
| `rpm` | RPM | Engine RPM |
| `runtime_hrs` | hrs | Cumulative runtime |
| `apu_state` | string | off / starting / running / stopping / fault |
| `fault` | string | Hex e.g. `0x0020` |

Fault bit map (for display):

| Hex | Name | Severity |
|-----|------|----------|
| 0x0001 | DC over-voltage | CRITICAL |
| 0x0002 | DC under-voltage | WARNING |
| 0x0004 | Over-current | CRITICAL |
| 0x0008 | Over-temp (battery) | CRITICAL |
| 0x0010 | Over-temp (coolant) | CRITICAL |
| 0x0020 | Low oil pressure | CRITICAL |
| 0x0040 | Comm timeout | WARNING |
| 0x0080 | Charge failure | WARNING |
| 0x0100 | Engine start fail | CRITICAL |
| 0x0200 | Fan fault | WARNING |

---

## RBAC model (4 tiers)

Enforced via JWT `fleet_id` and `unit_serial` Cognito claims.

### EcoFleet Admin
- All access across all fleets
- Remote control (start/stop, LED color) all units
- Bulk maintenance across all fleets
- Firmware update any unit
- Set alert thresholds globally
- All reporting and history
- Full user management (can assign any role)
- System configuration

### Fleet Manager
- All of the above but **scoped to their `fleet_id`**
- User management for their fleet only
- Cannot assign roles above their own tier
- Cannot touch units outside their fleet

### Maintenance Tech
- Status checks and logs — all units they're assigned to
- Firmware updates
- Full maintenance history
- **Limited** remote control (start/stop requires supervisor sign-off — show a confirmation modal with note field)
- No LED control, no bulk actions, no alerts, no fleet reporting

### End User
- Own APU only (scoped by `unit_serial` claim)
- Remote control (start/stop, LED color)
- Firmware update
- Alerts (view and set thresholds for own unit)
- Own APU history and maintenance history
- No bulk actions, no fleet reporting, no user management

---

## What's already built (prototype)

The prototype (link above) has:
- Role switcher showing how nav and panels change per role
- Live telemetry cards (dc_v, batt_soc, oil_psi, coolant_t, apu_state)
- OTA firmware update panel with progress bar animation
- LED color picker
- Fault history table with severity badges
- All panels dynamically scoped per role

The prototype uses **mock data**. The production dashboard needs real API hooks.

---

## Four tasks to implement

### Task 1 — Lambda RBAC middleware (backend, `cloud/lambda/ingest/api.js`)

Add a middleware function that extracts the JWT claims and enforces route-level scoping.

Every authenticated route handler currently calls `authenticate(event)` which returns
`{ sub, email, fleet_id, exp }`. Extend this to:

```js
// Pseudocode — adapt to match existing api.js style
async function requireScope(event, requiredRole, unitParam = null) {
  const claims = await authenticate(event);
  // fleet_id scoping: query param unit must start with claims.fleet_id prefix
  // OR claims.fleet_id === 'ADMIN' bypasses all checks
  // unit_serial scoping: if claims.unit_serial exists, unit param must match exactly
  return claims;
}
```

Role hierarchy to enforce:
- `ADMIN` claim → no restrictions
- `fleet_id` claim → unit must belong to that fleet (unit naming convention: `{FLEET_ID}-{serial}`)
- `unit_serial` claim → can only query their exact unit

Routes to lock down:
- `GET /fleet/units` — return only units matching `claims.fleet_id`
- `GET /fleet/telemetry` — unit must match fleet or unit_serial scope
- `GET /fleet/faults` — same
- `GET /fleet/shadow` — same
- `POST /fleet/config` — Maintenance Tech cannot send `reboot: true` without a supervisor token

### Task 2 — Mobile layout (bottom nav bar)

The prototype has a left sidebar. For mobile (< 768px), collapse it into a bottom navigation bar.

Bottom nav items (icons + labels, role-scoped — hide items the current role can't access):
- Dashboard (home)
- Units (list)
- Faults (alerts)
- Maintenance
- Settings (admin/manager only)

The existing sidebar items should map 1:1 to bottom nav items. Use the same role-visibility
logic — don't show nav items for features the role can't access.

### Task 3 — Wireframe export document

Produce a PDF or markdown spec document that a frontend developer can implement against.
Should cover:
- All screens / panels per role (what's visible, what's interactive)
- Component hierarchy
- API call per panel (which endpoint, which params)
- Auth flow (login → JWT → scoped requests)
- Responsive breakpoints
- Color/typography tokens (match the existing prototype styling)

### Task 4 — Real-time telemetry (InfluxDB → WebSocket → React)

The dashboard currently queries telemetry on-demand. Add a live data feed.

Architecture:
- A new Lambda function (or extend the existing API Lambda) that queries InfluxDB for
  the last reading for a given unit and returns it
- API Gateway WebSocket API (or use polling at 5s interval as a simpler alternative)
- React hook `useLiveTelemetry(unitSerial)` that polls `GET /fleet/telemetry?unit=X&start=-30s`
  every 5 seconds and updates the telemetry cards
- Show a "live" indicator badge on cards when data is fresh (< 15s old), "stale" when older

The Device Shadow `reported.last_seen_ts` field can be used to determine online/offline status
without a separate query — if `(now - last_seen_ts) > 30s`, the unit is offline.

**Simpler approach (recommended for now):** polling every 5s against the existing
`GET /fleet/telemetry?unit=X&start=-30s&fields=dc_v,batt_soc,apu_state,fault` endpoint
is sufficient and avoids the complexity of a WebSocket API. A WebSocket can be added later
when the fleet grows large enough that polling becomes expensive.

---

## Auth flow

```
POST /auth/login {email, password}
→ { token: "eyJ...", fleet_id: "FLEET-001" }

Store token in memory (not localStorage — artifacts restriction).
Attach to all subsequent requests:
  Authorization: Bearer eyJ...

Token expires after 1 hour. On 401, redirect to login.
```

---

## Device Shadow shape (for the shadow panel)

```json
{
  "unit": "TRUCK-001",
  "shadow_exists": true,
  "version": 42,
  "reported": {
    "poll_interval_s": 5,
    "report_mode": "normal",
    "firmware_version": "1.1.0",
    "apu_state": "running",
    "dc_v": 27.8,
    "batt_soc": 82,
    "fault": "0x0000",
    "last_seen_ts": 1700000000000,
    "stale_seconds": 3,
    "online": true
  },
  "desired": {
    "poll_interval_s": 10
  },
  "delta": {
    "poll_interval_s": 10
  }
}
```

`delta` means desired ≠ reported — display a "pending" badge on those config fields.

---

## Styling reference

The prototype uses these CSS variable conventions (already in the codebase):
- Background: `var(--color-background-primary/secondary/tertiary)`
- Text: `var(--color-text-primary/secondary/tertiary)`
- Borders: `0.5px solid var(--color-border-tertiary)`
- Border radius: `var(--border-radius-md)` (8px), `var(--border-radius-lg)` (12px)
- Semantic colors: `--color-background-success/warning/danger/info`

Role accent colors (from the permission matrix):
- EcoFleet Admin: `#534AB7` (purple)
- Fleet Manager: `#0F6E56` (teal)
- Maintenance Tech: `#854F0B` (amber)
- End User: `#185FA5` (blue)

---

## Notes / gotchas

- `localStorage` is not available in claude.ai artifact context — use React state or
  `sessionStorage` for token storage in production.
- The API is in a VPC. Lambda functions have a cold-start delay of ~1-2s on first request
  after idle. Show a loading spinner on the first telemetry fetch.
- InfluxDB returns CSV from the query endpoint — `parseCsv()` is already implemented in
  `api.js`. The response shape is `{ count: N, rows: [...] }`.
- Device Shadow `GET /fleet/shadow` returns `shadow_exists: false` if the device has never
  connected. Handle this gracefully in the shadow panel.
- Maintenance Tech remote control (start/stop) requires a supervisor confirmation modal.
  The API doesn't enforce this — it's a UI-only constraint. Don't skip it.
- Fleet Manager cannot assign roles above their own level. The user management UI should
  not offer EcoFleet Admin as an assignable role when a Fleet Manager is logged in.
