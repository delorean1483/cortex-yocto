# STM32G0 APU Port — Milestone 6d: Battery Monitor + Error Shutdown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the PIC `BatteryMonitorMode` (`OP_BATTERY`) and `ErrorShutdownMode` (`OP_ERROR_SHUTDOWN`) faithfully, completing the control-mode set — the battery charge-cycle with its engine-start handoff and monitor tail, and the per-fault error handler that de-energizes outputs and auto-recovers from standby — registered into the M6a dispatcher.

**Architecture:** `control_battery_mode(apu_ctx_t *ctx)` runs the `battery_monitor_state_list` machine off `ctx->sub_state`; `control_error_shutdown_mode(apu_ctx_t *ctx)` dispatches on `ctx->error_state` (a per-fault handler, not a sub-state machine — the PIC's structure). Both request outputs into `apu_ctx_t`, mapped by `outputs_apply` (M6a). A shared `control_deenergize_all` primitive stands all outputs down. Battery voltage/setpoint come from a new `control_sample_sensors` line + a new `control_battery_sample_settings` on the M6c `control_1s_slot`. Registered via `control_register_mode(...)` — no dispatcher edits.

**Tech Stack:** C11, CMake + Unity (host). Reuses M6a `control` (apu_ctx_t, dispatcher, outputs_apply, control_app), M6b engine-start (invoked mode + hand-back target), M6c climate (sibling mode + the 1 s slot), M5 `app_timers`/`sched`, M3 `sensors` (battery voltage), M2 `nvm` (battery setpoint), M4b register model (`EE_MONITOR_BATT_SETTING` reg 13 already bound).

**Design spec:** `docs/superpowers/specs/2026-08-14-stm32g0-apu-milestone6d-battery-error-design.md`. Source of truth: PIC `main.c` `BatteryMonitorMode` (~L1813–1939), `ErrorShutdownMode` (~L2270–2410), `main.h` `battery_monitor_state_list` / `error_message_state_list`.

## Global Constraints

- **Behavior preserved faithfully** (same states, transitions, timings, thresholds), restructured into `apu_ctx_t`.
- **`control_error_t` extends** with `ERR_ENGINE_STALLED = 8`, `ERR_NO_RPM_DETECTED = 9`, `ERR_HIGH_AC_PRESSURE = 10` (after `ERR_STANDBY = 7`; maps 1:1 to PIC `error_message_state_list`). `ERR_HIGH_AC_PRESSURE`(10) is the PIC record-only `HIGH_AC_PRESSURE_ERROR`, **distinct** from `ERR_AC_HIGH_PRESSURE`(5) climate shutdown.
- **`battery_monitor_state_list`** (in `control_battery.c`, `ctx->sub_state`): `BM_START=0, BM_BATT_MONITOR=1, BM_START_ENGINE=2, BM_CHARGING=3, BM_BATT_STABLE_2MIN=4, BM_BATT_CHECK=5, BM_ERROR_PROCESS=6`. **`BM_CHARGING == 3`** is M6b engine-start's `op_state_previous == OP_BATTERY` hand-back target — do not renumber.
- **Timers** (all indices exist in M5 `app_timers.h`): `SHORT_DELAY_TMR` (SCALE_TEN_MS); `BATT_STABLE_TMR` (SCALE_SECOND); `CHARGING_BATT_TMR` (SCALE_MINUTE). `app_timer_expired(s,i)` is true when the timer value == 0.
- **Battery timings:** low-battery confirm `SHORT_DELAY_TMR = 1000` (10 s). Charge `CHARGING_BATT_TMR = 30` (min). Rest `BATT_STABLE_TMR = 120` (2 min). Charge-retry cap `attempted_charging_counter > 3`.
- **Battery trigger:** `battery_voltage < batt_monitor_setting` (both centivolts). **12V system** (PIC `USE_24VDC_BATTERY` off): default `batt_monitor_setting = BATT_MONITOR_V_INIT = 1200` from NVM; no thresholds hard-coded in M6d.
- **Error-shutdown dispatch on `error_state`.** Latching de-energize codes: `ERR_LOW_OIL`, `ERR_HIGH_ENGINE_TEMP`, `ERR_LOW_BATTERY`, `ERR_STARTING_FAILURE`, `ERR_NO_RPM_DETECTED`. Compressor-only: `ERR_AC_LOW_PRESSURE`, `ERR_AC_HIGH_PRESSURE` (engine runs; A/C-override resume deferred to bench). Standby recovery: `ERR_STANDBY` de-energizes, recovers when `!in_truck_ignition || standby_override` → `error_state = ERR_NONE`, `op_state = op_state_previous`, `sub_state = 0`. `ERR_NONE` and `default` (covers 8/10) → `op_state = OP_OFF`, `sub_state = 0`. Sets `temp_display_state = TD_REAL_TIME` on entry.
- **Shared `control_deenergize_all(apu_ctx_t *ctx)`** (in `control.c`): clears `out.{fuel_pump,starter,glow_plug,compressor_clutch,heat_reverse,evap_fan}` + `cool_mode` to false, sets `engine_op_status = ST_OFF`, `control_status = ST_OFF`.
- **No new Modbus binds, no `apu_outputs_t` change.** Fixed-width integers only. Portable code under `App/services/` — **no HAL**. Firmware root `firmware/g0b1-apu/`. Every task ends green (`ctest`) and is committed; build is `-Wall -Wextra -Werror -funsigned-char` and must stay pristine.

### Deferred / carry-forward
- Oil-change warnings + engine runtime-hour accounting + the long-term NVM counter chain → **M6e**.
- A/C low/high override-resume + override registers → bench (with A/C-pressure sensing).
- ERR_ENGINE_STALLED/NO_RPM/HIGH_AC (8–10) triggering → bench (RPM reg 9 + stall detection in running modes).
- `engine_temp_ok` derivation + oil-pressure switch polarity → bench (shared M6b/M6c).

---

### Task 1: control_error_t 8–10 + apu_ctx_t battery fields + init resets

**Files:**
- Modify: `firmware/g0b1-apu/App/services/control.h` (extend `control_error_t`, `apu_ctx_t`)
- Modify: `firmware/g0b1-apu/App/services/control.c` (reset new fields in `control_init`)
- Create: `firmware/g0b1-apu/Tests/test_control_ctx_bm.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Produces (`control.h`): `control_error_t` gains `ERR_ENGINE_STALLED`(8), `ERR_NO_RPM_DETECTED`(9), `ERR_HIGH_AC_PRESSURE`(10). `apu_ctx_t` gains `uint8_t attempted_charging_counter;`, `uint16_t battery_voltage;`, `uint16_t batt_monitor_setting;`.
- `control_init` resets: `attempted_charging_counter = 0`, `battery_voltage = 0`, `batt_monitor_setting = 0`.

- [ ] **Step 1: Extend `control_error_t` in `control.h`** — replace the enum body:

```c
typedef enum {
    ERR_NONE = 0, ERR_LOW_OIL, ERR_HIGH_ENGINE_TEMP, ERR_LOW_BATTERY,
    ERR_AC_LOW_PRESSURE, ERR_AC_HIGH_PRESSURE, ERR_STARTING_FAILURE, ERR_STANDBY,
    ERR_ENGINE_STALLED,        /* 8  — low RPM detected (log only) */
    ERR_NO_RPM_DETECTED,       /* 9  — no RPM detected */
    ERR_HIGH_AC_PRESSURE       /* 10 — PIC HIGH_AC_PRESSURE_ERROR (record-only; != ERR_AC_HIGH_PRESSURE=5) */
} control_error_t;
```

- [ ] **Step 2: Extend `apu_ctx_t` in `control.h`** — add before the closing brace (after `cool_mode;`):

```c
    /* --- M6d battery + error --- */
    uint8_t  attempted_charging_counter; /* battery charge attempts this cycle */
    uint16_t battery_voltage;            /* centivolts, from M3 sensors (reg 6) */
    uint16_t batt_monitor_setting;       /* centivolts, from NVM EE_MONITOR_BATT_SETTING (reg 13) */
```

- [ ] **Step 3: Write the failing test `Tests/test_control_ctx_bm.c`**

```c
#include "unity.h"
#include "control.h"

static apu_ctx_t ctx;
void setUp(void) { control_init(&ctx); }
void tearDown(void) {}

static void test_err_codes_8_9_10(void) {
    TEST_ASSERT_EQUAL_INT(8, ERR_ENGINE_STALLED);
    TEST_ASSERT_EQUAL_INT(9, ERR_NO_RPM_DETECTED);
    TEST_ASSERT_EQUAL_INT(10, ERR_HIGH_AC_PRESSURE);
}

static void test_init_resets_bm_fields(void) {
    TEST_ASSERT_EQUAL_UINT8(0, ctx.attempted_charging_counter);
    TEST_ASSERT_EQUAL_UINT16(0, ctx.battery_voltage);
    TEST_ASSERT_EQUAL_UINT16(0, ctx.batt_monitor_setting);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_err_codes_8_9_10);
    RUN_TEST(test_init_resets_bm_fields);
    return UNITY_END();
}
```

- [ ] **Step 4: Register the test in `Tests/CMakeLists.txt`** (append; link `control.c` + `fan_speed.c`)

```cmake
add_unity_test(test_control_ctx_bm test_control_ctx_bm.c ../App/services/control.c ../App/services/fan_speed.c)
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_ctx_bm --output-on-failure`
Expected: build fails — new enum values / ctx fields undefined.

- [ ] **Step 6: Add the field resets to `control_init` in `control.c`** (after `ctx->cool_mode = false;`)

```c
    ctx->attempted_charging_counter = 0;
    ctx->battery_voltage = 0;
    ctx->batt_monitor_setting = 0;
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_ctx_bm --output-on-failure`
Expected: PASS (2 tests). Run the full suite too (expect 52 executables green: 51 prior + 1 new).

- [ ] **Step 8: Commit**

```bash
git add firmware/g0b1-apu/App/services/control.h firmware/g0b1-apu/App/services/control.c firmware/g0b1-apu/Tests/test_control_ctx_bm.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): control — control_error_t 8-10 + apu_ctx_t battery fields + init resets"
```

---

### Task 2: control_deenergize_all + battery-voltage sample + control_battery_sample_settings + 1s-slot wiring

**Files:**
- Modify: `firmware/g0b1-apu/App/services/control.h` (add prototypes)
- Modify: `firmware/g0b1-apu/App/services/control.c` (add `control_deenergize_all`)
- Modify: `firmware/g0b1-apu/App/services/control_sample.c` (add battery-voltage copy)
- Create: `firmware/g0b1-apu/App/services/control_battery.c` (settings helper only; the mode is added in Task 3)
- Modify: `firmware/g0b1-apu/App/services/control_app.c` (call the battery settings sample in `control_1s_slot`)
- Create: `firmware/g0b1-apu/Tests/test_control_battery_sample.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: M3 `sensors.h` (`sensors_get_batt_cv`), M2 `nvm.h` (`nvm_read_word`) + `nvm_map.h` (`EE_MONITOR_BATT_SETTING`).
- Produces (`control.h`): `void control_deenergize_all(apu_ctx_t *ctx);`, `void control_battery_sample_settings(apu_ctx_t *ctx);`. `control_sample_sensors` additionally sets `ctx->battery_voltage = sensors_get_batt_cv();`.
- **Note (cross-task):** the battery NVM read lives on `control_battery_sample_settings` (1 s slot), keeping the sensor sample (10 ms) NVM-free — same isolation as M6c.

