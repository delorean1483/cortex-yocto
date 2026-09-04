# VEVOR Diesel Heater — Cortex Control Contract

**Date:** 2026-09-03  
**Status:** Implemented  
**Scope:** gobi-agent telemetry & command paths; gobi-ui TelemetryModel fields & Home HeaterCard  

This document specifies the on-device and cloud control / reporting interfaces for the VEVOR XMZ-F-D5 diesel heater as exposed by the EcoFleet cortex system (gobi-agent + gobi-ui). For the authoritative STM32 firmware register map, protocol, and safety semantics, see [`docs/superpowers/specs/2026-09-03-vevor-heater-control-design.md`](./superpowers/specs/2026-09-03-vevor-heater-control-design.md) and [`docs/superpowers/plans/2026-09-03-vevor-heater-firmware.md`](./superpowers/plans/2026-09-03-vevor-heater-firmware.md).

---

## Telemetry: `latest.json` Keys

Emitted by `gobi-agent` via `build_telemetry_json()`. The `heater_present` flag indicates whether a heater telemetry read succeeded; on older APU firmware without the heater block, or when the read fails, all heater keys default and `heater_present` is `false`, causing the UI card to hide entirely.

| Key | Type | Range / Values | Source | Notes |
|-----|------|-----------------|--------|-------|
| `heater_present` | bool | — | Register 55 successful read | Hides the UI card when `false` |
| `heater_state` | string | `off`, `preheat`, `ignition`, `running`, `cooldown`, `unknown` | Register 55 decoded | Heater-reported state (0–4, 5=unknown) |
| `heater_target_level` | int | 1–10 | Register 54 readback | Last commanded level |
| `heater_active_level` | int | 0–10 | Register 56 | Heater-reported active level |
| `heater_error` | int | 0+ | Register 57 | Error code; 0 = none |
| `heater_supply_v` | float | volts | Register 58 (mV ÷ 1000) | Supply voltage |
| `heater_fan_rpm` | int | RPM | Register 59 | Combustion fan RPM |
| `heater_pump_hz` | float | Hz | Register 60 (×10 value ÷ 10) | Fuel-pump frequency |
| `heater_exchanger` | int | raw | Register 61 | Exchanger / temperature raw (conversion TBD) |
| `heater_state_seconds` | int | seconds | Register 62 | Duration in current state |
| `heater_age_ms` | int | ms | Register 63 | ms since last valid frame (saturates at 65535) |
| `heater_flags` | int | 0–31 | Register 64 | Raw flags word (see below) |
| `heater_safe_off` | bool | — | Flags bit 2 | Safe to remove power (after cooldown confirms state-00) |
| `heater_comms_ok` | bool | — | Flags bit 0 AND NOT bit 3 | Fresh frame AND no comms fault |
| `heater_valid_frames` | int | count | Register 65 | Diagnostic counter |
| `heater_checksum_failures` | int | count (saturating) | Register 66 | Diagnostic counter |
| `heater_transport_errors` | int | count (saturating) | Register 67 | Diagnostic counter |

**Flags word (register 64):**
- Bit 0: Fresh — most recent frame is valid
- Bit 1: Cooldown flag
- Bit 2: Safe to power down — comms loss / power removal OK
- Bit 3: Comms fault — loss of communication while active
- Bit 4: Transport fault — I2C / WK2132 error

---

## Command: `command.json` Keys

Written by `gobi-ui`, applied by `gobi-agent` via `apply_command_file()` → Modbus holding registers (firmware exposes no coils).

| Key | Type | Range | Register | Behavior |
|-----|------|-------|----------|----------|
| `heater_on` | int | 0 or 1 | 53 | 1 = start/run; 0 = stop request |
| `heater_level` | int | 1–10 | 54 | Target level. Write while running = set-level, no restart |

Both are validated (range-checked) before write. A write to register 53 invokes the firmware's heater start/stop FSM; a write to register 54 (during active heating) adjusts level without restart.

---

## AWS IoT Device Shadow

The heater has its own scoped shadow fields, independent of the whole-APU `apu_command` (which remains deferred).

### Reported (`state.reported.heater`)

Published every telemetry cycle:

```json
{
  "heater": {
    "state": "running",
    "level": 7,
    "error": 0,
    "fan_rpm": 2500,
    "safe_off": false,
    "comms_ok": true
  }
}
```

| Field | Type | Meaning |
|-------|------|---------|
| `state` | string | One of: `off`, `preheat`, `ignition`, `running`, `cooldown`, `unknown` |
| `level` | int | Heater-reported active level (register 56) |
| `error` | int | Heater error code; 0 = none |
| `fan_rpm` | int | Combustion fan RPM |
| `safe_off` | bool | Safe-to-power-down flag (register 64 bit 2) |
| `comms_ok` | bool | Comms healthy flag (fresh AND NOT comms_fault) |

