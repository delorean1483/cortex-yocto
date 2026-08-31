# APU Control Panel — GUI Redesign: Implementation Design

**Date:** 2026-08-31
**Status:** Draft for review
**Companion to:** `APU_GUI_Design_Spec.docx` (product/IA brief, "Adapted from the Honeywell Home smart-thermostat interface")
**Codebase:** `meta-ecofleet/recipes-ecofleet/gobi-ui/` (Qt6 / QML)
**Branch:** `feat/gobi-ui-800x480-layout`

---

## 1. Purpose

The IA spec defines *what* each screen contains and how screens relate. This document is its engineering companion: it maps that IA onto the **actual gobi-ui codebase and telemetry**, fixes the target-display strategy, defines the reusable component set, and — most importantly — **phases the work by what data/features actually exist today**, so the "too cluttered" feedback is resolved early without waiting on backend/firmware that isn't built yet.

It does **not** restate the IA; read the docx for screen-by-screen intent.

### Problem being solved
The current app is **3 bottom tabs** (`Dashboard`, `Diagnostics`, `Device`) with a `DashboardPage` that crams six jobs onto one 800×480 screen (mode buttons + temp stepper + fan slider + START/STOP + live telemetry + weather). That density is the clutter. The IA's fix — **progressive disclosure** behind a persistent rail + Menu — is adopted here.

---

## 2. Display architecture (target-first, scales to the dev kit)

**Target production panel:** Riverdi **RVT50HQLNWC00-B — 5.0″ IPS, 800×480**, LVDS, optical-bonded capacitive touch. Same 800×480 canvas we already target; just a brighter/nicer physical panel.

**Decision — author on a fixed 800×480 logical canvas inside a uniform-scale, letterboxed container:**

```qml
// ScaleRoot.qml — wraps the whole app
Item {
    anchors.fill: parent
    Item {
        id: canvas
        width: 800; height: 480          // EVERYTHING is authored at 800×480
        anchors.centerIn: parent
        scale: Math.min(parent.width / 800, parent.height / 480)   // fit, preserve 5:3
        // rail + screens live here
    }
}
```

- On the **Riverdi 800×480**: `scale = 1.0` → pixel-perfect/native.
- On the **dev kit** (`main.qml` currently declares 1280×800): scales up ~1.6× with ~16 px letterbox bars top/bottom — **WYSIWYG for the target**; what's on the bench is what ships.
- Text/vectors re-rasterize at scale in Qt → stays crisp.
- **Removes** the ad-hoc "compact 800×480 content in a 1280×800 window" tuning: one rule, no per-device forks.

This is a prerequisite for all phases and lands in Phase 1.

---

## 3. Navigation restructure

**From:** `SwipeView` of 3 pages + bottom `TabBar` (`main.qml`).
**To:** a persistent **left rail** (~160 px = 20 % of 800) + an **80 %** content pane, per the IA.

Rail items (fixed): **Home · Mode · Battery · Menu**. The content pane hosts one active screen; **Menu** is a 2-page 3×2 tile-grid launcher for everything else (page-dot pagination). Sub-screens opened from Menu push onto a `StackView` in the content pane with a back affordance; the rail stays put.

Old → new mapping:
- `DashboardPage` splits into **Home** (setpoint + run state) and **Mode** (mode choice) + **Battery**.
- `DiagnosticsPage` (16 tiles) → **Menu → Live Diagnostics** (customer view) and feeds **Maintenance → Live Sensor Data** (tech view).
- `DevicePage` → **Menu → Unit Information** (identity/network) + **Menu → User Maintenance** (oil reset/hours).

---

## 4. Reusable components (the three templates + shell)