- [ ] **Step 1: Add the prototypes to `control.h`** (near the other control-app prototypes)

```c
void control_deenergize_all(apu_ctx_t *ctx);
void control_battery_sample_settings(apu_ctx_t *ctx);
```

- [ ] **Step 2: Write the failing test `Tests/test_control_battery_sample.c`**

```c
#include "unity.h"
#include "control.h"
#include "sensors.h"
#include "sensors_cal.h"
#include "nvm.h"
#include "nvm_map.h"
#include "fake_nor.h"

static nvm_backend_t nor;
static apu_ctx_t ctx;
void setUp(void) { fake_nor_init(&nor); nvm_init(&nor); sensors_init(VREF_CAL_DEFAULT, 0); control_init(&ctx); }
void tearDown(void) {}

static void test_deenergize_all_clears_outputs_and_status(void) {
    ctx.out.fuel_pump = true; ctx.out.starter = true; ctx.out.glow_plug = true;
    ctx.out.compressor_clutch = true; ctx.out.heat_reverse = true; ctx.out.evap_fan = true;
    ctx.cool_mode = true; ctx.engine_op_status = ST_RUNNING; ctx.control_status = ST_CHARGING;
    control_deenergize_all(&ctx);
    TEST_ASSERT_FALSE(ctx.out.fuel_pump);
    TEST_ASSERT_FALSE(ctx.out.starter);
    TEST_ASSERT_FALSE(ctx.out.glow_plug);
    TEST_ASSERT_FALSE(ctx.out.compressor_clutch);
    TEST_ASSERT_FALSE(ctx.out.heat_reverse);
    TEST_ASSERT_FALSE(ctx.out.evap_fan);
    TEST_ASSERT_FALSE(ctx.cool_mode);
    TEST_ASSERT_EQUAL_UINT8(ST_OFF, ctx.engine_op_status);
    TEST_ASSERT_EQUAL_UINT8(ST_OFF, ctx.control_status);
}

static void test_sample_copies_battery_voltage(void) {
    for (int i = 0; i < SENS_AVG_DEFAULT; i++) sensors_add_sample(SENS_BATT, 2000);
    control_sample_sensors(&ctx);
    TEST_ASSERT_EQUAL_UINT16(sensors_get_batt_cv(), ctx.battery_voltage);
}

static void test_battery_sample_settings_reads_nvm(void) {
    nvm_write_word(EE_MONITOR_BATT_SETTING, 1180);
    control_battery_sample_settings(&ctx);
    TEST_ASSERT_EQUAL_UINT16(1180, ctx.batt_monitor_setting);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_deenergize_all_clears_outputs_and_status);
    RUN_TEST(test_sample_copies_battery_voltage);
    RUN_TEST(test_battery_sample_settings_reads_nvm);
    return UNITY_END();
}
```

