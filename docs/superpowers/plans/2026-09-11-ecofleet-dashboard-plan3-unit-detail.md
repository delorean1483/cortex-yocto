# EcoFleet Dashboard — Plan 3: Unit Detail & Feature Cards

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the tabbed `/units/:id` detail screen that surfaces every firmware feature as read-only, professional cards: live sensor suite, VEVOR heater, component test, telemetry history charts, and event history.

**Architecture:** Replace the UnitDetailPage placeholder with a tabbed screen. Each tab is a focused component consuming the existing react-query hooks (`useUnitLatest`, `useTelemetrySeries`, `useFaults`) and `contract.js` helpers. Pure display helpers (heater flags, component-test outputs) are added to `contract.js` and TDD'd. Charts use `recharts` and follow the `dataviz` skill. Write/control actions are deliberately deferred to Plan 4.

**Tech Stack:** React 18, react-router 6, @tanstack/react-query, recharts, @tabler/icons-react, Vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-09-11-ecofleet-web-dashboard-design.md` (phase 5)

## Global Constraints

- **Contract:** field names per `cloud/CONTRACT.md` (`heater_*`, `diag_outputs`, `error`/`error_n`, etc.).
- **Read-only:** no shadow writes in this plan. Control lands in Plan 4.
- **Brand tokens** from `index.css` (`--brand-blue`, `--brand-green-text`, `--brand-orange`, semantic bg/border). No hard-coded amber.
- **Tests:** `cd cloud/frontend && npx vitest run <file>`; component tests mock `../data/hooks.js`. Verify visually on the dev server (mock mode) with a screenshot; do NOT rely on `npm run build` (slow locally).
- **Charts:** load the `dataviz` skill before writing chart code (Task 6).
- Working directory: `cloud/frontend/`.

---

### Task 1: contract.js display helpers (pure, TDD)

**Files:**
- Modify: `cloud/frontend/src/api/contract.js`
- Modify: `cloud/frontend/src/api/contract.test.js`

**Interfaces:**
- Produces:
  - `HEATER_FLAG_LABELS` and `heaterFlags(flags)` → array of `{ key, label, on }` for bits fresh(0x1)/cooldown(0x2)/safe_off(0x4)/comms_fault(0x8)/xport_fault(0x10).
  - `DIAG_OUTPUTS` (names, index 0..6) and `diagOutputs(mask)` → array of `{ idx, name, on }`.
  - `connLabel(tele)` → `{ text, cls }` where cls ∈ p-g/p-a/p-r/p-n: 'live'(p-g) if fresh, 'stale'(p-a) if old, 'no data'(p-n) if none.

- [ ] **Step 1: Add failing tests**

Append to `cloud/frontend/src/api/contract.test.js`:
```javascript
import { heaterFlags, diagOutputs, connLabel } from './contract.js'

describe('heaterFlags', () => {
  it('decodes xport-fault (0x10) as on, comms as off', () => {
    const f = heaterFlags(0x10)
    const x = f.find((b) => b.key === 'xport_fault')
    const c = f.find((b) => b.key === 'comms_fault')
    expect(x.on).toBe(true)
    expect(c.on).toBe(false)
  })
  it('decodes cooldown (0x2)', () => {
    expect(heaterFlags(0x2).find((b) => b.key === 'cooldown').on).toBe(true)
  })
})

describe('diagOutputs', () => {
  it('bit 6 set -> that output on, others off', () => {
    const outs = diagOutputs(1 << 6)
    expect(outs).toHaveLength(7)
    expect(outs[6].on).toBe(true)
    expect(outs[0].on).toBe(false)
  })
})

