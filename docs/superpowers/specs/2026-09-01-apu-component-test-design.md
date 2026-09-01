# APU Component Test — Design Spec

- **Date:** 2026-09-01
- **Status:** Approved design, pending implementation plan
- **Scope:** Give the inert "Component Test" relay placeholders real, guarded actuation, end-to-end across STM32 firmware, gobi-agent, and gobi-ui.

## Problem

The gobi-ui Diagnostics screen (`screens/DiagnosticsScreen.qml:44-47, 125-142`) and Maintenance screen (`screens/MaintenanceScreen.qml:35-36`) show six inert relay tiles labelled "available with an APU firmware update." They are inert because relays have **no write path**: gobi-agent only writes holding registers 10/12/14/18/20, and the STM32 drives every output purely from its op-state machine (`control_outputs.c:8` `outputs_apply()`, called each 10 ms). There are **no Modbus coils** — actuation is holding-register writes only.

This spec adds a **guarded Component Test mode**: a maintenance-passcode-gated, interlocked, auto-timing-out diagnostic mode that lets a technician actuate individual outputs on the bench, safe by construction.

## Decisions (locked)

1. **All seven outputs are testable**, with the three engine relays (Fuel Pump, Starter, Glow Plug) **hard-interlocked** — firmware refuses to energize them unless the engine is stopped and ignition is off (or standby-override is set).
2. **Latched actuation with a firmware auto-timeout.** Tap to energize; firmware auto-drops on a timeout. Low-risk outputs are held on by a UI heartbeat; engine relays are capped at a short pulse regardless.
3. **Separate maintenance passcode** (distinct from the user Screen-Lock PIN) gates entry.
4. **Local-UI-only.** Never triggerable from the AWS IoT shadow (`apu_command` stays ignored — `main.c:333-336`).
5. **Single active output at a time**, enforced in firmware: energizing an output releases any other currently-energized test output. A component test exercises one relay at a time; combinations are out of scope.

## Output index map

`DIAG_OUT` index = the firmware `OUT_*` enum value directly (`board_pins.h:5-10`, `OUT_COUNT=7`):

| index | output | risk tier | actuation |
|---|---|---|---|
| 0 | Fuel Pump | **engine — interlocked** | pulse, cap ~5 s, no heartbeat extend |
| 1 | Starter | **engine — interlocked** | pulse, cap ~4 s (matches real crank pulse), no heartbeat extend |
| 2 | Glow Plug | **engine — interlocked** | pulse, cap ~5 s, no heartbeat extend |
| 3 | Compressor Clutch | low | latched, heartbeat-held, 10 s inactivity drop |
| 4 | Heat Reverser | low | latched, heartbeat-held, 10 s inactivity drop |
| 5 | Evap Fan | low | latched; on = GPIO on + PWM 100% |
| 6 | Condenser Fan | low | latched; on = GPIO on + PWM 100% |

## Modbus contract (3 new holding registers, slave id 1)

Free register slots the firmware already earmarks as control space (`app_main.c:147`; firmware free regs: 2,4,5,9,41,49,50).

- **reg 49 — `DIAG_MODE` (R/W).** Write `1` = enter Component Test, `0` = exit. Read = current mode (1/0). Entry is interlock-gated in firmware; a refused entry returns Modbus exception `ILLEGAL_VALUE` (0x03) and mode stays `0`.
- **reg 50 — `DIAG_OUT` (W).** Command one output. Value = `(index << 8) | state`, `index` 0..6 (table above), `state` 0/1. Honored only while `DIAG_MODE == 1`; a write with an engine-relay index while the interlock is not satisfied returns `ILLEGAL_VALUE`. **Every accepted write resets the global inactivity timer.**
- **reg 41 — `DIAG_STATUS` (R).** Bitmask, bit *i* = output *i* currently energized. The UI reflects real output state from this register (not just optimistic UI state).

The register map + encoding is the **cross-repo contract**; it is documented in one shared place (a `docs/` register-map note referenced from both repos) and asserted at build where practical.

## Firmware design (`g0b1-firmware`)