- [ ] **Step 3: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_control_battery_sample test_control_battery_sample.c ../App/services/control.c ../App/services/control_sample.c ../App/services/control_battery.c ../App/services/sensors.c ../App/services/nvm.c ../App/services/nvm_record.c ../App/services/nvm_defaults.c ../App/services/modbus_crc.c ../App/services/fan_speed.c fakes/fake_nor.c)
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_battery_sample --output-on-failure`
Expected: build fails — `control_deenergize_all` / `control_battery_sample_settings` / `control_battery.c` undefined.

- [ ] **Step 5: Add `control_deenergize_all` to `control.c`** (after `control_init`)

```c
void control_deenergize_all(apu_ctx_t *ctx) {
    ctx->out.fuel_pump = false;  ctx->out.starter = false;  ctx->out.glow_plug = false;
    ctx->out.compressor_clutch = false;  ctx->out.heat_reverse = false;  ctx->out.evap_fan = false;
    ctx->cool_mode = false;
    ctx->engine_op_status = ST_OFF;  ctx->control_status = ST_OFF;
}
```

- [ ] **Step 6: Create `App/services/control_battery.c`** (settings helper only)

```c
#include "control.h"
#include "nvm.h"
#include "nvm_map.h"

void control_battery_sample_settings(apu_ctx_t *ctx) {
    ctx->batt_monitor_setting = nvm_read_word(EE_MONITOR_BATT_SETTING);
}
```

- [ ] **Step 7: Add the battery-voltage copy to `control_sample.c`** (extend `control_sample_sensors`, after the cabin-temp line)

```c
    ctx->battery_voltage = sensors_get_batt_cv();
```

- [ ] **Step 8: Wire `control_battery_sample_settings` into `control_1s_slot`** in `control_app.c` (add after `control_climate_sample_settings(&s_ctx);`)

```c
    control_battery_sample_settings(&s_ctx);
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_battery_sample --output-on-failure`
Expected: PASS (3 tests). Then run the full suite (expect 53 executables green: 52 prior + 1 new). `control_1s_slot` gains the battery settings call but is only exercised end-to-end by the Task 6 integration test.

- [ ] **Step 10: Commit**

```bash
git add firmware/g0b1-apu/App/services/control.h firmware/g0b1-apu/App/services/control.c firmware/g0b1-apu/App/services/control_sample.c firmware/g0b1-apu/App/services/control_battery.c firmware/g0b1-apu/App/services/control_app.c firmware/g0b1-apu/Tests/test_control_battery_sample.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): control — deenergize-all helper + battery-voltage sample + battery settings sample + 1s wiring"
```

---

### Task 3: Battery core — BM_START / BM_BATT_MONITOR / BM_START_ENGINE handoff

**Files:**
- Modify: `firmware/g0b1-apu/App/services/control.h` (add prototype)
- Modify: `firmware/g0b1-apu/App/services/control_battery.c` (add `BM_*` enum + `control_battery_mode`)
- Create: `firmware/g0b1-apu/Tests/test_control_battery.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `apu_ctx_t` (Task 1), M5 `app_timers.h`, `control_deenergize_all` (Task 2).
- Produces: `void control_battery_mode(apu_ctx_t *ctx);` (registered for `OP_BATTERY` in Task 6). This task implements `BM_START`, `BM_BATT_MONITOR`, `BM_START_ENGINE` + `default`; the charge cycle (Task 4) and monitor tail (Task 4) are appended later. Defines the full `BM_*` enum.

- [ ] **Step 1: Add the prototype to `control.h`**

```c
void control_battery_mode(apu_ctx_t *ctx);   /* register for OP_BATTERY */
```

- [ ] **Step 2: Write the failing test `Tests/test_control_battery.c`**

```c
#include "unity.h"
#include "control.h"
#include "app_timers.h"

static apu_ctx_t ctx;
void setUp(void) { app_timers_init(); control_init(&ctx); ctx.op_state = OP_BATTERY; ctx.sub_state = 0; }
void tearDown(void) {}

static void test_bm_start_deenergizes_and_advances(void) {
    ctx.out.fuel_pump = true; ctx.attempted_start_counter = 4; ctx.attempted_charging_counter = 2;
    control_battery_mode(&ctx);
    TEST_ASSERT_FALSE(ctx.out.fuel_pump);
    TEST_ASSERT_EQUAL_UINT8(ST_OFF, ctx.control_status);
    TEST_ASSERT_EQUAL_UINT8(0, ctx.attempted_start_counter);
    TEST_ASSERT_EQUAL_UINT8(0, ctx.attempted_charging_counter);
    TEST_ASSERT_EQUAL_UINT8(1, ctx.sub_state);          /* BM_BATT_MONITOR */
}

static void test_bm_monitor_low_voltage_arms_10s(void) {
    ctx.sub_state = 1; ctx.battery_voltage = 1150; ctx.batt_monitor_setting = 1200; /* low */
    control_battery_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT16(1000, app_timer_get(SCALE_TEN_MS, SHORT_DELAY_TMR));
    TEST_ASSERT_EQUAL_UINT8(2, ctx.sub_state);          /* BM_START_ENGINE */
}

static void test_bm_monitor_ok_voltage_stays(void) {
    ctx.sub_state = 1; ctx.battery_voltage = 1250; ctx.batt_monitor_setting = 1200; /* ok */
    ctx.attempted_charging_counter = 2;
    control_battery_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT8(0, ctx.attempted_charging_counter);
    TEST_ASSERT_EQUAL_UINT8(1, ctx.sub_state);          /* stays */
}

static void test_bm_start_engine_recovers_within_10s(void) {
    ctx.sub_state = 2; ctx.battery_voltage = 1250; ctx.batt_monitor_setting = 1200; /* recovered */
    app_timer_set(SCALE_TEN_MS, SHORT_DELAY_TMR, 5);    /* timer still running */
    control_battery_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT8(1, ctx.sub_state);          /* back to BM_BATT_MONITOR */
}

static void test_bm_start_engine_hands_off_after_10s(void) {
    ctx.sub_state = 2; ctx.battery_voltage = 1150; ctx.batt_monitor_setting = 1200;
    ctx.attempted_charging_counter = 1;                 /* -> 2, <=3 */
    /* SHORT_DELAY_TMR == 0 (expired) in fresh app_timers_init */
    control_battery_mode(&ctx);
    TEST_ASSERT_EQUAL_INT(OP_ENGINE_START, ctx.op_state);
    TEST_ASSERT_EQUAL_UINT8(OP_BATTERY, ctx.op_state_previous);
    TEST_ASSERT_EQUAL_UINT8(0, ctx.sub_state);          /* ES_GLOWPLUG_ON */
    TEST_ASSERT_EQUAL_UINT8(0, ctx.attempted_start_counter);
}

static void test_bm_start_engine_4th_attempt_errors(void) {
    ctx.sub_state = 2; ctx.battery_voltage = 1150; ctx.batt_monitor_setting = 1200;
    ctx.attempted_charging_counter = 3;                 /* ++ -> 4, > 3 */
    control_battery_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT8(0, ctx.attempted_charging_counter);
    TEST_ASSERT_EQUAL_UINT8(6, ctx.sub_state);          /* BM_ERROR_PROCESS */
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_bm_start_deenergizes_and_advances);
    RUN_TEST(test_bm_monitor_low_voltage_arms_10s);
    RUN_TEST(test_bm_monitor_ok_voltage_stays);
    RUN_TEST(test_bm_start_engine_recovers_within_10s);
    RUN_TEST(test_bm_start_engine_hands_off_after_10s);
    RUN_TEST(test_bm_start_engine_4th_attempt_errors);
    return UNITY_END();
}
```

