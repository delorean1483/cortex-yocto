# Cab Panel UI Refresh (1a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the 1a "Refined" pass to the gobi-ui cab panel. It covers the 13px type floor, fill-only selection, a global fault indicator (header pill, Rail badge, Home strip, Alerts tile) and the per-screen refinements A2–A12.

**Architecture:** This is a visual refresh inside the existing QML stack, using the `Theme` singleton, atoms, templates and screens. New display logic goes into pure functions on the `StatusLabels` singleton, and those are unit-tested with `qmltestrunner`. Layout is verified by rendering the headless Shots tour and comparing each PNG with the 1a reference image. Navigation changes go through `AppShell`: it gains `openAlerts()` and `openMode()`.

**Tech Stack:** Qt 6 / QML (QtQuick, QtQuick.Layouts, QtQuick.Controls Basic), Qt Quick Test (`qmltestrunner`), Yocto recipe `gobi-ui_1.0.bb`.

**Spec:** `docs/superpowers/specs/2026-10-20-ui-refresh-design.md`. Read Part A and the "Implementation decisions" section at the end. The reference images are in `docs/superpowers/specs/2026-10-20-ui-refresh/cab/`.

## Global Constraints

- Paths are relative to `meta-ecofleet/recipes-ecofleet/gobi-ui/files/` (written `F/`) unless they start with `docs/` or `meta-ecofleet/`.
- The canvas is fixed at 800×480. Header is 40 high, Rail 112 wide, content area 688×440. Do not change ScaleRoot or AppShell geometry.
- Type floor is 13px. `Theme.fsCaption` = 13, and no `fsCaption - 1` remains anywhere.
- Show selection with a fill, never an outline. Segmented controls use a solid `accent` fill with `textOnAccent` text; list rows use a `surface2` fill.
- Status colours (ok, warn, fault, info) are for status only. Lock affordances use the neutral PIN tag (`atoms/PinTag.qml`), not a warn-coloured lock.
- No continuous animations. Remove the Home glow pulse. Keep the existing 120 ms segment colour animation. The wrong-PIN shake (300 ms, one-shot) is allowed.
- Keep every optimistic, debounced and reconcile idiom (`uiMode`, `dirty`, `Timer spSend`, `Connections onDataChanged`) exactly as it is. The only behaviour changes are:
  - the label renames: AUTO/OFF → ON/OFF, LOW/MED/HIGH → Auto/Low/Med/High, keyboard "Space";
  - the Mode route;
  - the merged Diagnostics cabin tile.
- Tap targets are at least 48px.
- Atom changes keep today's look by default. Callers that the plan doesn't touch must render exactly as before: ComponentTestScreen and ScreenLockScreen Keypads, the WifiSaved and Wifi ConfirmButtons, and the HeaterCard ConfirmButton.
- Every new `.qml` file is added to `SRC_URI` in `meta-ecofleet/recipes-ecofleet/gobi-ui/gobi-ui_1.0.bb`. Files under `atoms/`, `templates/` and `screens/` are installed by glob; a new top-level file would also need an `install` line.
- Use the fault count from the spec decisions everywhere: `StatusLabels.faultCount(telemetry.hasError, eventlog.activeCount)`.
- Phase 2 (1b) is out of scope: no night palette and no brightness presets.

## Verification commands (used by every task)

```bash
F=$PWD/meta-ecofleet/recipes-ecofleet/gobi-ui/files            # run from the worktree root
B=/private/tmp/claude-501/-Users-sungkang-dev-cortex-yocto/79176ab2-7031-4081-ae3e-9bcb3f7f743a/scratchpad/shots-build
# QML unit tests
QT_QPA_PLATFORM=offscreen /opt/homebrew/opt/qt/bin/qmltestrunner -input $F/tests/qml
# Shots tour (runner is prebuilt in $B; QML/Mocks load at runtime, no rebuild needed)
rm -rf $B/out && mkdir -p $B/out && (cd $B && QT_QPA_PLATFORM=offscreen QT_QUICK_CONTROLS_STYLE=Basic \
  QT_QUICK_BACKEND=software ./shots $F/qml $F/fonts $B/out preview/Shots.qml)
```
- **Tests pass** when the output ends with `Totals: N passed, 0 failed`.
- **The Shots tour passes** when:
  - stderr is exactly `app font "Inter"`, with no QML warnings or errors;
  - the named PNGs in `$B/out` match the 1a reference image for layout, sizes, colours and copy, allowing for mock data differences. Open both with the Read tool.
- If `$B/shots` is missing, rebuild it with `cmake -S $F/qml/preview/runner -B $B -DCMAKE_PREFIX_PATH=/opt/homebrew/opt/qt && cmake --build $B`.

## Review Focus

1. **Fault active, but no active event in `eventlog`.** This happens when `events.json` is missing, after an agent restart, or while the event log lags.
   - The pill, badge and Alerts tile must still show 1.
   - The Home strip shows without "Active for".
   - The Alerts card shows without the snapshot line.
   - Tests: `faultCount(true, 0) === 1`, `activeEvent([]) === null`, `activeFor(0, now) === ""` (Task 2). Shots step `01c-home-fault-noevents` (Task 4).
