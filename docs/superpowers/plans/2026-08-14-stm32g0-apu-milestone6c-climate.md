# STM32G0 APU Port — Milestone 6c: Climate Control (Cooling) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the PIC `ClimateControlMode` (cooling-only) faithfully as the `OP_CLIMATE` control-mode handler — the settle→engine-start handoff, the cabin-temp hysteresis, the compressor/evaporator cool sequence, the 30-minute defrost cycle, the A/C low/high-pressure fault handling, and the engine-over-temp monitor — registered into the M6a dispatcher.

**Architecture:** A single `control_climate_mode(apu_ctx_t *ctx)` runs the `clmt_ctrl_state_list` machine off `ctx->sub_state`, reading cabin temp / setpoint / timers / A/C-pressure flags from `apu_ctx_t` and writing output *requests* + statuses + `op_state` transitions into the ctx — the M6a "modes request; outputs_apply maps" model. Count-up compressor timers are maintained by a new `control_1s_slot` (M5 `SLOT_1S`); countdown timers auto-decrement via `sched`. The handler is registered via `control_register_mode(OP_CLIMATE, …)` — no dispatcher edits. Sensor/setting/flag derivations that depend on M3-deferred sensing are ctx flags/values with safe defaults.

**Tech Stack:** C11, CMake + Unity (host). Reuses M6a `control` (apu_ctx_t, dispatcher, outputs_apply, control_app), M6b engine-start (invoked mode + hand-back target), M5 `app_timers`/`sched`, M3 `sensors` (enclosure/cabin temp), M2 `nvm` (setpoint/fan-speed), M4b register model (setpoint reg 14 + fan-speed reg 12 already bound).

**Design spec:** `docs/superpowers/specs/2026-08-14-stm32g0-apu-milestone6c-climate-design.md`. Source of truth: PIC `main.c` `ClimateControlMode` (~L1547–1760), `main.h` `clmt_ctrl_state_list` / CC constants.

## Global Constraints

- **Behavior preserved faithfully** (same states, transitions, timings, thresholds), restructured into `apu_ctx_t`.
- **Cooling-only.** The `CC_*` enum (in `control_climate.c`, `ctx->sub_state` values) defines all 19 values: `CC_START_SETTLE=0, CC_START_ENGINE=1, CC_MONITOR_TEMP=2, CC_START_COOL=3, CC_SWITCH_TO_COOL=4, CC_COMP_ON=5, CC_AC_LOW_PRESSURE_RECHK=6, CC_EVAP_ON=7, CC_CTRL_RUNNING=8, CC_HEAT_DEFROST=9, CC_COOL_DEFROST_END=10, CC_HEAT_SWITCHFROM_COOL=11, CC_EVAP_OFF=12, CC_AC_LOW_PRESSURE_FAIL=13, CC_AC_HIGH_PRESSURE_FAIL=14, CC_ANTI_STALL_STEP1=15, CC_ANTI_STALL_STEP2=16, CC_AC_HIGH_PRESSURE_RECHK=17, CC_WAIT_HIGH_PRESSURE_NORMAL=18`. **Dispatched:** 0,1,2,3,5,6,7,8,10,12,13,14,17,18. **Defined-but-never-dispatched** (preserve value, no case): 4, 9, 11, 15, 16.
- **`CC_MONITOR_TEMP == 2`** is M6b engine-start's COOL_ON hand-back target — do not renumber.
- **Constants:** `CC_TEMP_OFFSET = 3` (°F). Settle `SHORT_DELAY_TMR = 100` (SCALE_TEN_MS → 1 s). `COMP_EVAP_DELAY_TMR = 0` (SCALE_SECOND). `EVAP_FORCED_ON_TMR = 10` (SCALE_SECOND). `EVENT_INTERVAL_TMR = 45` (SCALE_SECOND). `DEFROST_CYCLE_TMR = 30` (SCALE_MINUTE, = `DEFROST_INTERVAL`). Compressor min-off guard `compressor_off_timer >= 15`. Pressure-monitor arm `compressor_on_timer >= 2`. Refrigerant retry cap `refregerant_check_counter > 10`.
- **Timers** (all indices exist in M5 `app_timers.h`): `SHORT_DELAY_TMR` (SCALE_TEN_MS); `COMP_EVAP_DELAY_TMR`, `EVAP_FORCED_ON_TMR`, `EVENT_INTERVAL_TMR` (SCALE_SECOND); `DEFROST_CYCLE_TMR` (SCALE_MINUTE). `app_timer_expired(s,i)` is true when the timer value == 0.
- **Compressor count-up timers** (`control_1s_slot`): compressor OFF → `compressor_on_timer = 0`, `compressor_off_timer++` (cap 255); compressor ON → `compressor_off_timer = 0`, `compressor_on_timer++` (cap 255) — keyed off `ctx->out.compressor_clutch`.
- **Cool = PB4 de-energized** (`out.heat_reverse = false`), OI-1. **Condenser (OI-2)** = follow compressor at a fixed stub duty (ramp curve deferred).
- **A/C pressure flags** `ac_low_pressure_ok`/`ac_high_pressure_ok` default **true** (derivation deferred). `engine_temp_ok` default true (from M6b).
- **No new Modbus binds, no new `control_error_t` codes** (`ERR_AC_LOW_PRESSURE`/`ERR_AC_HIGH_PRESSURE` exist from M6a). No `apu_outputs_t` change.
- Fixed-width integers only. Portable code under `App/services/` — **no HAL**. Firmware root `firmware/g0b1-apu/`. Every task ends green (`ctest`) and is committed; build is `-Wall -Wextra -Werror -funsigned-char` and must stay pristine.

### Deferred / carry-forward
- `ac_low_pressure_ok`/`ac_high_pressure_ok` derivation (M3 A/C-pressure regs 4/5) → bench; flags default true (OK).
- OI-2 condenser head-pressure ramp curve → bench; M6c uses a fixed stub duty.
- Battery-voltage monitor in the PIC climate tail → **M6d** (also registers `OP_ERROR_SHUTDOWN`, consuming the `error_state`/`op_state` this mode sets).
- RPM anti-stall (`CC_ANTI_STALL_*`) + reg 9 (RPM) + reg 41 (production test) → deferred.
- `cab_temp_offset` (PIC cabin-temp trim) — not modeled (default 0).

---

### Task 1: apu_ctx_t climate fields + init resets