- [ ] **Step 3: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_control_battery test_control_battery.c ../App/services/control_battery.c ../App/services/control.c ../App/services/app_timers.c ../App/services/nvm.c ../App/services/nvm_record.c ../App/services/nvm_defaults.c ../App/services/modbus_crc.c ../App/services/fan_speed.c fakes/fake_nor.c)
```
*(`control_battery.c` includes `nvm.h`/`nvm_map.h` for its settings helper; link the NVM set. The mode tests set ctx directly and don't call NVM, but the TU must link.)*

- [ ] **Step 4: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R "^test_control_battery$" --output-on-failure`
Expected: build fails — `control_battery_mode` undefined.

- [ ] **Step 5: Add the `BM_*` enum + `control_battery_mode` to `control_battery.c`** (add `#include "app_timers.h"`; add the enum near the top; add the function below the helper)

```c
enum { BM_START = 0, BM_BATT_MONITOR, BM_START_ENGINE, BM_CHARGING,
       BM_BATT_STABLE_2MIN, BM_BATT_CHECK, BM_ERROR_PROCESS };

void control_battery_mode(apu_ctx_t *ctx) {
    switch (ctx->sub_state) {
        case BM_START:
            control_deenergize_all(ctx);   /* also sets engine_op_status/control_status = ST_OFF */
            ctx->attempted_start_counter = 0;
            ctx->attempted_charging_counter = 0;
            ctx->sub_state = BM_BATT_MONITOR;
            break;
        case BM_BATT_MONITOR:
            if (ctx->battery_voltage < ctx->batt_monitor_setting) {
                app_timer_set(SCALE_TEN_MS, SHORT_DELAY_TMR, 1000);   /* 10 s confirm */
                ctx->sub_state = BM_START_ENGINE;
            } else {
                ctx->attempted_charging_counter = 0;
            }
            break;
        case BM_START_ENGINE:
            if (!app_timer_expired(SCALE_TEN_MS, SHORT_DELAY_TMR)) {
                if (ctx->battery_voltage > ctx->batt_monitor_setting) {   /* recovered < 10 s */
                    app_timer_set(SCALE_TEN_MS, SHORT_DELAY_TMR, 0);
                    ctx->sub_state = BM_BATT_MONITOR;
                }
            } else {                                                     /* 10 s elapsed */
                ctx->attempted_charging_counter++;
                if (ctx->attempted_charging_counter > 3) {
                    ctx->attempted_charging_counter = 0;
                    ctx->sub_state = BM_ERROR_PROCESS;
                } else {
                    ctx->op_state_previous = OP_BATTERY;
                    ctx->op_state = OP_ENGINE_START;
                    ctx->sub_state = 0;                                  /* ES_GLOWPLUG_ON */
                    ctx->attempted_start_counter = 0;
                }
            }
            break;
        default:
            break;
    }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R "^test_control_battery$" --output-on-failure`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add firmware/g0b1-apu/App/services/control.h firmware/g0b1-apu/App/services/control_battery.c firmware/g0b1-apu/Tests/test_control_battery.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): control — battery core (start / monitor / start-engine handoff)"
```

---

### Task 4: Battery charge cycle (CHARGING / STABLE / CHECK / ERROR_PROCESS) + monitor tail

**Files:**
- Modify: `firmware/g0b1-apu/App/services/control_battery.c` (add four cases + post-switch tail)
- Modify: `firmware/g0b1-apu/Tests/test_control_battery.c` (add tests)

**Interfaces:**
- Adds cases `BM_CHARGING`, `BM_BATT_STABLE_2MIN`, `BM_BATT_CHECK`, `BM_ERROR_PROCESS` before `default`, and the post-switch monitor tail after the switch (engine over-temp → oil → standby), mirroring M6c's placement.

- [ ] **Step 1: Add the failing tests to `test_control_battery.c`** (add functions + `RUN_TEST` lines)

```c
static void test_bm_charging_arms_30min(void) {
    ctx.sub_state = 3 /*BM_CHARGING*/;
    control_battery_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT16(30, app_timer_get(SCALE_MINUTE, CHARGING_BATT_TMR));
    TEST_ASSERT_EQUAL_UINT8(ST_CHARGING, ctx.control_status);
    TEST_ASSERT_EQUAL_UINT8(4, ctx.sub_state);          /* BM_BATT_STABLE_2MIN */
}

static void test_bm_stable_after_charge_arms_2min(void) {
    ctx.sub_state = 4 /*BM_BATT_STABLE_2MIN*/; ctx.out.fuel_pump = true; ctx.cool_mode = true;
    /* CHARGING_BATT_TMR == 0 (expired) in fresh app_timers_init */
    control_battery_mode(&ctx);
    TEST_ASSERT_FALSE(ctx.out.fuel_pump);
    TEST_ASSERT_FALSE(ctx.cool_mode);
    TEST_ASSERT_EQUAL_UINT8(ST_OFF, ctx.control_status);
    TEST_ASSERT_EQUAL_UINT16(120, app_timer_get(SCALE_SECOND, BATT_STABLE_TMR));
    TEST_ASSERT_EQUAL_UINT8(5, ctx.sub_state);          /* BM_BATT_CHECK */
}