2. **Fault clears while the user is on Home.** The strip, pill and badge disappear on the next `dataChanged`, and the strip leaves no gap: an invisible item drops out of the ColumnLayout. Shots step `01d-home-cleared` (Task 4).
3. **Stale telemetry and a fault together.** The header shows the pill and the red "No APU data". The row must still fit beside the logo without overlap. Shots step `01e-header-stale-fault` (Task 3).
4. **Unknown or long error codes.** `StatusLabels.error()` returns the raw string, e.g. `"compressor_overcurrent_lockout"`. The strip, Alerts card and lock chip must elide rather than push "Details" or the chevron off-screen. Tests: `error("compressor_overcurrent_lockout")` round-trips (Task 2), plus Shots step `01f-home-longcode` (Task 4).
5. **Values before the first snapshot or at extremes.** Setpoint 0 shows "—" as today. Engine hours 0 or ≥ 10,000 must format. More than one active fault reads "2 faults". Tests: `thousands(0) === "0"`, `thousands(12345) === "12,345"`, `faultCountLabel(2) === "2 faults"` (Task 2).

---

### Task 1: Theme tokens, `check` icon, PinTag and stepper/segment atom props (A0)

**Files:**
- Modify: `F/qml/Theme.qml`, `F/qml/atoms/Icon.qml`, `F/qml/atoms/SegmentedControl.qml`, `F/qml/atoms/StepButton.qml`, `F/qml/atoms/Stepper.qml`, `F/qml/HeaterCard.qml` (only the `fsCaption - 1` line), `F/qml/screens/HomeScreen.qml` (only the `fsCaption - 1` line)
- Create: `F/qml/atoms/PinTag.qml`
- Modify: `meta-ecofleet/recipes-ecofleet/gobi-ui/gobi-ui_1.0.bb` (add `file://qml/atoms/PinTag.qml`)

**Interfaces (Produces):**
- `Theme`: `fsCaption: 13`, `faultText: "#FF7B72"`, `okText: "#56D364"`, `radioRing: "#4A5361"`, `keyFill: "#1F252E"`, `lockPanel: "#141820"`.
- `Icon` name `"check"`, path `"M5 12l5 5 9-10"`.
- `PinTag {}` is a `Rectangle` with the text "PIN": 12px Bold, letterSpacing 0.8, `textDim` on `surface2`, radius 5, padding 2×6 (implicit size from the text). Callers anchor it themselves: top-right, 10px inset.
- `SegmentedControl` new properties:
  - `property color trackColor: Theme.surface`;
  - `property bool showBorder: !Qt.colorEqual(trackColor, Theme.bg)`;
  - `radius` stays overridable.
  - The track uses `trackColor`, with a border only when `showBorder`.
- `StepButton` new properties:
  - `property int w: Theme.touch + 4`, `property int h: Theme.touch` (they drive the implicit size);
  - `property color fill: Theme.surface`;
  - `property bool showBorder: true`;
  - `property int iconSize: 22`, `property real iconStroke: 2.4`.
  - Pressed colour: `surface2` when `fill` is `surface`, otherwise `Theme.border`.
- `Stepper` pass-through properties: `buttonW`, `buttonH`, `buttonFill`, `buttonBorder`, `iconSize`, `iconStroke` (same defaults as StepButton), and `property real textLetterSpacing: 0`. `spacing` stays assignable.

- [ ] **Step 1: Add the tokens, the `check` icon, PinTag and the atom properties above. Change the three `Theme.fsCaption - 1` usages to `Theme.fsCaption`. Add PinTag to `SRC_URI` after `file://qml/atoms/TextKeyboard.qml`.**
- [ ] **Step 2: Run the Shots tour.**
  - Expected: stderr is only `app font "Inter"`.
  - `01-home.png`, `03-battery.png` and `04-menu.png` look the same as the baseline, except that caption text is 1px larger. The default prop values must reproduce today's look.
- [ ] **Step 3: Confirm the floor holds.** `grep -rn "fsCaption - 1\|fsCaption-1" $F/qml` → no output.
- [ ] **Step 4: Commit:** `feat(gobi-ui): 1a theme tokens, PIN tag and stepper/segment atom options`

---

### Task 2: StatusLabels display helpers + QML test suite

**Files:**
- Modify: `F/qml/StatusLabels.qml`
- Create: `F/tests/qml/tst_statuslabels.qml`. This is a `TestCase` that does `import "../../qml"`. It is not in SRC_URI, so it doesn't ship.

**Interfaces (Produces).** All of these are pure functions on `StatusLabels`. The `events` arrays are EventLogModel maps, newest first, where `endMs === 0` means active.
- `thousands(n) -> string`: integer with comma separators. Don't rely on `toLocaleString`.
- `faultCount(hasError, activeCount) -> int`: `hasError ? Math.max(1, activeCount) : 0`.
- `faultCountLabel(n) -> string`: "1 fault" / "N faults".
- `activeEvent(events) -> object|null`: the first event with `endMs === 0`.
- `recentCleared(events, n) -> array`: the first `n` events with `endMs > 0`.
- `activeFor(startMs, nowMs) -> string`: "" when `!startMs`, otherwise `"Active for " + duration(nowMs - startMs)`.
- `faultSnapshot(e) -> string`: "" when `!e`, otherwise `"At fault: " + mode(e.mode) + " · " + control(e.controlStatus) + " · " + thousands(e.rpm) + " rpm · " + e.battV.toFixed(1) + " V · coolant " + Math.round(e.coolantF) + "°F"`.
- `battHealth(v) -> {key, label}`:
  - `v >= 12.4` → `{key:"healthy", label:"Healthy"}`;
  - `v < 11.8` → `{key:"low", label:"Low"}`;
  - otherwise `{key:"ok", label:"OK"}`.
- `battModeHelp(mode) -> string`:
  - `"climate"` → "Climate mode is running. On switches the APU to Battery mode.";
  - `"battery"` → "Runs the APU only to keep the truck battery charged.";
  - `"off"` → "APU stays off. On starts it in Battery mode.";
  - anything else → "".
