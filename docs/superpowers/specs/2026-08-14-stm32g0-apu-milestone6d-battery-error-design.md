# STM32G0 APU Port — Milestone 6d: Battery Monitor + Error Shutdown — Design

**Status:** Approved 2026-08-14. Expands the overarching design spec `2026-08-12-pic18-to-stm32g0-apu-port-design.md` §8 for the two remaining control modes. Source of truth: PIC `main.c` `BatteryMonitorMode` (~L1813–1939) + `ErrorShutdownMode` (~L2270–2410), `main.h` `battery_monitor_state_list` / `error_message_state_list` / battery thresholds.

## 1. Overview & Scope

Port the PIC `BatteryMonitorMode` as `OP_BATTERY` and `ErrorShutdownMode` as `OP_ERROR_SHUTDOWN`, both registered into the M6a dispatcher (**no dispatcher edits**), completing the mode set — **after M6d every `op_state` has a handler**. Same M6a model: modes request outputs into `apu_ctx_t`; `outputs_apply` maps them. Extends `control_error_t` with the three remaining PIC codes.

**In scope:** `OP_BATTERY` charge-cycling, `OP_ERROR_SHUTDOWN` (de-energize + standby recovery), `control_error_t` 8–10.

**Deferred (per brainstorming decisions):**
- **Oil-change warnings + engine runtime-hour accounting** + the PIC long-term NVM counter chain (`inc_long_term_counter`) → **future M6e**. M4b exposes only the `_START` word of each counter via Modbus; the accumulation subsystem is not ported.
- **A/C low/high override-resume recovery** (the PIC `low_ac_overide_flag`/`high_ac_overide_flag` dismiss-and-resume) → **bench**, alongside the A/C-pressure sensing that lets those faults fire.

**Prereqs:** M6a (foundation), M6b (engine-start — battery invokes it and is its hand-back target), M6c (climate — sibling running mode; provides the 1 s settings-sample slot), M5 (`app_timers`, `sched`), M3 (`sensors` — battery voltage), M2 (`nvm` — battery setpoint), M4b (register model — `EE_MONITOR_BATT_SETTING` reg 13 already bound).

## 2. `control_error_t` extension

Add after `ERR_STANDBY = 7` (values map 1:1 to the PIC `error_message_state_list`):

```c
typedef enum {
    ERR_NONE = 0, ERR_LOW_OIL, ERR_HIGH_ENGINE_TEMP, ERR_LOW_BATTERY,
    ERR_AC_LOW_PRESSURE, ERR_AC_HIGH_PRESSURE, ERR_STARTING_FAILURE, ERR_STANDBY,
    ERR_ENGINE_STALLED,        /* 8  — low RPM detected (log only) */
    ERR_NO_RPM_DETECTED,       /* 9  — no RPM detected */
    ERR_HIGH_AC_PRESSURE       /* 10 — PIC HIGH_AC_PRESSURE_ERROR (record-only; distinct from ERR_AC_HIGH_PRESSURE=5 climate shutdown) */
} control_error_t;
```

Codes 8/9/10 are RPM-/log-derived → **not triggerable on host** (RPM reg 9 deferred), but `OP_ERROR_SHUTDOWN` handles them structurally so they work once RPM sensing lands. Field is `uint8_t error_state` (ABI-safe extension).

## 3. Battery monitor (`battery_monitor_state_list`, dispatched on `ctx->sub_state`)

Enum values: `BM_START = 0, BM_BATT_MONITOR = 1, BM_START_ENGINE = 2, BM_CHARGING = 3, BM_BATT_STABLE_2MIN = 4, BM_BATT_CHECK = 5, BM_ERROR_PROCESS = 6`. **`BM_CHARGING == 3` is M6b engine-start's `op_state_previous == OP_BATTERY` hand-back target** — do not renumber. Entry to the mode is via reg-10 `MODE_BATTERY` (`apply_mode_request` sets `op_state = OP_BATTERY, sub_state = 0`).