describe('connLabel', () => {
  it('no data', () => expect(connLabel(null).text).toBe('no data'))
  it('live when fresh', () => expect(connLabel({ ts: Date.now() }).text).toBe('live'))
  it('stale when old', () => expect(connLabel({ ts: Date.now() - 120000 }).text).toBe('stale'))
})
```

- [ ] **Step 2: Run — expect fail**

Run: `npx vitest run src/api/contract.test.js`
Expected: FAIL — `heaterFlags is not a function`.

- [ ] **Step 3: Implement in `contract.js`**

Append:
```javascript
export const HEATER_FLAG_LABELS = [
  { key: 'fresh',       bit: 0x01, label: 'Fresh' },
  { key: 'cooldown',    bit: 0x02, label: 'Cooldown' },
  { key: 'safe_off',    bit: 0x04, label: 'Safe-off' },
  { key: 'comms_fault', bit: 0x08, label: 'Comms fault' },
  { key: 'xport_fault', bit: 0x10, label: 'Transport fault' },
]
export function heaterFlags(flags) {
  const f = Number(flags) || 0
  return HEATER_FLAG_LABELS.map((x) => ({ key: x.key, label: x.label, on: (f & x.bit) !== 0 }))
}

// Component-test output names by index (mirrors firmware diag_outputs bits;
// names are best-effort labels — correct against firmware if they differ).
export const DIAG_OUTPUTS = [
  'Run/Ignition', 'Glow Plug', 'Starter', 'Fuel Pump',
  'Evap Fan', 'Compressor', 'Condenser Fan',
]
export function diagOutputs(mask) {
  const m = Number(mask) || 0
  return DIAG_OUTPUTS.map((name, idx) => ({ idx, name, on: (m & (1 << idx)) !== 0 }))
}