- `climateLine(on, controlStatus, setpointF) -> string`:
  - `!on` → "climate off";
  - `"cooling"` → "cooling to {sp}°";
  - `"chillin"` → "at target {sp}°";
  - any other status → `control(s).toLowerCase()`.
  - When `setpointF <= 0`, drop " to {sp}°" and " {sp}°".

- [ ] **Step 1: Write the failing tests.** In `tst_statuslabels.qml` (`TestCase { name: "StatusLabels" }`):
  ```qml
  function test_thousands() { compare(StatusLabels.thousands(0), "0"); compare(StatusLabels.thousands(1284), "1,284")
                              compare(StatusLabels.thousands(12345), "12,345"); compare(StatusLabels.thousands(1234567), "1,234,567") }
  function test_faultCount() { compare(StatusLabels.faultCount(false, 3), 0); compare(StatusLabels.faultCount(true, 0), 1)
                               compare(StatusLabels.faultCount(true, 2), 2) }
  function test_faultCountLabel() { compare(StatusLabels.faultCountLabel(1), "1 fault"); compare(StatusLabels.faultCountLabel(2), "2 faults") }
  // fixture mirrors preview/Mocks.qml eventlog.sample() with t = 1e12
  function test_activeEvent() { compare(StatusLabels.activeEvent(ev()).error, "low_oil"); compare(StatusLabels.activeEvent([]), null)
                                compare(StatusLabels.activeEvent(ev().slice(1)), null) }
  function test_recentCleared() { var r = StatusLabels.recentCleared(ev(), 2); compare(r.length, 2)
                                  compare(r[0].error, "high_engine_temp"); compare(r[1].error, "low_battery") }
  function test_activeFor() { compare(StatusLabels.activeFor(0, 1e12), ""); compare(StatusLabels.activeFor(1e12 - 4*60000, 1e12), "Active for 4 min")
                              compare(StatusLabels.activeFor(1e12 - 20000, 1e12), "Active for under a minute") }
  function test_faultSnapshot() { compare(StatusLabels.faultSnapshot(ev()[0]), "At fault: Climate · Cooling · 2,440 rpm · 13.9 V · coolant 188°F")
                                  compare(StatusLabels.faultSnapshot(null), "") }
  function test_battHealth() { compare(StatusLabels.battHealth(12.4).key, "healthy"); compare(StatusLabels.battHealth(12.39).key, "ok")
                               compare(StatusLabels.battHealth(11.8).key, "ok"); compare(StatusLabels.battHealth(11.79).key, "low")
                               compare(StatusLabels.battHealth(13.9).label, "Healthy") }
  function test_battModeHelp() { compare(StatusLabels.battModeHelp("off"), "APU stays off. On starts it in Battery mode.")
                                 compare(StatusLabels.battModeHelp("battery"), "Runs the APU only to keep the truck battery charged.")
                                 compare(StatusLabels.battModeHelp(""), "") }
  function test_climateLine() { compare(StatusLabels.climateLine(true, "cooling", 70), "cooling to 70°")
                                compare(StatusLabels.climateLine(true, "chillin", 70), "at target 70°")
                                compare(StatusLabels.climateLine(true, "warming_up", 70), "warming up")
                                compare(StatusLabels.climateLine(false, "cooling", 70), "climate off")
                                compare(StatusLabels.climateLine(true, "cooling", 0), "cooling") }
  function test_unknownErrorRoundTrips() { compare(StatusLabels.error("compressor_overcurrent_lockout"), "compressor_overcurrent_lockout") }
  ```
  `ev()` returns the three Mocks sample events with `t = 1e12`:
  1. `low_oil`, `endMs: 0`, mode climate / cooling, rpm 2440, battV 13.9, coolantF 188;
  2. `high_engine_temp`, cleared;
  3. `low_battery`, cleared.
- [ ] **Step 2: Run the tests.** Expected: FAIL with a TypeError for each new function. `test_unknownErrorRoundTrips` already passes.
- [ ] **Step 3: Implement the helpers in `StatusLabels.qml`, matching the file's one-line-function style.**
- [ ] **Step 4: Run the tests.** Expected: `Totals: 13 passed, 0 failed`, which is 11 tests plus init and cleanup.
- [ ] **Step 5: Commit:** `feat(gobi-ui): StatusLabels helpers for fault, battery and lock copy + QML tests`

---

### Task 3: Global fault indicator in the chrome: Header pill, Rail badge, AppShell routes (A1)

**Files:**
- Modify: `F/qml/Header.qml`, `F/qml/Rail.qml`, `F/qml/AppShell.qml`, `F/qml/main.qml`, `F/qml/screens/AlertsScreen.qml` (add the marker property only), `F/qml/preview/Shots.qml`

**Interfaces:**
- Consumes: `StatusLabels.faultCount`, `StatusLabels.faultCountLabel` (Task 2); `Theme.fault` (Task 1).
- Produces:
  - `Header`: `signal faultTapped()`.
  - `Rail`: `property int badgeCount: 0` and `property string badgeKey: "menu"`.
  - `AppShell`:
    - `function openAlerts()` returns early if `stack.currentItem.isAlertsScreen === true`; otherwise it calls `selectRail(2)` and pushes `alertsC`.
    - `function openMode()` runs `stack.push(modeC)`.
    - It owns `Component { id: alertsC; AlertsScreen {} }` and `Component { id: modeC; ModeScreen {} }`.
  - `AlertsScreen`: `readonly property bool isAlertsScreen: true`.
  - `main.qml`: remove the dangling `modeC`, and change `homeC` to `HomeScreen { appShell: shell }`. HomeScreen gets the property in Task 4. Add the `appShell` property to HomeScreen in this task too, so main.qml loads.

