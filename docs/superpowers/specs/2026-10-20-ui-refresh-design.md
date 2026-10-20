# Handoff: Cortex cab panel + EcoFleet admin site refinement

## Overview
This handoff is a refinement pass on the two user interfaces in the `cortex-yocto` repo. It does not redesign either UI.

1. **Cab panel**: the Qt/QML app at `meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/`. It runs on a fixed 800×480 canvas that ScaleRoot letterbox-scales to the panel.
2. **Admin site**: the Vite + React SPA at `cloud/frontend/src/`.

Routes, information architecture, component structure and existing tokens all stay the same. The work covers:
- legibility (13px type floor),
- hierarchy (each status appears once per screen),
- one selection treatment,
- a global fault indicator on the cab panel,
- consistent tables and badges on the admin site,
- night-driving comfort on the cab panel.

Two directions were explored for each UI. **Implement direction 1a (Refined) first.** Direction 1b is Phase 2 and optional:
- Cab panel 1b: a night palette.
- Admin site 1b: a topbar scope selector and table views.

Both are specified below so they can be scheduled separately.

## About the design files
The `.dc.html` files in this folder are **design references built in HTML**. They show the intended look and behaviour and are not production code to copy. Rebuild these designs in the repo's existing stack:
- **Cab panel**: QML using the existing `Theme` singleton, atoms and templates.
- **Admin site**: React using `index.css` classes and CSS variables, `@tabler/icons-react`, and the existing hooks and components.

Open `Cab Panel Review.dc.html` and `Admin Site Review.dc.html` in a browser. Each row is one screen and has three columns:
- **CURRENT**: rebuilt from source, for comparison.
- **1a**: the refined version.
- **1b**: the Phase 2 version.

Numbered notes under each frame list the issues found and the changes made.

## Fidelity
**High fidelity.** Colours, sizes and spacing are final, and the values below are exact. Data in the mocks comes from `qml/preview/Mocks.qml` and `cloud/frontend/src/api/mock.js`. The scenario is 9:41 PM, APU cooling, with an active `low_oil` fault.

---

# Part A — Cab panel (gobi-ui, QML)

All sizes are in px on the 800×480 canvas. The shell is unchanged: header 40px high, rail 112px wide, content area 688×440.

## A0. Theme.qml changes

Add these tokens. They are used by 1a.
```
fsCaption:     12 → 13       // new floor; remove every "fsCaption - 1" (11px) usage
faultText:     "#FF7B72"     // fault-coloured TEXT on a fault tint (better contrast than #F85149)
okText:        "#56D364"     // ok-coloured text on an ok tint
radioRing:     "#4A5361"     // unselected radio ring
keyFill:       "#1F252E"     // TextKeyboard key fill (no border)
lockPanel:     "#141820"     // keypad side of LockOverlay
```
**Selection rule (enforce everywhere):** show selection with a fill, never an outline.
- Segmented controls: solid `accent` fill with `textOnAccent` text, on a track whose colour is `bg` (inset) when the control sits on a `surface` card.
- Lists: the selected item uses a `surface2` fill.

Remove these outlines: the 2px accent border in ChoiceList, and the accent border plus tint on Wi-Fi rows (keep only the tint for the in-use row).

**Status colours are status only.** Lock icons on tiles and rows change from `warn` to a neutral **PIN tag**:
- 12px Bold, letter-spacing 0.8
- `textDim` text on `surface2`
- radius 5, padding 2×6
- top-right, 10px inset

### Phase 2 (1b) night palette
Add it as an alternate palette, e.g. `Theme.night: bool` switching the colour properties:
```
bg #0A0C0F   surface #16191E   surface2 #22262D   border #30353D (rail/header hairline #262A31)
text #E6E3DC   textDim #C2BEB5   textMute #9A968D   (inactive rail/seg labels #A9A59C)
accent #3CC29D   selFill #1F3B33   selText #5CD3AF   (selection = selFill + selText, NOT solid accent)
ok #4CB35E (text #6CC77B)   warn #D9AE48   fault #F0625A (text #F47A72)   info #6AA6E8
lockPanel #111317   heroText #DAD6CE (hero numbers use Font.Medium, not DemiBold)
```
In night mode the Header and Rail fill with `bg`, not `surface`, so only cards are lit. The logo drops to opacity 0.8, and Wi-Fi bars use `textDim`, not accent. Fault fills use `tint(fault, 0.15)` and the header fault pill uses `tint(fault, 0.22)` with `fault` text. **Product decision needed:** what switches night mode (a manual toggle, the clock, or the Night brightness preset; see A7).

## A1. Global fault indicator (new; the main functional gap)
Today an active fault shows only under Menu → Alerts. Home, Header and Rail have no fault state. Add it in three places, all driven by `telemetry.hasError` and `eventlog.activeCount`.