static void test_bm_check_after_rest_remeasures(void) {
    ctx.sub_state = 5 /*BM_BATT_CHECK*/;
    /* BATT_STABLE_TMR == 0 (expired) */
    control_battery_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT8(1, ctx.sub_state);          /* BM_BATT_MONITOR */
}

static void test_bm_error_process_shuts_down(void) {
    ctx.sub_state = 6 /*BM_ERROR_PROCESS*/;
    control_battery_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT8(ERR_LOW_BATTERY, ctx.error_state);
    TEST_ASSERT_EQUAL_INT(OP_ERROR_SHUTDOWN, ctx.op_state);
}

static void test_tail_engine_over_temp_shuts_down(void) {
    ctx.sub_state = 1 /*BM_BATT_MONITOR*/; ctx.batt_monitor_setting = 1200; ctx.battery_voltage = 1250;
    ctx.engine_temp_ok = false;
    control_battery_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT8(ERR_HIGH_ENGINE_TEMP, ctx.error_state);
    TEST_ASSERT_EQUAL_INT(OP_ERROR_SHUTDOWN, ctx.op_state);
}

static void test_tail_low_oil_when_running_shuts_down(void) {
    ctx.sub_state = 1; ctx.batt_monitor_setting = 1200; ctx.battery_voltage = 1250;
    ctx.engine_temp_ok = true; ctx.out.fuel_pump = true; ctx.in_oil_pressure_ok = false;
    control_battery_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT8(ERR_LOW_OIL, ctx.error_state);
    TEST_ASSERT_EQUAL_INT(OP_ERROR_SHUTDOWN, ctx.op_state);
}

static void test_tail_standby_shuts_down(void) {
    ctx.sub_state = 1; ctx.batt_monitor_setting = 1200; ctx.battery_voltage = 1250;
    ctx.engine_temp_ok = true; ctx.control_status = ST_CHARGING; /* != ST_OFF */
    ctx.standby_override = false; ctx.in_truck_ignition = true;
    control_battery_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT8(ERR_STANDBY, ctx.error_state);
    TEST_ASSERT_EQUAL_INT(OP_ERROR_SHUTDOWN, ctx.op_state);
    TEST_ASSERT_EQUAL_UINT8(OP_BATTERY, ctx.op_state_previous);
    TEST_ASSERT_EQUAL_UINT8(0, ctx.attempted_charging_counter);
}

static void test_tail_standby_suppressed_when_status_off(void) {
    ctx.sub_state = 1; ctx.batt_monitor_setting = 1200; ctx.battery_voltage = 1250;
    ctx.engine_temp_ok = true; ctx.control_status = ST_OFF;  /* guard: no standby while stood down */
    ctx.standby_override = false; ctx.in_truck_ignition = true;
    control_battery_mode(&ctx);
    TEST_ASSERT_NOT_EQUAL_INT(OP_ERROR_SHUTDOWN, ctx.op_state);
}
```
Register all eight with `RUN_TEST(...)`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R "^test_control_battery$" --output-on-failure`
Expected: FAIL — the four cases fall through `default`; no tail.

- [ ] **Step 3: Add the four cases + the tail to `control_battery.c`** (insert the cases before `default:`; add the tail after the switch's closing brace, before the function's closing `}`)

```c
        case BM_CHARGING:
            app_timer_set(SCALE_MINUTE, CHARGING_BATT_TMR, 30);
            ctx->control_status = ST_CHARGING;
            ctx->sub_state = BM_BATT_STABLE_2MIN;
            break;
        case BM_BATT_STABLE_2MIN:
            if (app_timer_expired(SCALE_MINUTE, CHARGING_BATT_TMR)) {
                ctx->out.fuel_pump = false;
                ctx->cool_mode = false;
                ctx->control_status = ST_OFF;
                app_timer_set(SCALE_SECOND, BATT_STABLE_TMR, 120);
                ctx->sub_state = BM_BATT_CHECK;
            }
            break;
        case BM_BATT_CHECK:
            if (app_timer_expired(SCALE_SECOND, BATT_STABLE_TMR)) {
                ctx->sub_state = BM_BATT_MONITOR;
            }
            break;
        case BM_ERROR_PROCESS:
            ctx->error_state = ERR_LOW_BATTERY;
            ctx->op_state = OP_ERROR_SHUTDOWN;
            break;
```

After the `switch (...) { ... }` closing brace, before the function's closing `}`:

```c
    /* Monitor engine temperature, oil pressure, and standby every tick. */
    if (!ctx->engine_temp_ok) {
        ctx->error_state = ERR_HIGH_ENGINE_TEMP;
        ctx->op_state = OP_ERROR_SHUTDOWN;
    } else if (ctx->out.fuel_pump && !ctx->in_oil_pressure_ok) {
        ctx->error_state = ERR_LOW_OIL;
        ctx->op_state = OP_ERROR_SHUTDOWN;
    }
    if (!ctx->standby_override && ctx->control_status != ST_OFF && ctx->in_truck_ignition) {
        ctx->attempted_charging_counter = 0;
        ctx->op_state_previous = OP_BATTERY;
        ctx->error_state = ERR_STANDBY;
        ctx->op_state = OP_ERROR_SHUTDOWN;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R "^test_control_battery$" --output-on-failure`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add firmware/g0b1-apu/App/services/control_battery.c firmware/g0b1-apu/Tests/test_control_battery.c
git commit -m "feat(g0b1-apu): control — battery charge cycle (charging/stable/check/error) + monitor tail"
```

---

### Task 5: Error-shutdown handler (dispatch on error_state + standby recovery)

**Files:**
- Modify: `firmware/g0b1-apu/App/services/control.h` (add prototype)
- Create: `firmware/g0b1-apu/App/services/control_error_shutdown.c`
- Create: `firmware/g0b1-apu/Tests/test_control_error_shutdown.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `apu_ctx_t`, `control_deenergize_all` (Task 2).
- Produces: `void control_error_shutdown_mode(apu_ctx_t *ctx);` (registered for `OP_ERROR_SHUTDOWN` in Task 6). A `switch (ctx->error_state)` — NOT a sub-state machine.

- [ ] **Step 1: Add the prototype to `control.h`**

```c
void control_error_shutdown_mode(apu_ctx_t *ctx);   /* register for OP_ERROR_SHUTDOWN */
```

- [ ] **Step 2: Write the failing test `Tests/test_control_error_shutdown.c`**