- [ ] **Step 1: Header (A1).**
  - Left padding 20, logo height 22.
  - Right-hand row, spacing 18: fault pill, APU status, Wi-Fi, clock.
    - **Pill:** visible when `telemetry.hasError`. Height 28, radius 14, fill `Theme.fault`. Contains the `alert` icon (15px, stroke 2.6, `#2A0705`) and `faultCountLabel(faultCount(...))` at 13px Bold `#2A0705`. Tapping it emits `faultTapped`.
    - **APU status:** 9px dot plus "APU live" / "No APU data" at 14px; `textDim`, or fault colour when stale.
    - **Wi-Fi:** bars only. Use `WifiBars` with `unit: 4`; the bar heights are 6/9/12/15. Drop the wifi glyph. The tap area stays.
    - **Clock:** `Qt.formatDateTime(now, "h:mm AP")`, 16px DemiBold, `Theme.text`, `font.features: {"tnum": 1}`.
- [ ] **Step 2: Rail (A1).**
  - Top padding 12, sides 10, item height 84, spacing 8.
  - Inactive icon and label are `textDim`; labels are 15px.
  - The active item has a `tint(accent, 0.18)` fill, radius 12, icon stroke 2.4 and a DemiBold label.
  - Badge: when `badgeCount > 0` on the item whose `modelData.key === badgeKey`, draw an 18px circle filled `fault` with the count at 12px Bold `#2A0705`, anchored top 10 / right 18 inside the item.
- [ ] **Step 3: AppShell.**
  - Wire `hdr.onFaultTapped: shell.openAlerts()`.
  - Bind `rail.badgeCount: StatusLabels.faultCount(telemetry.hasError, eventlog.activeCount)`.
  - Add `openAlerts()`, `openMode()` and the two Components. Update `main.qml` and `Shots.qml` (`homeC` passes `appShell: shell`).
- [ ] **Step 4: Add Shots steps after `01-home`.**
  - `01b-home-fault`: `telemetry.mode="climate"; telemetry.controlStatus="cooling"; telemetry.hasError=true; telemetry.error="low_oil"; eventlog.sample(); root.poke()`.
  - `01e-header-stale-fault`: `telemetry.stale=true; root.poke()`.
  - Then restore `stale=false; hasError=false; error="none"; eventlog.events=[]; eventlog.activeCount=0` at the start of the next existing step. Later steps must keep rendering their current state.
- [ ] **Step 5: Run the Shots tour.** Expected:
  - clean stderr;
  - in `01b-home-fault.png`, the header matches the reference header in `cab/01-home-1a.png`: pill "1 fault", "APU live", bars, "h:mm AP" clock, and the Menu badge "1";
  - `01e-header-stale-fault.png` shows the pill and the red "No APU data" with no overlap.
- [ ] **Step 6: Commit:** `feat(gobi-ui): header fault pill, rail fault badge and AppShell alert/mode routes`

---

### Task 4: Home fault strip, Home layout and HeaterCard (A1 strip, A2, A4 route)

**Files:**
- Modify: `F/qml/screens/HomeScreen.qml`, `F/qml/HeaterCard.qml`, `F/qml/preview/Shots.qml`

**Interfaces:**
- Consumes:
  - `appShell.openAlerts()` / `appShell.openMode()` (Task 3);
  - `StatusLabels.activeEvent`, `activeFor`, `thousands`, `error` (Task 2);
  - the `SegmentedControl` `trackColor`/`showBorder` and `Stepper` button properties (Task 1).
- Produces: nothing new.

- [ ] **Step 1: HomeScreen.**
  - Delete the glow bar and its `SequentialAnimation`, plus `glowOn` and `caption()`. Keep `glowColor()`; it is renamed in use only as the status-dot hue.
  - Layout: ColumnLayout, margins 16, spacing 12: fault strip, then body row (spacing 12), then HeaterCard.
  - **Fault strip** (spec A1):
    - `visible: telemetry.hasError`, height 48, radius 10, `tint(fault, 0.18)`.
    - Contents: `alert` icon 22 `fault`; `StatusLabels.error(telemetry.error)` at 17px Bold `faultText`; then `StatusLabels.activeFor(ev ? ev.startMs : 0, now)` at 14px `textDim` with `Layout.fillWidth` and `elide: Text.ElideRight`; then "Details" at 15px DemiBold plus `chevron-right` 20.
    - `ev = StatusLabels.activeEvent(eventlog.events)`.
    - Give the error label `Layout.maximumWidth: 260` and `elide: Text.ElideRight`.
    - Tapping it calls `home.appShell.openAlerts()`.
    - A `Timer { interval: 10000; repeat: true; running: telemetry.hasError }` refreshes `now`.
  - **Left column** (spec A2), width 220:
    - "76°" at 100px DemiBold, letterSpacing −2, lineHeight 0.9;
    - "CABIN" at 13px DemiBold, letterSpacing 1.4, `textMute`, top margin 8;
    - a label/value list of three 30px rows with 1px `surface2` hairlines between them: Coolant `extTempF.toFixed(0)+"°F"`, Battery `battV.toFixed(1)+" V"`, Engine `thousands(engineHrs)+" h"`.
  - **Climate card** (spec A2), padding 16:
    - The header-left column is "CLIMATE" over a 10px dot in the `glowColor()` hue plus the status label at 18px DemiBold. Wrap that column in a MouseArea that calls `home.appShell.openMode()`.
    - Segment: 168×48, labels "ON"/"OFF", `trackColor: Theme.bg`.
    - Caption: always "SETPOINT".
    - Stepper: spacing 10; buttons 64×56, radius 12, `surface2`, no border; icon 26, stroke 2.6; value 56px, letterSpacing −1, `textWidth` 124.
    - Fan row: "FAN" over `fanSpeed%` (width 46), then a segment with height 52, font 15, labels "Auto"/"Low"/"Med"/"High" and `trackColor: Theme.bg`.
    - The option *values* stay `"AUTO"/"LOW"/"MED"/"HIGH"`, so `pickFan`/`activeFan` don't change.