Build these first; every screen is content dropped into one of them (this is the IA's own "three templates cover the whole app" principle, and it keeps each QML file small/focused).

| Component | Role | Key API |
|---|---|---|
| `ScaleRoot` | fixed 800×480 canvas + letterbox scale (§2) | — |
| `AppShell` | header bar + left rail + content `StackView` | `currentRail`, `push(screen)` |
| `Rail` | persistent 4-item nav, active item highlighted | `model`, `currentIndex` |
| `Header` | top status glance: connectivity + clock (+ fault chip) | binds telemetry |
| **`BigNumberScreen`** (template B) | one oversized numeral + chevrons + status line + pill + footer stats | `value`, `onInc/onDec`, `statusText`, `pillText`, `footerStats[]`, `faultBanner` |
| **`ChoiceList`** (template C-list) | rows of icon + bold title + helper text, outlined selection | `model[{icon,title,help,value}]`, `current`, `onPick` |
| **`TileGrid`** (template C-grid) | 3×2 icon tiles, page-dot pagination, optional lock glyph | `pages[[{icon,title,locked,target}]]` |
| `StatusPill`, `FaultBanner`, `StatCard`, `Keypad`, `ConfirmDialog` | shared bits reused across screens | — |

Existing `SegButton`/`StepButton` are superseded by `ChoiceList` rows and `BigNumberScreen` chevrons respectively; the `WeatherStrip`/`WeatherIcon` are reused (footer/Home + Sleep screen).

---

## 5. Screen inventory, data mapping & readiness

Legend: ✅ buildable from existing data · 🟡 partial (some data missing) · 🔴 needs new firmware/backend.

| Screen | Template | Data / control source (exists today) | Ready |
|---|---|---|---|
| **Home** | BigNumber | `clmtSetpointF` + `setSetpoint()`; status = `controlStatus`; pill = `mode`/`engineStatus`; fault = `hasError`/`error`; footer = `battV`, `engineHrs` | 🟡 (battery shown as **volts**, not SoC %) |
| **Mode** | ChoiceList | `mode` + `setMode("off"/"climate"/"battery")` | 🟡 (labels — see §6) |
| **Battery Monitor** | BigNumber (read-only) | `battV`, `battSetpointV`; status text derived from voltage | 🟡 (no amps / charge-state / SoC %) |
| **Menu** | TileGrid | static launcher | ✅ |
| **Live Diagnostics** (customer) | TileGrid/cards | today's `DiagnosticsPage` 16 tiles | ✅ |
| **User Maintenance** | cards | `engineHrs`,`machineHrs`,`oilHrs`,`oilChange`, `devinfo.serial`, `resetOil()` (+ confirm) | ✅ |
| **Unit Information** | cards | `devinfo.serial/hostname/fwVersion`, network `ipAddress/macAddress/ethLinked` | ✅ |
| **Alerts** (active) | ChoiceList/list | `hasError`/`error` (single current fault) | 🟡 (no multi-fault list) |
| **Error Log** (history) | list | — | 🔴 (no fault-history store) |
| **Cloud Connection** | cards | `ethLinked`/`ipAddress` (link only) | 🟡 (no IoT conn-state / customer assignment) |
| **Screen Lock** | Keypad | client-side PIN | ✅ |
| **Settings / Display Settings** | ChoiceList | client-side prefs; brightness/sleep | 🟡 (backlight/dim hooks needed) |
| **Maintenance** (tech, gated) | Keypad + rail | live sensors ✅; **component test** 🔴; fault codes 🔴; calibration/factory-reset 🔴 | 🔴 |
| **Load / Output Monitor** | BigNumber | — | 🔴 (does this APU have AC/inverter output? §9) |
| **Runtime Schedule** | ChoiceList | — | 🔴 (no scheduling in firmware) |
| **Connect App / Support** | cards/QR | static/help content | 🟡 |
| **Sleep / Idle** | ambient | `weather`, clock, `cabinTempF` | 🟡 (needs inactivity timer + backlight dim) |

Data surface today (`TelemetryModel`): `cabinTempF, extTempF, battV, clmtSetpointF, battSetpointV, rpm, fanSpeed, engineHrs, machineHrs, oilHrs, oilOk, ignition, mode, engineStatus, controlStatus, error, hasError, oilChange, stale`; writes `setMode, setSetpoint, setFan, resetOil`. Plus `devinfo`: `serial, hostname, fwVersion, ethLinked, ipAddress, macAddress`.

---

## 6. Taxonomy & data reconciliation (decisions)

1. **Mode.** Firmware modes today are **Off / Climate / Battery** (`setMode`), not the spec's Auto / Manual Run / Battery Saver / Off. **Decision:** Phase-1 Mode screen uses the ChoiceList template with **today's three real modes** + plain-language helper text (a clean win over the current SegButtons). The richer Auto/Manual/Battery-Saver taxonomy is a **firmware feature** deferred to a later phase; the UI template won't need to change, only its `model`.
2. **Battery %.** Only **voltage** (`battV`) is available — there is no state-of-charge or current (amps) sensing. **Decision:** Home footer and Battery Monitor show **voltage + a plain-language status** derived from voltage thresholds (e.g. "Battery healthy" / "Low — will start to recharge"). True SoC %, charge/discharge amps, and the 24-hr trend need **new sensing** (coulomb counter / current sensor → agent → telemetry). Flagged, not blocked.
3. **Alerts vs Error Log.** Today there's a single live `error`/`hasError`. **Decision:** Phase-1 Alerts shows the current active fault only; a real **fault-history store** (agent persists fault events; UI reads a list) is required for Error Log and multi-item Alerts — Phase 2.
4. **Fault severity color** reserved per IA §4.2: amber = warning, red = active fault. Reuse the existing accent conventions (`#F85149` red already in use).

---

## 7. Phasing

### Phase 1 — "not cluttered", existing data only (the deliverable that answers the feedback)
- `ScaleRoot` fixed-canvas scaling (§2) + `AppShell`/`Rail`/`Header`.
- The three templates (`BigNumberScreen`, `ChoiceList`, `TileGrid`) + shared bits.
- **Home**, **Mode** (3 real modes), **Battery Monitor** (voltage + status), **Menu**.
- Menu tiles that **re-home today's content**: Live Diagnostics (from `DiagnosticsPage`), User Maintenance + Unit Information (from `DevicePage`).
- Fault banner on Home from `hasError`.
- **Outcome:** the current 6-in-1 screen becomes a glanceable Home with everything else one tap away — on the true 800×480 target canvas, scaling onto the dev kit. No backend/firmware changes.

### Phase 2 — light plumbing
- Alerts + **Error Log** (agent fault-history store + a telemetry/list channel).
- Cloud Connection (surface AWS IoT connection state from the agent).
- Settings + **Display Settings** (backlight/brightness + inactivity → **Sleep screen**).
- Screen Lock (client-side PIN).

### Phase 3 — needs firmware/backend features
- **Maintenance** tech mode: password gate + Live Sensor Data (✅ data) + **Component Test** (needs STM32 relay/actuator test hooks) + technical Fault History + Calibration/Factory Reset.
- **Runtime Schedule** (firmware auto-start rules).
- **Load / Output Monitor** (only if the APU has output worth showing — §9).
- Connect App, Support, richer Battery (SoC/amps/trend once sensing exists).

---

## 8. Access tiers / gating
- **Screen Lock** — light client-side PIN to stop accidental driver input; unrelated to the tech gate.
- **Maintenance password** — separate, heavier gate; on success enters a visually-distinct "Maintenance Mode" section (own rail, dark header) with an idle-timeout auto-exit and explicit "Exit Maintenance Mode". Both are client-side to implement; the *actions* behind Maintenance (component test, calibration) need firmware support.
- Re-assigning a unit to a customer (Cloud Connection) should sit behind the Maintenance password (changes billing/fleet ownership); read-only connection status stays open.

---

## 9. Open questions (need PM / team / hardware input)
1. **Load/Output Monitor** — does this APU expose any electrical *output* (inverter/genset/outlets), or is it strictly cab‑HVAC + battery‑charging? If the latter, drop the screen or repurpose it as "what the APU is currently powering" (HVAC on/off, charging on/off). **Blocks whether §7-P3 includes it.**
2. **Battery SoC/amps** — is a current sensor / SoC source planned? Determines whether Battery Monitor ever gets beyond voltage.
3. **Mode taxonomy** — final call on Off/Climate/Battery vs Auto/Manual/Battery-Saver; the latter needs firmware work.
4. **Runtime scheduling** — is auto start/stop-by-schedule on the firmware roadmap?
5. **Cloud/customer assignment + Connect App** — is there a fleet backend + companion app to point these at, or are they placeholders?
6. **Fault-history store** — where does it live (on-device SQLite in the agent? cloud?) — gates Error Log.

## 10. Non-goals / risks
- **Not** building aspirational screens (Load/Output, Runtime Schedule, Component Test, full Battery Monitor) until their backing features exist — they'd be dead UI.
- Letterbox bars on the dev kit are expected and correct (preserve target proportions); not a bug.
- Scope: full spec ≈ 20 screens vs 3 today — this is multi-phase; Phase 1 is the only part that resolves the immediate clutter feedback and is self-contained.

---

## 11. Next step
On approval of this design, produce the **Phase-1 implementation plan** (writing-plans) — the scaling shell + rail + Home/Mode/Battery/Menu re-homing today's screens — as the first buildable, flashable increment.