**Files:**
- Modify: `firmware/g0b1-apu/App/services/control.h` (extend `apu_ctx_t`)
- Modify: `firmware/g0b1-apu/App/services/control.c` (reset new fields in `control_init`)
- Create: `firmware/g0b1-apu/Tests/test_control_ctx_cc.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Produces (`control.h`): `apu_ctx_t` gains `int16_t cabin_temperature;`, `int16_t clmt_temp_setting;`, `uint8_t evap_fan_speed;` (holds `fan_speed_t`), `uint8_t compressor_on_timer;`, `uint8_t compressor_off_timer;`, `uint8_t refregerant_check_counter;`, `bool ac_low_pressure_ok;`, `bool ac_high_pressure_ok;`, `bool cool_mode;`.
- `control_init` resets: `cabin_temperature = 0`, `clmt_temp_setting = 0`, `evap_fan_speed = FAN_HIGH`, `compressor_on_timer = 0`, `compressor_off_timer = 0`, `refregerant_check_counter = 0`, `ac_low_pressure_ok = true`, `ac_high_pressure_ok = true`, `cool_mode = false`.

- [ ] **Step 1: Extend `apu_ctx_t` in `control.h`** — add the nine fields before the closing brace (after `standby_override;`):

```c
    /* --- M6c climate --- */
    int16_t  cabin_temperature;        /* degF, from M3 enclosure sensor (reg 1) */
    int16_t  clmt_temp_setting;        /* degF, from NVM EE_CLIMATE_TEMP_SETTING (reg 14) */
    uint8_t  evap_fan_speed;           /* fan_speed_t, from NVM EE_EVAP_FAN_SPEED (reg 12) */
    uint8_t  compressor_on_timer;      /* seconds compressor ON (count-up, cap 255) */
    uint8_t  compressor_off_timer;     /* seconds compressor OFF (count-up, cap 255) */
    uint8_t  refregerant_check_counter;/* A/C low-pressure retry counter */
    bool     ac_low_pressure_ok;       /* A/C low side OK (derivation deferred; default true) */
    bool     ac_high_pressure_ok;      /* A/C high side OK (derivation deferred; default true) */
    bool     cool_mode;                /* cooling selected (PIC COOL_MODE_STATE) */
```

- [ ] **Step 2: Write the failing test `Tests/test_control_ctx_cc.c`**

```c
#include "unity.h"
#include "control.h"
#include "fan_speed.h"

static apu_ctx_t ctx;
void setUp(void) { control_init(&ctx); }
void tearDown(void) {}

static void test_init_resets_cc_fields(void) {
    TEST_ASSERT_EQUAL_INT16(0, ctx.cabin_temperature);
    TEST_ASSERT_EQUAL_INT16(0, ctx.clmt_temp_setting);
    TEST_ASSERT_EQUAL_UINT8(FAN_HIGH, ctx.evap_fan_speed);
    TEST_ASSERT_EQUAL_UINT8(0, ctx.compressor_on_timer);
    TEST_ASSERT_EQUAL_UINT8(0, ctx.compressor_off_timer);
    TEST_ASSERT_EQUAL_UINT8(0, ctx.refregerant_check_counter);
    TEST_ASSERT_TRUE(ctx.ac_low_pressure_ok);
    TEST_ASSERT_TRUE(ctx.ac_high_pressure_ok);
    TEST_ASSERT_FALSE(ctx.cool_mode);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_init_resets_cc_fields);
    return UNITY_END();
}
```

- [ ] **Step 3: Register the test in `Tests/CMakeLists.txt`** (append; link `control.c` + `fan_speed.c`)

```cmake
add_unity_test(test_control_ctx_cc test_control_ctx_cc.c ../App/services/control.c ../App/services/fan_speed.c)
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_ctx_cc --output-on-failure`
Expected: build fails — new ctx fields undefined.

- [ ] **Step 5: Add the field resets to `control_init` in `control.c`** (after `ctx->standby_override = false;`)

```c
    ctx->cabin_temperature = 0;
    ctx->clmt_temp_setting = 0;
    ctx->evap_fan_speed = FAN_HIGH;
    ctx->compressor_on_timer = 0;
    ctx->compressor_off_timer = 0;
    ctx->refregerant_check_counter = 0;
    ctx->ac_low_pressure_ok = true;
    ctx->ac_high_pressure_ok = true;
    ctx->cool_mode = false;
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_ctx_cc --output-on-failure`
Expected: PASS (1 test). Run the full suite too — the extended `apu_ctx_t` must not break prior tests (expect 48 executables green: 47 prior + 1 new).

- [ ] **Step 7: Commit**

```bash
git add firmware/g0b1-apu/App/services/control.h firmware/g0b1-apu/App/services/control.c firmware/g0b1-apu/Tests/test_control_ctx_cc.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): control — apu_ctx_t climate fields + init resets"
```

---

### Task 2: control_climate helpers (compressor timers + settings sample) + cabin-temp sample + control_1s_slot

**Files:**
- Modify: `firmware/g0b1-apu/App/services/control.h` (add prototypes)
- Create: `firmware/g0b1-apu/App/services/control_climate.c` (helpers only; the mode is added in Task 3)
- Modify: `firmware/g0b1-apu/App/services/control_sample.c` (add cabin-temp copy)
- Modify: `firmware/g0b1-apu/App/services/control_app.c` (add `control_1s_slot`)
- Create: `firmware/g0b1-apu/Tests/test_control_1s.c`
- Modify: `firmware/g0b1-apu/Tests/test_control_sample.c` (add cabin-temp assertion)
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: M3 `sensors.h` (`sensors_get_encl_temp_f`), M2 `nvm.h` (`nvm_read_word`, `nvm_read_byte`) + `nvm_map.h` (`EE_CLIMATE_TEMP_SETTING`, `EE_EVAP_FAN_SPEED`), `fan_speed.h` (`FAN_HIGH`).
- Produces (`control.h`): `void control_service_compressor_timers(apu_ctx_t *ctx);`, `void control_climate_sample_settings(apu_ctx_t *ctx);`, `void control_1s_slot(void);`. `control_sample_sensors` additionally sets `ctx->cabin_temperature = sensors_get_encl_temp_f();`.
- **Note (cross-task):** the NVM reads live on `control_1s_slot`/`control_climate_sample_settings`, NOT on `control_sample_sensors`, so the M6b engine-start integration test (which registers only the 10 ms slot) gains no NVM dependency.

- [ ] **Step 1: Add the prototypes to `control.h`** (near the other control-app prototypes)

```c
void control_service_compressor_timers(apu_ctx_t *ctx);
void control_climate_sample_settings(apu_ctx_t *ctx);
void control_1s_slot(void);
```

- [ ] **Step 2: Write the failing test `Tests/test_control_1s.c`**

```c
#include "unity.h"
#include "control.h"
#include "fan_speed.h"
#include "nvm.h"
#include "nvm_map.h"
#include "fake_nor.h"

static nvm_backend_t nor;
static apu_ctx_t ctx;
void setUp(void) { fake_nor_init(&nor); nvm_init(&nor); control_init(&ctx); }
void tearDown(void) {}

static void test_compressor_off_timer_counts_up_when_off(void) {
    ctx.out.compressor_clutch = false;
    ctx.compressor_on_timer = 7;               /* should be reset to 0 */
    control_service_compressor_timers(&ctx);
    TEST_ASSERT_EQUAL_UINT8(0, ctx.compressor_on_timer);
    TEST_ASSERT_EQUAL_UINT8(1, ctx.compressor_off_timer);
}

static void test_compressor_on_timer_counts_up_when_on(void) {
    ctx.out.compressor_clutch = true;
    ctx.compressor_off_timer = 9;              /* should be reset to 0 */
    control_service_compressor_timers(&ctx);
    TEST_ASSERT_EQUAL_UINT8(0, ctx.compressor_off_timer);
    TEST_ASSERT_EQUAL_UINT8(1, ctx.compressor_on_timer);
}

static void test_compressor_timer_caps_at_255(void) {
    ctx.out.compressor_clutch = false;
    ctx.compressor_off_timer = 255;
    control_service_compressor_timers(&ctx);
    TEST_ASSERT_EQUAL_UINT8(255, ctx.compressor_off_timer);   /* no wrap */
}

static void test_sample_settings_reads_nvm(void) {
    nvm_write_word(EE_CLIMATE_TEMP_SETTING, 72);
    nvm_write_byte(EE_EVAP_FAN_SPEED, FAN_MEDIUM);
    control_climate_sample_settings(&ctx);
    TEST_ASSERT_EQUAL_INT16(72, ctx.clmt_temp_setting);
    TEST_ASSERT_EQUAL_UINT8(FAN_MEDIUM, ctx.evap_fan_speed);
}

