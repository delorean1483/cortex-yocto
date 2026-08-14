# STM32G0 APU Port — Milestone 6c: Climate Control — Design

**Status:** Approved 2026-08-14. Expands the overarching design spec `2026-08-12-pic18-to-stm32g0-apu-port-design.md` §8.3 for the climate (cooling) control mode. Source of truth: PIC `main.c` `ClimateControlMode` (~L1547–1760) + `main.h` `clmt_ctrl_state_list` / constants.

## 1. Overview & Scope

Port the PIC `ClimateControlMode` as the `OP_CLIMATE` control-mode handler: a single `control_climate_mode(apu_ctx_t *ctx)` runs the `clmt_ctrl_state_list` state machine off `ctx->sub_state`, reads sensor/setting/flag values from `apu_ctx_t`, and writes output *requests* + statuses + `op_state` transitions into the ctx — the same M6a model (modes request; `outputs_apply` maps). Registered via `control_register_mode(OP_CLIMATE, control_climate_mode)` — **no M6a dispatcher edits**.

**Cooling-only, faithful.** The shipped PIC firmware is cooling-only (reverse-valve heat eliminated 2020-03-30). The `CC_*` enum defines all values so `sub_state` numbering matches the PIC and M6b's hand-back target, but the heat and RPM-anti-stall states are **defined-but-never-dispatched** (the same treatment M6b gave `ES_HEAT_ON`).

**Prereqs:** M6a (control foundation), M6b (engine-start — climate invokes it and is its hand-back target), M5 (`app_timers`, `sched`), M3 (`sensors`, enclosure/cabin temp), M2 (`nvm`, setpoint/fan-speed), M4b (register model — setpoint reg 14 + fan-speed reg 12 already bound).

## 2. State enum (`clmt_ctrl_state_list`, `ctx->sub_state` values)

```
CC_START_SETTLE = 0, CC_START_ENGINE = 1, CC_MONITOR_TEMP = 2, CC_START_COOL = 3,
CC_SWITCH_TO_COOL = 4, CC_COMP_ON = 5, CC_AC_LOW_PRESSURE_RECHK = 6, CC_EVAP_ON = 7,
CC_CTRL_RUNNING = 8, CC_HEAT_DEFROST = 9, CC_COOL_DEFROST_END = 10, CC_HEAT_SWITCHFROM_COOL = 11,
CC_EVAP_OFF = 12, CC_AC_LOW_PRESSURE_FAIL = 13, CC_AC_HIGH_PRESSURE_FAIL = 14,
CC_ANTI_STALL_STEP1 = 15, CC_ANTI_STALL_STEP2 = 16, CC_AC_HIGH_PRESSURE_RECHK = 17,
CC_WAIT_HIGH_PRESSURE_NORMAL = 18
```

**Dispatched:** 0,1,2,3,5,6,7,8,10,12,13,14,17,18. **Defined-but-never-dispatched** (preserve value, no case body): `CC_SWITCH_TO_COOL(4)`, `CC_HEAT_DEFROST(9)`, `CC_HEAT_SWITCHFROM_COOL(11)`, `CC_ANTI_STALL_STEP1(15)`, `CC_ANTI_STALL_STEP2(16)`. `CC_MONITOR_TEMP == 2` **confirms** M6b's engine-start COOL_ON hand-back (`op_state=OP_CLIMATE, sub_state=2`).

## 3. Constants (from PIC `main.h`)

- `CC_TEMP_OFFSET = 3` (°F hysteresis band around setpoint).
- `DEFROST_INTERVAL = 30` (min; `DEFROST_CYCLE_TMR` on `SCALE_MINUTE`).
- Settle = `SHORT_DELAY_TMR = 100` (10 ms scale → 1 s). Defrost-end wait = `EVENT_INTERVAL_TMR = 45` (1 s scale). Forced evap-on = `EVAP_FORCED_ON_TMR = 10` (1 s). Compressor-evap delay = `COMP_EVAP_DELAY_TMR = 0` (1 s; PIC set 0 after 6-16-2015).
- Compressor min-off guard = **15 s** (`compressor_off_timer ≥ 15`). Pressure-monitor arm = `compressor_on_timer ≥ 2` s. Refrigerant retry cap = `refregerant_check_counter > 10`.
- Setpoint-reached (cooling stop) uses `cabin_temp ≤ clmt_temp_setting + 1`; cool-call uses `cabin_temp ≥ setpoint + 3`; chillin/early-off uses `cabin_temp ≤ setpoint − 3`.

