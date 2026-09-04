# VEVOR XMZ-F-D5 Diesel Heater Control — Design Spec

**Date:** 2026-09-03
**Status:** Draft — design approved in brainstorm (control model, bench timing, UI placement, and control scope decided); pending spec review, then implementation plan(s).
**Repos:** `g0b1-firmware` (STM32 firmware) and `ecofleet-firmware` (= `cortex-yocto`: gobi-agent + gobi-ui).
**Source material:** Robb's handoff archive (`VEVOR_XMZ-F-D5_Claude_Handoff.zip`) — a reverse-engineered, actively-proven heater protocol, a provisional STM32 driver, a Python reference, and two raw HTerm captures. The VEVOR protocol layer is treated as **verified**; the WK2132/I2C HAL port is **provisional until hardware bench**.

## Goal

Let the operator run a **VEVOR XMZ-F-D5 diesel-fired air heater** from the EcoFleet system — turn it on/off and set a heat level (1–10) from the touchscreen (and remotely via the cloud), and see the heater's live state and telemetry. The heater's own ECU keeps full responsibility for combustion, glow plug, fuel pump, fan, ignition, faults, and the multi-minute startup/cooldown sequences. The STM32 is a **relay + reporter**, never a combustion controller.

## Decisions (from brainstorm)

1. **Control model = manual, extensible.** The user sets On/Off + level 1–10 directly; the firmware forwards start/stop/level and reports telemetry. No closed-loop thermostat. The Modbus register block is laid out so a future "HEAT mode" (setpoint → level loop) can be added without renumbering.
2. **No hardware in hand yet → build bench-ready.** Everything is verified this cycle by host tests (including a regression against the two captured logs), captured-frame fidelity, and code review. Live bench (DFR0627 bring-up → fueled-heater start/cooldown) is a documented follow-up.
3. **UI = compact Heater card on Home.** A fourth control block on the thermostat Home screen: On/Off + level 1–10 + live state + a small fan/temp readout + error badge.
4. **Control scope = local + cloud shadow.** Heater control and telemetry flow through the on-device `command.json`/`latest.json` path (like the thermostat) **and** through the AWS IoT device shadow (reported heater telemetry + desired start/stop), scoped to the heater.

## Context / why this shape

- **Both STM32 UARTs are already committed:** USART1 = RS-485 (Modbus to Cortex), LPUART1 = Ezurio 453-00001R radio. The heater's one-wire UART must come from a **new peripheral**.
- **The new peripheral is a DFRobot DFR0627 I2C-to-dual-UART bridge (WK2132-ISSG)** on the STM32's **I2C2** (PA11 = SCL, PB14 = SDA — both currently unused and free). WK2132 UART1 runs the heater link at **4800 8N1**. Base 7-bit I2C address 0x70 (DIP A1=1, A0=1); the WK2132 encodes UART channel + register/FIFO object in the low address bits.
- **The heater data line is a shared, open-drain-style one-wire bus** idling high at ≈3.86 V. A push-pull UART TX must never drive it directly; a non-inverting open-drain stage (e.g. SN74LVC1G07 or cascaded NPN) sits between the DFR0627 TX and the heater data line, and the DFR0627 RX must be level-limited from the ≈3.86 V bus. The factory VEVOR display must be disconnected while the replacement controller transmits (no two masters). **This level-shift + power wiring is Robb's hardware task and is out of scope for the firmware, but the firmware's driver assumes it.**
- The DFR0627 is powered from the **switched 3P3_VCC rail** (the same rail the firmware already enables at boot); the WK2132 is initialized only after that rail is stable. (Board-rev note: on rev R0 the rail enable is PC3=VCC_EN; on rev R1 PC3 is repurposed as LEDS_OFF — the target board rev and the exact bridge power source must be confirmed at bench. See Open Items.)
- The DFR0627 is rated to only 85 °C; this is acceptable for proof-of-concept but **must be flagged against any final 125 °C component requirement**.

## Verified VEVOR protocol (reference — do not re-derive)