static void test_sample_settings_clamps_evap_speed(void) {
    nvm_write_byte(EE_EVAP_FAN_SPEED, 9);       /* out of range -> clamp to FAN_HIGH */
    control_climate_sample_settings(&ctx);
    TEST_ASSERT_EQUAL_UINT8(FAN_HIGH, ctx.evap_fan_speed);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_compressor_off_timer_counts_up_when_off);
    RUN_TEST(test_compressor_on_timer_counts_up_when_on);
    RUN_TEST(test_compressor_timer_caps_at_255);
    RUN_TEST(test_sample_settings_reads_nvm);
    RUN_TEST(test_sample_settings_clamps_evap_speed);
    return UNITY_END();
}
```

- [ ] **Step 3: Register `test_control_1s` in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_control_1s test_control_1s.c ../App/services/control_climate.c ../App/services/control.c ../App/services/nvm.c ../App/services/nvm_record.c ../App/services/nvm_defaults.c ../App/services/modbus_crc.c ../App/services/fan_speed.c fakes/fake_nor.c)
```
*(NVM links its record/defaults/crc TUs; match the source set used by `test_nvm`/`test_mbp_nvm` in this file — if those entries link additional NVM sources, mirror them here.)*

- [ ] **Step 4: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_1s --output-on-failure`
Expected: build fails — helpers + `control_climate.c` undefined.

- [ ] **Step 5: Write `App/services/control_climate.c`** (helpers only)

```c
#include "control.h"
#include "sensors.h"
#include "nvm.h"
#include "nvm_map.h"
#include "fan_speed.h"

void control_service_compressor_timers(apu_ctx_t *ctx) {
    if (!ctx->out.compressor_clutch) {
        ctx->compressor_on_timer = 0;
        if (ctx->compressor_off_timer < 255u) ctx->compressor_off_timer++;
    } else {
        ctx->compressor_off_timer = 0;
        if (ctx->compressor_on_timer < 255u) ctx->compressor_on_timer++;
    }
}

void control_climate_sample_settings(apu_ctx_t *ctx) {
    ctx->clmt_temp_setting = (int16_t)nvm_read_word(EE_CLIMATE_TEMP_SETTING);
    uint8_t sp = nvm_read_byte(EE_EVAP_FAN_SPEED);
    ctx->evap_fan_speed = (sp > (uint8_t)FAN_HIGH) ? (uint8_t)FAN_HIGH : sp;
}
```

- [ ] **Step 6: Add the cabin-temp copy to `control_sample.c`** (extend `control_sample_sensors`; add `#include "sensors.h"` if not present — it is)

```c
    ctx->cabin_temperature = sensors_get_encl_temp_f();
```

- [ ] **Step 7: Add `control_1s_slot` to `control_app.c`** (after `control_10ms_slot`)

```c
void control_1s_slot(void) {
    control_service_compressor_timers(&s_ctx);
    control_climate_sample_settings(&s_ctx);
}
```

- [ ] **Step 8: Add the cabin-temp assertion to `Tests/test_control_sample.c`** (new test function + `RUN_TEST`; the existing setUp already calls `sensors_init` and drives `SENS_EXT` — drive `SENS_ENCL` here). Add:

```c
static void test_sample_copies_cabin_temp(void) {
    for (int i = 0; i < SENS_AVG_DEFAULT; i++) sensors_add_sample(SENS_ENCL, 2048); /* ~25C midscale */
    control_sample_sensors(&ctx);
    TEST_ASSERT_EQUAL_INT16(sensors_get_encl_temp_f(), ctx.cabin_temperature);
}
```
Register it with `RUN_TEST(test_sample_copies_cabin_temp);`. *(No NVM needed here — cabin temp is sensor-only. `control_sample.c`'s existing CMake source list is unchanged.)*

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R "test_control_1s|test_control_sample" --output-on-failure`
Expected: PASS (test_control_1s: 5; test_control_sample: prior + 1). Then run the full suite (expect 49 executables green: 48 prior + test_control_1s). `control_1s_slot` is compiled into `control_app.c` but only exercised by the Task 6 integration test.

- [ ] **Step 10: Commit**

```bash
git add firmware/g0b1-apu/App/services/control.h firmware/g0b1-apu/App/services/control_climate.c firmware/g0b1-apu/App/services/control_sample.c firmware/g0b1-apu/App/services/control_app.c firmware/g0b1-apu/Tests/test_control_1s.c firmware/g0b1-apu/Tests/test_control_sample.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): control — climate compressor timers + settings sample + cabin-temp sample + 1s slot"
```

---

### Task 3: Climate core — SETTLE / START_ENGINE handoff / MONITOR_TEMP

**Files:**
- Modify: `firmware/g0b1-apu/App/services/control.h` (add prototype)
- Modify: `firmware/g0b1-apu/App/services/control_climate.c` (add `CC_*` enum + `control_climate_mode`)
- Create: `firmware/g0b1-apu/Tests/test_control_climate.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `apu_ctx_t` (Task 1), M5 `app_timers.h`.
- Produces: `void control_climate_mode(apu_ctx_t *ctx);` (registered for `OP_CLIMATE` in Task 6). This task implements `CC_START_SETTLE`, `CC_START_ENGINE`, `CC_MONITOR_TEMP` + `default`; the cool sequence (Task 4), faults + monitor tail (Task 5) are appended later. Defines the full `CC_*` enum.

- [ ] **Step 1: Add the prototype to `control.h`**

```c
void control_climate_mode(apu_ctx_t *ctx);   /* register for OP_CLIMATE */
```

- [ ] **Step 2: Write the failing test `Tests/test_control_climate.c`**

