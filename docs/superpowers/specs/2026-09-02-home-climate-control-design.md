# Home Climate Control — Design Spec

**Date:** 2026-09-02
**Status:** Draft for review
**Repos:** `cortex-yocto` (this repo — gobi-ui + gobi-agent) and `g0b1-firmware` (STM32 APU control)

## Goal

Turn the gobi-ui **Home** screen into a thermostat-style climate control the operator
drives directly: a large current-temperature readout, an **Auto/Off** control and
setpoint, a **fan control** whose speed is set automatically by the firmware from the
cabin-vs-target gap (with manual override), a **glowing status bar** that reflects the
unit's live state, and status text that never shows raw firmware enum strings.

## Context (current state)

- Home today (`HomeScreen.qml`) shows the **target setpoint** as the big number with ▲▼
  steppers, a mode pill, and four footer **stat cards** (CABIN/OUTSIDE/BATTERY/ENGINE HRS)
  that read as tappable buttons.
- Climate on/off lives in the **Mode** menu (`climate`/`battery`/`off`). Fan lives in its
  own **Fan** menu; the only fan control is a manual 0–100% slider (moved to the
  Component Test screen in the prior feature).
- Modes → reg 10 (`0=off 1=climate 2=battery`); setpoint → reg 14 (°F); fan command →
  reg 12 (0–100%, manual); fan speed readback → reg 12; control status → reg 23
  (`control_status_t`). "Climate" mode already auto-decides heat vs. cool and holds the
  setpoint — it is effectively a thermostat.
- `control_status`/`engine_status`/`error` are surfaced to the UI as **raw enum strings**
  (`warming_up`, `high_engine_temp`, …) and displayed verbatim — the underscores read as
  a bug.

## Global constraints

- **Auto-fan control logic lives in firmware** (the correct long-term home for a control
  loop), not in the UI. The UI only *commands the mode* (auto vs. manual) and *displays*
  the resulting fan speed.
- Landscape ~800×480 today, **must scale down to a smaller screen** — touch targets
  (setpoint arrows, fan slider) sized accordingly.
- gobi-ui theme is the existing dark dashboard theme (`Theme.*`); reuse it.
- The APU is **cooling-focused**: `control_status` has no distinct "heating" state;
  `warming_up` is engine spin-up before cooling.

---

## 1. Home screen layout (Model A + layout B)

Top-to-bottom:

1. **Glowing status bar** (§5) — slim rounded rectangle across the top, above the
   weather/time row, pulsing in the state color.
2. **Weather + time** row (unchanged from today).
3. **Body row**: left **rail** (Home / Mode / Menu — Fan removed); center **big current
   cabin temp**, color-tinted by value (reuse the existing `tempColor` ramp); right
   **control column**:
   - **AUTO / OFF** segmented toggle.
   - Status-derived caption: `COOLING TO` / `WARMING UP` / `AT TARGET` / `CHARGING` /
     `OFF` (from `control_status`, UPPERCASE — see §4/§6).
   - **Setpoint** (target °F) with large ▲▼ touch targets.
4. **Fan control** — a segmented **`AUTO / LOW / MED / HIGH`** control (large touch
   targets, no slider) with a small % readout of the current fan speed (§3).
5. **Stats** — a divider line then passive text (`OUTSIDE` / `BATTERY` / `ENGINE HRS`),
   **not** styled as cards/buttons.

Rail change: **Home / Mode / Menu**. **Mode** menu keeps `Battery` / `Climate` / `Off`
(Battery = charge-only; Climate/Off are shared with the home Auto/Off toggle). The **Fan**
rail item and its screen are removed.

## 2. Control model (UI → firmware)

- **AUTO** → `mode=climate` (reg 10 = 1); **OFF** → `mode=off` (reg 10 = 0). Optimistic
  echo like the existing Mode/fan controls.