Serial: **4800 8N1**, controller transmits ≈1×/second.

- **Controller frame:** 16 bytes, `AA 66`, checksum at byte 15.
- **Heater frame:** 56 bytes, `AA 77`, checksum at byte 55.
- **Checksum:** `sum(frame[2 : checksum_index]) & 0xFF` (AA and device ID excluded).

Controller frame: `AA 66 CC 0B 00 00 00 00 LL SS QQ 00 00 00 00 CS`
- `LL` = level `01..0A`.
- **Start:** `CC=06 SS=06 QQ=00`, sent **four times**, then transition to run/poll.
- **Run/poll:** `CC=02 SS=06 QQ=02`.
- **Stop/cooldown:** `CC=06 SS=05 QQ=00`, repeated ≈1×/s until the heater reports state 00.

Heater telemetry fields used: `[5]` state (0 off / 1 preheat / 2 ignition / 3 running / 4 cooldown), `[6]` level, `[7]` error (0=none), `[11]` supply V ×10, `[14]` cooldown flag, `[16..17]` BE exchanger/temp raw, `[20..21]` BE state-duration seconds, `[23]` pump Hz ×10, `[28..29]` BE fan RPM.

**Safety invariant (governs the whole feature):** the heater ECU owns combustion and safety. Never stop the heater by removing power. Continue valid stop/cooldown commands until a **recent, checksum-valid** heater response explicitly reports **state 00**. Startup takes >3 minutes; shutdown/cooldown ≈5 minutes.

## Architecture

```
VEVOR heater ECU ──one-wire 4800 8N1──▶ DFR0627 / WK2132 bridge ──I2C2 (PA11/PB14)──▶ STM32 G0B1
  (owns glow/pump/fan/ignition/cooldown)                                                    │
                                    Modbus holding-register block (heater cmd + telemetry)    │
                            RS-485 / Modbus ▲                                                  ▼
  Qt UI (Home Heater card) ◀─latest.json / command.json─▶ gobi-agent ◀──RS-485/Modbus──────┘
                    ▲                                          │
                    └───────── AWS IoT device shadow ──────────┘  (reported heater telemetry + desired start/stop)
```

The heater subsystem is **independent of the APU op-state machine** (`OP_OFF`/`OP_CLIMATE`/`OP_BATTERY`/…). A diesel bunk heater is used precisely when the engine is off, so the heater service runs on its own scheduler tick regardless of op-state, and its command registers act directly on the heater driver.

## Component F1 — STM32 firmware (`g0b1-firmware`)

### F1.a Protocol layer — preserved, made host-testable

The supplied `vevor_heater.c/.h` (frame build/parse/checksum, telemetry decode, and the `VEVOR_Init/Process/Start/SetLevel/Stop` + `IsResponseFresh`/`IsSafeToPowerDown` nonblocking state machine) is **verified logic and is preserved intact**. The single adaptation: the WK2132 register access is routed through the project's existing **`i2c_backend_t`** abstraction (the same one `rtc.c`/`drv_mcp7940n.c` use), so:

- The verified protocol layer and the WK2132 register logic compile into the **Unity host-test harness** and run against a `fake_i2c` backend.
- The two captured logs (`output_2026-09-03_17-06-34.log`, `output_2026-09-03_17-23-50.log`) become a **golden-frame regression**: every heater response re-checksummed, decoded by our parser, and cross-checked; our builders reproduce the exact controller start/run/stop frames from `PROTOCOL.md`.

New portable modules under `App/services/`:
- `vevor_heater.c/.h` — the adapted, backend-driven protocol + FSM (verified).
- `wk2132.c/.h` — the WK2132 register/FIFO logic, backend-driven (provisional; host-tested against `fake_i2c` for the documented init/FIFO register sequences).
- `heater.c/.h` (or fold into the above) — the thin service that owns the `VEVOR_t` instance, maps the Modbus command registers onto `VEVOR_Start/SetLevel/Stop`, and publishes telemetry into the register providers.

### F1.b On-target driver (bench-pending, not host-unit-tested)

