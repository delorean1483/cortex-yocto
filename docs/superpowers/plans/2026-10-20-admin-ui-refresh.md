# Admin Site UI Refresh (1a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the 1a "Refined" pass to the EcoFleet admin SPA. It covers the accent-text contrast fix, a 13px type floor, one table and badge system, a sidebar user footer with breadcrumbs, and the page refinements B2–B11. It is frontend only.

**Architecture:** Visual and structural changes stay inside the existing Vite + React SPA, using `index.css` classes, CSS variables and `@tabler/icons-react`. New display logic goes into pure, unit-tested functions in `src/api/contract.js`. Two shared UI pieces (`FilterChips`, `SearchInput`) are added to `src/components/`. `AuthContext` learns the signed-in user's real role so the "Preview as" control can be limited to admins. There are no API or Lambda changes.

**Tech Stack:** React 18, react-router-dom 6, @tanstack/react-query 5, @tabler/icons-react 3, Vitest 2 + Testing Library, Vite 5.

**Spec:** `docs/superpowers/specs/2026-10-20-ui-refresh-design.md`. Read Part B and the "Implementation decisions" section at the end. The reference images are in `docs/superpowers/specs/2026-10-20-ui-refresh/admin/` (1280×800, light theme).

## Global Constraints

- Paths are relative to `cloud/frontend/` (written `W/`) unless they start with `docs/`.
- Desktop reference is 1280×800: `navMode` "full", sidebar 232. The `rail` (64px) and `drawer` (phone) modes must keep working; in compact modes labels move into `aria-label`/`title`, as they do today.
- `--accent` (#12A5D6) is never used for text on a light background; text uses `--accent-text`. `--accent` stays for fills, borders and focus rings.
- Type floor is 13px. The only exception is the 11px DEMO tag in the topbar.
- One badge system: `.badge` / `.badge-sm` with `t-err | t-warn | t-ok | t-off`. `.pill`/`.p-*` survive only where `contract.js` returns `cls` (`connLabel`, `otaStatusView`) and in tabs this plan doesn't touch.
- One table system: `.dtbl` (+ `.roomy` on list pages) with `.num` for numeric columns. No inline table styles on the pages this plan touches.
- No hard-coded `#E24B4A` / `#1D9E75` in LoginPage, APUHistoryPage or UsersPage. Use `var(--err)` / `var(--ok)`.
- Fleet text appears only when a unit object has `fleet_id`. Today it never does, so nothing renders. The Reports fleet select is not built.
- Role changes stay admin-only (`isAdmin`), matching `PATCH /fleet/users` (admin only).
- Icons come from `@tabler/icons-react` only.
- Phase 2 (1b) is out of scope: no topbar scope selects and no Cards|Table toggle.

## Verification commands (used by every task)

```bash
cd cloud/frontend            # from the worktree root
npx vitest run               # expected: all test files pass, 0 failed
npx vite build               # expected: "✓ built in", no errors
```
- **Visual check (final task):** run `VITE_MOCK=on npx vite --port 5179`, sign in with any email, and compare each page at 1280×800 with the reference image.

## Review Focus

1. **A non-admin whose localStorage still says `eco_role=admin`** from earlier previewing must, after this ships and they sign in, see their real role and no "Preview as" control. Test in Task 2: `login()` with an `fm` JWT sets `role` and `realRole` to `fm`, and `canPreview` is false.
2. **A session restored from before this change**, with no `eco_real_role` stored, must render without crashing. `canPreview` is false, and the role stays as stored; the API still enforces the real role. Test in Task 2.
3. **All-units Alerts where one unit's fault request fails.** The other units' faults still list, and a notice names the failed unit. The page is never blank or stuck loading. Test in Task 9.
4. **A Dashboard filter or count tile that matches nothing.** Show "No units match this filter" with a way to clear it, rather than two empty section headings. A section with zero units is not rendered. Test in Task 6.
5. **Unexpected raw values from the users API:** an unknown status such as `RESET_REQUIRED` or an unknown role such as `superadmin`. These render title-cased ("Reset required") or as the raw role in a neutral badge, and must never be blank. Tests in Task 3.

---

### Task 1: CSS tokens, type floor, tables, plus FilterChips and SearchInput (B0)

**Files:**
- Modify: `W/src/index.css`
- Create: `W/src/components/FilterChips.jsx`, `W/src/components/FilterChips.test.jsx`, `W/src/components/SearchInput.jsx`

**Interfaces (Produces):**
- CSS variables `--accent-text` (light `#0A6E97`, dark `#5CC6EC`) and `--accent-soft` (light `#E3F3FA`, dark `rgba(18,165,214,.16)`).
- Table classes:
  - `.dtbl td.num, .dtbl th.num { text-align:right; font-variant-numeric: tabular-nums }`;
  - `.dtbl.roomy td { padding:12px 14px }`;
  - `.dtbl th { padding:10px 14px }`.
- Chip classes `.chips` (flex, gap 6, wrap) and `.chip`: a button 32 high, radius 16, padding 0 12, 14px, 1px `--color-border-secondary`, transparent background. When `[aria-pressed="true"]` it gets an `--accent-soft` fill, `--accent-text` text, an `--accent` border and weight 600.
- `.search`: an input wrapper with a 16px icon absolutely positioned at left 10, and the input padded left 34.
- `<FilterChips label options value onChange />`:
  - `options: [{ value, label }]`;
  - renders a `role="group"` with `aria-label={label}` containing `<button className="chip" aria-pressed>` elements;
  - clicking a chip calls `onChange(value)`.
- `<SearchInput value onChange placeholder width />`: an `IconSearch` plus `<input type="search" className="control">` with `aria-label={placeholder}`, calling `onChange(e.target.value)`.

- [ ] **Step 1: Write the failing test** in `FilterChips.test.jsx`:
  ```jsx
  it('marks the selected chip pressed and reports clicks', () => {
    const onChange = vi.fn()
    render(<FilterChips label="Severity" value="all" onChange={onChange}
      options={[{ value: 'all', label: 'All · 3' }, { value: 'err', label: 'Critical · 1' }]} />)
    const group = screen.getByRole('group', { name: 'Severity' })
    expect(within(group).getByRole('button', { name: 'All · 3' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(group).getByRole('button', { name: 'Critical · 1' }))
    expect(onChange).toHaveBeenCalledWith('err')
  })
  ```
- [ ] **Step 2: Run** `npx vitest run src/components/FilterChips.test.jsx`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** FilterChips and SearchInput, and update the CSS:
  - add the tokens to `:root` and `:root[data-theme="dark"]`;
  - text-colour swaps to `--accent-text`: `.tab.on`, `.map-hint` (color), and the active nav item (Task 2) / "View unit" (Task 6) where they live;
  - type floor raises:
    - `.scard-lbl`, `.scard-sub` → 13;
    - `.uid` → 14, `.umeta` → 13, `.uval` → 13;
    - `.atitle` → 14, `.asub`, `.atime` → 13;
    - `.tunit` → 13;
    - `.rbadge` → 12;
  - the table and chip rules above.
- [ ] **Step 4: Run** `npx vitest run` and `npx vite build`. Expected: everything passes and the build is clean.
- [ ] **Step 5: Confirm no CSS rule below 13px remains:** `grep -nE "font-size: ?(1[0-2](\.[0-9])?|[0-9])px" src/index.css` → only `.rbadge` (12px) and `.badge-sm`, if present.
- [ ] **Step 6: Commit:** `feat(dashboard): 1a tokens, 13px type floor, table/chip styles, FilterChips + SearchInput`

---

### Task 2: AuthContext real role + Layout sidebar footer, nav, topbar, breadcrumb (B1)

**Files:**
- Modify: `W/src/contexts/AuthContext.jsx`, `W/src/components/Layout.jsx`, `W/src/components/Layout.test.jsx`
- Create: `W/src/contexts/AuthContext.test.jsx`

**Interfaces (Produces):** `useAuth()` additionally returns:
- `realRole: string | null`, the role from the login JWT, persisted as localStorage `eco_real_role` and removed on `logout()`;
- `canPreview: boolean` (`realRole === 'admin'`).

On provider mount, if `eco_real_role` is a known non-admin role, `role` is forced to it and any stored preview role is ignored. `setRole` is unchanged.

- [ ] **Step 1: Write the failing AuthContext tests.** Render a probe component inside `<AuthProvider>`. Build JWTs with `btoa(JSON.stringify(payload))`.
  ```jsx
  it('login with an fm token: role and realRole fm, no preview', ...)        // expect role 'fm', realRole 'fm', canPreview false, localStorage eco_real_role 'fm'
  it('login with an admin token enables preview', ...)                       // canPreview true
  it('a stored preview role is ignored for a non-admin', ...)                // localStorage eco_role 'admin', eco_real_role 'fm', eco_rt 'x', eco_user {...} → role 'fm'
  it('a pre-upgrade session (no eco_real_role) renders with preview off', ...) // eco_role 'maint' only → role 'maint', realRole null, canPreview false
  it('logout clears eco_real_role', ...)
  ```
- [ ] **Step 2: Run them.** Expected: FAIL (`realRole`/`canPreview` undefined).
- [ ] **Step 3: Implement the AuthContext changes.**
- [ ] **Step 4: Update the Layout tests first.**
  - Mock `useAuth` to return `canPreview` and `realRole`.
  - Desktop: the email shows in the footer, there is a "Sign out" button, and there is no `.rbadge` in the topbar.
  - `canPreview: false` → `queryByRole('combobox', { name: /Preview as/ })` is null.
  - `canPreview: true` → the combobox exists.
  - Rendering at `/units/APU-000123` shows a `link` named "Dashboard" (href `/`) plus the text "APU-000123".
  - Rail mode keeps the "Sign out" button accessible by name.
- [ ] **Step 5: Implement Layout (spec B1).**
  - **Sidebar header:** logo height 40 and no email.
  - **Footer** (full mode):
    - a 32px initials avatar coloured by role, using the `rb-*` classes;
    - a column with the email (13px, ellipsis) and the role label (12px, 600, in the role colour);
    - a 36px icon button with `IconLogout` (`aria-label="Sign out"`).
    - In compact mode, show only the avatar and the sign-out icon button.
  - **Active nav item:** `background: var(--accent-soft); color: var(--accent-text); font-weight: 600`.
  - **Topbar:**
    - Remove the `.rbadge`.
    - When `canPreview`, show a ghost select with `aria-label="Preview as role"`, rendered as a DEMO tag (11px, 700, letterSpacing .06em, 1px `--color-border-secondary`, radius 4, padding 1×5) followed by "Preview as {role} ▾".
    - On `/units/:id`, the title is a breadcrumb: a `<Link to="/">Dashboard</Link>` (500, `--color-text-secondary`), then `IconChevronRight`, then the id (600, primary), all at 20px. The id is `decodeURIComponent` of the path segment.
- [ ] **Step 6: Run** `npx vitest run`. Expected: everything passes.
- [ ] **Step 7: Commit:** `feat(dashboard): sidebar user footer, accent-soft active nav, admin-only role preview, unit breadcrumb`

---

### Task 3: UsersPage (B9)

**Files:**
- Modify: `W/src/api/contract.js`, `W/src/api/contract.test.js`, `W/src/pages/UsersPage.jsx`, `W/src/pages/UsersPage.test.jsx`

**Interfaces (Produces):**
- `userStatusView(raw) -> { label, tone }`:
  - `CONFIRMED` / `active` → `{ 'Active', 'ok' }`;
  - `FORCE_CHANGE_PASSWORD` / `invited` → `{ 'Pending', 'warn' }`;
  - `DISABLED` → `{ 'Disabled', 'off' }`;
  - anything else → title-case of the lower-cased raw value with `_` replaced by spaces, tone `off`;
  - empty → `{ '—', 'off' }`.
- `assignableRoles(myRole) -> [{ value, label }]`:
  - `admin` → admin, fm, maint, eu;
  - `fm` → fm, maint, eu;
  - anything else → `[]`.
  - Labels come from `ROLE_CFG[*].lbl`. Import nothing from React; keep the four labels as a local constant mirroring ROLE_CFG.

- [ ] **Step 1: Write the failing contract tests:**
  ```js
  expect(userStatusView('CONFIRMED')).toEqual({ label: 'Active', tone: 'ok' })
  expect(userStatusView('active')).toEqual({ label: 'Active', tone: 'ok' })
  expect(userStatusView('invited')).toEqual({ label: 'Pending', tone: 'warn' })
  expect(userStatusView('DISABLED')).toEqual({ label: 'Disabled', tone: 'off' })
  expect(userStatusView('RESET_REQUIRED')).toEqual({ label: 'Reset required', tone: 'off' })
  expect(userStatusView('')).toEqual({ label: '—', tone: 'off' })
  expect(assignableRoles('fm').map(r => r.value)).toEqual(['fm', 'maint', 'eu'])
  expect(assignableRoles('admin').map(r => r.value)).toEqual(['admin', 'fm', 'maint', 'eu'])
  expect(assignableRoles('eu')).toEqual([])
  ```
- [ ] **Step 2: Run them.** Expected: FAIL. Then implement and run again. Expected: PASS.
- [ ] **Step 3: Update the UsersPage tests first.**
  - Mock statuses `active` / `invited` render "Active" / "Pending".
  - An unknown role `superadmin` renders the text "superadmin".
  - As admin:
    - there is no inline role `<select>` in the table;
    - clicking "Change role" for `mgr@fleet1.com` opens a dialog with a role select;
    - Confirm calls `api.updateUser('mgr@fleet1.com', { role })`.
  - The current user's row has no actions and shows "(you)".
  - The "Delete mgr@fleet1.com" button exists.
  - Typing in "Filter by email" narrows the rows.
  - The role chips filter by role.
- [ ] **Step 4: Implement the page (spec B9).**
  - **Toolbar:** SearchInput (280 wide), a FilterChips group "Role" with "All roles · N", Admin, Fleet Manager, Maintenance and End User, then a right-aligned `.btn.btn-primary` "Add user" with `IconUserPlus`.
  - **Table** (`.dtbl.roomy`):
    - User (500 weight, plus "(you)");
    - Role (a 13px `rbadge rb-*` badge, falling back to the raw role);
    - Fleet (`fleet`, or a tertiary "All fleets" for `—`/empty);
    - Status (a `badge-sm t-{tone}`);
    - Actions (200, right-aligned): `btn-sm` "Change role" plus a red icon `btn-sm` with `IconTrash`.
  - Change role uses ConfirmDialog with `body` set to a labelled `<select>` populated from `assignableRoles(myRole)`.
  - The create form uses `.field`/`.control` with 14/600 labels and the note "No welcome email is sent — share credentials with the user directly." at 14px.
  - Messages use `var(--err)` / `var(--ok)`. Delete the inline `<style>` keyframes and use `.spin`.
- [ ] **Step 5: Run** `npx vitest run`. Expected: everything passes.
- [ ] **Step 6: Commit:** `feat(dashboard): users table with role badges, change-role dialog, status mapping`

---

### Task 4: APU history + `?tab=` deep link on Unit detail (B8)

**Files:**
- Modify: `W/src/api/contract.js`, `W/src/api/contract.test.js`, `W/src/pages/APUHistoryPage.jsx`, `W/src/pages/APUHistoryPage.test.jsx`, `W/src/pages/UnitDetailPage.jsx`, `W/src/pages/UnitDetailPage.test.jsx`

**Interfaces (Produces):**
- `rangeLabel(range) -> string`: `'-1d'` → 'Last 24 h', `'-7d'` → 'Last 7 days', `'-30d'` → 'Last 30 days', anything else → the input.
- `shortWhen(ts) -> string`: `new Date(Number(ts)).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })`, e.g. "Oct 20, 9:37 PM", or '—' for nullish.
- UnitDetailPage reads its initial tab from `?tab=`, ignoring unknown ids. Changing tab writes `?tab=<id>` with `setSearchParams(..., { replace: true })`. Overview omits the param.

- [ ] **Step 1: Write the failing tests.**
  - `rangeLabel('-1d') === 'Last 24 h'`, `rangeLabel('-30d') === 'Last 30 days'`.
  - `shortWhen(new Date(2026, 9, 20, 21, 37).getTime()) === 'Oct 20, 9:37 PM'`.
  - UnitDetailPage at `/units/TRUCK-001?tab=firmware` has the Firmware tab `aria-selected="true"`, and `?tab=bogus` falls back to Overview.
  - APUHistoryPage:
    - the section heading reads "Fault events · N in the last 24 h" (or "No fault events…" copy kept for empty);
    - the fault table has no "Unit" column header;
    - the subtitle never contains "last 1d".
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement (spec B8).**
  - Period becomes a `.seg` radio group (24 h / 7 days / 30 days).
  - Event table columns:
    - When (190, `shortWhen`, not monospace);
    - Event (`faultInfo(f).name` plus the code in 13px tertiary);
    - State (`badge-sm`, using the same state→tone mapping as AlertsPage's log).
  - Telemetry table: 14px, `.num` columns Battery (`12.64 V`), RPM, Cabin (`96°F`), Oil, Engine hours (`4 h`).
  - Header-right `btn-sm` "Open Telemetry tab" → `navigate('/units/' + encodeURIComponent(unit) + '?tab=telemetry')`.
  - Errors use `var(--err)`. Remove all 11px and monospace inline styles and `.pill`.
- [ ] **Step 4: Run** `npx vitest run`. Expected: everything passes.
- [ ] **Step 5: Commit:** `feat(dashboard): APU history range label fix, segmented period, cleaned tables, unit tab deep link`

---

### Task 5: LoginPage (B11)

**Files:**
- Modify: `W/src/pages/LoginPage.jsx`
- Create: `W/src/pages/LoginPage.test.jsx`

- [ ] **Step 1: Write the failing test.**
  - The form has a "Fleet management dashboard" subtitle, labelled Email and Password inputs, and a "Sign in" button.
  - When `api.login` rejects with `Error('Incorrect username or password.')`, an element with `role="alert"` shows that text.
  - Mock `../api/client.js` and `useAuth`, following `AlertsPage.test.jsx`.
- [ ] **Step 2: Run it.** Expected: FAIL (no subtitle, no `role="alert"`).
- [ ] **Step 3: Implement (spec B11).**
  - **Card:** width 400, radius 14, 1px `--color-border-secondary`, padding 36 36 32, gap 24.
  - **Logo:** height 60.
  - **Fields:** `.field` + `.control` at height 44.
  - **Error row:** `role="alert"`, `IconAlertCircle`, `--err-soft` fill, `--err` text, 14px.
  - **Submit:** `.btn.btn-primary.btn-lg`, full width.
  - Keep the existing submit and login logic.
- [ ] **Step 4: Run** `npx vitest run`. Expected: everything passes.
- [ ] **Step 5: Commit:** `feat(dashboard): refined login card and error row`

---

### Task 6: DashboardPage count tiles, filter and sections (B2)

**Files:**
- Modify: `W/src/api/contract.js`, `W/src/api/contract.test.js`, `W/src/pages/DashboardPage.jsx`, `W/src/pages/DashboardPage.test.jsx`, `W/src/index.css` (only for `.kv-lbl` colour)

**Interfaces (Produces).** Rows have the shape `{ u: { unit, demo, fleet_id? }, tele, view? }`, as built in DashboardPage today.
- `toneCounts(rows) -> { err, warn, off, ok }`: counts by `view.tone`; rows without a view are not counted.
- `filterRows(rows, { tone, q }) -> rows`:
  - `tone` null means any; otherwise only rows with `view.tone === tone`;
  - `q` is a trimmed, case-insensitive substring of `u.unit` or `u.fleet_id`;
  - rows without a view pass the tone filter only when `tone` is null.

- [ ] **Step 1: Write the failing contract tests.**
  - `toneCounts` over rows with err, ok, ok and one without a view → `{ err: 1, warn: 0, off: 0, ok: 2 }`.
  - `filterRows(rows, { tone: 'ok', q: '' })` returns the two ok rows.
  - `filterRows(rows, { tone: null, q: 'truck-00' })` matches by unit, ignoring case.
  - A `fleet_id: 'FLEET-001'` row matches `q: 'fleet-001'`.
- [ ] **Step 2: Run them.** Expected: FAIL. Implement and run again. Expected: PASS.
- [ ] **Step 3: Update the DashboardPage tests first.**
  - No "Needs attention" panel heading.
  - Four count-tile buttons named by label: "Fault", "Warning", "Offline", "Healthy", each with its count.
  - Clicking "Fault" leaves only fault units and marks the tile `aria-pressed="true"`; clicking it again clears the filter.
  - Sections are titled "Needs attention · N" and "Running normally · N", and a section with 0 units isn't rendered.
  - A filter that matches nothing shows "No units match this filter" and a "Clear filter" button.
  - A unit with `fleet_id` shows the fleet after its name.
- [ ] **Step 4: Implement (spec B2).**
  - **Tiles:** 4-up flex, gap 12, `<button aria-pressed>`. Each has a tone icon (20), a label (15 secondary) and a count (24/600). When count > 0 and the tone isn't ok, use the `--{tone}-soft` fill and a `--{tone}` count. The active tile has a 2px border in the tone colour.
  - **Toolbar:** SearchInput, 300 wide, placeholder "Filter by unit or fleet".
  - **Sections:** split `filterRows(...)` by `view.attention`. The h2 is 17/600 with a 14px tertiary subtitle.
  - **UnitCard:** fleet id after the name (14px tertiary, only when present); "View unit" in `--accent-text`; `.kv-lbl` in `--color-text-secondary`.
  - Keep the "settled" gating: tiles show counts only once settled, and "—" before.
  - Delete `AttentionPanel`.
- [ ] **Step 5: Run** `npx vitest run`. Expected: everything passes.
- [ ] **Step 6: Commit:** `feat(dashboard): status count tiles, unit filter, attention/normal sections`

---

### Task 7: Unit detail header and OverviewTab (B3)

**Files:**
- Modify: `W/src/pages/UnitDetailPage.jsx`, `W/src/pages/UnitDetailPage.test.jsx`, `W/src/components/unit/OverviewTab.jsx`, `W/src/components/unit/OverviewTab.test.jsx`, `W/src/index.css` (`.banner`, `.ov-groups`, `.rv` in this layout)

**Interfaces:**
- Consumes: `unitView`, `fmt` and the breadcrumb (Task 2).
- `StatusBadge` from DashboardPage moves to `W/src/components/StatusBadge.jsx` as `export default function StatusBadge({ view, size })`. DashboardPage imports it from there.

- [ ] **Step 1: Update the tests first.**
  - UnitDetailPage has no "Fleet" back button and no `h1` containing the id.
  - The header row shows the id, a status badge (e.g. "Fault") and the seen text.
  - In OverviewTab, a fault banner title has no "Fault:" prefix.
  - When actions are disabled for a demo unit, the reason renders *before* the action buttons in DOM order: compare `compareDocumentPosition` between the notice and the first action button.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement (spec B3).**
  - **Header row:** id (24/600), `StatusBadge`, demo badge, and `{fleet_id ·} {view.seen}` (14 tertiary).
  - **Banner:** `--{tone}-soft` fill, radius 12, padding 14×18, no 2px border. Tone icon 24, title 18/600 in the tone colour, the context sub-line inline at 15 secondary, and the action `.btn` on the right.
  - **Groups:** `.ov-groups` becomes `repeat(auto-fit, minmax(min(300px,100%),1fr))` with gap 16; `.rv` is 18px; the side column is 300px.
  - **Disabled-actions notice** above the buttons: `--color-background-secondary`, radius 8, padding 10×12, `IconInfoCircle`, 14px secondary.
- [ ] **Step 4: Run** `npx vitest run`. Expected: everything passes.
- [ ] **Step 5: Commit:** `feat(dashboard): unit header row, lighter status banner, two-column readings`

---

### Task 8: Fleet map labels, legend and side panel (B4)

**Files:**
- Modify: `W/src/components/map/FleetMap.jsx`, `W/src/components/map/FleetMap.test.jsx`, `W/src/pages/FleetMapPage.jsx`, `W/src/pages/FleetMapPage.test.jsx`, `W/src/index.css`

- [ ] **Step 1: Update the tests first.**
  - In FleetMapPage, the "unit not placed" heading comes before the "On the map" heading in DOM order.
  - The CTA button is named "Set location for {unit}".
  - The "On the map" list is ordered by attention: a fault unit precedes a healthy one.
  - In FleetMap, a legend lists Fault, Warning, Healthy and Offline.
  - Each pin has a label "{unit} · {status}". This can be asserted from the rendered marker HTML, the same way the current test inspects markers.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement (spec B4).**
  - **Pin label chip:** 13/600, `--color-background-primary`, radius 6, padding 3×8, shadow `0 1px 3px rgba(0,0,0,.2)`.
  - **Legend:** bottom-left, 10px dots, 13px labels.
  - **Side panel:**
    - "Not placed" goes first: `IconMapPinOff` in warn, "N unit(s) not placed" (15/600), the copy from the spec, and a full-width `btn-primary` CTA.
    - Then "On the map", sorted with `byAttention`.
    - Then the "Assigned locations — units don't report GPS yet." note (13 tertiary, `IconInfoCircle`).
- [ ] **Step 4: Run** `npx vitest run`. Expected: everything passes.
- [ ] **Step 5: Commit:** `feat(dashboard): map pin labels, legend, not-placed call to action first`

---

### Task 9: AlertsPage all-units mode (B5)

**Files:**
- Modify: `W/src/api/contract.js`, `W/src/api/contract.test.js`, `W/src/components/UnitPicker.jsx`, `W/src/pages/AlertsPage.jsx`, `W/src/pages/AlertsPage.test.jsx`

**Interfaces (Produces):**
- `UnitPicker` gains an optional `allLabel` prop. When it is set, it renders `<option value="__all__">{allLabel}</option>` first. `ALL_UNITS = '__all__'` is exported from `UnitPicker.jsx`.
- `fleetFaultRows(results) -> { active, log, failed }`:
  - `results` is `[{ unit, faults } | { unit, error }]`;
  - `active` is `activeFaults(faults)` per unit, mapped to `{ unit, ...fault }` and sorted newest `ts` first;
  - `log` is every event as `{ unit, ...event }`, newest first;
  - `failed` is the list of unit ids that errored.
- `severityCounts(rows) -> { all, err, warn }`, using `faultInfo(row).tone`.

- [ ] **Step 1: Write the failing contract tests.**
  - Two units, one with an active critical fault (`fault: '0x0020'`) and one with an error → `active.length === 1`, `active[0].unit === 'A'`, `failed` equals `['B']`.
  - The log is sorted newest first across units.
  - `severityCounts` returns `{ all: 2, err: 1, warn: 1 }` for one critical and one warning row.
- [ ] **Step 2: Run them.** Expected: FAIL. Implement and run again. Expected: PASS.
- [ ] **Step 3: Update the AlertsPage tests first.**
  - Admin and fm default to "All units": the picker value is `__all__` and `getFaults` is called once per unit with `{ start: '-7d', limit: '100' }`.
  - The heading reads "Active faults · 1 across 1 unit". Pluralise "unit"/"units".
  - The active table has columns Unit, Fault, Severity, Raised and an "Open unit" link-button.
  - In fan-out mode there is no big banner.
  - A unit whose `getFaults` rejects produces a notice "Couldn't load faults for B" while A's rows still render.
  - Severity chips filter the active table.
  - The maint and eu roles still default to `selectedUnit`, keeping the existing tests.
  - The single-unit mode keeps its banner.
- [ ] **Step 4: Implement (spec B5).**
  - Scope is local state: `useState(role === 'admin' || role === 'fm' ? ALL_UNITS : selectedUnit)`. Picking a unit also calls `setSelectedUnit`.
  - Fan-out uses `Promise.allSettled` over `units.map(u => api.getFaults(u.unit, { start: '-7d', limit: '100' }))` inside the existing `useEffect` idiom, so the page stays free of react-query here.
  - **Toolbar:** UnitPicker with `allLabel="All units"`, FilterChips "Severity" ("All · N", "Critical · N", "Warning · N"), and a right-aligned "Last 7 days".
  - **Active table** (`.dtbl.roomy`): Unit (150, 600), Fault (tone icon 18, name 600, code 13 tertiary), Severity (`badge-sm`), Raised (`ageText`, plus a "Unit offline" sub-line when that unit's latest view is stale; skip the sub-line if the latest isn't loaded), and an "Open unit" `btn-sm`. Critical rows use `--err-soft`.
  - **Fault log:** a Unit column. Columns are When 170, Unit 150, Fault, State 110.
  - Keep the `<details>` "What the controller monitors".
- [ ] **Step 5: Run** `npx vitest run`. Expected: everything passes.
- [ ] **Step 6: Commit:** `feat(dashboard): fleet-wide alerts with severity chips and per-unit fault fan-out`

---

### Task 10: MaintenancePage (B6)

**Files:**
- Modify: `W/src/pages/MaintenancePage.jsx`, `W/src/pages/MaintenancePage.test.jsx`

- [ ] **Step 1: Update the tests first.**
  - Service counters show "Oil hours" `4 h` · "since last oil change", "Engine hours" `4 h`, and "Machine hours" `128 h`. Mock `useUnitLatest`, or mock `api.getLatest` and wrap in a QueryClientProvider.
  - The history is a table with headers Date, Type, Technician, Notes.
  - A row with a `tech` field shows the technician.
  - Empty notes show "No notes".
  - The type chips filter rows: "Oil change" hides the inspection.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement (spec B6).**
  - **Toolbar:** UnitPicker, FilterChips "Type" (All types, Oil change, Inspection, Repair, Firmware), and a right-aligned "Add record" `btn-primary`.
  - **Service counters:** three `.scard`s with a 14 label, a 26/600 value and a 13 caption. Show `—` when latest is missing.
  - **Service history** (`.dtbl.roomy`): Date (600, 150), Type (`badge-sm t-off`, 150), Technician (180, `technician || tech`), Notes.
- [ ] **Step 4: Run** `npx vitest run`. Expected: everything passes.
- [ ] **Step 5: Commit:** `feat(dashboard): maintenance service counters, type chips, history table`

---

### Task 11: ReportsPage (B7)

**Files:**
- Modify: `W/src/api/contract.js`, `W/src/api/contract.test.js`, `W/src/pages/ReportsPage.jsx`, `W/src/pages/ReportsPage.test.jsx`

**Interfaces (Produces):** `reportRangeText(start, now) -> string`.
- `start` is one of `'-1d' | '-7d' | '-30d'`.
- The output is "Oct 13 – Oct 20, 2026 · real units only": the en-US short month and day, with the year once at the end.
- When the years differ, both carry the year: "Dec 28, 2025 – Jan 4, 2026 · real units only".

- [ ] **Step 1: Write the failing tests.**
  - `reportRangeText('-7d', new Date(2026, 9, 20, 12))` → 'Oct 13 – Oct 20, 2026 · real units only'.
  - `reportRangeText('-7d', new Date(2026, 0, 4, 12))` → 'Dec 28, 2025 – Jan 4, 2026 · real units only'.
  - ReportsPage: the heading reads "Operator activity · 2 operators", there is a "Total" row with summed starts `231`, and the Starts cells have class `num`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement (spec B7, minus the fleet select).**
  - **Toolbar:** period seg, then right-aligned `reportRangeText` (14 tertiary) and Refresh.
  - The fuel savings stat uses neutral ink, not green.
  - The operator table has `.num` Starts, Stops and FW updates, and a bold Total row.
- [ ] **Step 4: Run** `npx vitest run`. Expected: everything passes.
- [ ] **Step 5: Commit:** `feat(dashboard): reports explicit date range, neutral savings, operator totals`

---

### Task 12: Unit settings, formerly System config (B10)

**Files:**
- Modify: `W/src/components/Layout.jsx` (NAV label), `W/src/pages/SystemConfigPage.jsx`, `W/src/pages/SystemConfigPage.test.jsx`

- [ ] **Step 1: Update the tests first.**
  - The nav and topbar label is "Unit settings".
  - The page shows "Settings apply to one unit at a time.".
  - The interval status renders as a badge: "Confirmed by unit" (`t-ok`), "Pending" (`t-warn`), "Not confirmed" (`t-err`).
  - While the button is disabled, the hint "Pick a new value to enable" shows.
  - With image fw below 1.2.62:
    - a warning row "Needs system image 1.2.62 or newer. {unit} is on {fw}." renders before the Reboot button;
    - a "Go to Firmware" button navigates to `/units/{unit}?tab=firmware`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement (spec B10).** The route stays `/config`. The interval reads "Every N seconds" (22/500) with the badge beside it. The warning row uses `--warn-soft`, radius 8, padding 12×14 and `IconAlertTriangle`.
- [ ] **Step 4: Run** `npx vitest run`. Expected: everything passes.
- [ ] **Step 5: Commit:** `feat(dashboard): rename to Unit settings, interval status badge, reboot prerequisite row`

---

### Task 13: Final sweep and visual check

- [ ] **Step 1: Grep the invariants.** Each should produce no output:
  - `grep -n "#E24B4A\|#1D9E75" src/pages/LoginPage.jsx src/pages/APUHistoryPage.jsx src/pages/UsersPage.jsx`
  - `grep -n "className=\"pill\|'pill " src/pages/UsersPage.jsx src/pages/APUHistoryPage.jsx`
  - `grep -n "<style>" src/pages/UsersPage.jsx`
  - `grep -n "color: 'var(--accent)'" src/pages src/components -r`
- [ ] **Step 2: Run** `npx vitest run` and `npx vite build`. Expected: all pass and the build is clean.
- [ ] **Step 3: Visual check in mock mode** (`VITE_MOCK=on npx vite --port 5179`) at 1280×800, light theme. Compare Login, Dashboard, Unit detail, Fleet map, Alerts, Maintenance, Reports, APU history, Users and Unit settings with `admin/*-1a.png`. Toggle dark theme on the Dashboard and confirm the `--accent-text`/`--accent-soft` dark values read correctly.
- [ ] **Step 4: Rail mode.** Check the sidebar at 1000px wide (avatar plus sign-out icon, labels in `title`). Drawer mode at 390px: the footer shows in the drawer.
- [ ] **Step 5: Commit any fixes:** `chore(dashboard): 1a refresh sweep`