- Turning the toggle to **AUTO also sets `fan_auto=1`** (per Model A, "Auto runs the whole
  thing" — the fan starts automatic); the operator can then override to manual on the fan
  slider for that session.
- **Setpoint** ▲▼ → reg 14 (°F), debounced send (existing `HomeScreen` pattern, 55–85 °F
  clamp).
- **Battery** mode reachable via the Mode menu; unaffected.
- No trip into Mode is needed to turn climate on/off.

## 3. Fan control contract (NEW register)

- **New firmware holding register `fan_auto`** (R/W). **= fw reg 9** (agent wire addr 8) —
  confirmed free in the g0b1 register census (free: 2/4/5/9; note fw15 is **not** free — it
  is the cold-storage temp setting). A live ctx flag (Pattern B, like reg 32 standby), not
  NVM-backed: it resets to `0` on firmware reboot, which is fine since the APU also boots to
  `OFF` and the UI re-asserts `fan_auto=1` whenever AUTO is (re)selected.
  - `1` = **auto**: firmware computes fan from the temp delta (§4); reg 12 write ignored.
  - `0` = **manual**: firmware drives the fan at the reg 12 value.
- reg 12 remains the **manual fan %** command and the **fan-speed readback**.
- **UI — a segmented `AUTO / LOW / MED / HIGH` control** (no slider):
  - **AUTO** → send `fan_auto=1`. Firmware drives the fan from the temp delta (§4); the
    % readout shows `telemetry.fanSpeed` as it glides.
  - **LOW / MED / HIGH** → send `fan_auto=0` + reg 12 = the preset's fixed %.
  - **Fixed v1 preset values:** LOW = **40%**, MED = **70%**, HIGH = **100%** (all ≥ the
    firmware `FAN_MIN` 32% floor). Compile-time UI constants for v1.
  - **Active-segment highlight:** AUTO when `fan_auto=1`; otherwise the preset whose % equals
    the current `fanSpeed`; if `fanSpeed` matches no preset (e.g. a value set elsewhere),
    no preset is highlighted.
- **Agent:** new command key `fan_auto` (0/1) → reg 15; read reg 15 into `latest.json`
  as `fan_auto` (bool). `fanSpeed` (reg 12 readback) already exists; presets reuse the
  existing `fan` command key (reg 12).
- **TelemetryModel:** add `Q_PROPERTY bool fanAuto` and `Q_INVOKABLE void setFanAuto(bool)`
  (the existing `setFan(int)` writes the preset %).

## 4. Firmware auto-fan control law (`g0b1-apu`)

Active when **`mode=climate` and `fan_auto=1`**:

```
error   = cabin_temp_f - setpoint_f      // cooling error; >0 means cabin hotter than target
e       = clamp(error, 0, SPAN)          // ignore below-target (cooling unit)
fan%    = FAN_MIN + (100 - FAN_MIN) * (e / SPAN)
fan%    = clamp(fan%, FAN_MIN, 100)
if error <= DEADBAND: fan% = FAN_MIN
```

- **Defaults (v1, firmware constants):** `FAN_MIN = 32%` (existing `FAN_MIN_DUTY` floor),
  `SPAN = 6 °F` (reaches 100% at ≥6 °F over target), `DEADBAND = 0.5 °F`.
- Large gap while `warming_up` (cabin still hot) naturally yields a high fan; it eases
  down as the cabin approaches target — matching the observed behavior.
- `mode=off` / `battery` → auto-fan inactive (fan off / per existing behavior).
- **Manual (`fan_auto=0`)**: firmware drives reg 12 value directly, unchanged.

**Tuning (v1 decision):** ramp params are **compile-time firmware constants** — tuned by
reflash, which is already part of the bench loop. Exposing `SPAN` as a live-tune holding
register is a documented fast-follow if the defaults need frequent adjustment.

## 5. Glowing status bar

Slim rounded-rectangle bar at the top of Home, softly pulsing in a color mapped from
`control_status` (reg 23), carrying an **UPPERCASE** state label:

| `control_status` | glow color | label |
|---|---|---|
| `warming_up`, `starting` | amber | WARMING UP / STARTING |
| `cooling` | blue | COOLING |
| `chillin` | teal | AT TARGET |
| `charging` | green | CHARGING |
| `running`, `defrost` | neutral/cyan | RUNNING / DEFROST |
| `off` | none (bar hidden or dark) | — |

Pure UI (reads existing telemetry); no new firmware/agent data required beyond
`control_status`, which is already published.

## 6. Status-label prettification (UI, app-wide)

A single UI mapping renders friendly labels for `control_status`, `engine_status`, and
`error` — **no raw underscore strings anywhere**. Applied to the Home glow bar + caption
**and** the existing Diagnostics tiles.

- `control_status`: off→Off, warming_up→Warming Up, starting→Starting, running→Running,
  defrost→Defrost, charging→Charging, cooling→Cooling, **chillin→At Target**, unknown→—.
- `error`: none→None, low_oil→Low Oil, high_engine_temp→High Engine Temp,
  low_battery→Low Battery, ac_low_pressure→AC Low Pressure, ac_high_pressure→AC High
  Pressure, starting_failure→Starting Failure, standby→Standby, engine_stalled→Engine
  Stalled, no_rpm→No RPM, high_ac_pressure→High AC Pressure, unknown→—.
- Casing: **UPPERCASE** on the glow bar / home caption; Title Case elsewhere (Diagnostics).

## 7. Data flow (summary)

```
UI command.json { mode, setpoint_f, fan, fan_auto } → gobi-agent → regs 10/14/12/9 → firmware
firmware regs (cabin, setpoint, fan speed, control_status, fan_auto) → gobi-agent latest.json → TelemetryModel → UI
```

## Decomposition (two implementation plans)

- **Plan A — firmware (`g0b1-firmware`):** `fan_auto` register (fw9) + auto-fan control
  law in climate mode. Self-contained, host-testable control-law unit + on-target reg
  wiring. Local branch, flashed at the bench.
- **Plan B — agent + UI (`cortex-yocto`):** agent `fan_auto` command key + telemetry read;
  `TelemetryModel` `fanAuto`/`setFanAuto`; Home screen redesign (layout, Auto/Off,
  setpoint, fan slider w/ auto-manual, glow bar); status-label map (home + Diagnostics);
  rail change (remove Fan); recipe/packaging. Degrades gracefully on firmware without
  `fan_auto` (reg read unsupported → UI shows manual-only / hides AUTO chip).

## Accepted v1 deviations / fast-follows

- Auto-fan ramp params are firmware constants (reflash to tune); live-tune register deferred.
- **Fan presets are fixed** (LOW 40 / MED 70 / HIGH 100). **User-configurable-local presets**
  are a fast-follow — they want an on-device persisted settings store, which pairs with
  persisting the maintenance PIN (also currently in-memory). **Admin/cloud-defined presets**
  are further out (require the deferred shadow config/command path).
- Graceful-degrade if the `fan_auto` register is absent on old firmware: the **AUTO** segment
  is hidden and the fan behaves as manual LOW/MED/HIGH presets only (existing reg 12 path).
- Glow bar is presentation-only; no new telemetry.

## Out of scope

- Battery-mode UI changes beyond keeping it in the Mode menu.
- Humidity / air-quality readouts (no sensors).
- Remote (shadow) control of climate — still telemetry-only + local command.json.
