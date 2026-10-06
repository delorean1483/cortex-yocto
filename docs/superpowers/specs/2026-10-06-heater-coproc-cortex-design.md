# Heater Coprocessor — Cortex Follow-up (Modbus regs 68–75) — Design

**Date:** 2026-10-06
**Status:** Draft for review
**Depends on:** g0b1-firmware PR #12 (merged @ 08018fb) — heater coprocessor; Modbus heater block now 53–75.
**Firmware spec:** g0b1-firmware `docs/superpowers/specs/2026-10-06-heater-coprocessor-design.md` §7.

## 1. Purpose

The G0B1 now reaches heaters through the heater coprocessor, which supports
both VEVOR (level 1–10) and AUTOTERM (temperature setpoint) heaters, detects
which one is attached, and latches faults that must be cleared before a
restart. Firmware exposes this in Modbus regs 68–75. Cortex (gobi-agent,
gobi-ui, cloud dashboard) still only understands regs 53–67.

Goal: surface heater type, phase, setpoint control and fault clearing end to
end — on the in-cab panel and the cloud dashboard — without breaking units
on older firmware.

### Decisions (brainstorm)

| # | Decision |
|---|---|
| C1 | Scope = device (gobi-agent + gobi-ui) **and** cloud (ingest, API, frontend Heater tab). |
| C2 | Clear Fault available **on-screen and on the dashboard** (dashboard: existing `heater` permission + confirm). Clearing never starts the heater; a separate ON is required. |
| C3 | Setpoint shown in **°F, 41–86**, converted to whole °C (5–30) for the firmware. |
| C4 | Reg 74 (heater type select) is a bench override — **no UI**; detected type is shown read-only. |
| C5 | Old firmware (no regs 68–75) behaves exactly as today. |

## 2. Firmware contract consumed (firmware reg N = Modbus wire N−1)

| fw reg | Name | RW | Meaning |
|---|---|---|---|
| 55 | state | RO | legacy 0 off / 1 starting / 3 running / 4 cooldown (unchanged) |
| 57 | error | RO | vendor fault code; 0xFF = coprocessor fault without a code |
| 68 | heater_type | RO | 0 none, 1 VEVOR, 2 AUTOTERM |
| 69 | heater_setpoint_c | RW | 5–30 °C |
| 70 | heater_caps | RO | bit0 CAP_LEVEL, bit1 CAP_SETPOINT, … |
| 71 | heater_phase | RO | 0 off, 1 detecting, 2 starting, 3 running, 4 stop_requested, 5 cooldown, 6 fault |
| 72 | heater_vendor_state | RO | major<<8 \| sub |
| 73 | heater_detect | RO | detect_result<<8 \| line_sense |
| 74 | heater_type_select | RW | not used by cortex (C4) |
| 75 | heater_command | RW | write 3 = CLEAR_FAULT (others unused here); read = last CMD_RESULT (0 OK, 1 BUSY, 2 BAD_ARG, 3 NOT_SUPPORTED, 4 NO_TYPE) |

Firmware behaviour cortex relies on: on FAULT the G0B1 latches reg 53 to 0
(the agent will read `heater_request` 0); CLEAR_FAULT is accepted only when
the heater reports standby (else CMD_RESULT BUSY); clearing never restarts.

## 3. gobi-agent

### 3.1 New pure module `heater_ext.c/.h` (host-tested)

- `heater_type_name(uint16_t)` → `"none" | "vevor" | "autoterm" | "unknown"`.
- `heater_phase_name(uint16_t)` → `"off" | "detecting" | "starting" | "running" | "stopping" | "cooldown" | "fault"` (`stop_requested` → `"stopping"`; out of range → `"unknown"`).
- `heater_control_name(uint16_t caps)` → `"setpoint"` if CAP_SETPOINT, else `"level"`.
- `heater_c_to_f(int c)` → whole °F (rounded); `heater_f_to_c(int f)` → whole °C (rounded), clamped to 5–30.
- `heater_vendor_state_str(uint16_t, char *buf, size_t)` → `"4.0"`.
- `heater_present_from(bool state_ok, bool type_ok, uint16_t type)` → `state_ok && (!type_ok || type != 0)` (C5: `type_ok` false on old firmware).

### 3.2 Reads (main.c, best-effort, like 53–67)

`config.h`: `REG_HEATER_TYPE 67`, `REG_HEATER_SETPOINT_C 68`, `REG_HEATER_CAPS 69`,
`REG_HEATER_PHASE 70`, `REG_HEATER_VENDOR_ST 71`, `REG_HEATER_DETECT 72`,
`REG_HEATER_COMMAND 74` (wire addresses). Reg 68 is read with the `_ok`
variant to learn whether the extended block exists (`heater_ext`).

### 3.3 `latest.json` / MQTT telemetry — new keys

Emitted **only when `heater_ext`** (firmware has regs 68–75); old firmware's
payload is byte-for-byte unchanged (C5).

| Key | Type | Source |
|---|---|---|
| `heater_type` | string | reg 68 via `heater_type_name` |
| `heater_phase` | string | reg 71 via `heater_phase_name` |
| `heater_control` | string | reg 70 via `heater_control_name` |
| `heater_setpoint_f` | int | reg 69 °C → °F |
| `heater_vendor_state` | string | reg 72, `"major.sub"` |
| `heater_fault` | bool | phase == 6 |
| `heater_cmd_result` | int | reg 75 |