- `cube/Core/Src/drv_wk2132_i2c2.c` — implements the `i2c_backend_t` over **HAL I2C2** (PA11 SCL / PB14 SDA), exposing a `drv_wk2132_i2c2_backend()` factory (mirrors `drv_mcp7940n_backend()`).
- `.ioc` change: enable I2C2 on PA11/PB14 (open-drain AF), 100 kHz (traffic is tiny), plus the generated `MX_I2C2_Init()`/`hi2c2`. The DFR0627 supplies its own 5.1 kΩ pull-ups — account for any board pull-ups before adding more.
- Verified by host-compile + the documented bench bring-up; **not** host-unit-tested (hardware seam), exactly like the RS-485 transport in the remote-update project.

### F1.c Scheduler + init wiring

- `VEVOR_Process(now)` called from `control_10ms_slot()` (fast enough for the ≤10 ms RX-poll cadence and to drain the WK2132 RX FIFO).
- A 1 Hz telemetry sample + register publish from `control_1s_slot()` (mirrors `control_climate_sample_settings`).
- Driver init in `app_main` after peripheral bring-up and after the switched 3P3_VCC rail is confirmed stable: `WK2132_Init` → `WK2132_Begin4800_8N1` → `WK2132_FlushRx` → `VEVOR_Init`, via the `i2c_backend`-factory pattern (`heater_init(drv_wk2132_i2c2_backend())`).
- The multi-minute cooldown stays **non-blocking** (the FSM is tick-driven; no `HAL_Delay`), so the ~2 s IWDG (refreshed once per superloop pass) is never at risk.

### F1.d Modbus register block

The current map is full: `MB_REG_MAX = 52` with only regs 4–5 free. **Expand** `MB_REG_MAX` → **70** and `MB_REG_LIMIT` → **71** (updating `s_slots[]`, the wire bound-checks in `mb_engine.c`, and the fixed-size arrays in `Tests/`). This is independent of and does not touch the **frozen bootloader FC 0x41/0x42 contract** or reg 2/34/35 from the remote-update project. Heater block = **registers 53–67**, with **68–70 reserved** for the future thermostat extension (`heater_mode`/`heater_auto`/`heater_setpoint`).

| Reg | Name | R/W | Meaning |
|----|------|-----|---------|
| 53 | `heater_request` | RW | 0 = off/stop, 1 = on/run. Write 1 → `VEVOR_Start(level)`; write 0 → `VEVOR_Stop()`. |
| 54 | `heater_level` | RW | Target level 1–10. Write while on → `VEVOR_SetLevel()` (no restart). |
| 55 | `heater_state` | RO | 0 off, 1 preheat, 2 ignition, 3 running, 4 cooldown (heater-reported). |
| 56 | `heater_active_level` | RO | Heater-reported active level. |
| 57 | `heater_error` | RO | Heater error code; 0 = none. |
| 58 | `heater_supply_mv` | RO | Supply voltage in millivolts (byte[11] ×100). |
| 59 | `heater_fan_rpm` | RO | Fan RPM. |
| 60 | `heater_pump_hz_x10` | RO | Fuel-pump frequency ×10 Hz. |
| 61 | `heater_exchanger_raw` | RO | BE exchanger/temperature raw value (conversion TBD; raw for now). |
| 62 | `heater_state_seconds` | RO | Duration in the current heater state. |
| 63 | `heater_age_ms` | RO | ms since the last valid heater frame (saturating at 65535). |
| 64 | `heater_flags` | RO | bit0 fresh/valid, bit1 cooldown_flag, bit2 safe_to_power_down, bit3 comms_fault (no fresh frame while active), bit4 transport_fault (I2C/WK2132 error). |
| 65 | `heater_valid_frames` | RO | Valid-frame count (low 16 bits; diagnostic). |
| 66 | `heater_checksum_failures` | RO | Checksum-failure count (saturating; diagnostic). |
| 67 | `heater_transport_errors` | RO | I2C/transport error count (saturating; diagnostic). |