- **BM_START(0)**: de-energize all (via the shared helper §5), `engine_op_status = ST_OFF`, `control_status = ST_OFF`, `attempted_start_counter = 0`, `attempted_charging_counter = 0` → BM_BATT_MONITOR.
- **BM_BATT_MONITOR(1)**: `battery_voltage < batt_monitor_setting` → `app_timer_set(SCALE_TEN_MS, SHORT_DELAY_TMR, 1000)` (10 s) → BM_START_ENGINE; else `attempted_charging_counter = 0`.
- **BM_START_ENGINE(2)**: while `SHORT_DELAY_TMR` **not** expired — if `battery_voltage > batt_monitor_setting` (recovered) → `SHORT_DELAY_TMR = 0`, → BM_BATT_MONITOR. When `SHORT_DELAY_TMR` expired (10 s elapsed) — `attempted_charging_counter++`; if `> 3` → `attempted_charging_counter = 0`, → BM_ERROR_PROCESS; else `op_state_previous = OP_BATTERY`, `op_state = OP_ENGINE_START`, `sub_state = 0` (ES_GLOWPLUG_ON), `attempted_start_counter = 0` (M6b runs, hands back to BM_CHARGING).
- **BM_CHARGING(3)**: `app_timer_set(SCALE_MINUTE, CHARGING_BATT_TMR, 30)`, `control_status = ST_CHARGING` → BM_BATT_STABLE_2MIN.
- **BM_BATT_STABLE_2MIN(4)**: when `CHARGING_BATT_TMR` expired (30 min charge done) → `out.fuel_pump = false`, `cool_mode = false`, `control_status = ST_OFF`, `app_timer_set(SCALE_SECOND, BATT_STABLE_TMR, 120)` (2 min) → BM_BATT_CHECK.
- **BM_BATT_CHECK(5)**: when `BATT_STABLE_TMR` expired → BM_BATT_MONITOR (re-measure).
- **BM_ERROR_PROCESS(6)**: `error_state = ERR_LOW_BATTERY`, `op_state = OP_ERROR_SHUTDOWN`.

`app_timer_expired(s, i)` is true when the timer value == 0 (a fresh `app_timers_init` leaves timers expired).

## 4. Battery post-switch monitor tail (runs every tick, after the switch)

Mirrors M6c's placement (outside the switch, inside the function):
1. **Engine over-temp** — `!engine_temp_ok` → `error_state = ERR_HIGH_ENGINE_TEMP`, `op_state = OP_ERROR_SHUTDOWN`.
2. **Low oil** (only while engine running) — else if `out.fuel_pump && !in_oil_pressure_ok` → `error_state = ERR_LOW_OIL`, `op_state = OP_ERROR_SHUTDOWN`.
3. **Standby** — `!standby_override && control_status != ST_OFF && in_truck_ignition` → `attempted_charging_counter = 0`, `op_state_previous = OP_BATTERY`, `error_state = ERR_STANDBY`, `op_state = OP_ERROR_SHUTDOWN`. (The PIC's `control_status != OFF` guard is preserved so standby doesn't fire while the mode has already stood everything down.)