```c
#include "unity.h"
#include "control.h"

static apu_ctx_t ctx;
void setUp(void) { control_init(&ctx); ctx.op_state = OP_ERROR_SHUTDOWN; }
void tearDown(void) {}

static void set_all_outputs_on(apu_ctx_t *c) {
    c->out.fuel_pump = true; c->out.starter = true; c->out.glow_plug = true;
    c->out.compressor_clutch = true; c->out.evap_fan = true; c->cool_mode = true;
}

static void test_err_none_goes_off(void) {
    ctx.error_state = ERR_NONE;
    control_error_shutdown_mode(&ctx);
    TEST_ASSERT_EQUAL_INT(OP_OFF, ctx.op_state);
    TEST_ASSERT_EQUAL_UINT8(0, ctx.sub_state);
}

static void test_low_oil_deenergizes(void) {
    set_all_outputs_on(&ctx); ctx.error_state = ERR_LOW_OIL;
    control_error_shutdown_mode(&ctx);
    TEST_ASSERT_FALSE(ctx.out.fuel_pump);
    TEST_ASSERT_FALSE(ctx.out.compressor_clutch);
    TEST_ASSERT_FALSE(ctx.out.evap_fan);
    TEST_ASSERT_EQUAL_INT(OP_ERROR_SHUTDOWN, ctx.op_state);  /* latches */
}

static void test_high_engine_temp_deenergizes(void) {
    set_all_outputs_on(&ctx); ctx.error_state = ERR_HIGH_ENGINE_TEMP;
    control_error_shutdown_mode(&ctx);
    TEST_ASSERT_FALSE(ctx.out.fuel_pump);
    TEST_ASSERT_EQUAL_UINT8(ST_OFF, ctx.control_status);
}

static void test_low_battery_deenergizes(void) {
    set_all_outputs_on(&ctx); ctx.error_state = ERR_LOW_BATTERY;
    control_error_shutdown_mode(&ctx);
    TEST_ASSERT_FALSE(ctx.out.starter);
    TEST_ASSERT_EQUAL_UINT8(ST_OFF, ctx.engine_op_status);
}

static void test_starting_failure_deenergizes(void) {
    set_all_outputs_on(&ctx); ctx.error_state = ERR_STARTING_FAILURE;
    control_error_shutdown_mode(&ctx);
    TEST_ASSERT_FALSE(ctx.out.glow_plug);
}

static void test_no_rpm_deenergizes(void) {
    set_all_outputs_on(&ctx); ctx.error_state = ERR_NO_RPM_DETECTED;
    control_error_shutdown_mode(&ctx);
    TEST_ASSERT_FALSE(ctx.out.fuel_pump);
    TEST_ASSERT_EQUAL_INT(OP_ERROR_SHUTDOWN, ctx.op_state);
}

static void test_ac_low_pressure_kills_compressor_only(void) {
    set_all_outputs_on(&ctx); ctx.error_state = ERR_AC_LOW_PRESSURE;
    control_error_shutdown_mode(&ctx);
    TEST_ASSERT_FALSE(ctx.out.compressor_clutch);
    TEST_ASSERT_TRUE(ctx.out.fuel_pump);                    /* engine keeps running */
    TEST_ASSERT_EQUAL_INT(OP_ERROR_SHUTDOWN, ctx.op_state);
}

static void test_ac_high_pressure_kills_compressor_only(void) {
    set_all_outputs_on(&ctx); ctx.error_state = ERR_AC_HIGH_PRESSURE;
    control_error_shutdown_mode(&ctx);
    TEST_ASSERT_FALSE(ctx.out.compressor_clutch);
    TEST_ASSERT_TRUE(ctx.out.fuel_pump);
}

static void test_standby_recovers_when_truck_off(void) {
    set_all_outputs_on(&ctx); ctx.error_state = ERR_STANDBY;
    ctx.op_state_previous = OP_CLIMATE; ctx.in_truck_ignition = false; /* truck off */
    control_error_shutdown_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT8(ERR_NONE, ctx.error_state);
    TEST_ASSERT_EQUAL_INT(OP_CLIMATE, ctx.op_state);
    TEST_ASSERT_EQUAL_UINT8(0, ctx.sub_state);
}

static void test_standby_recovers_on_override(void) {
    set_all_outputs_on(&ctx); ctx.error_state = ERR_STANDBY;
    ctx.op_state_previous = OP_BATTERY; ctx.in_truck_ignition = true; ctx.standby_override = true;
    control_error_shutdown_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT8(ERR_NONE, ctx.error_state);
    TEST_ASSERT_EQUAL_INT(OP_BATTERY, ctx.op_state);
}

static void test_standby_latches_when_truck_on(void) {
    set_all_outputs_on(&ctx); ctx.error_state = ERR_STANDBY;
    ctx.op_state_previous = OP_CLIMATE; ctx.in_truck_ignition = true; ctx.standby_override = false;
    control_error_shutdown_mode(&ctx);
    TEST_ASSERT_FALSE(ctx.out.fuel_pump);                   /* de-energized */
    TEST_ASSERT_EQUAL_INT(OP_ERROR_SHUTDOWN, ctx.op_state); /* stays */
    TEST_ASSERT_EQUAL_UINT8(ERR_STANDBY, ctx.error_state);
}

static void test_engine_stalled_goes_off(void) {           /* code 8 -> default -> OFF */
    ctx.error_state = ERR_ENGINE_STALLED;
    control_error_shutdown_mode(&ctx);
    TEST_ASSERT_EQUAL_INT(OP_OFF, ctx.op_state);
    TEST_ASSERT_EQUAL_UINT8(0, ctx.sub_state);
}

static void test_high_ac_pressure_goes_off(void) {         /* code 10 -> default -> OFF */
    ctx.error_state = ERR_HIGH_AC_PRESSURE;
    control_error_shutdown_mode(&ctx);
    TEST_ASSERT_EQUAL_INT(OP_OFF, ctx.op_state);
}

static void test_sets_temp_display_realtime(void) {
    ctx.error_state = ERR_LOW_OIL; ctx.temp_display_state = TD_CC_SETTING;
    control_error_shutdown_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT8(TD_REAL_TIME, ctx.temp_display_state);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_err_none_goes_off);
    RUN_TEST(test_low_oil_deenergizes);
    RUN_TEST(test_high_engine_temp_deenergizes);
    RUN_TEST(test_low_battery_deenergizes);
    RUN_TEST(test_starting_failure_deenergizes);
    RUN_TEST(test_no_rpm_deenergizes);
    RUN_TEST(test_ac_low_pressure_kills_compressor_only);
    RUN_TEST(test_ac_high_pressure_kills_compressor_only);
    RUN_TEST(test_standby_recovers_when_truck_off);
    RUN_TEST(test_standby_recovers_on_override);
    RUN_TEST(test_standby_latches_when_truck_on);
    RUN_TEST(test_engine_stalled_goes_off);
    RUN_TEST(test_high_ac_pressure_goes_off);
    RUN_TEST(test_sets_temp_display_realtime);
    return UNITY_END();
}
```