- [ ] **Step 2: HeaterCard (spec A2 "HeaterCard").**
  - Height 60 (max 60, and HomeScreen's `preferredHeight`/`maximumHeight` become 60). No border; padding left 16, right 8; spacing 14.
  - One baseline row: "HEATER", then the state at 16px DemiBold, then `"VEVOR · " + heaterFanRpm + " rpm"` at 13px `textMute`, formed from the existing type tag.
  - Then "LEVEL"/"SET", then a stepper with 48×44 radius-10 `surface2` borderless buttons and a 24px value (width 34, or 52 for setpoint), then an ON/OFF segment 128×44 with `trackColor: Theme.bg`.
  - Remove the RPM/EXCH column. Keep the fault badge and the ConfirmButton CLEAR FAULT path unchanged.
- [ ] **Step 3: Add Shots steps.** Each runs with Home selected via `shell.selectRail(0)`:
  - `01c-home-fault-noevents`: `hasError=true; error="low_oil"; eventlog.events=[]; eventlog.activeCount=0`;
  - `01d-home-cleared`: `hasError=false; error="none"`;
  - `01f-home-longcode`: `hasError=true; error="compressor_overcurrent_lockout"`;
  - then restore no-fault.
- [ ] **Step 4: Run the Shots tour.** Expected:
  - `01b-home-fault.png` matches `cab/01-home-1a.png` (strip "Low Oil · Active for 4 min · Details ›", list rows, ON/OFF, SETPOINT, Auto/Low/Med/High, the 60px heater row);
  - `01c` shows the strip with no "Active for" text and the pill "1 fault";
  - `01d` shows no strip and no gap; the body row starts at the top margin;
  - in `01f` the code elides and "Details ›" stays visible;
  - `02*-heater-*` shots still render all heater states.
- [ ] **Step 5: Commit:** `feat(gobi-ui): Home fault strip, refined climate card and one-row heater card`

---

### Task 5: ModeScreen and ChoiceList (A4)

**Files:**
- Modify: `F/qml/templates/ChoiceList.qml`, `F/qml/screens/ModeScreen.qml`, `F/qml/preview/Shots.qml`

**Interfaces:** Consumes the `check` icon, `radioRing` and `AppShell.openMode()`.

- [ ] **Step 1: Fix the ChoiceList root.** Give it `anchors.fill: parent; anchors.margins: 16`. This is the bug where cards render flush to the edges.
- [ ] **Step 2: Restyle the cards (spec A4).**
  - Height 100, radius 12, padding 0×20, spacing 18, no border.
  - Fill: `surface2` when selected, otherwise `surface`.
  - Radio: 28px. Selected is a solid accent circle with a `check` icon (stroke 3, `textOnAccent`). Unselected is a 2px `radioRing` ring.
  - Title 20px: Bold accent when selected, DemiBold `text` otherwise.
  - Help 15px `textDim`.
- [ ] **Step 3: Add a header to ModeScreen.** Wrap it in an Item with a ColumnLayout: `ScreenHeader { title: "APU mode"; onBack: page.StackView.view.pop() }`, then the ChoiceList. Keep the optimistic `uiMode` logic as is.
- [ ] **Step 4: Add the Shots step `03b-mode`:** `shell.selectRail(0); shell.openMode()`. Run the tour. Expected: it matches `cab/03-mode-1a.png`, with 16px margins on the cards.
- [ ] **Step 5: Commit:** `feat(gobi-ui): reachable APU mode screen with radio cards, fix ChoiceList margins`

---

### Task 6: BatteryScreen (A3)

**Files:**
- Modify: `F/qml/screens/BatteryScreen.qml`, `F/qml/preview/Shots.qml`

**Interfaces:** Consumes `StatusLabels.battHealth` and `battModeHelp`, `Theme.okText`, and the Task 1 atom properties.

- [ ] **Step 1: Rebuild the layout following spec A3.**
  - **Hero:** value `battV.toFixed(1)` at 88px in `text` colour, followed by " V" at 44px Medium `textDim`.
  - **Status row:** the status chip plus "Ignition on/off" at 15px `textDim`.
    - Chip from `battHealth(battV)`: healthy uses an ok tint with `okText`; low uses a warn tint with `warn`; ok is `surface2`/`textDim`.
    - It is replaced by an ok-tinted "Charging" chip when `telemetry.controlStatus === "charging"`.
  - **Threshold card:** height 84; stepper buttons 60×56 `surface2` borderless; value 32px, width 108, `target.toFixed(1)+" V"`.
  - **Mode card:** title "Battery mode", the `battModeHelp(effMode)` sentence, and an "On"/"Off" segment 220×56 with `trackColor: Theme.bg`, bound to the existing `on`/`setOn`.
  - Delete `healthColor()`, `statusText()` and the old ignition column.
- [ ] **Step 2: Add Shots steps.**
  - `03-battery` exists (12.2 V, off).
  - Add `03c-battery-charging`: `mode="battery"; controlStatus="charging"; battV=13.9`.
  - Add `03d-battery-low`: `battV=11.6; controlStatus="off"; mode="off"`.
  - Then restore `battV=12.2`.
- [ ] **Step 3: Run the Shots tour.** Expected:
  - `03c` matches `cab/02-battery-1a.png`, apart from the Charging chip;
  - `03-battery` shows a neutral "OK" chip and the off copy;
  - `03d` shows the warn "Low" chip.
- [ ] **Step 4: Commit:** `feat(gobi-ui): battery hero, status chip and battery-mode card`

---

### Task 7: AlertsScreen (A5)

**Files:**
- Modify: `F/qml/screens/AlertsScreen.qml`, `F/qml/preview/Shots.qml`

**Interfaces:** Consumes `faultCount`, `activeEvent`, `faultSnapshot`, `recentCleared`, `ago`, `duration` and `Theme.faultText`/`okText`.

- [ ] **Step 1: Header.** `ScreenHeader` with title "Alerts" and subtitle `n > 0 ? n + " active" : ""`, where `n = faultCount(...)`.
- [ ] **Step 2: Fault and all-clear cards (spec A5).**
  - Fault card: `tint(fault,.18)`, padding 18×20, no border; `alert` icon 36.
    - First line: the error label at 24px Bold `faultText` (elided), then "Started " + `ago(ev.startMs, now)` at 15px `textDim`. Omit "Started" when there is no active event.
    - Then the existing message at 15px.
    - Then `faultSnapshot(ev)` at 14px `textMute`, hidden when empty.
  - All-clear card: same layout with an ok tint and the `check-circle` icon.
- [ ] **Step 3: RECENT section.**
  - Header row: "RECENT", then a right-aligned "Error log" link (15px DemiBold accent) with a chevron. The link pushes a local `Component { ErrorLogScreen {} }` via `page.StackView.view.push(...)`.
  - Rows come from `recentCleared(eventlog.events, 2)`. Each is 52 high, radius 10, `surface`, with an 8px `textMute` dot, the error label at 16px DemiBold, and right-aligned `ago(startMs) + " · lasted " + duration(endMs - startMs)` at 14px `textDim`.
  - When there are no rows, show "No earlier alerts" at 15px `textDim`.
- [ ] **Step 4: Run the Shots tour.** Expected:
  - `09-alerts-fault` (after `eventlog.sample()`) matches `cab/04-alerts-1a.png`;
  - `08-alerts` shows the all-clear card and "No earlier alerts", or the cleared rows if the sample is loaded.
  - Move the `eventlog.sample()` call earlier if needed so `09` has events.
- [ ] **Step 5: Commit:** `feat(gobi-ui): alerts card with fault snapshot and recent cleared faults`

---

### Task 8: MenuScreen and TileGrid single page (A6)

**Files:**
- Modify: `F/qml/templates/TileGrid.qml`, `F/qml/screens/MenuScreen.qml`, `F/qml/preview/Shots.qml` (remove `findSwipe`/`menuPage2` and the `21i-menu-p2` step that uses them)

**Interfaces:**
- Consumes: `PinTag`, `faultCount`.
- Produces: TileGrid API `property var tiles: []` (flat), `property int columns: 4`, `property var counts: ({})` (keyed by tile `target`) and `signal opened(string target)`. The `pages` property and the SwipeView are removed.

- [ ] **Step 1: TileGrid.**
  - GridLayout with 4 columns, spacing 12, margins 16. Tiles fill their cells (about 155×128), radius 14, `surface`.
  - Content: icon 30 accent and title 15px Medium, spacing 10.
  - A tile with `locked: true` shows a `PinTag` (top-right, 10 inset) instead of the lock icon.
  - When `(counts[target] || 0) > 0`:
    - fill `tint(fault,.18)`;
    - icon in `faultText`;
    - title DemiBold;
    - `counts[target] + " active"` at 13px Bold `faultText`, top-right with a 10px inset.
- [ ] **Step 2: Set the tile order in MenuScreen** to Alerts, Error Log, Live Diagnostics, Unit Information / WiFi, Cloud Connection, Settings, Screen Lock / User Maintenance, Maintenance (locked), Component Test (locked), Support. Bind `counts: ({ alerts: StatusLabels.faultCount(telemetry.hasError, eventlog.activeCount) })`.
- [ ] **Step 3: Add the Shots step `04b-menu-fault`** (fault state on, Menu selected). Run the tour. Expected:
  - `04b` matches `cab/05-menu-1a.png`: 12 tiles on one page, the Alerts tile tinted with "1 active", and PIN tags on Maintenance and Component Test;
  - `04-menu` shows a neutral Alerts tile.
- [ ] **Step 4: Commit:** `feat(gobi-ui): single-page menu grid ordered by purpose, alert tile state, PIN tags`

---

### Task 9: Wi-Fi join, TextKeyboard and Wi-Fi rows (A7, A0 Wi-Fi rows)

**Files:**
- Modify: `F/qml/screens/WifiJoinScreen.qml`, `F/qml/atoms/TextKeyboard.qml`, `F/qml/screens/WifiScreen.qml` (row border only)

**Interfaces:** Consumes `Theme.keyFill`. TextKeyboard keeps its public API: `target`, `done()` and the `implicitHeight` formula with 54 instead of 52.

- [ ] **Step 1: WifiJoinScreen (spec A7).**
  - ScreenHeader shows the title only. Errors go in the subtitle in `fault` at 14px.
  - **Password field:** height 52, radius 10, `surface`. When focused it gets a 2px inset accent ring, or a fault ring on error. Padding 0 6 0 16.
    - Text at 18px, letterSpacing 3.
    - `len + " / 8 min"` at 14px `warn`, tabular, visible while `secured && len > 0 && len < 8`.
    - A 56×40 borderless Show/Hide button inside the field (15px DemiBold accent).
  - **Connect:** 140×52, radius 10. Disabled: `surface2` with `textMute`. Enabled: accent with `textOnAccent`, 17px DemiBold.
  - The hidden-network variant (`hidden: true`) keeps its name field with the same styling.
- [ ] **Step 2: TextKeyboard.**
  - Keys 60×54, radius 9, fill `keyFill`, no border. Letters 23px Medium; label keys 15px. Spacing 6.
  - The space key label is "Space". Done keeps its accent fill.
  - `implicitHeight: 4 * 54 + 3 * 6 + 12`.
- [ ] **Step 3: WifiScreen rows.** Remove the accent border on the in-use row and keep its tint. No other WifiScreen changes.
- [ ] **Step 4: Run the Shots tour.** Expected:
  - `21f-wifi-join` matches `cab/06-wifi-join-1a.png`;
  - `21f2`, `21g*`, `21d` and the Wi-Fi list shots render cleanly;
  - the in-use row has a tint and no outline.
- [ ] **Step 5: Commit:** `feat(gobi-ui): Wi-Fi join field and borderless keyboard; drop Wi-Fi row outline`

---

### Task 10: SettingsScreen and MaintenanceScreen (A8, A9)

**Files:**
- Modify: `F/qml/screens/SettingsScreen.qml`, `F/qml/screens/MaintenanceScreen.qml`

**Interfaces:** Consumes the `PinTag`, `SegmentedControl.trackColor` and StepButton `w`/`h`.

- [ ] **Step 1: Settings (spec A8).**
  - **Display card:**
    - Brightness row: label width 104; StepButton − (52×52, −5); slider with a 14px track, radius 7, `bg` track, accent fill, and a 36px `text`-colour handle with no border; StepButton + (52×52, +5); right-aligned value `brightness + "%"` at 18px DemiBold, width 50.
    - Sleep row: label "Sleep after" and a segment with height 52, `trackColor: Theme.bg`, Never / 1 min / 5 min / 10 min / 30 min.
    - The help line below, indented 116.
    - Keep the existing `display.brightness` / `display.sleepMinutes` writes and the 10–100 clamp.
  - **About card:** Firmware and Serial only. Rows are 44 high at 15px.
- [ ] **Step 2: Maintenance (spec A9).**
  - ScreenHeader "Maintenance" / "Technician tools".
  - Two 80-high primary rows:
    - **Component Test:** with a PinTag and the description "Actuate relays one at a time".
    - **Software Update:** with `telemetry.otaAvailable + " available"` at 13px DemiBold accent beside the title, shown when `otaAvailable !== ""`.
  - "ALSO IN MENU" label.
  - Two compact cards (each half width, height 60): Live Diagnostics and User Maintenance. They push the same screens the Menu does; reuse the existing components or routes in this file.
- [ ] **Step 3: Run the Shots tour.** Expected: `11-settings` matches `cab/07-settings-1a.png`, and `14-maintenance` matches `cab/08-maintenance-1a.png`. To see the accent "available" text, add the Shots step `14e-maintenance-update` with `otaAvailable = "1.2.74"`, then reset it.
- [ ] **Step 4: Commit:** `feat(gobi-ui): settings display card and maintenance tool rows`

---

### Task 11: DiagnosticsScreen (A10)

**Files:**
- Modify: `F/qml/screens/DiagnosticsScreen.qml`

**Interfaces:** Consumes `StatusLabels.ago` and `Theme.faultText`.

- [ ] **Step 1: Header freshness.** Add a right-aligned 8px ok dot plus `"Updated " + StatusLabels.ago(telemetry.tsMs, now)` at 14px `textDim`. Hide it when `ago()` returns "". `now` comes from a 1 s Timer.
- [ ] **Step 2: Sections and tiles (spec A10).**
  - Section labels: 13px, letterSpacing 1.2, `textMute`.
  - Grid: 5 columns, spacing 8.
  - Tiles: height 60, radius 12; label 13px `textDim` (elided); value 20px DemiBold.
  - **Fault tiles** (Error ≠ none, Oil Pressure LOW, Oil Change ≠ good): `tint(fault,.18)` fill, `text` label, `faultText` value, no border.
  - In CLIMATE, merge Cabin Temp and Enclosure Temp into one tile, "Cabin (enclosure sensor)", with `Layout.columnSpan: 2`. Then Setpoint, Coolant and Fan Speed.
- [ ] **Step 3: Run the Shots tour.** Expected: `05-diagnostics` matches `cab/09-diagnostics-1a.png` and still fits one page with no scroll. Add the step `05b-diagnostics-fault` (fault on, `oilOk=false`) and confirm the tinted fault tiles.
- [ ] **Step 4: Commit:** `feat(gobi-ui): diagnostics freshness, fault tint tiles, merged cabin sensor tile`

---

### Task 12: SoftwareUpdateScreen and ConfirmButton `filled` (A11)

**Files:**
- Modify: `F/qml/atoms/ConfirmButton.qml`, `F/qml/screens/SoftwareUpdateScreen.qml`

**Interfaces (Produces):** `ConfirmButton` gains:
- `property bool filled: false`. When it is true, the idle state is a solid `tone` fill with `textOnAccent` text and no border, and the armed state is `Qt.darker(tone, 1.15)` showing `confirmLabel`;
- `property int fontSize: Theme.fsLabel + 1`.

Callers can override `Layout.preferredWidth` and `Layout.preferredHeight`. Unfilled behaviour is unchanged.

- [ ] **Step 1: Add the ConfirmButton properties.**
- [ ] **Step 2: Rebuild the SoftwareUpdate card (spec A11).**
  - Card padding 20, spacing 18.
  - **Row 1:**
    - INSTALLED column: version at 30px DemiBold.
    - AVAILABLE column (accent version) when an update is available; otherwise the existing `statusText()` in `statusColor()`.
    - Bottom-right: "Checked " + `ago(otaCheckTs)` at 14px `textDim`.
  - **Row 2:**
    - Install: `ConfirmButton { filled: true; tone: Theme.accent; Layout.fillWidth: true; Layout.preferredHeight: 56; radius: 12; fontSize: 18 }` with label `"Install " + v` and confirmLabel "Tap again to install". Keep the existing confirmed handler.
    - "Check again": 180×56, `surface2`, 16px DemiBold.
  - The restart notice moves inside the card at 15px `textDim`.
- [ ] **Step 3: Run the Shots tour.** Expected:
  - `14c-swupdate-available` matches `cab/10-software-update-1a.png`;
  - `14b` and `14d` render their states;
  - WifiSaved Forget and HeaterCard CLEAR FAULT look unchanged in their shots, including the `armAll` armed previews.
- [ ] **Step 4: Commit:** `feat(gobi-ui): software update card with filled two-tap install button`

---

### Task 13: LockOverlay and Keypad (A12)

**Files:**
- Modify: `F/qml/LockOverlay.qml`, `F/qml/atoms/Keypad.qml`, `F/qml/preview/Shots.qml`

**Interfaces (Produces):**
- `Keypad` gains the following properties, whose defaults match today's look:
  - `keyW: 84`, `keyH: 56`, `keyFill: Theme.surface`, `showBorder: true`;
  - `backFill: keyFill`;
  - `dotSize: 14`, `dotSpacing: 16`;
  - `dotFilledStyle: false`. When it is true, dots are filled discs: `hue` when entered, `Theme.border` when empty, with no ring.
- `Keypad` also gains `function shake()`, which offsets the dot row x by ±8 for 3 cycles over 300 ms in total.

- [ ] **Step 1: Add the Keypad properties and `shake()`.** ComponentTestScreen and ScreenLockScreen keep the defaults.
- [ ] **Step 2: Build the LockOverlay two-column layout (spec A12).**
  - **Left side** (380 wide, padding 44×40):
    - lock icon plus "Screen locked";
    - clock `Qt.formatDateTime(now,"h:mm")` at 72px, plus " " + `"AP"` at 28px Medium `textDim`;
    - date `"ddd MMM d"` at 16px.
    - Pinned to the bottom:
      - a 10px dot in the control hue plus `"Cabin " + cabinTempF.toFixed(0) + "° · " + StatusLabels.climateLine(on, controlStatus, Math.round(clmtSetpointF))` at 17px. Here `on` is `telemetry.mode !== "off"`; copy Home's `glowColor()` mapping for the hue into this file.
      - When `hasError`, a fault chip: height 40, `tint(fault,.18)`, alert icon 18, error label 16px Bold `faultText` (elided), "active" 14px `textDim`.
  - **Right side** (`lockPanel` fill): "Enter PIN" at 16px `textDim`, then a Keypad with keys 96×64, `keyFill: Theme.surface2`, no border, `backFill: "transparent"`, digits 28px, `dotSize: 16`, `dotSpacing: 18`, `dotFilledStyle: true`.
  - On a wrong PIN, the hint becomes "Wrong PIN — try again" in `fault` and `pad.shake()` runs.
- [ ] **Step 3: Add the Shots step `18b-lockoverlay-fault`** (fault on, climate cooling, setpoint 70). Run the tour. Expected:
  - `18b` matches `cab/11-lock-1a.png`;
  - `18-lockoverlay` shows no chip;
  - `13-screenlock` and `15/16-comptest` Keypads are unchanged.
- [ ] **Step 4: Commit:** `feat(gobi-ui): two-column lock screen with status line, fault chip and filled PIN dots`

---

### Task 14: Final sweep

**Files:**
- Modify only if a check fails: anything already touched, and `gobi-ui_1.0.bb`.

- [ ] **Step 1: Recipe completeness.** Every `.qml` under `F/qml` (excluding `preview/`) must appear in `SRC_URI`:
  ```bash
  cd $F && for f in $(find qml -name '*.qml' -not -path 'qml/preview/*'); do grep -q "file://$f " ../gobi-ui_1.0.bb || echo MISSING $f; done
  ```
  Expected: no output.
- [ ] **Step 2: Grep the invariants.** Each command should produce no output:
  - `grep -rn "fsCaption - 1" $F/qml`
  - `grep -rn "SequentialAnimation on opacity" $F/qml/screens`
  - `grep -n "border.color: sel ? Theme.accent" $F/qml/templates`
  - `grep -n "color: Theme.warn" $F/qml/templates/TileGrid.qml`
- [ ] **Step 3: Run the QML tests and the full Shots tour.** Expected: 0 failed and clean stderr. Compare every 1a reference against its shot:
  `01b`↔01-home, `03c`↔02-battery, `03b`↔03-mode, `09`↔04-alerts, `04b`↔05-menu, `21f-wifi-join`↔06, `11`↔07, `14`↔08, `05`↔09, `14c`↔10, `18b`↔11.
- [ ] **Step 4: Run the C++ host tests**, which must stay green:
  `cmake -S $F/tests -B /tmp/gobi-ui-tests -DCMAKE_PREFIX_PATH=/opt/homebrew/opt/qt && cmake --build /tmp/gobi-ui-tests && ctest --test-dir /tmp/gobi-ui-tests --output-on-failure`.
- [ ] **Step 5: Commit any fixes:** `chore(gobi-ui): 1a refresh sweep`