(The PIC battery tail's over-temp and low-oil use `else if` between them — same structure as here.)

## 5. Shared de-energize helper

`void control_deenergize_all(apu_ctx_t *ctx);` — defined in `control.c`, prototyped in `control.h`. Clears every output request and stands the statuses down:

```c
void control_deenergize_all(apu_ctx_t *ctx) {
    ctx->out.fuel_pump = false;  ctx->out.starter = false;  ctx->out.glow_plug = false;
    ctx->out.compressor_clutch = false;  ctx->out.heat_reverse = false;
    ctx->out.evap_fan = false;   ctx->cool_mode = false;
    ctx->engine_op_status = ST_OFF;  ctx->control_status = ST_OFF;
}
```

Used by battery `BM_START` and the error-shutdown latching cases — avoids the PIC's verbatim 7-assignment repetition. (The PIC also toggles `Heat_Mode`; our OI-1 model has no separate heat output, so `heat_reverse` covers it.)

**Evap-forced-on note:** `control_deenergize_all` clears `out.evap_fan`, but the M6c evap-forced-on override keeps the evap physically on until `EVAP_FORCED_ON_TMR` expires — **faithful to the PIC** (its `ErrorShutdownMode`/`BatteryMonitorMode` set the flag off while `UpdateOutputs` still honors the forced window).

## 6. Error shutdown (dispatched on `ctx->error_state`)

`control_error_shutdown_mode` is a `switch (ctx->error_state)` — a per-fault handler, **not** a sub-state machine (this is the PIC's structure and the one architectural difference from the other modes). It also sets `temp_display_state = TD_REAL_TIME` on entry (PIC `temp_dspl_state = REAL_TIME_TEMP`).

- **ERR_NONE(0)** → `op_state = OP_OFF`, `sub_state = 0`.
- **Latching de-energize** — `ERR_LOW_OIL(1)`, `ERR_HIGH_ENGINE_TEMP(2)`, `ERR_LOW_BATTERY(3)`, `ERR_STARTING_FAILURE(6)`, `ERR_NO_RPM_DETECTED(9)`: `control_deenergize_all(ctx)` — stays latched (no transition).
- **ERR_AC_LOW_PRESSURE(4)** / **ERR_AC_HIGH_PRESSURE(5)**: `out.compressor_clutch = false` only (engine keeps running), latch. *(A/C-override resume deferred to bench — the PIC's `op_state = op_state_previous; sub_state = CC_COMP_ON` on override is not ported yet.)*
- **ERR_STANDBY(7)**: `control_deenergize_all(ctx)`; **recover** when `!in_truck_ignition || standby_override` → `error_state = ERR_NONE`, `op_state = op_state_previous`, `sub_state = 0`.
- **default** (covers `ERR_ENGINE_STALLED(8)`, `ERR_HIGH_AC_PRESSURE(10)`, and any unmapped value) → `op_state = OP_OFF`, `sub_state = 0`. *(Faithful: the PIC leaves 8/10 uncased → its `default` → `OFF_STATE`. The M6a OFF mode then de-energizes + clears the error.)*

All latching faults also recover via the operator setting reg-10 `MODE_OFF` (`apply_mode_request` → `op_state = OP_OFF`, `error_state = ERR_NONE`, `sub_state = 0`), which already works.

## 7. ctx extensions & sourcing

New fields: `uint8_t attempted_charging_counter;`, `uint16_t battery_voltage;` (centivolts), `uint16_t batt_monitor_setting;` (centivolts). `control_init` resets: `attempted_charging_counter = 0`, `battery_voltage = 0`, `batt_monitor_setting = 0`.

**Sourcing (no new Modbus binds):**
- `battery_voltage ← sensors_get_batt_cv()` (M3 reg 6) — added to `control_sample_sensors` (10 ms slot).
- `batt_monitor_setting ← nvm_read_word(EE_MONITOR_BATT_SETTING)` (Modbus reg 13, already M4b-bound + display-writable) — read via a new `void control_battery_sample_settings(apu_ctx_t *ctx);` called from `control_1s_slot` (alongside the existing `control_service_compressor_timers` + `control_climate_sample_settings`). Kept separate from the climate settings sampler to preserve single responsibility; no rename of the climate function.

**12V system** confirmed (PIC `USE_24VDC_BATTERY` commented out): the NVM default `BATT_MONITOR_V_INIT = 1200` (12.0 V) governs; the battery mode only compares `battery_voltage < batt_monitor_setting`, so no threshold constants are hard-coded in M6d.

## 8. Outputs, timers & registration

- No `apu_outputs_t` change (every output already exists and is mapped by `outputs_apply`).
- Battery uses only countdown timers (`SHORT_DELAY_TMR` ten-ms, `CHARGING_BATT_TMR` minute, `BATT_STABLE_TMR` second) — auto-decremented by `sched`; **no new slot** (unlike climate's count-up compressor timers).
- `control_app_init` adds `control_register_mode(OP_BATTERY, control_battery_mode)` and `control_register_mode(OP_ERROR_SHUTDOWN, control_error_shutdown_mode)`. This retires the M6a "handoff to unregistered modes" carry-forward — after M6d the `control_tick` NULL-guard no-op path is no longer exercised by normal operation.

## 9. Testing

Host tests (CMake + Unity), TDD. Unit tests: each battery state (drive `battery_voltage`, `batt_monitor_setting`, timers) + the monitor tail; each error-shutdown code (assert de-energize / compressor-only / standby recovery / default-OFF / ERR_NONE→OFF); the shared `control_deenergize_all`. Integration through the real scheduler: reg-10 `MODE_BATTERY` → BM_START → BM_BATT_MONITOR → low battery (driven via the M3 batt sensor, setpoint via NVM) → 10 s → engine-start handoff (`op_state = OP_ENGINE_START`, `op_state_previous = OP_BATTERY`) — all reachable in a bounded advance. **The 30-min charge + 2-min rest cycle is unit-tested by driving `CHARGING_BATT_TMR`/`BATT_STABLE_TMR` directly** (30 min is impractical in a 1 ms-step advance — the same call M6c made for the 30-min defrost). A fault-injection integration test: set `error_state` + `op_state = OP_ERROR_SHUTDOWN`, run the slot, assert outputs de-energized. As in M6b/M6c, drive `battery_voltage` through the M3 sensor and `batt_monitor_setting` through NVM (not by poking ctx), since the slots overwrite those ctx copies each tick.

## 10. Task decomposition (~6 TDD tasks; refined by the plan)

1. `control_error_t` 8–10 + ctx fields (`attempted_charging_counter`, `battery_voltage`, `batt_monitor_setting`) + `control_init` resets.
2. `control_deenergize_all` (in control.c) + `battery_voltage` into `control_sample_sensors` + `control_battery_sample_settings` + `control_1s_slot` wiring.
3. `control_battery.c` core: BM_START → BM_BATT_MONITOR → BM_START_ENGINE handoff.
4. Battery charge cycle: BM_CHARGING → BM_BATT_STABLE_2MIN → BM_BATT_CHECK + BM_ERROR_PROCESS + post-switch monitor tail.
5. `control_error_shutdown.c`: the `error_state` dispatch (all codes + standby recovery + default-OFF).
6. Register `OP_BATTERY` + `OP_ERROR_SHUTDOWN` + end-to-end integration (battery→engine-start handoff; fault→de-energize).

## 11. Deferred / carry-forward

- **M6e:** oil-change warnings (500/580/700 hr → SOON/NEEDED/PAST_DUE with 20 hr/5 hr re-warn) + engine runtime-hour accounting (`engine_run_timer`/`engine_oil_timer` → NVM every 60 min) + the long-term NVM counter chain (`inc_long_term_counter`/`read_long_term_counter`, multi-word 24-bit accumulators for `ENGINE_RUNTIME`/`ENGINE_OILTIME`/`MACHINE_RUNTIME`). Needs a 1-minute slot (`control_1min_slot`).
- **Bench:** A/C low/high override-resume + the override registers (with A/C-pressure sensing); ERR_ENGINE_STALLED/NO_RPM/HIGH_AC (8–10) triggering (RPM reg 9 + stall detection lives in the running modes); `engine_temp_ok` derivation + oil-pressure switch polarity (shared with M6b/M6c); reg 41 (production test).
- **Battery over-voltage / cold-storage battery** (`STORE_BATT_*`, `OP_COLD_STORAGE`) — cold storage is excluded per OI-6; the store-battery thresholds are unused here.

## 12. Open items (overarching spec §10)

- After M6d the full control application is ported; everything remaining is gated on the USER-OWNED hardware bench bring-up (M1 Task 1: `.ioc`/clock/boot + the concrete HAL/drivers) plus M6e (oil/runtime).
