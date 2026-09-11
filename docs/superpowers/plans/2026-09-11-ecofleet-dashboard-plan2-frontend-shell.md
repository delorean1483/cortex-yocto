# EcoFleet Dashboard — Plan 2: Branding, Data Layer & Fleet Overview

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand the React app to the EcoFleet identity, align it to the reconciled backend contract, add a react-query data layer, and rebuild the fleet-overview screens (Dashboard, Alerts, Reports, Users, Map) at professional quality with the live unit + labeled demo peers.

**Architecture:** Keep the existing React 18 + Vite + react-router structure and the token-based `index.css`. Repoint the design tokens to the logo palette, replace the placeholder brand chip with the real logo, introduce a small pure `contract.js` view-model layer (fully TDD'd with Vitest), and wrap data access in react-query hooks. Pages consume hooks + `contract.js` helpers only.

**Tech Stack:** React 18, Vite 5, react-router 6, @tabler/icons-react (present); **add** `@tanstack/react-query`, `recharts` (used in Plan 3), and dev deps `vitest` + `@testing-library/react` + `@testing-library/jest-dom` + `jsdom`.

**Spec:** `docs/superpowers/specs/2026-09-11-ecofleet-web-dashboard-design.md` (phases 3–4)

## Global Constraints

- **Contract is authoritative:** field names come from `cloud/CONTRACT.md`. Telemetry uses `batt_v`, `error`/`error_n`, `control_status`, `heater_*`, etc. — NOT the old `dc_v`/`fault`/`batt_soc`. `GET /fleet/units` now returns `{ units: [{ unit, demo }] }` (objects, not strings).
- **Brand palette** (exact tokens): blue `#12A5D6` (primary/interactive), blue-dark `#0E86B0` (hover), lime-green `#A8CE1F` (eco/positive accent), green-readable `#7C9E0C` (green text/borders), orange `#F26522` (energy/warning emphasis), navy `#1B2A3A` (dark text/surface), success `#1D9E75`, danger `#E24B4A`. Replace amber `#BA7517` everywhere.
- **Logo asset:** `cloud/frontend/src/assets/ecofleet_logo.png` (color, for dark bg) and `ecofleet_logo_navy.png` (navy "Eco", for light bg). Source from `meta-ecofleet/recipes-ecofleet/gobi-ui/files/ecofleet_logo.png` and `.superpowers/brainstorm/77396-1780582047/content/ecofleet_transparent.png`.
- **Run tests:** `cd cloud/frontend && npm test` (Vitest, `--run` for one-shot). **Build check:** `npm run build` must succeed. Commit only after both pass.
- **No secrets in code**; API base stays `import.meta.env.VITE_API_URL` (default already set).
- Working directory for all npm commands: `cloud/frontend/`.

---

### Task 1: Tooling — Vitest + deps + smoke test

**Files:**
- Modify: `cloud/frontend/package.json` (deps + `test` script)
- Create: `cloud/frontend/vitest.config.js`
- Create: `cloud/frontend/src/test/smoke.test.js`

- [ ] **Step 1: Add deps + test script**

`cd cloud/frontend` then:
```bash
npm install @tanstack/react-query@^5 recharts@^2
npm install -D vitest@^2 @testing-library/react@^16 @testing-library/jest-dom@^6 jsdom@^25
```
Add to `package.json` "scripts": `"test": "vitest"`.

- [ ] **Step 2: Vitest config**

Create `cloud/frontend/vitest.config.js`:
```javascript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true },
})
```

- [ ] **Step 3: Smoke test (write + run, expect pass)**

Create `cloud/frontend/src/test/smoke.test.js`:
```javascript
import { describe, it, expect } from 'vitest'
describe('harness', () => {
  it('runs', () => { expect(1 + 1).toBe(2) })
})
```
Run: `npm test -- --run src/test/smoke.test.js`
Expected: 1 passed.

- [ ] **Step 4: Commit**
```bash
git add cloud/frontend/package.json cloud/frontend/package-lock.json cloud/frontend/vitest.config.js cloud/frontend/src/test/smoke.test.js
git commit -m "chore(frontend): add vitest, react-query, recharts"
```

---

### Task 2: `contract.js` — view-model helpers (pure, TDD)

**Files:**
- Create: `cloud/frontend/src/api/contract.js`
- Create: `cloud/frontend/src/api/contract.test.js`

**Interfaces:**
- Produces:
  - `unitStatus(tele)` → `'ok' | 'warn' | 'err' | 'off'` (off = no telemetry; err = `error_n !== 0`; warn = `batt_v < 12.0` or `!oil_ok`; else ok).
  - `statusDotClass(status)` → `'s-on'|'s-warn'|'s-err'|'s-off'`.
  - `isStale(tele, maxAgeMs = 60000)` → boolean (based on `Date.now() - tele.ts`).
  - `heaterStateLabel(state)` → Title-cased label.
  - `fmt` → `{ volts(v), tempF(v), pct(v), int(v), hours(v) }` returning strings with units, `'—'` for null/undefined.

- [ ] **Step 1: Write the failing test**

Create `cloud/frontend/src/api/contract.test.js`:
```javascript
import { describe, it, expect } from 'vitest'
import { unitStatus, statusDotClass, isStale, heaterStateLabel, fmt } from './contract.js'

describe('unitStatus', () => {
  it('off when no telemetry', () => expect(unitStatus(null)).toBe('off'))
  it('err when error_n set', () => expect(unitStatus({ error_n: 32, batt_v: 13, oil_ok: true })).toBe('err'))
  it('warn on low battery', () => expect(unitStatus({ error_n: 0, batt_v: 11.4, oil_ok: true })).toBe('warn'))
  it('warn on oil not ok', () => expect(unitStatus({ error_n: 0, batt_v: 13, oil_ok: false })).toBe('warn'))
  it('ok otherwise', () => expect(unitStatus({ error_n: 0, batt_v: 12.7, oil_ok: true })).toBe('ok'))
})

describe('statusDotClass', () => {
  it('maps', () => {
    expect(statusDotClass('ok')).toBe('s-on')
    expect(statusDotClass('warn')).toBe('s-warn')
    expect(statusDotClass('err')).toBe('s-err')
    expect(statusDotClass('off')).toBe('s-off')
  })
})

describe('isStale', () => {
  it('fresh is not stale', () => expect(isStale({ ts: Date.now() })).toBe(false))
  it('old is stale', () => expect(isStale({ ts: Date.now() - 120000 })).toBe(true))
  it('missing ts is stale', () => expect(isStale({})).toBe(true))
})

describe('heaterStateLabel', () => {
  it('titlecases', () => expect(heaterStateLabel('preheat')).toBe('Preheat'))
  it('handles unknown', () => expect(heaterStateLabel('')).toBe('Unknown'))
})

describe('fmt', () => {
  it('volts', () => expect(fmt.volts(12.64)).toBe('12.6 V'))
  it('dash on null', () => expect(fmt.volts(null)).toBe('—'))
  it('tempF', () => expect(fmt.tempF(96.1)).toBe('96°F'))
  it('pct', () => expect(fmt.pct(40)).toBe('40%'))
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --run src/api/contract.test.js`
Expected: FAIL — cannot resolve `./contract.js`.

- [ ] **Step 3: Implement**

Create `cloud/frontend/src/api/contract.js`:
```javascript
// Pure view-model helpers over the telemetry contract (cloud/CONTRACT.md).

export function unitStatus(tele) {
  if (!tele) return 'off'
  if (Number(tele.error_n) !== 0) return 'err'
  if ((tele.batt_v != null && Number(tele.batt_v) < 12.0) || tele.oil_ok === false) return 'warn'
  return 'ok'
}

export function statusDotClass(status) {
  return { ok: 's-on', warn: 's-warn', err: 's-err', off: 's-off' }[status] || 's-off'
}

export function isStale(tele, maxAgeMs = 60000) {
  if (!tele || tele.ts == null) return true
  return (Date.now() - Number(tele.ts)) > maxAgeMs
}

export function heaterStateLabel(state) {
  if (!state) return 'Unknown'
  return String(state).charAt(0).toUpperCase() + String(state).slice(1)
}

const dash = (v) => v == null || Number.isNaN(Number(v))
export const fmt = {
  volts:  (v) => dash(v) ? '—' : `${Number(v).toFixed(1)} V`,
  tempF:  (v) => dash(v) ? '—' : `${Math.round(Number(v))}°F`,
  pct:    (v) => dash(v) ? '—' : `${Math.round(Number(v))}%`,
  int:    (v) => dash(v) ? '—' : `${Math.round(Number(v))}`,
  hours:  (v) => dash(v) ? '—' : `${Math.round(Number(v))} h`,
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --run src/api/contract.test.js`
Expected: all passed.

- [ ] **Step 5: Commit**
```bash
git add cloud/frontend/src/api/contract.js cloud/frontend/src/api/contract.test.js
git commit -m "feat(frontend): contract view-model helpers (status, fmt, stale)"
```

---

### Task 3: API client — align to reconciled contract

**Files:**
- Modify: `cloud/frontend/src/api/client.js`
- Create: `cloud/frontend/src/api/client.test.js`

**Interfaces:**
- Produces (additions/changes to `api`):
  - `listUnits()` → `{ units: [{unit, demo}] }` (unchanged call; shape documented).
  - `getLatest(unit)` → `{ unit, latest }` (new; `GET …/latest`).
  - `sendCommand(unit, body)` → posts `POST …/{unit}/command` (new).
  - existing `getTelemetry`, `getFaults`, `getShadow`, `setConfig`, `getReports`, users/maintenance kept.

- [ ] **Step 1: Write the failing test (mocked fetch)**

Create `cloud/frontend/src/api/client.test.js`:
```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api } from './client.js'

beforeEach(() => {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) }))
})

describe('api.getLatest', () => {
  it('GETs the latest path', async () => {
    await api.getLatest('APU-1')
    expect(global.fetch).toHaveBeenCalled()
    const url = global.fetch.mock.calls[0][0]
    expect(url).toContain('/fleet/units/APU-1/latest')
  })
})

describe('api.sendCommand', () => {
  it('POSTs the command with body', async () => {
    await api.sendCommand('APU-1', { heater: { on: 1 } })
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toContain('/fleet/units/APU-1/command')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ heater: { on: 1 } })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --run src/api/client.test.js`
Expected: FAIL — `api.getLatest is not a function`.

- [ ] **Step 3: Add the methods**

In `cloud/frontend/src/api/client.js`, inside the `export const api = { … }` object, add:
```javascript
  getLatest: (unit) => apiFetch(`/fleet/units/${encodeURIComponent(unit)}/latest`),

  sendCommand: (unit, body) =>
    apiFetch(`/fleet/units/${encodeURIComponent(unit)}/command`, {
      method: 'POST', body: JSON.stringify(body),
    }),
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --run src/api/client.test.js`
Expected: all passed.

- [ ] **Step 5: Commit**
```bash
git add cloud/frontend/src/api/client.js cloud/frontend/src/api/client.test.js
git commit -m "feat(frontend): api getLatest + sendCommand"
```

---

### Task 4: Design system rebrand + logo

**Files:**
- Modify: `cloud/frontend/src/index.css` (tokens + brand-derived colors)
- Create: `cloud/frontend/src/assets/ecofleet_logo.png`, `ecofleet_logo_navy.png`
- Modify: `cloud/frontend/src/components/Layout.jsx` (real logo, per-theme logo swap)
- Modify: `cloud/frontend/index.html` (title + favicon)

_Theme follows the system (`prefers-color-scheme`), already wired in `index.css`; the logo swaps per theme. A manual light/dark toggle is a small deferred nicety (not required for Plan 2)._

- [ ] **Step 1: Copy logo assets**
```bash
mkdir -p cloud/frontend/src/assets
cp meta-ecofleet/recipes-ecofleet/gobi-ui/files/ecofleet_logo.png cloud/frontend/src/assets/ecofleet_logo.png
cp .superpowers/brainstorm/77396-1780582047/content/ecofleet_transparent.png cloud/frontend/src/assets/ecofleet_logo_navy.png
```

- [ ] **Step 2: Repoint tokens in `index.css`**

Replace the `--accent`/`--accent-dark` lines in `:root` with the brand palette and add brand tokens:
```css
  --brand-blue: #12A5D6;
  --brand-blue-dark: #0E86B0;
  --brand-green: #A8CE1F;
  --brand-green-text: #7C9E0C;
  --brand-orange: #F26522;
  --brand-navy: #1B2A3A;
  --accent: var(--brand-blue);
  --accent-dark: var(--brand-blue-dark);
```
Change `.s-warn` and the `.a-warn` left-border from `#BA7517` to `var(--brand-orange)`; `.fw-fill` stays `var(--accent)` (now blue). Add a `.btn-primary` alias identical to `.btn-amber`. Leave `--font-mono`, radii, and the semantic bg/border tokens as-is.

- [ ] **Step 3: Real logo (per-theme swap) in `Layout.jsx`**

Replace the brand chip block (the `<div>` with `IconBolt`) with the logo image:
```jsx
import logoColor from '../assets/ecofleet_logo.png'
import logoNavy from '../assets/ecofleet_logo_navy.png'
// ...
<div style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--color-border-tertiary)', flexShrink: 0 }}>
  <img src={logoNavy} alt="EcoFleet" style={{ height: 22, display: 'block' }}
       className="logo-navy" />
  <img src={logoColor} alt="EcoFleet" style={{ height: 22, display: 'none' }}
       className="logo-color" />
  <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
    {user?.email}
  </div>
</div>
```
Add to `index.css` so the correct logo shows per theme:
```css
@media (prefers-color-scheme: dark) { .logo-navy { display: none !important; } .logo-color { display: block !important; } }
```
Keep the role `<select>` (label it "View as" for the demo). Nav active color is already `var(--accent)` → now blue.

- [ ] **Step 4: Title + favicon in `index.html`**

Set `<title>EcoFleet — Fleet APU Dashboard</title>` and keep the existing inline SVG favicon but change its `fill` to `#12A5D6`.

- [ ] **Step 5: Build + browser verify**

Run: `npm run build` (must succeed). Then start `npm run dev`, open the app, and screenshot the shell — verify the real logo renders, nav active state is blue (not amber), and light/dark both look right. Fix any visual issues.

- [ ] **Step 6: Commit**
```bash
git add cloud/frontend/src/index.css cloud/frontend/src/assets cloud/frontend/src/components/Layout.jsx cloud/frontend/index.html
git commit -m "feat(frontend): EcoFleet branding — logo, palette, favicon"
```

---

### Task 5: react-query data layer + hooks

**Files:**
- Modify: `cloud/frontend/src/main.jsx` (QueryClientProvider)
- Create: `cloud/frontend/src/data/hooks.js`

**Interfaces:**
- Produces (react-query hooks): `useUnits()`, `useUnitLatest(unit)`, `useTelemetrySeries(unit, opts)`, `useFaults(unit)`, `useCommand()` (mutation).

- [ ] **Step 1: Wrap app in QueryClientProvider**

In `cloud/frontend/src/main.jsx`, create a `QueryClient` (defaults: `refetchOnWindowFocus: false`) and wrap `<App/>` in `<QueryClientProvider client={qc}>`.

- [ ] **Step 2: Create hooks**

Create `cloud/frontend/src/data/hooks.js`:
```javascript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client.js'

export function useUnits() {
  return useQuery({ queryKey: ['units'], queryFn: () => api.listUnits(),
    refetchInterval: 30000, select: (d) => d.units || [] })
}
export function useUnitLatest(unit) {
  return useQuery({ queryKey: ['latest', unit], enabled: !!unit,
    queryFn: () => api.getLatest(unit), refetchInterval: 5000, select: (d) => d.latest })
}
export function useTelemetrySeries(unit, params = {}) {
  return useQuery({ queryKey: ['series', unit, params], enabled: !!unit,
    queryFn: () => api.getTelemetry(unit, params), select: (d) => d.telemetry || [] })
}
export function useFaults(unit) {
  return useQuery({ queryKey: ['faults', unit], enabled: !!unit,
    queryFn: () => api.getFaults(unit), select: (d) => d.faults || [] })
}
export function useCommand() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ unit, body }) => api.sendCommand(unit, body),
    onSuccess: (_r, { unit }) => qc.invalidateQueries({ queryKey: ['latest', unit] }),
  })
}
```

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: success (imports resolve).

- [ ] **Step 4: Commit**
```bash
git add cloud/frontend/src/main.jsx cloud/frontend/src/data/hooks.js
git commit -m "feat(frontend): react-query data layer + hooks"
```

---

### Task 6: Dashboard rework to contract + demo badges

**Files:**
- Modify: `cloud/frontend/src/pages/DashboardPage.jsx`
- Create: `cloud/frontend/src/pages/DashboardPage.test.jsx`

**Interfaces:**
- Consumes: `useUnits`, `useUnitLatest` (Task 5), `unitStatus`, `statusDotClass`, `fmt` (Task 2).

- [ ] **Step 1: Write the failing component test**

Create `cloud/frontend/src/pages/DashboardPage.test.jsx`. Mock `../data/hooks.js` so `useUnits` returns `[{unit:'APU-1',demo:false},{unit:'APU-DEMO-01',demo:true}]` and `useUnitLatest` returns a fixture snapshot; render within a `MemoryRouter`; assert both unit ids render and the demo unit shows a `(demo)` badge (`getByText(/demo/i)`), and that a fault snapshot yields an `s-err` dot (query by class via container).

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --run src/pages/DashboardPage.test.jsx`
Expected: FAIL (old DashboardPage uses `api` directly / no demo badge).

- [ ] **Step 3: Rewrite `DashboardPage.jsx`**

Rebuild using `useUnits()` + per-unit `useUnitLatest()`; compute KPIs (online/faults/warnings) via `unitStatus`; render the unit list with `statusDotClass`, `fmt.volts(tele.batt_v)`, the `error` label when `error_n !== 0`, a stale indicator via `isStale`, and a `(demo)` pill (`.p-n`) for `u.demo`. Row click → `navigate('/units/' + u.unit)` (unit-detail route lands in Plan 3; until then it may 404 to `/` — acceptable). Keep skeleton/empty/error states.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --run src/pages/DashboardPage.test.jsx`
Expected: all passed.

- [ ] **Step 5: Build + browser verify**

`npm run build`; then in `npm run dev` view the Dashboard — real logo, blue accents, live `.86` unit + three `(demo)` peers, correct status dots. Screenshot.

- [ ] **Step 6: Commit**
```bash
git add cloud/frontend/src/pages/DashboardPage.jsx cloud/frontend/src/pages/DashboardPage.test.jsx
git commit -m "feat(frontend): dashboard on live contract + demo peers"
```

---

### Task 7: Align Alerts, Reports, Users, Map to contract

**Files:**
- Modify: `cloud/frontend/src/pages/AlertsPage.jsx`, `ReportsPage.jsx`, `UsersPage.jsx`, `StubPage.jsx`
- Modify: `cloud/frontend/src/App.jsx` (add `/units/:id` route pointing to a temporary placeholder until Plan 3)

- [ ] **Step 1: Alerts** — source active alerts from `useFaults(unit)` across units (or the latest snapshot's `error` per unit); render `.arow` severity rows using `error`/`control_status`. Keep the threshold table static (config surface) but rebrand.

- [ ] **Step 2: Reports** — call `api.getReports()`; render KPI `.scard`s + operator table; show honest empty state when no aggregates. Rebrand.

- [ ] **Step 3: Users** — keep `api.listUsers()/createUser/...`; ensure role labels use `ROLE_CFG`; rebrand badges.

- [ ] **Step 4: Map** — `StubPage`: honest placeholder noting GPS not yet in telemetry (per spec non-goal).

- [ ] **Step 5: Route** — add `<Route path="/units/:id" …>` rendering a minimal placeholder page (`<div className="notice">Unit detail — built in Plan 3</div>`) so Dashboard row clicks resolve.

- [ ] **Step 6: Build + verify + commit**

`npm run build`; view each screen; screenshot the fleet overview. Then:
```bash
git add cloud/frontend/src/pages cloud/frontend/src/App.jsx
git commit -m "feat(frontend): align alerts/reports/users/map to contract + brand"
```

---

## Notes for the executor

- **Visual tasks (4, 6, 7)** are verified by `npm run build` + a browser screenshot (dev server), not only unit tests — the rendered result is the acceptance. Pure logic (Tasks 2, 3) is fully TDD'd.
- **Old field names**: grep the frontend for `dc_v`, `batt_soc`, `\.fault\b`, `apu_state` before finishing — none should remain in rendering code (they're not in the contract).
- **Unit-detail route** (`/units/:id`) is a placeholder here; Plan 3 builds the real tabbed detail screen and its feature cards.
- **Deploy** (user-run): `cd cloud/frontend && vercel --prod` (project already linked). Set `VITE_API_URL` if different from the default.
```