export function connLabel(tele) {
  if (!tele || tele.ts == null) return { text: 'no data', cls: 'p-n' }
  return isStale(tele) ? { text: 'stale', cls: 'p-a' } : { text: 'live', cls: 'p-g' }
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run src/api/contract.test.js`
Expected: all passed.

- [ ] **Step 5: Commit**
```bash
git add cloud/frontend/src/api/contract.js cloud/frontend/src/api/contract.test.js
git commit -m "feat(frontend): heater-flag, diag-output, connection helpers"
```

---

### Task 2: Tabbed UnitDetail shell

**Files:**
- Modify: `cloud/frontend/src/pages/UnitDetailPage.jsx`
- Create: `cloud/frontend/src/pages/UnitDetailPage.test.jsx`

**Interfaces:**
- Consumes: `useUnitLatest` (hooks), `connLabel` (Task 1).
- Produces: a tab bar with tabs Overview / Telemetry / Heater / Component Test / History; renders the active panel. Tab components are added in later tasks — this task renders placeholders for each and the shared header (back button, unit id, connection pill, mode/error summary).

- [ ] **Step 1: Failing component test**

Create `cloud/frontend/src/pages/UnitDetailPage.test.jsx`: mock `../data/hooks.js` (`useUnitLatest` → a fixture snapshot, `useTelemetrySeries` → [], `useFaults` → []); render within `MemoryRouter` with an initial entry `/units/APU-1` and a route `/units/:id`; assert the unit id renders, a "live" connection pill renders, and clicking the "Heater" tab shows heater content (a `getByRole('button', {name:/heater/i})` click → `getByText(/heater/i)` in panel). Keep assertions to: tabs render (Overview/Heater/Component Test/Telemetry/History all present as buttons).

- [ ] **Step 2: Run — expect fail** (`npx vitest run src/pages/UnitDetailPage.test.jsx`).

- [ ] **Step 3: Implement the shell**

Rewrite `UnitDetailPage.jsx`: `const [tab, setTab] = useState('overview')`; header row (back button → `/`, unit id, `connLabel` pill, and `tele.mode` + `error` when `error_n!==0`); a tab bar of buttons (active = brand blue underline/text); a switch rendering `<OverviewTab tele/>`, `<TelemetryTab unit/>`, `<HeaterTab tele/>`, `<ComponentTestTab tele/>`, `<HistoryTab unit/>`. For this task, define those tab components inline as minimal placeholders (each a `<div className="notice">` naming itself) EXCEPT keep the header real. Later tasks replace each placeholder.

- [ ] **Step 4: Run — expect pass.**

- [ ] **Step 5: Commit**
```bash
git add cloud/frontend/src/pages/UnitDetailPage.jsx cloud/frontend/src/pages/UnitDetailPage.test.jsx
git commit -m "feat(frontend): tabbed unit-detail shell + header"
```

---

### Task 3: Overview tab — sensor suite

**Files:**
- Create: `cloud/frontend/src/components/unit/OverviewTab.jsx`
- Modify: `cloud/frontend/src/pages/UnitDetailPage.jsx` (import + use)

**Interfaces:**
- Consumes: `tele` (snapshot), `fmt` (contract).
- Produces: `<OverviewTab tele={tele} />`.

- [ ] **Step 1: Implement**

Create `OverviewTab.jsx`: a `.tgrid` of `.tcell`s for the live sensor suite — Battery (`fmt.volts(batt_v)`), Cabin (`fmt.tempF(cabin_temp_f)`), External (`fmt.tempF(ext_temp_f)`), RPM (`fmt.int(rpm)`), Oil (`oil_ok ? 'OK' : 'LOW'` colored), Ignition (`ignition ? 'ON':'OFF'`), Fan (`fmt.pct(fan_speed)`), Climate setpoint (`fmt.tempF(clmt_setpoint_f)`). Then a `.card` with mode/engine_status/control_status/error (error in red when `error_n!==0`) and hour counters (engine/oil/machine via `fmt.hours`), and `apu_fw_version`. Guard for `!tele` with a skeleton/notice.

- [ ] **Step 2: Wire into UnitDetailPage** (replace the overview placeholder).

- [ ] **Step 3: Verify + commit**

Dev server (mock) → open `/units/APU-DEMO-01` (running unit) → screenshot: sensors populated, running status. Then:
```bash
git add cloud/frontend/src/components/unit/OverviewTab.jsx cloud/frontend/src/pages/UnitDetailPage.jsx
git commit -m "feat(frontend): unit overview sensor suite"
```

---

### Task 4: Heater tab — VEVOR card (display)

**Files:**
- Create: `cloud/frontend/src/components/unit/HeaterTab.jsx`
- Modify: `cloud/frontend/src/pages/UnitDetailPage.jsx`

**Interfaces:**
- Consumes: `tele`, `heaterStateLabel`, `heaterFlags`, `fmt`.
- Produces: `<HeaterTab tele={tele} />`.

- [ ] **Step 1: Implement**

Create `HeaterTab.jsx`. If `!tele.heater_present`: a `.notice` "No heater detected on this unit." Else a `.card`: header with state (`heaterStateLabel(heater_state)`) + a comms pill (`heater_comms_ok ? p-g 'COMMS OK' : p-r 'NO COMMS'`); a `.tgrid` of tcells — Target level, Active level, Exchanger temp (`fmt.int(heater_exchanger)`), Fan RPM, Pump Hz (`heater_pump_hz`), Supply V (`fmt.volts(heater_supply_v)`), State seconds; a flags row rendering `heaterFlags(heater_flags)` as pills (on = colored p-a/p-r, off = p-n); error code when `heater_error!==0` (red); and a small "Link health" line with valid_frames / checksum_failures / transport_errors. Note: control (on/off + level) is added in Plan 4.

- [ ] **Step 2: Wire into UnitDetailPage.**

- [ ] **Step 3: Verify + commit**

Dev server → `/units/APU-DEMO-01` (heater running in mock) Heater tab → screenshot. Also check `/units/APU-000123` (heater off, NO COMMS, xport-fault flag). Then:
```bash
git add cloud/frontend/src/components/unit/HeaterTab.jsx cloud/frontend/src/pages/UnitDetailPage.jsx
git commit -m "feat(frontend): VEVOR heater detail card"
```

---

### Task 5: Component Test tab (display)

**Files:**
- Create: `cloud/frontend/src/components/unit/ComponentTestTab.jsx`
- Modify: `cloud/frontend/src/pages/UnitDetailPage.jsx`

**Interfaces:**
- Consumes: `tele`, `diagOutputs`.
- Produces: `<ComponentTestTab tele={tele} />`.

- [ ] **Step 1: Implement**

Create `ComponentTestTab.jsx`: a status line — `diag_active ? (p-a 'DIAG ACTIVE') : (p-n 'Inactive')`; a grid of output tiles from `diagOutputs(tele.diag_outputs)` — each tile shows the name and an on/off state (on = brand-green filled, off = muted). A `.notice`: "Technician actuation (enter passcode) is added in Plan 4 — this view is read-only." (The guarded actuation controls land in Plan 4.)

- [ ] **Step 2: Wire in + verify + commit**

Screenshot `/units/APU-000123` Component Test tab (all outputs off, Inactive). Then:
```bash
git add cloud/frontend/src/components/unit/ComponentTestTab.jsx cloud/frontend/src/pages/UnitDetailPage.jsx
git commit -m "feat(frontend): component-test read-only tiles"
```

---

### Task 6: Telemetry tab — history charts (recharts)

**Files:**
- Create: `cloud/frontend/src/components/unit/TelemetryTab.jsx`
- Modify: `cloud/frontend/src/pages/UnitDetailPage.jsx`

**Interfaces:**
- Consumes: `useTelemetrySeries(unit, {limit})`, `recharts`.
- Produces: `<TelemetryTab unit={unit} />`.

- [ ] **Step 0: Load the dataviz skill** before writing chart code, and follow its palette/axis/tooltip guidance.

- [ ] **Step 1: Implement**

Create `TelemetryTab.jsx`: range selector (60 / 240 samples); `const { data: series, isLoading } = useTelemetrySeries(unit, { limit })`; render responsive `LineChart`s (recharts `ResponsiveContainer`) for Battery (`batt_v`), Cabin temp (`cabin_temp_f`), and RPM (`rpm`) over `ts` (x-axis formatted as time). Use brand tokens for line colors (blue for battery, orange for temp, green for rpm), theme-aware axis/grid colors, a tooltip, and `.card` wrappers with titles. Loading skeleton + empty state when no series.

- [ ] **Step 2: Verify + commit**

Screenshot `/units/APU-DEMO-01` Telemetry tab (mock series has jitter → visible lines). Then:
```bash
git add cloud/frontend/src/components/unit/TelemetryTab.jsx cloud/frontend/src/pages/UnitDetailPage.jsx
git commit -m "feat(frontend): telemetry history charts (recharts)"
```

---

### Task 7: History tab — event log

**Files:**
- Create: `cloud/frontend/src/components/unit/HistoryTab.jsx`
- Modify: `cloud/frontend/src/pages/UnitDetailPage.jsx`

**Interfaces:**
- Consumes: `useFaults(unit)`.
- Produces: `<HistoryTab unit={unit} />`.

- [ ] **Step 1: Implement**

Create `HistoryTab.jsx`: `const { data: faults, isLoading } = useFaults(unit)`; a `.dtbl` table — Time (`toLocaleString`), Code (`fault`), Description (`error` || decoded), State (pill: active=p-r, cleared=p-g). Loading skeleton + empty state ("No events in the last 7 days.").

- [ ] **Step 2: Verify full screen + commit**

Screenshot each tab of `/units/APU-DEMO-01` once more for the record. Run the full suite `npx vitest run` (all green). Then:
```bash
git add cloud/frontend/src/components/unit/HistoryTab.jsx cloud/frontend/src/pages/UnitDetailPage.jsx
git commit -m "feat(frontend): unit history event log"
```

---

## Notes for the executor

- Tab components live under `src/components/unit/` (files that change together, together).
- Every tab guards `!tele` / loading / empty; never renders `undefined` units.
- Control actions (heater on/off+level, component-test actuation, APU start/stop, OTA) are **Plan 4** — leave the read-only notices in place.
- After Task 7, also fix the small carry-forward: Layout topbar title for `/units/:id` (show the unit id instead of "Dashboard") — one line in `Layout.jsx`.
```