```c
#include "unity.h"
#include "control.h"
#include "app_timers.h"

static apu_ctx_t ctx;
void setUp(void) { app_timers_init(); control_init(&ctx); ctx.op_state = OP_CLIMATE; ctx.sub_state = 0; }
void tearDown(void) {}

static void test_settle_arms_1s_and_advances(void) {
    control_climate_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT8(TD_REAL_TIME, ctx.temp_display_state);
    TEST_ASSERT_EQUAL_UINT16(100, app_timer_get(SCALE_TEN_MS, SHORT_DELAY_TMR));
    TEST_ASSERT_EQUAL_UINT8(1, ctx.sub_state);          /* CC_START_ENGINE */
}

static void test_start_engine_hands_off_when_engine_off(void) {
    ctx.sub_state = 1 /*CC_START_ENGINE*/;
    ctx.out.fuel_pump = false;                          /* engine not running */
    /* SHORT_DELAY_TMR is 0 (expired) in a fresh app_timers_init */
    control_climate_mode(&ctx);
    TEST_ASSERT_EQUAL_INT(OP_ENGINE_START, ctx.op_state);
    TEST_ASSERT_EQUAL_UINT8(OP_CLIMATE, ctx.op_state_previous);
    TEST_ASSERT_EQUAL_UINT8(0, ctx.sub_state);          /* ES_GLOWPLUG_ON */
    TEST_ASSERT_EQUAL_UINT8(0, ctx.attempted_start_counter);
}

static void test_start_engine_skips_when_engine_running(void) {
    ctx.sub_state = 1; ctx.out.fuel_pump = true;        /* engine running */
    control_climate_mode(&ctx);
    TEST_ASSERT_EQUAL_INT(OP_CLIMATE, ctx.op_state);
    TEST_ASSERT_EQUAL_UINT8(2, ctx.sub_state);          /* CC_MONITOR_TEMP */
}

static void test_monitor_temp_cool_call(void) {
    ctx.sub_state = 2; ctx.clmt_temp_setting = 70; ctx.cabin_temperature = 73; /* >= 70+3 */
    control_climate_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT8(ST_COOLING, ctx.control_status);
    TEST_ASSERT_EQUAL_UINT8(3, ctx.sub_state);          /* CC_START_COOL */
}

static void test_monitor_temp_chillin_stays(void) {
    ctx.sub_state = 2; ctx.clmt_temp_setting = 70; ctx.cabin_temperature = 67; /* <= 70-3 */
    control_climate_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT8(ST_CHILLIN, ctx.control_status);
    TEST_ASSERT_EQUAL_UINT8(2, ctx.sub_state);          /* stays MONITOR_TEMP */
}

static void test_monitor_temp_in_band_no_change(void) {
    ctx.sub_state = 2; ctx.clmt_temp_setting = 70; ctx.cabin_temperature = 70; /* within +/-3 */
    control_climate_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT8(2, ctx.sub_state);          /* stays */
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_settle_arms_1s_and_advances);
    RUN_TEST(test_start_engine_hands_off_when_engine_off);
    RUN_TEST(test_start_engine_skips_when_engine_running);
    RUN_TEST(test_monitor_temp_cool_call);
    RUN_TEST(test_monitor_temp_chillin_stays);
    RUN_TEST(test_monitor_temp_in_band_no_change);
    return UNITY_END();
}
```

- [ ] **Step 3: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_control_climate test_control_climate.c ../App/services/control_climate.c ../App/services/control.c ../App/services/app_timers.c ../App/services/sensors.c ../App/services/nvm.c ../App/services/nvm_record.c ../App/services/nvm_defaults.c ../App/services/modbus_crc.c ../App/services/fan_speed.c fakes/fake_nor.c)
```
*(`control_climate.c` pulls `sensors.h`/`nvm.h`/`nvm_map.h` for its helpers; link the same NVM/sensors set as `test_control_1s`. The mode's unit tests themselves set ctx fields directly and never call the NVM helper, but the TU must link.)*

- [ ] **Step 4: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_climate --output-on-failure`
Expected: build fails — `control_climate_mode` undefined.

- [ ] **Step 5: Add the `CC_*` enum + `control_climate_mode` to `control_climate.c`** (add the enum near the top after the includes; add the function below the helpers)

```c
enum { CC_START_SETTLE = 0, CC_START_ENGINE, CC_MONITOR_TEMP, CC_START_COOL,
       CC_SWITCH_TO_COOL, CC_COMP_ON, CC_AC_LOW_PRESSURE_RECHK, CC_EVAP_ON,
       CC_CTRL_RUNNING, CC_HEAT_DEFROST, CC_COOL_DEFROST_END, CC_HEAT_SWITCHFROM_COOL,
       CC_EVAP_OFF, CC_AC_LOW_PRESSURE_FAIL, CC_AC_HIGH_PRESSURE_FAIL,
       CC_ANTI_STALL_STEP1, CC_ANTI_STALL_STEP2, CC_AC_HIGH_PRESSURE_RECHK,
       CC_WAIT_HIGH_PRESSURE_NORMAL };

#define CC_TEMP_OFFSET 3

void control_climate_mode(apu_ctx_t *ctx) {
    switch (ctx->sub_state) {
        case CC_START_SETTLE:
            ctx->temp_display_state = TD_REAL_TIME;
            app_timer_set(SCALE_TEN_MS, SHORT_DELAY_TMR, 100);   /* 1 s settle */
            ctx->sub_state = CC_START_ENGINE;
            break;
        case CC_START_ENGINE:
            if (app_timer_expired(SCALE_TEN_MS, SHORT_DELAY_TMR)) {
                if (!ctx->out.fuel_pump) {                       /* engine not running */
                    ctx->op_state_previous = OP_CLIMATE;
                    ctx->op_state = OP_ENGINE_START;
                    ctx->sub_state = 0;                          /* ES_GLOWPLUG_ON */
                    ctx->attempted_start_counter = 0;
                } else {
                    ctx->sub_state = CC_MONITOR_TEMP;
                }
            }
            break;
        case CC_MONITOR_TEMP:
            if (ctx->cabin_temperature <= (ctx->clmt_temp_setting - CC_TEMP_OFFSET)) {
                ctx->temp_display_state = TD_REAL_TIME;
                ctx->control_status = ST_CHILLIN;
            }
            if (ctx->cabin_temperature >= (ctx->clmt_temp_setting + CC_TEMP_OFFSET)) {
                ctx->temp_display_state = TD_REAL_TIME;
                ctx->control_status = ST_COOLING;
                ctx->sub_state = CC_START_COOL;
            }
            break;
        default:
            break;
    }
}
```
*(Include `app_timers.h` at the top of `control_climate.c`.)*

- [ ] **Step 6: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_climate --output-on-failure`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add firmware/g0b1-apu/App/services/control.h firmware/g0b1-apu/App/services/control_climate.c firmware/g0b1-apu/Tests/test_control_climate.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): control — climate core (settle / engine-start handoff / monitor-temp hysteresis)"
```

---

### Task 4: Climate cool sequence — START_COOL / COMP_ON / EVAP_ON / CTRL_RUNNING / EVAP_OFF

**Files:**
- Modify: `firmware/g0b1-apu/App/services/control_climate.c` (add the five cases)
- Modify: `firmware/g0b1-apu/Tests/test_control_climate.c` (add tests)

**Interfaces:**
- Adds cases `CC_START_COOL`, `CC_COMP_ON`, `CC_EVAP_ON`, `CC_CTRL_RUNNING`, `CC_EVAP_OFF` before `default`. Uses M5 `app_timers` (`COMP_EVAP_DELAY_TMR`/`EVAP_FORCED_ON_TMR` SCALE_SECOND, `DEFROST_CYCLE_TMR` SCALE_MINUTE) + `ctx->evap_fan_speed`.

- [ ] **Step 1: Add the failing tests to `test_control_climate.c`** (add functions + `RUN_TEST` lines)