- [ ] **Step 3: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_control_error_shutdown test_control_error_shutdown.c ../App/services/control_error_shutdown.c ../App/services/control.c ../App/services/fan_speed.c)
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_error_shutdown --output-on-failure`
Expected: build fails — `control_error_shutdown_mode` undefined.

- [ ] **Step 5: Write `App/services/control_error_shutdown.c`**

```c
#include "control.h"

void control_error_shutdown_mode(apu_ctx_t *ctx) {
    ctx->temp_display_state = TD_REAL_TIME;
    switch (ctx->error_state) {
        case ERR_NONE:
            ctx->op_state = OP_OFF;
            ctx->sub_state = 0;
            break;
        case ERR_LOW_OIL:
        case ERR_HIGH_ENGINE_TEMP:
        case ERR_LOW_BATTERY:
        case ERR_STARTING_FAILURE:
        case ERR_NO_RPM_DETECTED:
            control_deenergize_all(ctx);   /* latching de-energize */
            break;
        case ERR_AC_LOW_PRESSURE:
        case ERR_AC_HIGH_PRESSURE:
            ctx->out.compressor_clutch = false;   /* engine keeps running */
            break;
        case ERR_STANDBY:
            control_deenergize_all(ctx);
            if (!ctx->in_truck_ignition || ctx->standby_override) {
                ctx->error_state = ERR_NONE;
                ctx->op_state = ctx->op_state_previous;
                ctx->sub_state = 0;
            }
            break;
        default:                            /* ERR_ENGINE_STALLED, ERR_HIGH_AC_PRESSURE, unmapped */
            ctx->op_state = OP_OFF;
            ctx->sub_state = 0;
            break;
    }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_error_shutdown --output-on-failure`
Expected: PASS (14 tests).

- [ ] **Step 7: Commit**

```bash
git add firmware/g0b1-apu/App/services/control.h firmware/g0b1-apu/App/services/control_error_shutdown.c firmware/g0b1-apu/Tests/test_control_error_shutdown.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): control — error-shutdown handler (de-energize + standby recovery + default-OFF)"
```

---

### Task 6: Register OP_BATTERY + OP_ERROR_SHUTDOWN + end-to-end integration

**Files:**
- Modify: `firmware/g0b1-apu/App/services/control_app.c` (register both modes)
- Create: `firmware/g0b1-apu/Tests/test_control_battery_integration.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt` (new exe **and** add the two new sources to the three pre-existing integration tests — link fallout)

**Interfaces:**
- `control_app_init` also calls `control_register_mode(OP_BATTERY, control_battery_mode)` and `control_register_mode(OP_ERROR_SHUTDOWN, control_error_shutdown_mode)`.
- Integration drives the battery low-voltage → engine-start handoff through the real scheduler, and a fault → de-energize.

- [ ] **Step 1: Modify `control_app.c`** — add to `control_app_init` (after the OP_CLIMATE registration):

```c
    control_register_mode(OP_BATTERY, control_battery_mode);
    control_register_mode(OP_ERROR_SHUTDOWN, control_error_shutdown_mode);
```

- [ ] **Step 2: Add the two new sources to the three pre-existing integration tests' CMake lines** (link fallout — `control_app.c` now references `control_battery_mode` + `control_error_shutdown_mode`). To each of `test_control_integration`, `test_control_engine_start_integration`, `test_control_climate_integration`, append:

```
../App/services/control_battery.c ../App/services/control_error_shutdown.c
```
*(Each of those three `add_unity_test(...)` lines already links `control_app.c`, `control_climate.c`, `control_engine_start.c`, and the NVM set; add exactly these two sources. Do not change anything else on those lines.)*

- [ ] **Step 3: Write the failing test `Tests/test_control_battery_integration.c`**

```c
#include "unity.h"
#include "control.h"
#include "sched.h"
#include "app_timers.h"
#include "sensors.h"
#include "sensors_cal.h"
#include "nvm.h"
#include "nvm_map.h"
#include "bsp_io.h"
#include "bsp_pwm.h"
#include "mb_regmodel.h"
#include "fake_bsp_io.h"
#include "fake_bsp_pwm.h"
#include "fake_nor.h"

static bsp_io_backend_t io_be;
static bsp_pwm_backend_t pwm_be;
static nvm_backend_t nor;

void setUp(void) {
    fake_bsp_io_init(&io_be);   bsp_io_init(&io_be);
    fake_bsp_pwm_init(&pwm_be); bsp_pwm_init(&pwm_be);
    mb_reg_reset();
    sensors_init(VREF_CAL_DEFAULT, 0);
    fake_nor_init(&nor); nvm_init(&nor);
    sched_init();
    control_app_init();
    sched_register(SLOT_10MS, control_10ms_slot);
    sched_register(SLOT_1S,   control_1s_slot);
}
void tearDown(void) {}

static void advance(uint32_t total_ms) {
    for (uint32_t t = 0; t < total_ms; t++) { sched_service(1); sched_run(); }
}

/* Battery monitor: setpoint high, measured battery low -> after 10 s confirm, hand off to
   engine-start with op_state_previous = OP_BATTERY. Drive battery via the M3 sensor and the
   setpoint via NVM (the slots overwrite the ctx copies each tick), not by poking ctx. */
static void test_low_battery_hands_off_to_engine_start(void) {
    apu_ctx_t *c = control_app_ctx();
    nvm_write_word(EE_MONITOR_BATT_SETTING, 1300);           /* setpoint 13.0 V */
    for (int i = 0; i < SENS_AVG_DEFAULT; i++) sensors_add_sample(SENS_BATT, 1000); /* low battery */
    TEST_ASSERT_TRUE(sensors_get_batt_cv() < 1300);          /* guard: really low */
    c->op_state = OP_BATTERY; c->sub_state = 0;              /* BM_START */

    advance(11000);   /* START -> MONITOR -> arm 10 s -> START_ENGINE -> handoff */
    TEST_ASSERT_EQUAL_INT(OP_ENGINE_START, c->op_state);
    TEST_ASSERT_EQUAL_UINT8(OP_BATTERY, c->op_state_previous);
}