Convention: RO registers bind a NULL write fn (rejected with `MB_EXC_ILLEGAL_ADDRESS`, matching the existing model). `heater_request`/`heater_level` are the only writable heater registers.

### F1.e Safety semantics (critical)

- **Comms loss, MCU reset, mode change, or Cortex shutdown are NEVER permission to stop or power-cut** the heater. Only a fresh, checksum-valid **state-00** response sets `safe_to_power_down` (reg 64 bit2).
- **Loss of communication while the heater is active is a fault** (`comms_fault`, reg 64 bit3) surfaced in telemetry — not a stop.
- **Conservative reset recovery:** on MCU reset the firmware initializes to *stop-request* but **keeps polling**; if it finds the heater already running (state 1–4), it does not force a restart and does not power-cut — it resumes reporting and lets the operator/heater sequence continue. (The firmware never controls heater power directly regardless.)
- **`heater_request` defaults to 0 (stop) on boot**, but the FSM's actual TX is governed by the heater's reported state and the stop/cooldown invariant, not by a naive "off → silence."

## Component F2 — gobi-agent (`ecofleet-firmware`)

### F2.a Telemetry read → latest.json / MQTT

Add `#define REG_HEATER_*` wire constants (0-based) in `config.h`; add heater fields to `telemetry_t`; read them with the **best-effort** path (`modbus_read_reg_besteffort`) so the agent degrades gracefully on APU firmware that predates the heater block. Emit JSON keys in `build_telemetry_json` (a `heater_present` flag derived from a successful read of reg 55/64, plus `heater_state` (string), `heater_target_level`, `heater_active_level`, `heater_error`, `heater_fan_rpm`, `heater_pump_hz` (float), `heater_supply_v` (float), `heater_exchanger`, `heater_state_seconds`, `heater_age_ms`, `heater_safe_off` (bool), `heater_comms_ok` (bool), and the diagnostic counters).

### F2.b Command path (local)

Add `heater_on` (0/1) and `heater_level` (1–10) keys to `apply_command_file()`, validated then written via `mb_write_reg(53, …)` / `mb_write_reg(54, …)` — mirroring the existing `setpoint`/`diag_out` blocks. (All control is via holding registers; the firmware exposes no coils.)

### F2.c Cloud shadow (reported + desired)

- **Reported:** extend `shadow_reported_t` + `shadow_publish_reported()` with a heater sub-object (state, active level, error, fan RPM, safe-to-power-down, comms-ok) so remote observers see heater status each telemetry cycle.
- **Desired → applied:** extend `apply_desired()` to parse a heater desired block (`heater_on`, `heater_level`) into `shadow_config_t`, and wire a scoped peek/ack apply (reusing the existing `shadow_peek_apu_command`/`ack` idiom) that writes regs 53/54 from the telemetry thread. This is a **deliberate, heater-scoped** enablement of remote control — distinct from the currently-deferred whole-APU start/stop, which stays deferred. The same safety invariants apply: a shadow "off" is a stop *request*, never a power-cut.

## Component F3 — gobi-ui (`ecofleet-firmware`)

- **TelemetryModel:** add `Q_PROPERTY` heater fields (all sharing the existing `dataChanged()` NOTIFY), parsed from the new `latest.json` keys in `poll()`. Add `Q_INVOKABLE setHeaterOn(bool)` / `setHeaterLevel(int)` calling `writeCommand("heater_on", …)` / `writeCommand("heater_level", …)` (the same atomic `command.json` merge the thermostat uses).
- **HeaterCard on Home:** a compact fourth control block on `HomeScreen.qml` — On/Off toggle, a level 1–10 stepper (▲/▼ with a debounce timer like the setpoint), a live **state line** (preheat / ignition / running / cooldown), a small fan-RPM + exchanger-temp readout, and an **error/fault badge** (heater error code or `comms_fault`). Optimistic-then-reconcile, exactly like the thermostat's `setAuto`/`onDataChanged` pattern. It must clearly show cooldown-in-progress so the operator understands "off" isn't immediate.