### Desired (`state.desired.heater`)

Remote control from the cloud. Both fields are **independently optional** — a payload with at least one valid field arms the command.

```json
{
  "heater": {
    "on": 1,
    "level": 5
  }
}
```

| Field | Type | Range | Meaning |
|-------|------|-------|---------|
| `on` | int | 0 or 1 | 1 = start, 0 = stop request (optional) |
| `level` | int | 1–10 | Set level (optional, can be sent alone while running) |

**Examples:**
- `{"heater":{"on":0}}` — remote stop request
- `{"heater":{"level":5}}` — adjust level while running (no restart)
- `{"heater":{"on":1,"level":8}}` — start at level 8

**Application & acknowledgment:** The desired fields are applied from the gobi-agent telemetry thread only (libmodbus is single-threaded). The command is **acknowledged** (both fields nulled) **only after** the register write(s) succeed; if the write fails, the fields remain pending and the command retries the next telemetry cycle. This provides reliable remote control within the agent's existing constraints.

---

## Home HeaterCard Behavior (gobi-ui)

A compact fourth control block on the Home screen (below the fan presets). Shown only when `heater_present` is `true`.

### Layout & Controls

- **On/Off toggle:** Optimistic (updates immediately), reconciles to firmware state on next poll
- **Level stepper (▲/▼):** 1–10, with ~350 ms debounce between steps
- **State line:** Displays one of: `OFF`, `PREHEAT`, `IGNITION`, `RUNNING`, `COOLING DOWN…`, `UNKNOWN`
- **Fan RPM + Exchanger readout:** Live telemetry display (e.g., "2500 RPM / 52°F")
- **Error / fault badge:** Shown when `heater_error != 0` OR `!heater_comms_ok`, displaying the error code or a comms-fault indicator

### Critical Presentation Rule

The card **must clearly show `COOLING DOWN…` as in-progress** so the operator understands that an "off" command initiates a ~5-minute cooldown sequence, not an instantaneous shutdown. This prevents the user from thinking the heater stops immediately.

### Interaction Pattern

Matches the existing thermostat (optimistic-then-reconcile):
1. User taps toggle or stepper → `TelemetryModel.setHeaterOn(bool)` or `setHeaterLevel(int)`
2. UI updates immediately (optimistic)
3. Command written to `command.json`
4. Next `latest.json` poll reconciles the displayed state to firmware reality
5. If the write or read fails, the UI reverts to the last known good state

---

## Safety Note

**A heater "off" from the UI or cloud is a STOP REQUEST, never a power-cut.**

- The heater ECU owns all combustion hardware: glow plug, fuel pump, fan, ignition, and the multi-minute startup (>3 min) and cooldown (~5 min) sequences.
- The STM32 firmware, gobi-agent, and gobi-ui **never remove heater power** to stop; only the firmware's stop request commands the sequence.
- `heater_safe_off` (flags bit 2) and `heater_comms_ok` (bit 0 AND NOT bit 3) **come directly from the firmware flags word** — the cortex does not re-derive or weaken these safety signals.
- Comms loss / reset / power loss while heating is a **fault** (`heater_comms_ok` goes false), **never silent recovery or an automatic stop**.

---

## Register Map Reference

The firmware Modbus holding-register block (wire addresses = firmware register − 1) spans **registers 53–67**, split across:
- **53–54:** Command registers (heater_request, heater_level) — RW
- **55–63:** Telemetry & state registers — RO
- **64–67:** Flags & diagnostics — RO

For the complete register map, bit-field definitions, and safety invariants, consult:
- **Spec:** [`docs/superpowers/specs/2026-09-03-vevor-heater-control-design.md`](./superpowers/specs/2026-09-03-vevor-heater-control-design.md) — Register table, Component F1.d
- **Firmware plan:** [`docs/superpowers/plans/2026-09-03-vevor-heater-firmware.md`](./superpowers/plans/2026-09-03-vevor-heater-firmware.md) — Implementation details & safety semantics

---

## Best-Effort Reads & Graceful Degradation

Heater telemetry is read via the **best-effort path** (`modbus_read_reg_besteffort` in gobi-agent), following the precedent for diag/fan_auto. On older APU firmware that predates the heater block, the read silently fails, `heater_present` becomes `false`, and the UI card hides. No error is logged or surfaced to the user — the system degrades gracefully and continues normal operation.

---

## History

- **2026-09-03:** Task 1–5 completed (firmware + cortex implementation); Task 6 documentation.