All timer indices already exist in M5 `app_timers.h` (`SHORT_DELAY_TMR`, `COMP_EVAP_DELAY_TMR`, `EVAP_FORCED_ON_TMR`, `EVENT_INTERVAL_TMR` in their scales; `DEFROST_CYCLE_TMR` in `SCALE_MINUTE`). `EVENT_INTERVAL_TMR` lives in the 1-second timer bank.

## 4. Dispatched state transitions

- **`CC_START_SETTLE(0)`**: `temp_display_state = TD_REAL_TIME`; `SHORT_DELAY_TMR = 100`; → `CC_START_ENGINE`.
- **`CC_START_ENGINE(1)`**: when `SHORT_DELAY_TMR` expired — if engine not running (`!out.fuel_pump`): `op_state_previous = OP_CLIMATE`, `op_state = OP_ENGINE_START`, `sub_state = 0` (ES_GLOWPLUG_ON), `attempted_start_counter = 0` (M6b runs and hands back to `CC_MONITOR_TEMP`); else → `CC_MONITOR_TEMP`.
- **`CC_MONITOR_TEMP(2)`** (hysteresis idle; the hand-back entry): `cabin_temperature ≤ clmt_temp_setting − 3` → `temp_display_state = TD_REAL_TIME`, `control_status = ST_CHILLIN`, stay; `cabin_temperature ≥ clmt_temp_setting + 3` → `control_status = ST_COOLING`, → `CC_START_COOL`.
- **`CC_START_COOL(3)`**: `cool_mode = true`, `out.heat_reverse = false` (cool = PB4 de-energized, OI-1) → `CC_COMP_ON`.
- **`CC_COMP_ON(5)`**: when `compressor_off_timer ≥ 15` → `out.compressor_clutch = true`, `COMP_EVAP_DELAY_TMR = 0` → `CC_EVAP_ON`.
- **`CC_EVAP_ON(7)`**: when `COMP_EVAP_DELAY_TMR` expired → `out.evap_fan = true`, `EVAP_FORCED_ON_TMR = 10`, `DEFROST_CYCLE_TMR = 30` → `CC_CTRL_RUNNING`. (The PIC clears `ac_high_pres_happened_flag` here, but its only set site was commented out 2014-12-15 — the flag is vestigial and is **not** ported; no ctx field for it.)
- **`CC_CTRL_RUNNING(8)`**: if `DEFROST_CYCLE_TMR > 0` and `cool_mode` and `cabin_temperature ≤ clmt_temp_setting + 1` → `out.compressor_clutch = false`, `temp_display_state = TD_CC_SETTING` → `CC_EVAP_OFF`. If `DEFROST_CYCLE_TMR` expired → `control_status = ST_DEFROST`, `temp_display_state = TD_REAL_TIME`, compressor+cool+evap off, `EVENT_INTERVAL_TMR = 45` → `CC_COOL_DEFROST_END`.
- **`CC_COOL_DEFROST_END(10)`**: when `EVENT_INTERVAL_TMR` expired → `out.compressor_clutch = true`, `cool_mode = true`, `out.evap_fan = true`, `control_status = ST_COOLING`, reload `DEFROST_CYCLE_TMR = 30` → `CC_CTRL_RUNNING`.
- **`CC_EVAP_OFF(12)`**: when `compressor_off_timer ≥ 15` → `cool_mode = false`, `out.evap_fan = false` → `CC_MONITOR_TEMP`; else if `cabin_temperature ≤ clmt_temp_setting − 3` → `cool_mode = false` (early cool-off, evap stays until the 15 s guard).
- **`CC_AC_LOW_PRESSURE_RECHK(6)`**: `out.compressor_clutch = false`; `refregerant_check_counter++`; if `> 10` → `refregerant_check_counter = 0`, → `CC_AC_LOW_PRESSURE_FAIL`; else → `CC_COMP_ON` (retry).
- **`CC_AC_LOW_PRESSURE_FAIL(13)`**: `op_state_previous = OP_CLIMATE`, `error_state = ERR_AC_LOW_PRESSURE`, `op_state = OP_ERROR_SHUTDOWN`.
- **`CC_AC_HIGH_PRESSURE_RECHK(17)`**: `out.compressor_clutch = false` → `CC_WAIT_HIGH_PRESSURE_NORMAL`.
- **`CC_WAIT_HIGH_PRESSURE_NORMAL(18)`**: when `ac_high_pressure_ok` (high side back to OK) → `out.compressor_clutch = true`, `COMP_EVAP_DELAY_TMR = 0` → `CC_EVAP_ON`.
- **`CC_AC_HIGH_PRESSURE_FAIL(14)`**: `op_state_previous = OP_CLIMATE`, `error_state = ERR_AC_HIGH_PRESSURE`, `op_state = OP_ERROR_SHUTDOWN`.