```c
static void test_start_cool_sets_flags(void) {
    ctx.sub_state = 3 /*CC_START_COOL*/;
    control_climate_mode(&ctx);
    TEST_ASSERT_TRUE(ctx.cool_mode);
    TEST_ASSERT_FALSE(ctx.out.heat_reverse);
    TEST_ASSERT_EQUAL_UINT8(5, ctx.sub_state);          /* CC_COMP_ON */
}

static void test_comp_on_after_off_guard(void) {
    ctx.sub_state = 5 /*CC_COMP_ON*/; ctx.compressor_off_timer = 15;
    control_climate_mode(&ctx);
    TEST_ASSERT_TRUE(ctx.out.compressor_clutch);
    TEST_ASSERT_EQUAL_UINT16(0, app_timer_get(SCALE_SECOND, COMP_EVAP_DELAY_TMR));
    TEST_ASSERT_EQUAL_UINT8(7, ctx.sub_state);          /* CC_EVAP_ON */
}

static void test_comp_on_waits_for_off_guard(void) {
    ctx.sub_state = 5; ctx.compressor_off_timer = 10;   /* < 15 */
    control_climate_mode(&ctx);
    TEST_ASSERT_FALSE(ctx.out.compressor_clutch);
    TEST_ASSERT_EQUAL_UINT8(5, ctx.sub_state);          /* stays */
}

static void test_evap_on_turns_on_and_arms_defrost(void) {
    ctx.sub_state = 7 /*CC_EVAP_ON*/; ctx.evap_fan_speed = FAN_MEDIUM;
    /* COMP_EVAP_DELAY_TMR is 0 (expired) in fresh app_timers_init */
    control_climate_mode(&ctx);
    TEST_ASSERT_TRUE(ctx.out.evap_fan);
    TEST_ASSERT_EQUAL_UINT8(FAN_MEDIUM, ctx.out.evap_speed);
    TEST_ASSERT_EQUAL_UINT16(10, app_timer_get(SCALE_SECOND, EVAP_FORCED_ON_TMR));
    TEST_ASSERT_EQUAL_UINT16(30, app_timer_get(SCALE_MINUTE, DEFROST_CYCLE_TMR));
    TEST_ASSERT_EQUAL_UINT8(8, ctx.sub_state);          /* CC_CTRL_RUNNING */
}

static void test_ctrl_running_reaches_setpoint(void) {
    ctx.sub_state = 8 /*CC_CTRL_RUNNING*/; ctx.cool_mode = true;
    ctx.out.compressor_clutch = true;
    app_timer_set(SCALE_MINUTE, DEFROST_CYCLE_TMR, 5);  /* defrost timer running */
    ctx.clmt_temp_setting = 70; ctx.cabin_temperature = 71; /* <= 70+1 */
    control_climate_mode(&ctx);
    TEST_ASSERT_FALSE(ctx.out.compressor_clutch);
    TEST_ASSERT_EQUAL_UINT8(TD_CC_SETTING, ctx.temp_display_state);
    TEST_ASSERT_EQUAL_UINT8(12, ctx.sub_state);         /* CC_EVAP_OFF */
}

static void test_evap_off_returns_to_monitor(void) {
    ctx.sub_state = 12 /*CC_EVAP_OFF*/; ctx.cool_mode = true; ctx.out.evap_fan = true;
    ctx.compressor_off_timer = 15;
    control_climate_mode(&ctx);
    TEST_ASSERT_FALSE(ctx.cool_mode);
    TEST_ASSERT_FALSE(ctx.out.evap_fan);
    TEST_ASSERT_EQUAL_UINT8(2, ctx.sub_state);          /* CC_MONITOR_TEMP */
}

static void test_evap_off_early_cool_clear(void) {
    ctx.sub_state = 12; ctx.cool_mode = true; ctx.out.evap_fan = true;
    ctx.compressor_off_timer = 5;                        /* < 15 */
    ctx.clmt_temp_setting = 70; ctx.cabin_temperature = 67; /* <= 70-3 */
    control_climate_mode(&ctx);
    TEST_ASSERT_FALSE(ctx.cool_mode);                   /* cool cleared early */
    TEST_ASSERT_TRUE(ctx.out.evap_fan);                 /* evap still on until 15s guard */
    TEST_ASSERT_EQUAL_UINT8(12, ctx.sub_state);         /* stays */
}
```
Register all seven with `RUN_TEST(...)`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_climate --output-on-failure`
Expected: FAIL — the five cases fall through `default`.

- [ ] **Step 3: Add the five cases to `control_climate.c`** (insert before `default:`)

```c
        case CC_START_COOL:
            ctx->cool_mode = true;
            ctx->out.heat_reverse = false;                  /* cool = PB4 de-energized (OI-1) */
            ctx->sub_state = CC_COMP_ON;
            break;
        case CC_COMP_ON:
            if (ctx->compressor_off_timer >= 15u) {
                ctx->out.compressor_clutch = true;
                app_timer_set(SCALE_SECOND, COMP_EVAP_DELAY_TMR, 0);
                ctx->sub_state = CC_EVAP_ON;
            }
            break;
        case CC_EVAP_ON:
            if (app_timer_expired(SCALE_SECOND, COMP_EVAP_DELAY_TMR)) {
                ctx->out.evap_fan = true;
                ctx->out.evap_speed = (fan_speed_t)ctx->evap_fan_speed;
                app_timer_set(SCALE_SECOND, EVAP_FORCED_ON_TMR, 10);
                app_timer_set(SCALE_MINUTE, DEFROST_CYCLE_TMR, 30);
                ctx->sub_state = CC_CTRL_RUNNING;
            }
            break;
        case CC_CTRL_RUNNING:
            if (app_timer_get(SCALE_MINUTE, DEFROST_CYCLE_TMR) > 0u) {
                if (ctx->cool_mode &&
                    ctx->cabin_temperature <= (ctx->clmt_temp_setting + 1)) {
                    ctx->out.compressor_clutch = false;
                    ctx->temp_display_state = TD_CC_SETTING;
                    ctx->sub_state = CC_EVAP_OFF;
                }
            } else {                                        /* defrost cycle */
                ctx->control_status = ST_DEFROST;
                ctx->temp_display_state = TD_REAL_TIME;
                if (ctx->cool_mode) {
                    ctx->out.compressor_clutch = false;
                    ctx->cool_mode = false;
                    ctx->out.evap_fan = false;
                    app_timer_set(SCALE_SECOND, EVENT_INTERVAL_TMR, 45);
                    ctx->sub_state = CC_COOL_DEFROST_END;
                }
            }
            break;
        case CC_EVAP_OFF:
            if (ctx->compressor_off_timer >= 15u) {
                ctx->cool_mode = false;
                ctx->out.evap_fan = false;
                ctx->sub_state = CC_MONITOR_TEMP;
            } else if (ctx->cabin_temperature <= (ctx->clmt_temp_setting - CC_TEMP_OFFSET)) {
                ctx->temp_display_state = TD_REAL_TIME;
                ctx->cool_mode = false;
            }
            break;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_climate --output-on-failure`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add firmware/g0b1-apu/App/services/control_climate.c firmware/g0b1-apu/Tests/test_control_climate.c
git commit -m "feat(g0b1-apu): control — climate cool sequence (start-cool/comp-on/evap-on/ctrl-running/evap-off)"
```

---

### Task 5: Defrost end + A/C-pressure RECHK/FAIL/WAIT + post-switch monitor tail

**Files:**
- Modify: `firmware/g0b1-apu/App/services/control_climate.c` (add `CC_COOL_DEFROST_END`, `CC_AC_LOW_PRESSURE_RECHK`, `CC_AC_LOW_PRESSURE_FAIL`, `CC_AC_HIGH_PRESSURE_RECHK`, `CC_WAIT_HIGH_PRESSURE_NORMAL`, `CC_AC_HIGH_PRESSURE_FAIL` cases + post-switch tail)
- Modify: `firmware/g0b1-apu/Tests/test_control_climate.c` (add tests)

**Interfaces:**
- Adds the six remaining dispatched cases before `default`, and the post-switch monitor tail after the switch (A/C pressure monitor + engine over-temp), mirroring M6b's standby-tail placement.

- [ ] **Step 1: Add the failing tests to `test_control_climate.c`**