**New op-state `OP_DIAG`.** Register a handler in `control_app.c:10-15` (a spare, currently-unregistered op-state slot exists). While active `OP_DIAG` is the **only** writer of `ctx->out`, so it cannot fight the normal mode handlers, and hardware is still driven through the single audited path `outputs_apply()` (`control_outputs.c:8`). Entry runs `control_deenergize_all()` (`control.c:44`) first, so only explicitly-commanded outputs energize.

**Command registers** bound in `control_regs_register()` (`control_io.c:38`), following the reg-34 "write triggers an action" precedent (`mbp_sys.c:12`):
- `DIAG_MODE` writer: on `1`, evaluate the entry interlock; if it passes, set `op_state = OP_DIAG` and arm the inactivity timer; else return `ILLEGAL_VALUE`. On `0`, `deenergize_all()` + `op_state = OP_OFF`.
- `DIAG_OUT` writer: only honored when `op_state == OP_DIAG`; validate `index < OUT_COUNT`; for engine indices (0,1,2) re-check the interlock and return `ILLEGAL_VALUE` if not satisfied. On `state == 1`, **release any other energized test output first (single-active)**, then energize the named one; on `state == 0`, release the named output. Reset the inactivity timer on every accepted write.
- `DIAG_STATUS` reader: return the energized-output bitmask.

**Entry interlock** (reuses existing checks at `control_engine_start.c:111-115` / `control_battery.c:79-84`): allowed only when `op_state == OP_OFF`, engine stopped (`engine_op_status == ST_OFF`, `ctx->out.fuel_pump == false`), and **not** (`in_truck_ignition && !standby_override`).

**Per-relay engine gate:** energizing Fuel/Starter/Glow (index 0,1,2) requires the same engine-off + ignition-off condition at command time, re-checked in the `DIAG_OUT` writer.

**Auto-timeout (the comms-loss failsafe — RS-485 has no deadman today):** a new `app_timer` (`app_timers.h` `SCALE_SECOND` group), reset on entry and on every accepted `DIAG_OUT` write. On expiry the `OP_DIAG` handler calls `deenergize_all()` and returns to `OP_OFF`. Values:
- **Global inactivity:** ~10 s with no `DIAG_OUT` refresh → drop all + exit.
- **Engine-relay max-on:** each engine relay auto-drops after its cap (Starter ~4 s, Fuel/Glow ~5 s) even if the mode stays active and even if refreshed.

**Additional exits / failsafes:** `reg 10 == MODE_OFF` forces an immediate exit (deenergize + `OP_OFF`); boot safe-off (`app_main.c:100-108`) and the ~2 s IWDG (`app_main.c:172-192`) are unchanged; the diag handler must not block the superloop.

## gobi-agent design (`cortex-yocto`)

Symmetric extension of the existing `command.json` → Modbus path (`main.c:521-570`), no new libmodbus code:
- New consumed keys in `apply_command_file()`: `diag_mode` (0/1 → `mb_write_reg(49, …)`), `diag_out` (pre-encoded `(index<<8)|state` int → `mb_write_reg(50, …)`).
- Read reg 41 each poll (add to `config.h` read map and `telemetry_t`), publish `diagActive` (reg 49) + `diagOutputs` (reg 41 bitmask) to `latest.json` (`build_telemetry_json`).
- Document the new keys in the `COMMAND_JSON_PATH` comment (`config.h:78-79`).
- Shadow `apu_command` remains ignored — Component Test cannot be remotely triggered.

## gobi-ui design (`cortex-yocto`)

**TelemetryModel** (`TelemetryModel.{h,cpp}`): add `Q_INVOKABLE enterComponentTest()`, `exitComponentTest()`, `setTestRelay(int index, bool on)` (thin `writeCommand` one-liners writing `diag_mode`/`diag_out`), and `Q_PROPERTY diagActive` (bool) + `diagOutputs` (int bitmask), both `NOTIFY dataChanged`.