## Safety (whole-feature summary)

This controls a fuel-fired combustion device. The binding rules:
1. The heater ECU owns all combustion hardware and safety; the STM32/agent/UI only request start/stop/level and report status.
2. Never remove heater power to stop. Continue valid stop/cooldown commands until a fresh, checksum-valid **state-00** response.
3. Comms loss / reset / shutdown ⇒ **fault + keep reporting**, never a silent stop or a power-cut.
4. The UI must not present "off" as instantaneous — cooldown is ≈5 minutes and is shown.
5. No fueled-heater command is issued at the bench until the staged bring-up (bus, address, loopback, framing, open-drain levels, state-00 with panel disconnected) has passed.

## Testing plan

**Host-testable (this cycle):**
- **Captured-frame regression** (Unity): re-checksum + decode every frame in both logs; builders reproduce `PROTOCOL.md` start/run/stop frames byte-for-byte (adapt the supplied `test_vevor.c`).
- **FSM tests:** start (4 start frames → run polling), set-level without restart, stop → cooldown → only-then safe-to-power-down; comms-loss-while-active → `comms_fault` and never safe-to-power-down; conservative reset recovery.
- **WK2132 register logic** against `fake_i2c` (init/FIFO/read/write sequences per the DFRobot reference).
- **Modbus register block:** reg 53/54 writes drive the FSM; RO regs reflect decoded telemetry; the `MB_REG_MAX` expansion passes the existing register-model tests.
- **Agent:** any pure heater decode/transform gets a small host test; the passthrough is exercised by inspection + the existing `tests/run.sh` staying green.
- **UI:** offscreen QML preview-verify of the Home HeaterCard states (off/preheat/running/cooldown/error/comms-fault).

**Bench (deferred, documented — Robb's hardware):** DFR0627 power + I2C2 bus scan → confirm WK2132 address → UART1 loopback FIFO → scope 4800-baud framing → open-drain level verify → heater connected with factory panel disconnected, prove valid state-00 → only then a fueled level-1 start + full cooldown. (From `INTEGRATION.md`.)

## Delivery

- **Firmware:** via SWD, or the STM32 remote-update path once that lands. (Adds new portable modules + one `drv_*` + an `.ioc`/register change — a normal firmware bump.)
- **Agent + UI:** via the normal signed cortex OTA (`.swu`).

## Open items / assumptions (confirm at/ before bench)

- Target **board rev** and the exact **DFR0627 power source** (existing switched 3P3_VCC vs. a dedicated enable) — the PC3 VCC_EN/LEDS_OFF difference between R0/R1 must be reconciled with the "Scorpion G1 = switched 3P3_VCC" wiring.
- Exact **WK2132 I2C sub-address encoding** and the confirmed A1/A0 DIP setting (base 0x70 assumed).
- **Exchanger-temperature conversion** (raw → °F/°C) — exposed as raw until characterized.
- **Level-shift / open-drain hardware** and the **125 °C final-component** requirement — Robb's hardware tasks, flagged not solved.

## Out of scope

- Closed-loop thermostat / "HEAT mode" auto control (the future extension the registers reserve room for).
- The open-drain level-shift stage, DFR0627 power wiring, and any final-temperature-rated component selection.
- Controlling the heater's combustion sequences (owned by the heater ECU, by design).

## Sub-projects (each its own plan)

The feature spans two repos and splits cleanly; recommended decomposition (like the STM32 remote update):

1. **STM32 heater firmware** (`g0b1-firmware`) — F1: adapt the verified protocol layer to the host-test backend seam, the WK2132 register logic + `fake_i2c` tests + captured-frame regression, the on-target I2C2/WK2132 driver + `.ioc`, the scheduler wiring, the register-block expansion, and the safety semantics. The larger, host-TDD-heavy half.
2. **Cortex heater control** (`ecofleet-firmware`) — F2 + F3: gobi-agent register reads + `command.json` keys + shadow reported/desired, and the gobi-ui `TelemetryModel` fields + Home HeaterCard. Depends on F1's register map.