```c
static void test_cool_defrost_end_resumes(void) {
    ctx.sub_state = 10 /*CC_COOL_DEFROST_END*/;
    /* EVENT_INTERVAL_TMR is 0 (expired) in fresh app_timers_init */
    control_climate_mode(&ctx);
    TEST_ASSERT_TRUE(ctx.out.compressor_clutch);
    TEST_ASSERT_TRUE(ctx.cool_mode);
    TEST_ASSERT_TRUE(ctx.out.evap_fan);
    TEST_ASSERT_EQUAL_UINT8(ST_COOLING, ctx.control_status);
    TEST_ASSERT_EQUAL_UINT16(30, app_timer_get(SCALE_MINUTE, DEFROST_CYCLE_TMR));
    TEST_ASSERT_EQUAL_UINT8(8, ctx.sub_state);          /* CC_CTRL_RUNNING */
}

static void test_low_pressure_rechk_retries(void) {
    ctx.sub_state = 6 /*CC_AC_LOW_PRESSURE_RECHK*/; ctx.refregerant_check_counter = 3;
    ctx.out.compressor_clutch = true;
    control_climate_mode(&ctx);
    TEST_ASSERT_FALSE(ctx.out.compressor_clutch);
    TEST_ASSERT_EQUAL_UINT8(4, ctx.refregerant_check_counter);
    TEST_ASSERT_EQUAL_UINT8(5, ctx.sub_state);          /* CC_COMP_ON retry */
}

static void test_low_pressure_rechk_fails_after_10(void) {
    ctx.sub_state = 6; ctx.refregerant_check_counter = 10; /* ++ -> 11 > 10 */
    control_climate_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT8(0, ctx.refregerant_check_counter);
    TEST_ASSERT_EQUAL_UINT8(13, ctx.sub_state);         /* CC_AC_LOW_PRESSURE_FAIL */
}

static void test_low_pressure_fail_shuts_down(void) {
    ctx.sub_state = 13 /*CC_AC_LOW_PRESSURE_FAIL*/;
    control_climate_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT8(ERR_AC_LOW_PRESSURE, ctx.error_state);
    TEST_ASSERT_EQUAL_INT(OP_ERROR_SHUTDOWN, ctx.op_state);
    TEST_ASSERT_EQUAL_UINT8(OP_CLIMATE, ctx.op_state_previous);
}

static void test_high_pressure_rechk_waits(void) {
    ctx.sub_state = 17 /*CC_AC_HIGH_PRESSURE_RECHK*/; ctx.out.compressor_clutch = true;
    control_climate_mode(&ctx);
    TEST_ASSERT_FALSE(ctx.out.compressor_clutch);
    TEST_ASSERT_EQUAL_UINT8(18, ctx.sub_state);         /* CC_WAIT_HIGH_PRESSURE_NORMAL */
}

static void test_high_pressure_wait_resumes_when_ok(void) {
    ctx.sub_state = 18 /*CC_WAIT_HIGH_PRESSURE_NORMAL*/; ctx.ac_high_pressure_ok = true;
    control_climate_mode(&ctx);
    TEST_ASSERT_TRUE(ctx.out.compressor_clutch);
    TEST_ASSERT_EQUAL_UINT16(0, app_timer_get(SCALE_SECOND, COMP_EVAP_DELAY_TMR));
    TEST_ASSERT_EQUAL_UINT8(7, ctx.sub_state);          /* CC_EVAP_ON */
}

static void test_high_pressure_fail_shuts_down(void) {
    ctx.sub_state = 14 /*CC_AC_HIGH_PRESSURE_FAIL*/;
    control_climate_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT8(ERR_AC_HIGH_PRESSURE, ctx.error_state);
    TEST_ASSERT_EQUAL_INT(OP_ERROR_SHUTDOWN, ctx.op_state);
}

static void test_tail_low_pressure_trips_rechk(void) {
    ctx.sub_state = 8 /*CC_CTRL_RUNNING*/; ctx.cool_mode = true;
    app_timer_set(SCALE_MINUTE, DEFROST_CYCLE_TMR, 5);  /* running, not defrost */
    ctx.clmt_temp_setting = 70; ctx.cabin_temperature = 80; /* above setpoint+1, no cool-off */
    ctx.out.compressor_clutch = true; ctx.compressor_on_timer = 2; /* armed */
    ctx.ac_low_pressure_ok = false;
    control_climate_mode(&ctx);
    TEST_ASSERT_FALSE(ctx.out.compressor_clutch);
    TEST_ASSERT_EQUAL_UINT8(6, ctx.sub_state);          /* CC_AC_LOW_PRESSURE_RECHK */
}

static void test_tail_high_pressure_trips_rechk(void) {
    ctx.sub_state = 8; ctx.cool_mode = true;
    app_timer_set(SCALE_MINUTE, DEFROST_CYCLE_TMR, 5);
    ctx.clmt_temp_setting = 70; ctx.cabin_temperature = 80;
    ctx.out.compressor_clutch = true; ctx.compressor_on_timer = 2;
    ctx.ac_low_pressure_ok = true; ctx.ac_high_pressure_ok = false;
    control_climate_mode(&ctx);
    TEST_ASSERT_FALSE(ctx.out.compressor_clutch);
    TEST_ASSERT_EQUAL_UINT8(17, ctx.sub_state);         /* CC_AC_HIGH_PRESSURE_RECHK */
}

static void test_tail_normal_pressure_clears_counter(void) {
    ctx.sub_state = 8; ctx.cool_mode = true;
    app_timer_set(SCALE_MINUTE, DEFROST_CYCLE_TMR, 5);
    ctx.clmt_temp_setting = 70; ctx.cabin_temperature = 80;
    ctx.out.compressor_clutch = true; ctx.compressor_on_timer = 2;
    ctx.refregerant_check_counter = 4;                  /* should clear */
    control_climate_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT8(0, ctx.refregerant_check_counter);
    TEST_ASSERT_TRUE(ctx.out.compressor_clutch);        /* stays on */
}

static void test_tail_engine_over_temp_shuts_down(void) {
    ctx.sub_state = 2 /*CC_MONITOR_TEMP*/; ctx.clmt_temp_setting = 70; ctx.cabin_temperature = 70;
    ctx.engine_temp_ok = false;
    control_climate_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT8(ERR_HIGH_ENGINE_TEMP, ctx.error_state);
    TEST_ASSERT_EQUAL_INT(OP_ERROR_SHUTDOWN, ctx.op_state);
}
```
Register all eleven with `RUN_TEST(...)`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_climate --output-on-failure`
Expected: FAIL — new cases fall through `default`; no tail.

- [ ] **Step 3: Add the six cases + the post-switch tail to `control_climate.c`** (insert the cases before `default:`; add the tail after the switch's closing brace, before the function's closing `}`)

```c
        case CC_COOL_DEFROST_END:
            if (app_timer_expired(SCALE_SECOND, EVENT_INTERVAL_TMR)) {
                ctx->out.compressor_clutch = true;
                ctx->cool_mode = true;
                ctx->out.evap_fan = true;
                ctx->control_status = ST_COOLING;
                app_timer_set(SCALE_MINUTE, DEFROST_CYCLE_TMR, 30);
                ctx->sub_state = CC_CTRL_RUNNING;
            }
            break;
        case CC_AC_LOW_PRESSURE_RECHK:
            ctx->out.compressor_clutch = false;
            ctx->refregerant_check_counter++;
            if (ctx->refregerant_check_counter > 10u) {
                ctx->refregerant_check_counter = 0;
                ctx->sub_state = CC_AC_LOW_PRESSURE_FAIL;
            } else {
                ctx->sub_state = CC_COMP_ON;
            }
            break;
        case CC_AC_LOW_PRESSURE_FAIL:
            ctx->op_state_previous = OP_CLIMATE;
            ctx->error_state = ERR_AC_LOW_PRESSURE;
            ctx->op_state = OP_ERROR_SHUTDOWN;
            break;
        case CC_AC_HIGH_PRESSURE_RECHK:
            ctx->out.compressor_clutch = false;
            ctx->sub_state = CC_WAIT_HIGH_PRESSURE_NORMAL;
            break;
        case CC_WAIT_HIGH_PRESSURE_NORMAL:
            if (ctx->ac_high_pressure_ok) {
                ctx->out.compressor_clutch = true;
                app_timer_set(SCALE_SECOND, COMP_EVAP_DELAY_TMR, 0);
                ctx->sub_state = CC_EVAP_ON;
            }
            break;
        case CC_AC_HIGH_PRESSURE_FAIL:
            ctx->op_state_previous = OP_CLIMATE;
            ctx->error_state = ERR_AC_HIGH_PRESSURE;
            ctx->op_state = OP_ERROR_SHUTDOWN;
            break;