## 5. Post-switch monitor tail (runs every tick, after the switch)

Mirrors M6b's standby tail placement (outside the switch, inside the function):

1. **A/C pressure monitor** — if `out.compressor_clutch` and `compressor_on_timer ≥ 2`: `!ac_low_pressure_ok` → `out.compressor_clutch = false`, `sub_state = CC_AC_LOW_PRESSURE_RECHK`; else if `!ac_high_pressure_ok` → `out.compressor_clutch = false`, `sub_state = CC_AC_HIGH_PRESSURE_RECHK`; else (normal) → `refregerant_check_counter = 0`.
2. **Engine over-temp** — `!engine_temp_ok` → `error_state = ERR_HIGH_ENGINE_TEMP`, `op_state = OP_ERROR_SHUTDOWN`.

(The PIC tail's battery-voltage monitor is M6d — deferred here.)

## 6. `apu_ctx_t` extensions & sourcing

New fields: `int16_t cabin_temperature;`, `int16_t clmt_temp_setting;`, `uint8_t compressor_on_timer;`, `uint8_t compressor_off_timer;`, `uint8_t refregerant_check_counter;`, `bool ac_low_pressure_ok;` (default **true**), `bool ac_high_pressure_ok;` (default **true**), `bool cool_mode;`. No new `control_error_t` codes (`ERR_AC_LOW_PRESSURE`/`ERR_AC_HIGH_PRESSURE` already exist from M6a). `control_init` resets all to 0/true as noted.

**Sourcing (no new Modbus binds in M6c):**
- `cabin_temperature` ← `sensors_get_encl_temp_f()` (M3 enclosure sensor, reg 1), copied by an extended `control_sample_sensors`.
- `clmt_temp_setting` ← NVM `EE_CLIMATE_TEMP_SETTING` (Modbus reg 14, already M4b-bound + display-writable), read via the M2 `nvm` API.
- Evap-fan speed ← NVM `EE_EVAP_FAN_SPEED` (Modbus reg 12, already M4b-bound) → `out.evap_speed` (`fan_speed_t`; PIC LOW/MED/HIGH = 7/12/22 ms of 22 ms, "LOW eliminated" so effectively MED/HIGH).

## 7. Timer/slot model

Add **`control_1s_slot`** registered on M5 `SLOT_1S`: maintains the two count-up compressor timers faithfully to the PIC one-second routine — compressor OFF → `compressor_on_timer = 0`, `compressor_off_timer++` (cap 255); compressor ON → `compressor_off_timer = 0`, `compressor_on_timer++` (cap 255) — keyed off `ctx->out.compressor_clutch`. The state machine + monitor tail continue to run in `control_10ms_slot`. All countdown timers (`SHORT_DELAY`, `COMP_EVAP_DELAY`, `EVAP_FORCED_ON`, `EVENT_INTERVAL`, `DEFROST_CYCLE`) are auto-decremented by `sched` per their scale — no explicit servicing.

## 8. Outputs & deferrals

`outputs_apply`/`apu_outputs_t` already carry every needed output — **no output-struct change**:
- `compressor_clutch` (PB5), `evap_fan` (PC10) + `evap_speed` (PC4 PWM), `condenser_fan` (PB9) + `condenser_duty` (PC5 PWM), `heat_reverse` (PB4, held de-energized = cool per OI-1).

**Deferred (bench, structurally present + inert-safe):**
- `ac_low_pressure_ok` / `ac_high_pressure_ok` derivation from the M3-deferred A/C-pressure sensing (regs 4/5). Default **true** → fault/RECHK states reachable only when a real signal drives them.
- **OI-2 condenser ramp:** enable `condenser_fan` while `compressor_clutch` engaged at a **fixed stub `condenser_duty`**; the head-pressure ramp curve (`AN_Freon_HiPss`) → bench.
- RPM anti-stall (`CC_ANTI_STALL_*`) — RPM capture (reg 9) deferred; states preserved-but-unused.

## 9. Testing

Host tests (CMake + Unity), TDD. Unit tests per state group driving `cabin_temperature`, `clmt_temp_setting`, the timers, and the pressure flags directly; a `control_1s_slot` compressor-timer test (count-up + reset on state change). End-to-end integration through the real scheduler + fakes: engine-running → `CC_MONITOR_TEMP` → cool-call → `COMP_ON` → `EVAP_ON` → `CTRL_RUNNING` → setpoint reached → `EVAP_OFF` → `MONITOR_TEMP`; a defrost cycle (`DEFROST_CYCLE` expiry → `COOL_DEFROST_END` → resume); and an A/C-low-pressure fault (`ac_low_pressure_ok=false` while running → `RECHK` → after retries → `FAIL` → `OP_ERROR_SHUTDOWN`). Drive `cabin_temperature` through the M3 enclosure sensor and `clmt_temp_setting` through NVM/reg 14 (not by poking ctx) in the integration test, since `control_sample_sensors` overwrites the ctx copy each tick.

## 10. Task decomposition (~6 TDD tasks; refined by the plan)

1. `apu_ctx_t` climate fields + `CC_*` enum + `control_init` resets.
2. `control_1s_slot` (compressor count-up timers) + wiring; extend `control_sample_sensors` for cabin temp; read setpoint/fan-speed from NVM.
3. `control_climate.c` core: `CC_START_SETTLE` → `CC_START_ENGINE` handoff → `CC_MONITOR_TEMP` hysteresis.
4. Cool sequence: `CC_START_COOL` → `CC_COMP_ON` → `CC_EVAP_ON` → `CC_CTRL_RUNNING` → `CC_EVAP_OFF`.
5. Defrost (`CTRL_RUNNING` defrost branch → `CC_COOL_DEFROST_END`) + A/C-pressure `RECHK`/`FAIL` + `WAIT_HIGH_PRESSURE_NORMAL` + post-switch monitor tail (A/C pressure + engine over-temp).
6. Register `OP_CLIMATE` + condenser-fan OI-2 stub in `outputs_apply`/climate + end-to-end integration.

## 11. Deferred / carry-forward

- A/C low/high-pressure derivation (M3 A/C-pressure regs 4/5) + **oil/pressure switch polarity** → bench.
- OI-2 condenser head-pressure ramp curve → bench (OI-7 tuning).
- Battery-voltage monitor in the climate tail → **M6d** (battery + error-shutdown), which also consumes the `error_state`/`op_state` this mode sets and registers `OP_ERROR_SHUTDOWN`.
- RPM anti-stall + reg 9 (RPM) + reg 41 (production test) → deferred.
- `cab_temp_offset` (PIC cabin-temp trim) — not modeled in M6c (default 0); revisit if display calibration needs it.
- Evap-fan-speed → `fan_speed_t` value mapping (LOW eliminated) confirmed against the display at bench.

## 12. Open items (tracked in overarching spec §10)

- **OI-1** (cool = PB4 de-energized) — applied. **OI-2** (condenser ramp) — stubbed, curve at bench. **OI-5** (A/C pressure-register encoding) — tied to the deferred A/C-pressure derivation.