**Deadman heartbeat:** while any low-risk output is on, the UI re-sends its `setTestRelay(index, true)` every ~3 s (well inside the firmware's ~10 s timeout). The output therefore stays on while the UI + link are alive and drops the moment they are not. Engine relays are fire-once: the UI sends `on` once; firmware caps the pulse; the UI never heartbeats them.

**Maintenance passcode:** a new `MaintController` singleton mirroring `LockController.qml`, holding a **separate** maintenance PIN — stored like other device config (e.g. a file under `/etc/ecofleet` or QSettings), with a build-time default, changeable — reusing `atoms/Keypad.qml`.

**Diagnostics UX** (`screens/DiagnosticsScreen.qml`): keep START/STOP + the Evap-Fan slider. Replace the inert tile grid (`:127-142`) with the live test grid:
- An "Enter Component Test" affordance → maintenance `Keypad` overlay → `enterComponentTest()`.
- If firmware refuses (interlock), show *"Component test needs the engine off and ignition off."*
- Once `diagActive`, tiles go live: each shows name + real on/off from `diagOutputs`, tap to toggle via `setTestRelay`. Selecting a new output releases the current one (single-active, matching firmware). Engine relays (Fuel/Starter/Glow) are styled distinctly (⚠) and require an extra confirm tap ("Crank/prime — confirm?"); a visible countdown reflects the auto-timeout.
- "Exit Test" **and** leaving the screen (StackView pop / deactivation) both call `exitComponentTest()`.
- START/STOP + the fan slider are disabled while `diagActive` (the APU is in `OP_DIAG`, not climate/off).

**Graceful degradation:** on a device running old firmware, `enterComponentTest()` yields a Modbus exception (reg 49 unbound), so `diagActive` never becomes true; the tiles stay inert with today's "available with a firmware update" message. A gobi-ui update thus never offers a test the firmware cannot honor (the two ship from separate repos/cadences).

## Safety model (defense in depth)

Passcode gate (UI) → explicit interlocked entry (engine off + ignition off) → per-relay engine interlock re-checked at command time → latched-with-timeout + engine-relay pulse caps → fail-safe drop on comms loss (firmware inactivity timer), `MODE_OFF`, or power-cycle (boot safe-off) → local-only (no shadow). Entry starts from `deenergize_all()`; `OP_DIAG` is the sole output writer while active.

## Testing

- **Firmware (host-testable, the existing 63-test suite):** TDD the entry interlock (allow from OFF/engine-off; refuse ignition-on-without-override; refuse engine relays when running), the inactivity + engine-pulse timeouts dropping outputs, `MODE_OFF` immediate exit, and the `DIAG_STATUS` bitmask. This is the safety-critical bulk and is provable off-hardware.
- **gobi-agent:** unit/mock the `diag_mode`/`diag_out` key mapping to reg 49/50 writes and reg 41 → telemetry.
- **gobi-ui:** offscreen qml harness (`QT_QPA_PLATFORM=offscreen`) for the Component Test flow, passcode gate, tile state binding, and heartbeat timer.
- **Bench (the real component test):** actuate each relay; verify interlocks (attempt with ignition on → refused), the auto-timeout, and a comms-loss drop (kill gobi-agent → outputs release within the timeout). Requires the new firmware flashed + a gobi-ui build.

## Cross-repo sequencing

1. **Firmware first** (it's the gate and host-testable): `OP_DIAG` handler, reg 49/50/41 binds, interlock, timeouts — on a branch in `g0b1-firmware`.
2. **gobi-agent + gobi-ui** (`cortex-yocto`): command mapping, telemetry props, invokables, `MaintController` + Keypad, Diagnostics UI.
3. Shipped together; gobi-ui degrades gracefully against older firmware in the interim.
4. The register map (49/50/41 + encoding) is the shared contract — documented once and asserted at build where practical.

## Out of scope (future)

- Per-relay diagnostic *feedback* (current sense / fault detection) beyond on/off state.
- Calibration and fault-code history (the other Maintenance-screen placeholders).
- Remote/fleet-triggered component test (deliberately excluded — local-only).
- Variable fan duty in test mode (test energizes fans at 100%).