/* Fault injection: seed an error + OP_ERROR_SHUTDOWN, run the slot, outputs de-energize. */
static void test_error_shutdown_deenergizes(void) {
    apu_ctx_t *c = control_app_ctx();
    c->op_state = OP_ERROR_SHUTDOWN; c->error_state = ERR_HIGH_ENGINE_TEMP;
    c->out.fuel_pump = true; c->out.compressor_clutch = true;
    advance(50);
    TEST_ASSERT_FALSE(fake_bsp_io_out(OUT_FUEL_PUMP));
    TEST_ASSERT_FALSE(fake_bsp_io_out(OUT_COMPRESSOR_CLUTCH));
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_low_battery_hands_off_to_engine_start);
    RUN_TEST(test_error_shutdown_deenergizes);
    return UNITY_END();
}
```

*Note: `control_10ms_slot` runs `control_sample_sensors` (overwrites `battery_voltage` from `SENS_BATT`) and `control_1s_slot` runs `control_battery_sample_settings` (overwrites `batt_monitor_setting` from NVM) each period, so battery voltage and setpoint MUST be driven via the sensor/NVM, not the ctx fields. The `sensors_get_batt_cv() < 1300` guard makes a bad raw-count fail loudly. For the fault test, `error_state` is not a slot-sampled field, so setting it on the ctx is fine.*

- [ ] **Step 4: Register the new exe in `Tests/CMakeLists.txt`** (full source set)

```cmake
add_unity_test(test_control_battery_integration test_control_battery_integration.c
    ../App/services/control.c ../App/services/control_outputs.c ../App/services/control_powerup.c
    ../App/services/control_off.c ../App/services/control_io.c ../App/services/control_app.c
    ../App/services/control_engine_start.c ../App/services/control_climate.c ../App/services/control_battery.c
    ../App/services/control_error_shutdown.c ../App/services/control_sample.c
    ../App/services/sched.c ../App/services/app_timers.c ../App/services/io_debounce.c
    ../App/services/bsp_io.c ../App/services/bsp_pwm.c ../App/services/fan_speed.c
    ../App/services/sensors.c ../App/services/mb_regmodel.c
    ../App/services/nvm.c ../App/services/nvm_record.c ../App/services/nvm_defaults.c ../App/services/modbus_crc.c
    fakes/fake_bsp_io.c fakes/fake_bsp_pwm.c fakes/fake_nor.c)
```

- [ ] **Step 5: Run the integration test**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_battery_integration --output-on-failure`
Expected: build, then both scenarios pass. If the low-battery count doesn't satisfy the `< 1300` guard, adjust the raw count. A genuine composition bug → fix the offending module, not the test.

- [ ] **Step 6: Run the full suite to confirm no regressions**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build --output-on-failure`
Expected: all pass. Executable count: 51 (through M6c) + test_control_ctx_bm + test_control_battery_sample + test_control_battery + test_control_error_shutdown + test_control_battery_integration = **56 executables**, zero warnings under `-Werror`.

- [ ] **Step 7: Commit**

```bash
git add firmware/g0b1-apu/App/services/control_app.c firmware/g0b1-apu/Tests/test_control_battery_integration.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): control — register OP_BATTERY + OP_ERROR_SHUTDOWN + end-to-end integration"
```

---

## Deferred to later milestones / bench

- **M6e (oil-change + runtime hours):** the 1-minute routine (`engine_run_timer`/`engine_oil_timer` accumulation, NVM every 60 min), the 500/580/700 hr oil-change warnings with 20 hr/5 hr re-warn, and the PIC long-term NVM counter chain (`inc_long_term_counter`/multi-word accumulators). Needs a `control_1min_slot`.
- **`OP_COLD_STORAGE` / PIC `ColdStorageMode` (~main.c:1941) — intentionally descoped (OI-6), NOT ported.** After M6d, **6 of the 7 `op_state`s have handlers** (POWER_UP/OFF/ENGINE_START/CLIMATE/BATTERY/ERROR_SHUTDOWN); `OP_COLD_STORAGE` (enum slot 5) is deliberately left unregistered. It is runtime-unreachable — `apply_mode_request` maps only OFF/CLIMATE/BATTERY and `mode_request` has no cold-storage value — and the `control_tick` NULL-guard turns any (currently impossible) cold-storage dispatch into a safe no-op, so that guard is load-bearing and must stay. Revisit if OI-6 resolves cold-storage as in-scope for this variant.
- **Standby-override auto-reset (Minor, bench):** the PIC clears `stand_by_overide_flag` when the truck engine turns off (`BatteryMonitorMode` #else, ~main.c:1933-1937). The port's `standby_override` (reg 32) stays latched until externally cleared — the recovery path (`!in_truck_ignition`) still works, but the override won't self-re-arm on the next truck-off→on cycle. Likely bench/HMI-managed.
- **Bench:** A/C low/high override-resume (+ override registers); ERR_ENGINE_STALLED/NO_RPM/HIGH_AC triggering (RPM reg 9 + stall detection in running modes); `engine_temp_ok` derivation; oil-pressure switch polarity; reg 41 production test.

## Carry-forward items to confirm

- **Battery monitor thresholds / 12V system** — `batt_monitor_setting` default 1200 (12.0 V); confirm at bench against the pack.
- **Charge (30 min) / rest (2 min) / confirm (10 s) timings** — validated against the PIC constants; confirm on the unit.
- **Standby `control_status != ST_OFF` guard** — preserved from the PIC; confirm the standby-resume behavior at bench.

---

## Self-Review

**Spec coverage (design §2–§11):** `control_error_t` 8–10 ✅ (Task 1); battery `battery_monitor_state_list` with all seven states + BM_CHARGING=3 hand-back ✅ (Tasks 3–4); low-voltage confirm → engine-start handoff → charge → rest → re-measure ✅; monitor tail (over-temp/oil/standby) ✅ (Task 4); error-shutdown dispatch on `error_state` with latching de-energize / compressor-only / standby recovery / default-OFF / ERR_NONE→OFF ✅ (Task 5); shared `control_deenergize_all` ✅ (Task 2); battery voltage ← M3 reg 6, setpoint ← NVM reg 13 ✅ (Task 2); register both modes + integration ✅ (Task 6). Oil-change/runtime, A/C-override resume, RPM-derived triggering ⏸ deferred (documented).

**Placeholder scan:** no TBD/TODO. The one timing-sensitive integration vector (low-battery count) has a `sensors_get_batt_cv() < 1300` guard assert; the 30-min/2-min cycle is unit-tested by direct timer drive (documented), not advanced.

**Type consistency:** the three new `apu_ctx_t` fields (Task 1) are used identically by `control_battery_sample_settings`/`control_sample_sensors` (Task 2), the battery mode (Tasks 3–4), and the integration (Task 6). `ERR_*` codes, `ST_*` statuses, `OP_*` states, `TD_REAL_TIME` all from M6a `control.h`. `control_deenergize_all` (Task 2) is used by battery `BM_START` (Task 3) and every error-shutdown latching case (Task 5). Timer indices/scales (`SHORT_DELAY_TMR` TEN_MS; `BATT_STABLE_TMR` SECOND; `CHARGING_BATT_TMR` MINUTE) and `app_timer_set/get/expired` from M5. `sensors_get_batt_cv`/`SENS_BATT` from M3; `nvm_read_word`/`EE_MONITOR_BATT_SETTING` from M2/M4b. The battery NVM read rides only on `control_1s_slot`, so the M6b engine-start integration test stays NVM-independent at runtime. Task 6 adds `control_battery.c` + `control_error_shutdown.c` to the three pre-existing integration tests (link fallout from registering the modes) and links the full set for the new integration test.
