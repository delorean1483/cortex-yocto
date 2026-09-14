# EcoFleet Dashboard — Plan 4: Guarded Remote Control & OTA

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add role-gated, confirm-dialog remote control to the dashboard for the controls the device shadow actually applies — heater on/off + level, APU start/stop, and OTA firmware trigger — with pending→applied feedback.

**Architecture:** A shared `ConfirmDialog` and `RoleGate` wrap every write. Writes go through the existing `useCommand()` mutation → `POST /fleet/units/{id}/command` → shadow `desired`. UI gating uses a frontend copy of the permission matrix (`src/api/permissions.js`); the API Lambda remains the authority. Heater control lives in the existing HeaterTab; APU start/stop in a new Remote-control tab; OTA in a new Firmware tab. Pending state is optimistic and reconciled against the next `useUnitLatest` poll (real device) — in mock mode the mock mutates its snapshot so the demo reflects changes.

**Tech Stack:** React 18, @tanstack/react-query, @tabler/icons-react, Vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-09-11-ecofleet-web-dashboard-design.md` (phase 6)

## Global Constraints

- **Only shadow-wired controls** (verified in `gobi-agent/files/shadow.c apply_desired`): `heater{on,level}`, `apu_command` (start/stop), `firmware_target` (OTA), `reboot`, `poll_interval_s`, `report_mode`. **Setpoints (clmt/batt) and component-test actuation are NOT applied by the agent shadow** — leave those read-only with a note (wiring them needs an out-of-scope agent change).
- **Every write is guarded + confirmed:** role check (disable + reason) → ConfirmDialog naming action + unit → mutate → pending → applied. Demo units reject writes at the API (already) — the UI also disables controls for `demo` units.
- **No browser-native `confirm()/alert()`** for writes — use the in-app `ConfirmDialog` (matches the harness dialog guidance and is testable).
- Role matrix (mirror of backend `permissions.js`): admin/fm = all; maint = heater only (APU/OTA disabled); eu = none.
- Tests: `cd cloud/frontend && npx vitest run`. Verify on the dev server (mock) + screenshot. Do NOT `npm run build` locally.
- Working directory: `cloud/frontend/`.

---

### Task 1: Frontend permission matrix + shared control components

**Files:**
- Create: `cloud/frontend/src/api/permissions.js`
- Create: `cloud/frontend/src/api/permissions.test.js`
- Create: `cloud/frontend/src/components/ConfirmDialog.jsx`
- Create: `cloud/frontend/src/components/RoleGate.jsx`

**Interfaces:**
- Produces:
  - `canWrite(role, action)` → boolean (actions: heater, apu, ota, setpoint, diag). Mirrors backend.
  - `<RoleGate action can={role} demo={bool}>` → `{ allowed, reason }` via render-prop or a `useCan(action)` hook reading `useAuth().role`. Simplest: export `useCan(action)` → `{ allowed, reason }`.
  - `<ConfirmDialog open title body confirmLabel danger onConfirm onCancel />`.

- [ ] **Step 1: permissions test (fail)**

Create `cloud/frontend/src/api/permissions.test.js`:
```javascript
import { describe, it, expect } from 'vitest'
import { canWrite } from './permissions.js'
describe('canWrite (frontend mirror)', () => {
  it('admin/fm all', () => {
    for (const a of ['heater','apu','ota']) { expect(canWrite('admin', a)).toBe(true); expect(canWrite('fm', a)).toBe(true) }
  })
  it('maint heater only', () => {
    expect(canWrite('maint','heater')).toBe(true)
    expect(canWrite('maint','apu')).toBe(false)
    expect(canWrite('maint','ota')).toBe(false)
  })
  it('eu none', () => { for (const a of ['heater','apu','ota']) expect(canWrite('eu', a)).toBe(false) })
})
```

- [ ] **Step 2: Run — fail** (`npx vitest run src/api/permissions.test.js`).

- [ ] **Step 3: Implement `permissions.js`**
```javascript
// Frontend mirror of the API permission matrix (UI gating only; the api
// Lambda's permissions.js is authoritative). Keep in sync with CONTRACT/spec.
const MATRIX = {
  admin: new Set(['heater', 'setpoint', 'apu', 'diag', 'ota', 'users']),
  fm:    new Set(['heater', 'setpoint', 'apu', 'diag', 'ota', 'users']),
  maint: new Set(['heater', 'setpoint', 'diag']),
  eu:    new Set([]),
}
export function canWrite(role, action) {
  const s = MATRIX[role]
  return s ? s.has(action) : false
}
```

- [ ] **Step 4: Run — pass.**

- [ ] **Step 5: `RoleGate.jsx`** — export `useCan(action)`:
```javascript
import { useAuth } from '../contexts/AuthContext.jsx'
import { canWrite } from '../api/permissions.js'
export function useCan(action) {
  const { role } = useAuth()
  if (!canWrite(role, action)) return { allowed: false, reason: `Your role (${role}) can't do this.` }
  return { allowed: true, reason: '' }
}
```

- [ ] **Step 6: `ConfirmDialog.jsx`** — a fixed-overlay modal:
```javascript
export default function ConfirmDialog({ open, title, body, confirmLabel = 'Confirm', danger, onConfirm, onCancel, pending }) {
  if (!open) return null
  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ maxWidth: 360, width: '90%' }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginBottom: 14 }}>{body}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-sm" onClick={onCancel} disabled={pending}>Cancel</button>
          <button className={`btn btn-sm ${danger ? 'btn-red' : 'btn-primary'}`} onClick={onConfirm} disabled={pending}>
            {pending ? 'Sending…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Commit**
```bash
git add cloud/frontend/src/api/permissions.js cloud/frontend/src/api/permissions.test.js cloud/frontend/src/components/ConfirmDialog.jsx cloud/frontend/src/components/RoleGate.jsx
git commit -m "feat(frontend): permission mirror + ConfirmDialog + RoleGate"
```

---

### Task 2: Heater control (on/off + level)

**Files:**
- Modify: `cloud/frontend/src/components/unit/HeaterTab.jsx`
- Modify: `cloud/frontend/src/api/mock.js` (sendCommand mutates snapshot)
- Create: `cloud/frontend/src/components/unit/HeaterTab.test.jsx`

**Interfaces:**
- Consumes: `useCommand` (hooks), `useCan('heater')`, `ConfirmDialog`.

- [ ] **Step 1: Failing test**

Create `HeaterTab.test.jsx`: mock `../../data/hooks.js` (`useCommand` → `{ mutate: vi.fn(), isPending:false }`) and `../../contexts/AuthContext.jsx` (`useAuth` → `{ role:'admin' }`). Render HeaterTab with a present heater snapshot. Assert an "On"/"Off" control and a level stepper render; clicking "Turn on" opens a ConfirmDialog (getByText a confirm title); confirming calls the mutation with `{ unit, body:{ heater:{ on:1 } } }`. (Pass `unit` prop to HeaterTab.)

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Add controls to HeaterTab**

Add a `unit` prop. Below the read-only card, when `heater_present`: an On/Off toggle and a level stepper (1–10). Gate with `useCan('heater')` and disable for `demo` units (pass an `isDemo` prop from UnitDetailPage, or derive). Each action opens `ConfirmDialog` ("Turn heater ON for `<unit>`?" / "Set heater level to N?") → on confirm, `command.mutate({ unit, body: { heater: { on } | { level } } })`. Show pending; show the reason tooltip when `!allowed`. Update `UnitDetailPage` to pass `unit` (and demo flag) to `<HeaterTab>`.

- [ ] **Step 4: mock.sendCommand reflects heater changes**

In `mock.js`, make `sendCommand(unit, body)` mutate `SNAPSHOTS[unit]` when `body.heater` is present (on→heater_state 'running'/'off' + heater_active_level = level or target), so the demo reflects the change on next poll. Keep returning the success object.

- [ ] **Step 5: Run — pass.**

- [ ] **Step 6: Verify + commit**

Dev server → `/units/APU-000123` Heater tab → toggle on (confirm) → screenshot showing pending/applied. Then:
```bash
git add cloud/frontend/src/components/unit/HeaterTab.jsx cloud/frontend/src/components/unit/HeaterTab.test.jsx cloud/frontend/src/api/mock.js cloud/frontend/src/pages/UnitDetailPage.jsx
git commit -m "feat(frontend): guarded heater on/off + level control"
```

---

### Task 3: Remote Control tab (APU start/stop)

**Files:**
- Create: `cloud/frontend/src/components/unit/RemoteControlTab.jsx`
- Modify: `cloud/frontend/src/pages/UnitDetailPage.jsx` (add "Remote" tab)

**Interfaces:**
- Consumes: `useCommand`, `useCan('apu')`, `ConfirmDialog`, `tele` (for current engine_status).

- [ ] **Step 1: Implement**

Create `RemoteControlTab.jsx` (props `unit`, `tele`, `isDemo`): a card with **Start APU** (btn-primary) and **Stop APU** (btn-red) buttons, each guarded by `useCan('apu')` + disabled for demo, each opening a `ConfirmDialog` ("Start APU on `<unit>`? The engine will crank." / "Stop APU on `<unit>`?") → `command.mutate({ unit, body: { apu_command: 'start'|'stop' } })`. Show current engine/control status from `tele`. A `.notice` when not allowed. A second `.notice`: "Climate/battery setpoints and component-test actuation are read-only pending device shadow support."

- [ ] **Step 2: Add the tab** in `UnitDetailPage` (`{ id:'remote', label:'Remote' }`, rendered `<RemoteControlTab unit tele isDemo/>`). Order: Overview, Telemetry, Heater, Component Test, **Remote**, **Firmware**, History.

- [ ] **Step 3: Verify + commit**

Screenshot `/units/APU-000123` Remote tab (Start/Stop, confirm dialog). Then:
```bash
git add cloud/frontend/src/components/unit/RemoteControlTab.jsx cloud/frontend/src/pages/UnitDetailPage.jsx
git commit -m "feat(frontend): guarded APU start/stop remote control"
```

---

### Task 4: Firmware / OTA tab

**Files:**
- Create: `cloud/frontend/src/components/unit/FirmwareTab.jsx`
- Modify: `cloud/frontend/src/pages/UnitDetailPage.jsx` (add "Firmware" tab)
- Modify: `cloud/frontend/src/api/mock.js` (a `LATEST_FW` constant + shadow reflects firmware_target)

**Interfaces:**
- Consumes: `useCommand`, `useCan('ota')`, `useShadow` (add to hooks), `ConfirmDialog`, `tele` (apu_fw_version).

- [ ] **Step 1: Add `useShadow` hook** to `src/data/hooks.js`:
```javascript
export function useShadow(unit) {
  return useQuery({ queryKey: ['shadow', unit], enabled: !!unit,
    queryFn: () => api.getShadow(unit), refetchInterval: 8000 })
}
```

- [ ] **Step 2: Implement `FirmwareTab.jsx`** (props `unit`, `tele`, `isDemo`): show current version (`tele.apu_fw_version`) vs an available version (constant, e.g. from a `TARGET_FW` or the shadow). A **Trigger OTA** button (guarded `useCan('ota')`, disabled for demo) → ConfirmDialog ("Push firmware `<ver>` to `<unit>`? The unit will download and reboot.") → `command.mutate({ unit, body: { firmware_target: ver } })`. Show a reboot-expected `.notice` after send; show current vs target with an "up to date" / "update available" pill.

- [ ] **Step 3: Add the tab** in `UnitDetailPage` (`{ id:'firmware', label:'Firmware' }`).

- [ ] **Step 4: Verify + commit**

Screenshot Firmware tab. Then:
```bash
git add cloud/frontend/src/components/unit/FirmwareTab.jsx cloud/frontend/src/data/hooks.js cloud/frontend/src/api/mock.js cloud/frontend/src/pages/UnitDetailPage.jsx
git commit -m "feat(frontend): guarded OTA firmware trigger"
```

---

### Task 5: Full-suite check + role verification

- [ ] **Step 1: Full suite** — `npx vitest run` (all green).

- [ ] **Step 2: Role gating verification (browser)** — switch the topbar role selector to **maint** and confirm APU/OTA controls are disabled with a reason, heater still enabled; switch to **eu** and confirm all controls disabled. Screenshot one.

- [ ] **Step 3: Commit any fixes**, then this plan is done.

---

## Notes for the executor

- Controls appear only on their tabs; keep the read-only cards intact above the controls.
- `isDemo`: `UnitDetailPage` can derive it (the unit id starts with `APU-DEMO-`) or thread it from the units list; simplest is an id-prefix check in one helper.
- Pending→applied: optimistic pending + `useUnitLatest` invalidation is enough for the demo (mock mutates its snapshot). Against the real device, the heater ack rides `heater_desired_seq` in the shadow `reported` — a future refinement can compare-and-clear the pending badge off that; not required here.
- **Deploy (user-run):** remove `VITE_MOCK=on` from `.env.local` (or set the real `VITE_API_URL`) so prod uses the real API; `cd cloud/frontend && vercel --prod`; deploy Lambdas via `cloud/lambda/deploy-lambda.sh`.
- **Carry-forwards after Plan 4:** (a) backend Reports Lambda reconciliation; (b) optional agent shadow support for setpoints + component-test actuation (would unlock those controls); (c) heater pending badge off `heater_desired_seq`.
```