`heater_present` uses `heater_present_from` (fixes the always-visible card on
new firmware without a heater/coprocessor). Existing keys unchanged.

### 3.4 Local commands (`command.json`, from gobi-ui)

- `heater_setpoint_f` (int 41–86) → reg 69 = `heater_f_to_c(v)`; out of range ignored.
- `heater_clear_fault` (1) → reg 75 = 3. Ignored if `heater_ext` is false.

### 3.5 Shadow

- `reported.heater` (still presence-gated) gains, when `heater_ext`: `type`, `phase`, `control`, `setpoint_f`, `fault`.
- `desired.heater` accepts two more independently-optional fields: `setpoint_f` (int 41–86) and `clear_fault` (`true`). Same machinery as `on`/`level`: sentinel = not provided, applied on the Modbus thread, ack (null `desired.heater`) only after every provided write succeeded, compare-and-clear by `heater_desired_seq`. Out-of-range fields are dropped with a log line, like `level`.
- Apply order within one desired: `clear_fault` → `setpoint_f` → `level` → `on`, so "clear then start" in one message works when the firmware accepts the clear.

## 4. gobi-ui

### 4.1 TelemetryModel

New read properties: `heaterType`, `heaterPhase`, `heaterControl`, `heaterSetpointF`, `heaterVendorState`, `heaterFault`, `heaterCmdResult`, `heaterExt` (true when the keys are present).
New writers: `setHeaterSetpointF(int)` → `command.json {"heater_setpoint_f": v}`, `clearHeaterFault()` → `{"heater_clear_fault": 1}`.

### 4.2 HeaterCard

- Header: `HEATER` + type tag (`VEVOR` / `AUTOTERM`, hidden when `!heaterExt`); state label from `heaterPhase` when `heaterExt` (adds **Detecting**, **Stopping**, **FAULT**), else from the legacy `heaterState` exactly as today.
- Control row: `LEVEL` stepper (1–10) when `heaterControl == "level"` or `!heaterExt`; `SETPOINT` stepper (41–86 °F, step 2) when `"setpoint"`. Optimistic/dirty reconcile pattern identical to the level stepper.
- Fault: red `FAULT` badge (+ `ERR n` when error ≠ 0 and ≠ 255) and a **CLEAR FAULT** button using the two-tap confirm pattern from WiFi Forget; ON toggle disabled while `heaterFault`. If a clear returns BUSY (`heaterCmdResult == 1`) the button shows "Heater still cooling — try again".
- `Mocks.qml` gains the new fields; preview shots: VEVOR level, AUTOTERM setpoint, detecting, fault, old-firmware (no ext).

## 5. Cloud

### 5.1 Ingest (`cloud/lambda/ingest/telemetry-map.js`)

Tags: `heater_type`, `heater_phase`, `heater_control`. Fields: `heater_setpoint_f`, `heater_cmd_result`. Bools: `heater_fault`. `heater_vendor_state` stored as a tag (string).

### 5.2 API

- `telemetry-view.js`: pass the seven new keys through.
- `permissions.js validateCommand`: `heater` object additionally accepts `setpoint_f` (integer 41–86) and `clear_fault` (`true` only); "needs on and/or level" becomes "needs at least one of on, level, setpoint_f, clear_fault". Permission action stays `heater`.
- `cloud/CONTRACT.md`: document the new telemetry keys and desired fields.

### 5.3 Frontend Heater tab

- Title: `{Type} diesel heater — {phase label}` (falls back to today's text without `heater_type`).
- Phase pill; FAULT shows a red pill and a **Clear fault** button (`useCan('heater')`, confirm dialog, sends `{heater:{clear_fault:true}}`, shows pending via `heater_desired_seq` like existing controls).
- Control: level selector or setpoint selector (41–86 °F) by `heater_control`.
- Turn ON disabled while `heater_fault`.
- `contract.js`: `heaterPhaseLabel`, `heaterTypeLabel` helpers.
- Demo/mock data (`demo.js`, `mock.js`, `fixtures/telemetry.sample.json`) gain an AUTOTERM example.

## 6. Testing

- gobi-agent: `tests/test_heater_ext.c` (all pure functions incl. present-gating truth table and °F↔°C round-trips at 41/86/72); command mapping and shadow desired/reported additions covered by host tests where the existing suite reaches them; `main.c`/`shadow.c` strict `-fsyntax-only` against real headers (as for PR #19).
- gobi-ui: moc/object compile vs Qt6, qmllint, offscreen preview of the five states.
- Cloud: vitest — ingest map, telemetry view, `validateCommand` (accept/reject cases), contract helpers, HeaterTab (setpoint control, fault + clear, old payload unchanged).
- Release: new image (tag) after merge; cloud deploys user-run (API/ingest via `deploy-lambda.sh`, frontend `vercel --prod`).

## 7. Out of scope

- UI for reg 74 type select (C4); AUTOTERM fixed-power mode; showing provisional AUTOTERM telemetry (fan/pump) differently from VEVOR.
- Any firmware change.

## 8. Open items

1. Bench: confirm firmware reports `heater_type` 0 with no coprocessor fitted, so the card stays hidden on heaterless units.
2. Setpoint rounding: 1 °C steps ≈ 1.8 °F; the stepper's 2 °F steps may round to the same °C occasionally — acceptable, the read-back shows the applied value.