```

After the `switch (...) { ... }` closing brace, before the function's closing `}`:

```c
    /* A/C pressure monitor (armed once compressor has run >= 2 s). */
    if (ctx->out.compressor_clutch && ctx->compressor_on_timer >= 2u) {
        if (!ctx->ac_low_pressure_ok) {
            ctx->out.compressor_clutch = false;
            ctx->sub_state = CC_AC_LOW_PRESSURE_RECHK;
        } else if (!ctx->ac_high_pressure_ok) {
            ctx->out.compressor_clutch = false;
            ctx->sub_state = CC_AC_HIGH_PRESSURE_RECHK;
        } else {
            ctx->refregerant_check_counter = 0;
        }
    }
    /* Engine over-temp shutdown. */
    if (!ctx->engine_temp_ok) {
        ctx->error_state = ERR_HIGH_ENGINE_TEMP;
        ctx->op_state = OP_ERROR_SHUTDOWN;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_climate --output-on-failure`
Expected: PASS (24 tests).

- [ ] **Step 5: Commit**

```bash
git add firmware/g0b1-apu/App/services/control_climate.c firmware/g0b1-apu/Tests/test_control_climate.c
git commit -m "feat(g0b1-apu): control — climate defrost-end + A/C-pressure RECHK/FAIL/WAIT + monitor tail"
```

---

### Task 6: Register OP_CLIMATE + condenser (OI-2) stub + end-to-end integration

**Files:**
- Modify: `firmware/g0b1-apu/App/services/control_app.c` (register climate)
- Modify: `firmware/g0b1-apu/App/services/control_climate.c` (condenser-follows-compressor stub)
- Create: `firmware/g0b1-apu/Tests/test_control_climate_integration.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- `control_app_init` also calls `control_register_mode(OP_CLIMATE, control_climate_mode)`.
- `control_climate_mode` ends with a condenser stub: `ctx->out.condenser_fan = ctx->out.compressor_clutch; ctx->out.condenser_duty = ctx->out.compressor_clutch ? CONDENSER_STUB_DUTY : 0u;` (define `CONDENSER_STUB_DUTY = 1000u` = full permille; head-pressure ramp deferred).
- Integration drives the full cool cycle through the real scheduler with the 10 ms + 1 s slots, cabin temp via the M3 enclosure sensor, setpoint via NVM.

- [ ] **Step 1: Add the condenser stub to `control_climate.c`** — add the macro near `CC_TEMP_OFFSET`:

```c
#define CONDENSER_STUB_DUTY 1000u   /* OI-2: full airflow stub; head-pressure ramp deferred */
```
and as the **last two statements** of `control_climate_mode` (after the engine-over-temp tail, before the function's closing `}`):

```c
    /* OI-2 condenser: follow the compressor at a fixed stub duty (ramp curve deferred). */
    ctx->out.condenser_fan = ctx->out.compressor_clutch;
    ctx->out.condenser_duty = ctx->out.compressor_clutch ? CONDENSER_STUB_DUTY : 0u;
```

- [ ] **Step 2: Modify `control_app.c`** — add to `control_app_init` (after the OP_ENGINE_START registration):

```c
    control_register_mode(OP_CLIMATE, control_climate_mode);
```

- [ ] **Step 3: Write the failing test `Tests/test_control_climate_integration.c`**

```c
#include "unity.h"
#include "control.h"
#include "sched.h"
#include "app_timers.h"
#include "sensors.h"
#include "sensors_cal.h"
#include "nvm.h"
#include "nvm_map.h"
#include "fan_speed.h"
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

/* Engine already running: seed CC_MONITOR_TEMP + fuel on. Drive cabin hot via the enclosure
   sensor and setpoint via NVM. Because control_10ms_slot runs control_sample_sensors every
   tick (cabin temp) and control_1s_slot runs control_climate_sample_settings (setpoint) each
   second, cabin/setpoint MUST be driven through the sensor/NVM, not set on ctx directly. */
static void test_cool_cycle_runs_then_returns_to_monitor(void) {
    apu_ctx_t *c = control_app_ctx();
    nvm_write_word(EE_CLIMATE_TEMP_SETTING, 70);
    /* Cabin hot: drive enclosure sensor to a high degF (>= 70+3). Pick a raw count that
       interpolates hot; verify with sensors_get_encl_temp_f() >= 73 after seeding. */
    for (int i = 0; i < SENS_AVG_DEFAULT; i++) sensors_add_sample(SENS_ENCL, 3600);
    TEST_ASSERT_TRUE(sensors_get_encl_temp_f() >= 73);   /* guard: really hot */
    c->op_state = OP_CLIMATE;
    c->sub_state = 2;                 /* CC_MONITOR_TEMP */
    c->out.fuel_pump = true;          /* engine running */
    c->compressor_off_timer = 15;     /* satisfy the min-off guard immediately */

    advance(3000);                    /* MONITOR->START_COOL->COMP_ON->EVAP_ON->CTRL_RUNNING */
    TEST_ASSERT_TRUE(c->out.compressor_clutch);
    TEST_ASSERT_TRUE(c->out.evap_fan);
    TEST_ASSERT_TRUE(c->out.condenser_fan);              /* OI-2 stub follows compressor */
    TEST_ASSERT_EQUAL_UINT8(8, c->sub_state);            /* CC_CTRL_RUNNING */

    /* Now drive cabin cold (<= setpoint+1) so it reaches setpoint and shuts the compressor. */
    for (int i = 0; i < SENS_AVG_DEFAULT; i++) sensors_add_sample(SENS_ENCL, 700);
    TEST_ASSERT_TRUE(sensors_get_encl_temp_f() <= 71);
    advance(20000);                   /* CTRL_RUNNING->EVAP_OFF->(15s off)->MONITOR_TEMP */
    TEST_ASSERT_EQUAL_UINT8(2, c->sub_state);            /* back to CC_MONITOR_TEMP */
    TEST_ASSERT_FALSE(c->out.compressor_clutch);
}

/* Engine not running at entry: START_ENGINE hands off to OP_ENGINE_START. */
static void test_climate_entry_hands_off_to_engine_start(void) {
    apu_ctx_t *c = control_app_ctx();
    c->op_state = OP_CLIMATE; c->sub_state = 0; c->out.fuel_pump = false;
    advance(1200);                    /* settle 1s then START_ENGINE fires */
    TEST_ASSERT_EQUAL_INT(OP_ENGINE_START, c->op_state);
    TEST_ASSERT_EQUAL_UINT8(OP_CLIMATE, c->op_state_previous);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_cool_cycle_runs_then_returns_to_monitor);
    RUN_TEST(test_climate_entry_hands_off_to_engine_start);
    return UNITY_END();
}
```

*Note on the integration test — three slot side-effects to respect (as in the M6b integration test): the 10 ms slot runs `control_sample_sensors` (overwrites `cabin_temperature` from `SENS_ENCL`) and `control_inputs_service`; the 1 s slot runs `control_climate_sample_settings` (overwrites `clmt_temp_setting` from NVM) and `control_service_compressor_timers`. So drive cabin temp via `sensors_add_sample(SENS_ENCL, …)` and setpoint via `nvm_write_word`, never by poking the ctx fields. If a chosen enclosure raw count does not satisfy the `>= 73` / `<= 71` guards, adjust the count (the `TEST_ASSERT_TRUE(sensors_get_encl_temp_f() …)` guards make the mismatch explicit rather than a silent flaky pass). If `compressor_off_timer = 15` is decremented/overwritten unexpectedly, recall the 1 s slot only ever holds or increments it while the compressor is off — it is not reset until the compressor turns on.*

- [ ] **Step 4: Register the test in `Tests/CMakeLists.txt`** (full source set)

```cmake
add_unity_test(test_control_climate_integration test_control_climate_integration.c
    ../App/services/control.c ../App/services/control_outputs.c ../App/services/control_powerup.c
    ../App/services/control_off.c ../App/services/control_io.c ../App/services/control_app.c
    ../App/services/control_engine_start.c ../App/services/control_sample.c ../App/services/control_climate.c
    ../App/services/sched.c ../App/services/app_timers.c ../App/services/io_debounce.c
    ../App/services/bsp_io.c ../App/services/bsp_pwm.c ../App/services/fan_speed.c
    ../App/services/sensors.c ../App/services/mb_regmodel.c
    ../App/services/nvm.c ../App/services/nvm_record.c ../App/services/nvm_defaults.c ../App/services/modbus_crc.c
    fakes/fake_bsp_io.c fakes/fake_bsp_pwm.c fakes/fake_nor.c)
```
*(Mirror the M6b `test_control_engine_start_integration` source list + `control_climate.c` + the NVM TUs + `fake_nor.c`. If the NVM link set in this file's other entries differs, match it.)*

- [ ] **Step 5: Run the integration test**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_climate_integration --output-on-failure`
Expected: build, then both scenarios pass. If the enclosure-count → °F guards fail, adjust the raw counts until the `sensors_get_encl_temp_f()` guard asserts hold. A genuine composition bug → fix the offending module, not the test.

- [ ] **Step 6: Run the full suite to confirm no regressions**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build --output-on-failure`
Expected: all pass. Executable count: 47 (through M6b) + `test_control_ctx_cc` + `test_control_1s` + `test_control_climate` + `test_control_climate_integration` = **51 executables**, zero warnings under `-Werror`.

- [ ] **Step 7: Commit**

```bash
git add firmware/g0b1-apu/App/services/control_app.c firmware/g0b1-apu/App/services/control_climate.c firmware/g0b1-apu/Tests/test_control_climate_integration.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): control — register OP_CLIMATE + condenser OI-2 stub + end-to-end cool cycle"
```

---

## Deferred to later M6 sub-milestones / bench

- **M6d (battery + error)** registers `OP_BATTERY` (climate's sibling running mode) and `OP_ERROR_SHUTDOWN` (consumes the `error_state`/`op_state` this milestone sets on A/C-pressure and engine-over-temp faults); adds the battery-voltage monitor the PIC climate tail also performs; extends `control_error_t` with codes 8–10.
- **A/C low/high-pressure derivation** (M3 A/C-pressure regs 4/5) + **condenser head-pressure ramp curve** (OI-2) → bench.
- RPM anti-stall (`CC_ANTI_STALL_*`), reg 9 (RPM), reg 41 (production test) → deferred.

## Carry-forward items to confirm

- **A/C-pressure switch polarity / analog-threshold mapping** — confirm at bench when the sensing lands.
- **Condenser stub duty (1000 permille)** — replace with the bench-tuned head-pressure ramp.
- **Evap-fan-speed → `fan_speed_t` mapping** (LOW eliminated; NVM byte 1/2) — confirm against the display at bench.
- **`compressor_off_timer >= 15`, `>= 2` arm, defrost 30 min** — validated against the PIC constants; confirm on the unit at bench.

---

## Self-Review

**Spec coverage (design §2–§11):** cool-only faithful with the 19-value enum, 14 dispatched / 5 preserved-but-unused ✅ (Global Constraints + Tasks 3–5); modes request outputs mapped by `outputs_apply` (no `apu_outputs_t` change) ✅; SETTLE→START_ENGINE handoff ✅ (Task 3); MONITOR_TEMP hysteresis (±3) ✅ (Task 3); cool sequence COMP/EVAP/CTRL_RUNNING/EVAP_OFF with 15 s guards ✅ (Task 4); 30-min defrost + COOL_DEFROST_END ✅ (Task 5); A/C low/high RECHK/FAIL/WAIT + post-switch pressure monitor ✅ (Task 5); engine over-temp tail ✅ (Task 5); cabin temp ← enclosure sensor, setpoint/fan ← NVM ✅ (Task 2); `control_1s_slot` compressor timers ✅ (Task 2); register OP_CLIMATE + condenser OI-2 stub + integration ✅ (Task 6); CC_MONITOR_TEMP=2 hand-back preserved ✅. Battery monitor, A/C-pressure derivation, condenser ramp, RPM anti-stall ⏸ deferred (documented).

**Placeholder scan:** no TBD/TODO. The two timing-sensitive integration vectors (hot/cold enclosure counts) carry explicit `sensors_get_encl_temp_f()` guard asserts so a bad count fails loudly rather than flakily.

**Type consistency:** the nine new `apu_ctx_t` fields (Task 1) are used identically by `control_climate.c` helpers (Task 2), the mode (Tasks 3–5), and the integration (Task 6). `ERR_AC_LOW_PRESSURE`/`ERR_AC_HIGH_PRESSURE`/`ERR_HIGH_ENGINE_TEMP`, the `ST_*` statuses, `TD_*`, `OP_ERROR_SHUTDOWN`/`OP_ENGINE_START`/`OP_CLIMATE` all come from M6a `control.h`. `fan_speed_t`/`FAN_HIGH`/`FAN_MEDIUM` from `fan_speed.h`. Timer indices/scales (`SHORT_DELAY_TMR` TEN_MS; `COMP_EVAP_DELAY_TMR`/`EVAP_FORCED_ON_TMR`/`EVENT_INTERVAL_TMR` SECOND; `DEFROST_CYCLE_TMR` MINUTE) and `app_timer_set/get/expired` from M5 `app_timers.h`. `nvm_read_word/byte` + `EE_CLIMATE_TEMP_SETTING`/`EE_EVAP_FAN_SPEED` from M2. `sensors_get_encl_temp_f` from M3. The NVM dependency rides only on `control_1s_slot`/`control_climate_sample_settings`, so the M6b engine-start integration test is untouched. Each test's CMake link list compiles only the sources it exercises; the Task 6 integration links the full M6a+M6b+M6c + M5 + M3 + M2 + M4b-regmodel set.