**Header.qml** (1a)
- Left padding 20, logo height 22.
- Right-hand row, spacing 18, in this order:
  1. **Fault pill**: visible when `hasError`. Height 28, radius 14, fill `Theme.fault`. Content is the `alert` icon (15px, stroke 2.6, colour `#2A0705`) plus the text "N fault" (13px Bold, `#2A0705`). Tap → AlertsScreen.
  2. **APU status**: dot 9px plus label "APU live" / "No APU data" at 14px (`textDim`; fault colour when stale).
  3. **Wi-Fi**: bars only (unit 4, heights 6/9/12/15), tap opens Wi-Fi as today.
  4. **Clock**: `"h:mm AP"`, 16px DemiBold, `Theme.text`, tabular figures. The date is dropped to make room for the pill.

**Rail.qml**
- Padding 12 top, 10 sides; item height 84; spacing 8.
- Inactive icon and label colour `textDim` (was `textMute`); label 15px.
- Active item: `tint(accent, 0.18)` fill, radius 12, icon stroke 2.4, label DemiBold.
- **Badge on Menu**: an 18px circle filled `fault`, holding `activeCount` at 12px Bold `#2A0705`, anchored top 10 / right 18 inside the item.

**HomeScreen.qml: fault strip** (replaces the glow bar)
- Shown only while `hasError`. Height 48, radius 10, fill `tint(fault, 0.18)`, no border, padding 0×14, spacing 12.
- Contents, left to right:
  - `alert` icon, 22px, `fault`;
  - `StatusLabels.error(telemetry.error)` at 17px Bold, `faultText`;
  - "Active for N min" at 14px, `textDim`, filling the remaining width (N from the active eventlog event's `startMs`, formatted with `StatusLabels.ago`);
  - "Details" at 15px DemiBold, `text`, plus a `chevron-right` icon (20px).
- Tap → AlertsScreen.
- With no fault, nothing is shown: the status lives in the climate card.
- **Remove the glow bar and its pulse animation entirely.**

## A2. HomeScreen.qml + HeaterCard.qml
Layout is a ColumnLayout with margins 16 and spacing 12: [fault strip] → body row (spacing 12) → heater card.

**Left column**: width 220.
- Cabin reading `"76°"`: 100px DemiBold, letter-spacing −2, lineHeight 0.9, `text`.
- "CABIN": 13px DemiBold, letter-spacing 1.4, `textMute`, top margin 8.
- Bottom: the passive stats become a **label/value list** (padding 0×8). Three rows, each 30px high: label at 14px `textMute` on the left, value at 16px DemiBold `text` on the right. A 1px `surface2` hairline sits between rows. Rows: Coolant `extTempF°F`, Battery `battV.toFixed(1) V`, Engine `engineHrs h` (thousands separator).

**Climate card**: `surface` fill, radius 12, padding 16, children spread with space-between.
- Header row:
  - left: "CLIMATE" (13px caps, `textMute`) over a status row: a 10px dot in the `glowColor(controlStatus)` hue plus `StatusLabels.control(...)` at 18px DemiBold `text`. Show "Off" in `textMute` when off.
  - right: SegmentedControl 168×48 with labels **"ON" / "OFF"**, renamed from AUTO/OFF. Behaviour is unchanged: ON still calls `setAuto(true)`, which also sets fan auto.
- Middle: caption is always **"SETPOINT"** (13px caps; drop the `caption()` function). Stepper spacing 10:
  - StepButtons 64×56, radius 12, fill `surface2`, **no border**, icon 26px stroke 2.6 in accent;
  - value 56px DemiBold, letter-spacing −1, width 124.
- Fan row:
  - "FAN" (13px caps) over `fanSpeed%` (15px DemiBold `textDim`), width 46;
  - SegmentedControl, filling the width, height 52, font 15, labels **"Auto / Low / Med / High"** (sentence case), track colour `bg`.

**HeaterCard**
- Height 60 (max 60), `surface`, radius 12, **no border**, padding left 16 / right 8, spacing 14.
- One baseline row:
  - "HEATER" (13px caps `textMute`);
  - state at 16px DemiBold (existing `stateColor`);
  - "VEVOR · N rpm" at 13px `textMute`, formed from `typeTag` and `heaterFanRpm`;
  - keep the fault badge logic.
- Then "LEVEL"/"SET" (13px caps).
- Stepper: buttons 48×44, radius 10, `surface2`, no border; value 24px, width 34 (52 for setpoint).
- ON/OFF segment 128×44, track `bg`.
- The ConfirmButton CLEAR FAULT path is unchanged.
- Remove the RPM/EXCH column; RPM moves inline. EXCH stays on Diagnostics.

**Atom changes these require**
- `SegmentedControl`: add `trackColor` (default `Theme.surface`), `showBorder` (default true; false when `trackColor === Theme.bg`), and `radius` overridable. Selected text stays `textOnAccent`.
- `StepButton`: add `w`, `h` and `fill` properties (default 52×48, `surface`), and `showBorder` (default true). 1a uses `surface2` with no border on cards.

## A3. BatteryScreen.qml
- **Hero** (centred, spacing 10):
  - "TRUCK BATTERY" 13px caps;
  - value `battV.toFixed(1)` at 88px DemiBold, letter-spacing −1.5, `text` (not health-coloured), followed by " V" at 44px Medium `textDim`;
  - row (spacing 12): status chip plus "Ignition on/off" at 15px `textDim`.
- **Status chip**: height 30, radius 15, padding 0×12, 8px dot plus 15px DemiBold label:
  - battV ≥ 12.4: "Healthy" (`tint(ok, .16)` fill, `okText`);
  - battV < 11.8: "Low", in warn;
  - otherwise "OK", neutral (`surface2` fill, `textDim`).
- **Threshold card**: height 84, `surface`, radius 12, padding 0 12 0 18.
  - Title "Auto-charge below" at 17px DemiBold `text`; helper "APU starts to recharge when the battery drops below this" at 14px `textDim`.
  - Stepper: buttons 60×56 `surface2` without border; value 32px, width 108, `"12.0 V"`.
- **Mode card** (new; replaces the bare BATTERY ON/OFF segment and the ignition column): same card style.
  - Title "Battery mode" with a dynamic sentence at 14px `textDim`:
    - effMode `climate` → "Climate mode is running. On switches the APU to Battery mode."
    - effMode `battery` → "Runs the APU only to keep the truck battery charged."
    - effMode `off` → "APU stays off. On starts it in Battery mode." (copy to confirm)
  - SegmentedControl 220×56 "On"/"Off", track `bg`.
- Keep the CHARGING indicator: a chip "Charging" with an ok tint, shown when `controlStatus === "charging"`, in place of the health chip.

## A4. ModeScreen.qml / templates/ChoiceList.qml
- **Bug:** ChoiceList sets `anchors.margins: 16` without `anchors.fill`, so cards render flush to the edges. Fix it by giving the root `anchors.fill: parent; anchors.margins: 16`, or by wrapping it in an Item.
- **Bug / product:** `modeC` is declared in `main.qml` but nothing pushes it, so the screen is unreachable. Proposal: tapping the CLIMATE label area on Home pushes ModeScreen. Confirm with product.
- Add `ScreenHeader { title: "APU mode" }` at the top.
- Cards: height 100, radius 12, padding 0×20, spacing 18.
  - Radio: 28px circle. Selected: solid accent with a check (stroke 3, `textOnAccent`). Unselected: 2px `radioRing`.
  - Title 20px (selected: Bold accent; others: DemiBold `text`).
  - Help 15px `textDim`.
  - Selected card fill `surface2`; others `surface`. **No borders.**

## A5. AlertsScreen.qml
- ScreenHeader title "Alerts", subtitle "N active" (13px).
- **Fault card** (when `hasError`): `tint(fault, .18)` fill, radius 12, padding 18×20, no border, spacing 18.
  - `alert` icon 36px.
  - Column (spacing 6):
    - baseline row: error label at 24px Bold `faultText`, then "Started X" at 15px `textDim`;
    - existing message at 15px `text`;
    - snapshot line at 14px `textMute`: `"At fault: {mode} · {controlStatus} · {rpm} rpm · {battV} V · coolant {coolantF}°F"`, built from the active `eventlog` event fields.
- **All-clear card**: same layout, ok tint, `check-circle` icon, existing copy.
- **RECENT** section:
  - header row: "RECENT" (13px caps), then a right-aligned link "Error log" (15px DemiBold accent) with a chevron → push ErrorLogScreen;
  - list of the last 2 *cleared* events, each row 52 high, radius 10, `surface`, padding 0×16, spacing 14;
  - row content: 8px `textMute` dot, `StatusLabels.error(code)` at 16px DemiBold, `"{ago} · lasted {duration}"` at 14px `textDim` (`StatusLabels.ago` / `duration`).

## A6. MenuScreen.qml / templates/TileGrid.qml
- **Single page**: GridLayout with 4 columns, 3 rows, spacing 12, margins 16. Remove the SwipeView and page dots (or keep TileGrid generic and pass one page).
- Tiles are about 155×128, radius 14, `surface`. Content: icon 30px accent, title 15px Medium, spacing 10.
- **Order**, by purpose:
  - Row 1: Alerts, Error Log, Live Diagnostics, Unit Information
  - Row 2: WiFi, Cloud Connection, Settings, Screen Lock
  - Row 3: User Maintenance, Maintenance (PIN), Component Test (PIN), Support
- **Alerts tile while active**: fill `tint(fault, .18)`, icon `faultText`, title DemiBold, "N active" at 13px Bold `faultText` top-right (10px inset).
- Locked tiles show the PIN tag (A0), not the yellow lock.

## A7. WifiJoinScreen.qml / atoms/TextKeyboard.qml
- ScreenHeader shows the title only. Errors still use the subtitle slot, in `fault`, at 14px.
- **Password field**: height 52, radius 10, `surface`, 2px inset accent ring when focused (fault ring on error). Padding 0 6 0 16, spacing 8. Contents:
  - text at 18px, letter-spacing 3;
  - length hint `"{len} / 8 min"` at 14px `warn`, tabular, shown while `secured && 0 < len < 8`;
  - Show/Hide as a 56×40 borderless button *inside* the field (15px DemiBold accent).
- **Connect**: 140×52, radius 10. Disabled: `surface2` fill with `textMute` text. Enabled: accent fill with `textOnAccent` text, 17px DemiBold.
- **Keyboard**:
  - Letter keys 60×54, radius 9, fill `keyFill`, **no border**; letters 23px Medium; label keys 15px.
  - Spacing 6 (10 keys = 654px wide).
  - Space key label **"Space"**.
  - Done keeps accent fill.
  - Total height is 4×54 + 3×6 + 12.
- Night: keys `#16191E`, letters `#DAD6CE`, focus ring `#2E8C72`, Done uses selFill/selText.

## A8. SettingsScreen.qml
**Display card**: `surface`, radius 12, padding 16×18, spacing 12.
- **Brightness row** (spacing 12), left to right:
  - label "Brightness" at 16px `text`, width 104;
  - StepButton − (52×52, step −5);
  - Slider: track 14px tall, radius 7, track colour `bg`, fill accent; handle a 36px circle in `text` colour with no border;
  - StepButton + (52×52, step +5);
  - value `"80%"` at 18px DemiBold, width 50, right-aligned.
- **Sleep row**: label "Sleep after" (16px), SegmentedControl height 52 with track `bg` (Never / 1 min / 5 min / 10 min / 30 min).
- **Help**: "Dims 30 s before sleeping. Tap to wake. Stays on while a fault is active." at 14px `textDim`, left-indented 116.

**About card**: Firmware and Serial only, rows 44 high at 15px (label `textDim`, value `text`). Hostname stays on Unit Information.

**Phase 2 (1b) proposal**: add a "Brightness" preset SegmentedControl above the slider: **Day · 100% / Dusk · 50% / Night · 15%**. The values are placeholders to be tuned on real glass. It sets `display.brightness`, and the slider remains for fine adjustment. The About card collapses to a footer line ("Firmware v… Serial …", 14px `textMute`).

## A9. MaintenanceScreen.qml
- ScreenHeader "Maintenance" / "Technician tools".
- **Two primary rows**: height 80, radius 12, padding 0 14 0 18, spacing 16. Each row: icon 30, a column with title 18px DemiBold and description 14px `textDim`, then a chevron (`textDim`). Rows:
  1. Component Test, with the PIN tag; description "Actuate relays one at a time". The passcode note moves out of the description so it no longer elides.
  2. Software Update; when `otaAvailable !== ""` show "{version} available" at 13px DemiBold accent next to the title.
- "ALSO IN MENU" label (13px caps, top margin 6).
- Below it, a row of two compact cards (each filling half the width, height 60, radius 12, padding 0×16): icon 24 + title 16px DemiBold + chevron. Cards: Live Diagnostics and User Maintenance.

## A10. DiagnosticsScreen.qml
- **Header**: add a right-aligned freshness label: 8px ok dot plus "Updated Ns ago" at 14px `textDim`, from `telemetry.tsMs`.
- **Sections**: label 13px, letter-spacing 1.2, `textMute`; spacing 5; grid of 5 columns, spacing 8.
- **Tiles**: height 60, radius 12, `surface`, padding 0 10 0 14. Label 13px `textDim` (elide); value 20px DemiBold `text`.
- **Fault tiles** (Error, Oil Pressure LOW, Oil Change ≠ good): fill `tint(fault, .18)`, label `text`, value `faultText`, **no border**.
- **CLIMATE section**: Cabin Temp and Enclosure Temp read the same sensor. Merge them into one tile, **"Cabin (enclosure sensor)"**, with columnSpan 2, followed by Setpoint, Coolant and Fan Speed.

## A11. SoftwareUpdateScreen.qml / atoms/ConfirmButton.qml
**Card**: `surface`, radius 12, padding 20, spacing 18.
- **Row 1**:
  - INSTALLED column: label 13px caps; version 30px DemiBold `text`.
  - AVAILABLE column, when `available`: version in accent.
  - Bottom-right: "Checked X ago" at 14px `textDim`.
  - Without an update, replace the AVAILABLE column with the existing `statusText()` in `statusColor()`.
- **Row 2** (spacing 12):
  - **Install** fills the width: height 56, radius 12, solid accent, `"Install {v}"` at 18px Bold `textOnAccent`. Keep the two-tap behaviour, with armed label "Tap again to install".
  - **Check again**: 180×56, `surface2`, 16px DemiBold `text`.
- The restart notice moves inside the card, at 15px `textDim`.

**ConfirmButton**: add `filled: bool`. When true, the idle state is a solid `tone` fill with `textOnAccent` text; the armed state darkens it with `Qt.darker(tone, 1.15)` and switches to the confirm label.

## A12. LockOverlay.qml / atoms/Keypad.qml
Two columns across the full 800×480:
- **Left** (width 380, padding 44×40, spacing 6):
  - row with lock icon (22px `textDim`) and "Screen locked" (16px DemiBold `textDim`);
  - clock `"9:41"` at 72px DemiBold, letter-spacing −2, plus " PM" at 28px Medium `textDim`, top margin 18;
  - date `"ddd MMM d"` at 16px `textDim`;
  - pinned to the bottom (spacing 10):
    - status line: 10px dot in the control hue plus `"Cabin {cabin}° · {status lower} {setpoint}°"` at 17px `text`;
    - when `hasError`, a fault chip: height 40, radius 10, `tint(fault,.18)`, icon 18, error label 16px Bold `faultText`, "active" 14px `textDim`.
  - The left side is read-only; no touch targets.
- **Right**: fills the remaining width, fill `lockPanel`, centred column, spacing 20.
  - "Enter PIN" at 16px `textDim`.
  - Dots: 16px, spacing 18; filled = accent, empty = `border` colour (filled discs, not rings).
  - Keypad 3×4: keys 96×64, spacing 10, fill `surface2`, no border, digits 28px Medium; the backspace key is transparent.
- **Wrong PIN**: hint text switches to "Wrong PIN — try again" in `fault`. Suggested addition: shake the dots row (±8px on x, 3 cycles, 300 ms total).
- **Keypad** gets new props: `keyW`, `keyH`, `keyFill`, `showBorder`, `dotSize`, `dotFilledStyle`.

## A13. Interactions and behaviour (cab)
- Every new tap target is at least 48px; most are 52–64px.
- Fault strip, header pill, Menu badge and Alerts tile all navigate to AlertsScreen. When a fault clears they disappear on the next `dataChanged`.
- No continuous animations anywhere: remove the glow pulse. Keep the existing 120 ms segment colour animation.
- Keep every optimistic, debounced and reconcile idiom exactly as it is. These are visual changes only, except the label renames, the Mode route and the merged diagnostics tile.

---

# Part B — Admin site (cloud/frontend, React)

Desktop reference is 1280×800 (`navMode` "full", sidebar 232). Keep the `rail` and `drawer` modes working: the same changes apply, and labels move into the title/aria attributes as they do today. Font: IBM Plex Sans (already loaded).

## B0. index.css
**New tokens**
```css
:root                { --accent-text:#0A6E97; --accent-soft:#E3F3FA; }
:root[data-theme=dark]{ --accent-text:#5CC6EC; --accent-soft:rgba(18,165,214,.16); }
```
**Contrast fix**
- Every place that uses `--accent` (#12A5D6) as **text on white** (≈2.9:1) switches to `--accent-text`: the active nav item, `.tab.on`, the "View unit" link and `.map-hint`.
- `--accent` stays for fills, borders and focus rings.

**Type floor: 13px.** Raise:
- `.scard-lbl` and `.scard-sub` (10.5 → 13);
- `.uid` (12.5 → 14), `.umeta` (11 → 13), `.uval` (11.5 → 13);
- `.atitle` (12.5 → 14), `.asub` and `.atime` (→ 13);
- `.tunit` (10 → 13);
- `.rbadge` (11 → 12).

**Tables**
- Add `.dtbl td.num, .dtbl th.num { text-align:right; }`.
- Add `.dtbl.roomy td { padding: 12px 14px }` for list pages, and `.dtbl th { padding: 10px 14px }` in panels.
- Use this table style everywhere. Remove the inline table styles on Users and History.

**One badge system**
- Use `.badge` / `.badge-sm` with `t-err | t-warn | t-ok | t-off` everywhere.
- Retire `.pill` / `.p-*` from APUHistoryPage and UsersPage. Keep `.p-*` only where `contract.js` returns `cls` (`connLabel`, `otaStatusView`), or migrate those to tones.

**Hard-coded colours** to replace with tokens: `#E24B4A` in LoginPage, APUHistoryPage and UsersPage (→ `var(--err)`), and `#1D9E75` in UsersPage (→ `var(--ok)`).

## B1. Layout.jsx
- **Sidebar header**: logo height 40. **Move the email out of the header.**
- **Sidebar footer** (replaces the plain Sign out row): padding 12 12 12 16, border-top 0.5px `--color-border-tertiary`, gap 10. Contents:
  - 32px avatar circle with initials, coloured by role (`.rb-*` colours);
  - column of email (13px, ellipsis) and role label (12px 600 in the role colour);
  - 36px icon button with `IconLogout` (aria-label "Sign out").
- **Active nav item**: `background: var(--accent-soft); color: var(--accent-text); font-weight:600`. Previously it was `--color-background-primary`, which is nearly invisible on `--color-background-secondary`.
- **Topbar**:
  - Remove the `.rbadge`; the role now lives in the sidebar footer.
  - The role `<select>` becomes a ghost control reading `[DEMO] Preview as {role} ▾`. The DEMO tag is 11px, weight 700, letter-spacing .06em, 1px border `--color-border-secondary`, radius 4, padding 1×5. Render it only when demo/preview is enabled: gate it behind a flag in `config/flags.js`, because it is visible in production today.
  - **Breadcrumb title for `/units/:id`**: `Dashboard › {id}`. "Dashboard" is a 500-weight link in `--color-text-secondary`, followed by a chevron, then the id in 600 `--color-text-primary`, all at 20px.
- **Phase 2 (1b)**: the topbar gains scope selects, `FLEET · All fleets ▾` and `UNIT · {id} ▾`. Each is 36 high and 14px, with a 13px 600 tertiary prefix. They sit before the theme button and are backed by `AuthContext.selectedFleet` / `selectedUnit`. The `UnitPicker` is then removed from Alerts, Maintenance, History and Config.

## B2. DashboardPage.jsx
- **Count tiles** at the top: a 4-up flex with gap 12, one tile each for Fault, Warning, Offline and Healthy.
  - Each tile: padding 12×16, radius 12, 1px `--color-border-secondary`; tone icon 20 + label 15 `--color-text-secondary` + count 24/600.
  - When the count > 0 and the tone isn't ok, the fill is `--{tone}-soft` and the count is in `--{tone}`.
  - Tiles are buttons that filter the list; the active filter gets a 2px border in the tone colour.
- **Toolbar**: a filter input (300px, search icon, placeholder "Filter by unit or fleet") and, in Phase 2, a segmented `Cards | Table` toggle on the right.
- **Remove the separate "Needs attention" panel.** Instead split the grid into two sections, so each unit appears once:
  - "Needs attention · N" (`view.attention`);
  - "Running normally · N".
  - Each section has an h2 at 17/600 with a 14px tertiary subtitle.
- **UnitCard**: add the fleet id after the name (14px `--color-text-tertiary`). `kv-lbl` colour changes to `--color-text-secondary`. "View unit" uses `--accent-text`.
  - **Data dependency:** `/fleet/units` doesn't return a fleet today, and unit ids (`APU-000123`) don't follow the `{FLEET_ID}-{serial}` convention. Add `fleet_id` to the units response.
- **Phase 2 table view**: inside a `.panel`, a `.dtbl` with these columns:
  - Status (`badge-sm` with icon, 112px)
  - Unit (600, plus demo badge)
  - Fleet (secondary colour)
  - Status detail (headline; err rows 600 in `--err`); **this is the only column that may wrap, at width 100%**
  - Battery, Cabin, RPM, Fan (all `.num`)
  - Last report (secondary colour)
  - Chevron

  Every column except Status detail is `white-space:nowrap`. Row padding is 12px 10px. Fault rows get the `--err-soft` background. Clicking a row opens the unit. Sorting stays `byAttention`. Caption below: "N units · sorted by needs attention".

## B3. UnitDetailPage.jsx + unit/OverviewTab.jsx
- Remove the page `<h1>` and the "← Fleet" button; the topbar breadcrumb replaces them.
- **Header row** (gap 12): id at 24/600, status `.badge` with icon, demo badge, then `{fleet} · {view.seen}` at 14px tertiary.
- **Banner**:
  - lighter: `--err-soft` (or warn/ok) fill, radius 12, padding 14×18, no 2px border;
  - tone icon 24 + title at 18/600 in the tone colour, with the context sub-line inline at 15px secondary;
  - the action button sits on the right (`.btn`).
  - The header badge already states the status, so drop the "Fault:" prefix from the title.
- **Groups**: at this width, a 2-column grid (gap 16) holding Power, Climate, Engine and Diesel heater. `.rv` drops to 18px in this layout. The side column is 300px.
  - Today `ov-groups` falls to one column at 1280, pushing Engine and Heater below the fold. Adjust the `minmax` so 2 columns fit, e.g. `minmax(min(300px,100%),1fr)`.
- **Quick actions**: when actions are disabled (demo, role or offline), show the reason **above** the buttons as a notice: `--color-background-secondary` fill, radius 8, padding 10×12, info icon, 14px secondary text. Don't put it as a 13px caption below.
- **Phase 2**: a single 4-column readings panel (Power, Climate, Engine and Diesel heater columns, each cell with a 13px label and a 17px value), with actions in a 4-across row below. Nothing scrolls at 1280×800.

## B4. FleetMapPage.jsx (+ components/map/FleetMap.jsx)
- **Pins**: keep the 26px pins and add a label chip next to each: `"{unit} · {status}"` at 13px/600, `--color-background-primary` fill, radius 6, padding 3×8, `0 1px 3px rgba(0,0,0,.2)`.
- **Legend**, bottom-left of the map: Fault, Warning, Healthy and Offline, each a 10px dot plus label at 13px.
- **Side panel order**: "Not placed" comes first, as a call to action.
  - Heading: `pinOff` icon in warn plus "N unit not placed" (15/600).
  - Copy: "{unit} has no location, so it's missing from the map and gets no local weather or time zone."
  - `btn-primary` full width: "Set location for {unit}".
  - Then "On the map", **sorted by attention** (`byAttention`).
- The "Assigned locations — units don't report GPS yet." note moves under the side panel (13px tertiary, info icon).

## B5. AlertsPage.jsx
- Add **"All units"** as the first `UnitPicker` option, and make it the default for admin and fm roles.
- **Fleet-wide data**: there is no fleet faults endpoint. Either:
  - fan out `getFaults` per unit with `useQueries`, then merge and sort; or
  - add `GET /fleet/faults?scope=fleet` (preferred; enforce `fleet_id` server-side as the RBAC middleware task describes).
- **Toolbar**: Unit picker, severity chips ("All · N", "Critical · N", "Warning · N"; selected chip uses `--accent-soft` with `--accent-text`), and a right-aligned "Last 7 days".
- **Remove the big banner** in All-units mode; the section header carries the count: "Active faults · N across M units".
- **Active faults table**, columns:
  - Unit (150, 600)
  - Fault (tone icon 18 + name 600 + code 13px tertiary)
  - Severity (badge-sm)
  - Raised (`ageText`, plus a "Unit offline" sub-line when `view.stale`)
  - "Open unit" `btn-sm`

  Rows use the `roomy` padding; critical rows get `--err-soft`.
- **Fault log**: add a Unit column. Columns: When 170, Unit 150, Fault, State 110.
- Keep "What the controller monitors" `<details>` as it is.
- In single-unit mode, keep today's layout but apply the new table styles.

## B6. MaintenancePage.jsx
- **Toolbar**: Unit picker, type chips (All types, Oil change, Inspection, Repair, Firmware), and the Add record `btn-primary` on the right.
- **New "Service counters" section** for the selected unit, using `useUnitLatest`: three stat cards with 14px label, 26/600 value and 13px caption:
  - Oil hours `{oil_hrs} h` · "since last oil change"
  - Engine hours `{engine_hrs} h` · "engine counter"
  - Machine hours `{machine_hrs} h` · "unit powered"
- **Service history** becomes a table: Date (600, 150), Type (`badge-sm t-off`, 150), Technician (180; read `technician || tech`), Notes. When notes are empty, show "No notes" in tertiary.
- Phase 2: All-units mode adds a Unit column.

## B7. ReportsPage.jsx
- **Toolbar**: period seg, a Fleet select ("All fleets"; needs an API param), then on the right the explicit range "Oct 13 – Oct 20, 2026 · real units only" (14px tertiary) and Refresh.
- **Stats**: fuel savings is no longer green; use neutral ink.
- **Operator table**: Starts, Stops and FW updates are `.num`. Add a **Total** row in bold. Section header: "Operator activity · N operators".

## B8. APUHistoryPage.jsx
- **Bug:** `range.replace('-','last ')` renders "last 1d". Map it to "Last 24 h" / "Last 7 days" / "Last 30 days".
- The period becomes a `.seg` (24 h / 7 days / 30 days) instead of a select.
- **Event table**: rename the section "Fault events · N in the last {range}". Columns: When (190, `toLocaleString` short form like "Oct 20, 9:37 PM", **not monospace**), Event (`faultInfo(f).name` + code at 13px tertiary), State (`.badge-sm`, the same mapping as Alerts). **Drop the Unit column.**
- **Telemetry table**: 14px, columns Time, Battery `12.64 V`, RPM, Cabin `96°F`, Oil, Engine hours `4 h`, all `.num` except Time. Header right side: `btn-sm` "Open Telemetry tab", which navigates to the unit's Telemetry tab (needs a `?tab=` query param on UnitDetailPage).
- Remove every inline 11px and monospace style.

## B9. UsersPage.jsx
- **Toolbar**: "Filter by email" input (280, search icon), role chips ("All roles · N", Admin, Fleet Manager, Maintenance, End User), and on the right "Add user" as a regular-size `.btn-primary`, not `btn-amber btn-sm`.
- **Table** (`.dtbl roomy`, 14px), columns:
  - User: email at 500, plus "(you)" in tertiary for the current user;
  - Role: role badge at 13px using the `.rb-*` colours, **not an inline select**;
  - Fleet: `fleet`, or "All fleets" in tertiary for "—";
  - Status: badge;
  - Actions (200px, right-aligned): "Change role" `btn-sm` plus a red icon `btn-sm` for delete (aria-label "Delete {email}"). The current user's row has no actions.
- **Change role** opens `ConfirmDialog` containing a role `<select>`. A Fleet Manager must not be offered "EcoFleet Admin", per the handoff doc's RBAC rule.
- **Status mapping**: `CONFIRMED` and `active` → "Active" (ok); `FORCE_CHANGE_PASSWORD` and `invited` → "Pending" (warn); `DISABLED` → "Disabled" (off); anything else → title-cased raw value. Today mock "active" renders raw and lowercase.
- **Create form**: use `.field`, `.control` and labels at 14/600. Note text at 14px: "No welcome email is sent — share credentials with the user directly."
- Remove the inline `<style>` spin keyframes; use the existing `.spin` class.

## B10. SystemConfigPage.jsx
- **Rename the nav label** "System config" → **"Unit settings"**; the route stays `/config`. Every control here is per unit; global settings such as thresholds aren't on this page.
- Next to the unit picker: "Settings apply to one unit at a time." (14px tertiary).
- **Interval**: "Every N seconds" (22/500), with the status as a badge beside it ("Confirmed by unit" ok, "Pending" warn, "Not confirmed" err), replacing the text line. Description at 15px. While the button is disabled, show the hint "Pick a new value to enable" (13px tertiary).
- **Reboot prerequisite**: show it as a warning row **above** the button: `--warn-soft` fill, radius 8, padding 12×14, alert icon, the text "Needs system image 1.2.62 or newer. {unit} is on {fw}.", and a `btn-sm` "Go to Firmware" (→ `/units/{unit}?tab=firmware`).

## B11. LoginPage.jsx
- **Card**: width 400, radius 14, 1px `--color-border-secondary`, padding 36 36 32, gap 24.
- **Logo** height 60; subtitle "Fleet management dashboard" at 15px secondary.
- **Fields**: `.field` + `.control` at height 44 with 14/600 labels.
- **Error**: a flex row, gap 10, padding 10×12, radius 8, `--err-soft` fill, `--err` text at 14px, with an alert-circle icon.
- **Submit**: `.btn btn-primary btn-lg`, full width.

## B12. Tests to update
Expect assertion updates in:
- `Layout.test.jsx`: email location, role badge removed, breadcrumb;
- `DashboardPage.test.jsx`: attention panel removed, sections and tiles;
- `AlertsPage.test.jsx`: All units default;
- `APUHistoryPage.test.jsx`: Unit column, subtitle;
- `UsersPage.test.jsx`: role select → Change role dialog;
- `SystemConfigPage.test.jsx`: label.

Add tests for:
- the Users status mapping;
- the History range label;
- Fleet Manager not being offered the admin role.

---

## Suggested order of work
1. **Cab A1 + A2** (fault indicator, Home). This is the highest-value change.
2. **Cab A0 atoms** (SegmentedControl, StepButton, ConfirmButton, Keypad props), then A3–A12.
3. **Admin B0 + B1** (tokens, contrast, layout), then **B9, B8, B11**: these three pages are on the oldest styles.
4. **Admin B2–B7, B10.**
5. Phase 2: the cab night palette and brightness presets; the admin topbar scope and table views.

## Open product decisions
- Cab: how ModeScreen is reached (A4).
- Cab: how night mode is triggered.
- Cab: preset brightness values (A8).
- Cab: Battery mode copy for the off state (A3).
- Admin: a fleet-wide faults endpoint vs client fan-out (B5).
- Admin: adding `fleet_id` to `/fleet/units` (B2) and a fleet param to reports (B7).
- Admin: gating the "Preview as" control in production (B1).

## Assets
- Cab: `ecofleet_logo_topbar.png` and the Inter TTFs, both already in `gobi-ui/files/`. Icons are the existing `atoms/Icon.qml` paths; no new glyphs are needed except `check` (for the radio: `M5 12l5 5 9-10`).
- Admin: `ecofleet_logo.svg` / `ecofleet_logo_dark.svg` / `favicon.svg`, already in the repo. Icons come from `@tabler/icons-react`: IconSearch, IconPlus, IconUserPlus, IconTrash, IconMapPinOff, IconInfoCircle and IconChevronRight, all already imported somewhere in the app.

## Files in this bundle
- `Cab Panel Review.dc.html`: 11 cab screens × (current / 1a / 1b) with notes.
- `CabChrome.dc.html`: header + rail for the three cab variants (used by the review).
- `Admin Site Review.dc.html`: 10 admin pages × (current / 1a light / 1b dark), plus a theme check row.
- `support.js`, `assets/` and `fonts/`: needed to open the review files locally.
- `screenshots/cab/*.png`: 1600×960 (2×) PNGs of every cab screen, named `NN-screen-1a.png` (target) and `-1b.png` (Phase 2 night).
- `screenshots/admin/*.png`: 1280×800 PNGs of every admin page, named `NN-page-1a.png` (light, target) and `-1b.png` (dark, Phase 2 dense). Also `02-dashboard-1a-dark.png` and `02-dashboard-1b-light.png` for the theme check.

---

## Implementation decisions (2026-10-20)
Resolved with the product owner before implementation. They override the open questions above.

- **Scope:** direction 1a only, as two PRs from `main`: `feat/cab-ui-refresh` (Part A) and `feat/admin-ui-refresh` (Part B). Phase 2 (1b) is out of scope. That covers the night palette, brightness presets, the topbar scope selects and the table views.
- **Reference images:** the 1a screenshots are in `docs/superpowers/specs/2026-10-20-ui-refresh/{cab,admin}/`. The cab images are 1600×960, which is 2× the 800×480 canvas.
- **A1 correction:** "Active for N min" is `StatusLabels.duration(now - startMs)`, not `ago()`; `ago()` would read "Active for 4 min ago".
- **A1 count:** the header pill, Rail badge, Alerts tile and Alerts subtitle all show the same count, `hasError ? max(1, eventlog.activeCount) : 0`. So the count never reads 0 while a fault is active, even if `events.json` is missing or lags. The pill reads "1 fault" / "2 faults".
- **A3 Battery off copy:** "APU stays off. On starts it in Battery mode." (the designer's proposal).
- **A4 Mode route:** tapping the CLIMATE status area on Home pushes ModeScreen onto the Home stack, and its ScreenHeader back pops it.
- **A12 status line:** "Cabin 76° · cooling to 70°", as in the lock mock.
- **B1 Preview as:** visible only when the signed-in user's *real* JWT role is `admin`. The real role is recorded at login. A non-admin is always shown their real role, and any stale preview role left in localStorage is ignored.
- **B2/B5/B7 backend:** frontend only, no Lambda change.
  - Units have no fleet in the data model, so fleet text appears only when the API returns `fleet_id`.
  - All-units Alerts fans out per-unit `getFaults` queries on the client.
  - The Reports fleet select is skipped.
- **B9:** role changes stay admin-only, matching the API. `assignableRoles('fm')` still excludes admin, as a safeguard.
