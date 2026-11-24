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

**Application & acknowledgment:** The desired fields are applied from the gobi-agent telemetry thread only (libmodbus is single-threaded), by the 1 s heater tick (`heater_cmd.c`), so a command lands within about a second. Delivery rule: **ON at most once, STOP at least once.**
- An ON (`on: 1`) gets one delivery attempt (the write's own retries included). Whether the firmware accepts it, refuses it, or never answers, it is not sent again; the request readback shows the real state. A re-sent ON could start the heater long after the user asked, because the G0B1 re-arms START after a Cortex-silence stop.
- An ON older than 15 s, counted from the dashboard tap (shadow metadata timestamp), is dropped without being written. The same tap re-delivered by a shadow re-sync after a reconnect is ignored.
- A stop, level, setpoint or clear stays pending until the firmware answers (OK or a refusal) and is re-sent until then.
- The command is **acknowledged** (`desired.heater` nulled) once every write got an answer, an ON excepted.
- The panel follows the same rule. A panel Stop with no answer is re-sent every second until the firmware answers, and a panel Start or Stop supersedes a remote ON still pending (last writer wins).

The panel's "Check for updates" fetch runs on its own thread for the same reason: its 8 s network timeout would otherwise leave the bus silent. The same tick reads one register every second when it has nothing to send. That keepalive keeps the G0B1 (1.3.x) from stopping the heater: it stops it after 5 s without a good Modbus answer, and telemetry polls are 5 s or more apart.

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

G0B1 1.3.16 and later also answer three read-only registers outside that
block, which the agent reads with one extra FC03 (wire 2226, quantity 3) on
coprocessor firmware only. A G0B1 that answers ILLEGAL_ADDRESS (older than
1.3.16) is not asked again until its firmware version (reg 2) changes.
- **2227:** L011 firmware major<<8 | minor (0 while unidentified or in its loader)
- **2228:** L011 firmware build
- **2229:** last `0xB011` update-loader entry rejection (0 none, 1 phase not OFF,
  2 run request set, 3 lamp not confirmed off, 4 app identity/map mismatch,
  5 heater mode set, 6 loader/I²C error); a successful entry clears it

They go out as `heater_l011_fw` (`0.2.3`) and `heater_l011_reject`, the agent
logs each new L011 version and each new rejection, and the dashboard Heater tab
shows both under Link health.

### AUTOTERM control mode (G0B1 1.3.17 + L011 0.2.4)

The AUTOTERM can run in **temperature** mode (regulates to the setpoint, reg
69, using the cabin temperature the G0B1 sends) or **power** mode (a fixed
power level, reg 54 1–10 → heater 0–9). Both values stay stored in either mode.
- **Reg 70 bit 8 (0x0100):** the mode can be chosen (AUTOTERM only).
- **2230 (wire 2229), RW:** 0 temperature, 1 power. Reads the APPLIED mode.
  Writes are refused (ILLEGAL_VALUE) on a heater without the bit and during
  maintenance; an explicit OFF beats a pending mode change. A running heater
  changes over with one SETTINGS frame, never a second START.

The agent reads 2230 in the same FC03 as 2227–2229 (quantity 4) only while
reg 70 has bit 8. If the G0B1 refuses it (a G0B1 rolled back under L011 0.2.4,
which keeps its stored mode), the agent reads 2227–2229 alone and doesn't ask
for 2230 again until the G0B1 firmware changes; no mode is shown then. A read
with no answer keeps the last mode. So does a reading taken while the L011 is
unidentified (2227/2228 both 0) or reg 64 shows a heater-link or map fault
(bits 3, 5, 6): 1.3.17 answers 2230 with 0 then (no exception), which means
"unknown", not "temperature".

- `heater_mode` (`temperature` / `power`) and `reported.heater.mode`: only
  where the mode can be chosen. `heater_control` follows the applied mode
  (power → `level`, temperature → `setpoint`), so the panel, the Heater tab
  and the Overview show the matching control.
- Commands: panel `heater_mode` and shadow `desired.heater.mode`
  (`"temperature"` | `"power"`), written to fw 2230 after `clear_fault` and
  before setpoint → level → on, so a START goes out in the chosen mode.
  Delivered at least once like a setpoint; only on coprocessor firmware.
- Panel: the card's SET/LEVEL caption becomes a TEMP | POWER switch. It is
  optimistic and clears when the applied mode reads back, or after 30 s.
- Dashboard: a Mode cell and Temperature/Power buttons with a confirm.

### Host-owned level, setpoint and mode (after a G0B1 reboot)

The G0B1 keeps reg 54 (level), 69 (setpoint °C) and 2230 (mode) in RAM and
boots with level 1, 20 °C and temperature mode; the host owns them. The agent
remembers the last value of each that a command (panel or shadow) got
accepted, in `/data/ecofleet/heater-host.json` (with no file, each is seeded
once from the first good readback), and writes them back, 54 → 69 → 2230,
on coprocessor firmware:
- on the first good poll after the agent starts (with a file);
- on the first good poll after any poll, keepalive or write got no answer;
- when the 54 or 69 readback differs from the remembered value (only the
  agent writes them, so that means the G0B1 lost them);
- when the trusted 2230 readback has differed from the remembered mode for
  30 s: the L011 reset on its own and came back in temperature mode (it only
  applies its stored mode after a host writes it; 54/69 live on the G0B1 and
  still match). The hold covers the few seconds 2230 lags a mode write.

2230 only while reg 70 bit 8 is set; a mode left out is written once the bit
is back. Never reg 53 or 75, so it never starts or stops the heater. Held
while a heater command is pending, at most once per 10 s, 60 s after a refused
write or after a mismatch (54/69 or mode) the last write-back didn't fix. Code:
`gobi-agent/files/heater_host.c`. To set these registers by hand on a bench
with the agent running, send a command (or delete the file first): the agent
puts back what it remembers.

For the complete register map, bit-field definitions, and safety invariants, consult:
- **Spec:** [`docs/superpowers/specs/2026-09-03-vevor-heater-control-design.md`](./superpowers/specs/2026-09-03-vevor-heater-control-design.md) — Register table, Component F1.d
- **Firmware plan:** [`docs/superpowers/plans/2026-09-03-vevor-heater-firmware.md`](./superpowers/plans/2026-09-03-vevor-heater-firmware.md) — Implementation details & safety semantics

---

## Best-Effort Reads & Graceful Degradation

Heater telemetry is read via the **best-effort path** (`modbus_read_reg_besteffort` in gobi-agent), following the precedent for diag/fan_auto. On older APU firmware that predates the heater block, the read silently fails, `heater_present` becomes `false`, and the UI card hides. No error is logged or surfaced to the user — the system degrades gracefully and continues normal operation.

---

## History

- **2026-09-03:** Task 1–5 completed (firmware + cortex implementation); Task 6 documentation.
