# STM32G0 APU Port — Milestone 6b: Engine Start Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the PIC `EngineStartMode` faithfully as the `OP_ENGINE_START` control-mode handler — the temperature-keyed glow-plug/fuel/starter crank sequence, oil-pressure-based start detection with a 5-attempt failure path, the over-temp and standby fault shutdowns, and the hand-back to the invoking climate/battery mode — registered into the M6a dispatcher.

**Architecture:** A single `control_engine_start_mode(apu_ctx_t *ctx)` runs the `engine_start_state_list` state machine off `ctx->sub_state`, reading sensor/input values from `apu_ctx_t` (populated by a new `control_sample_sensors` step and the M6a input debounce) and writing output requests + statuses + `op_state` transitions into the ctx — exactly the M6a "modes request into the context; outputs_apply maps them" model. Timers use the M5 `app_timers` scales. The handler is registered via `control_register_mode(OP_ENGINE_START, …)` — no M6a dispatcher edits. Sensor→flag derivations that depend on the M3-deferred engine-coolant sensor are structured as ctx flags (always-OK until wired at bench).

**Tech Stack:** C11, CMake + Unity (host). Reuses M6a `control` (apu_ctx_t, dispatcher, outputs_apply, control_app), M5 `app_timers`, M3 `sensors`, M4b `mb_regmodel`.

**Design spec:** `docs/superpowers/specs/2026-08-12-pic18-to-stm32g0-apu-port-design.md` §8.2. Prereqs: M6a (control foundation), M3 (sensors), M5 (app_timers), M4b (register model). Source of truth: PIC `main.c` `EngineStartMode` (~L1376–1543), `main.h` `engine_start_state_list` / `control_status_list` / `error_message_state_list`.

## Global Constraints

- **Behavior preserved faithfully** (same states, transitions, timings, thresholds), restructured into `apu_ctx_t`.
- **`engine_start_state_list`** (in `control_engine_start.c`, `ctx->sub_state` values): `ES_GLOWPLUG_ON=0, ES_HEAT_ON=1, ES_FUEL_ON=2, ES_STARTER_ON=3, ES_ENGINE_ON=4, ES_CHECK_PRESSURE=5, ES_COOL_ON=6`. `ES_HEAT_ON` is **defined but never entered** (the PIC flow goes GLOWPLUG→FUEL) — preserve the value, don't dispatch it.
- **Timers:** glow-plug uses `GLOW_PLUG_ON_TMR` on **SCALE_HUNDRED_MS** (100 ms/tick); crank delays use `SHORT_DELAY_TMR` on **SCALE_TEN_MS** (10 ms/tick). Both from M5 `app_timers.h`.
- **Glow-plug duration** (SCALE_HUNDRED_MS ticks), set on `ES_GLOWPLUG_ON` entry: `ext_temp_sensor_state == SENSOR_OFF` → **280** (28 s); else by `external_temperature` (°F): `>=122` → **0** + glow off; `>=104` → **80** (8 s); `>=68` → **100** (10 s); `>=32` → **160** (16 s); else (`<32`) → **290** (29 s).
- **Crank delays** (SCALE_TEN_MS ticks): fuel-on hold **100** (1 s); starter crank **400** (4 s); post-crank pressure wait **1000** (10 s). Post-crank **post-heat** glow (`external_temperature < 122`) = `GLOW_PLUG_ON_TMR` **50** (5 s).
- **Start success = oil pressure OK after the 10 s crank wait.** Oil-pressure polarity: `ctx->in_oil_pressure_ok == true` means pressure good; the PIC "oil low / NOK" branch is `!ctx->in_oil_pressure_ok`. (Physical switch polarity is a bench carry-forward.)
- **Attempt limit = 5:** on oil-low after crank, `attempted_start_counter >= 5` → `error_state = ERR_STARTING_FAILURE`, `op_state = OP_ERROR_SHUTDOWN`, `attempted_start_counter = 0`; else fuel off + retry (`sub_state = ES_GLOWPLUG_ON`). `attempted_start_counter++` occurs on each `ES_GLOWPLUG_ON` entry; reset to 0 on success.
- **Statuses:** `ES_GLOWPLUG_ON` → `control_status = ST_WARMING_UP`; `ES_STARTER_ON` → `ST_STARTING`; start success → `engine_op_status = ST_RUNNING`, `control_status = ST_RUNNING`; climate handoff → `ST_COOLING`.
- **COOL_ON handoff:** when the pressure-wait delay is 0 — `op_state_previous == OP_CLIMATE` → `op_state = OP_CLIMATE`, `sub_state = 2` (`CC_MONITOR_TEMP`), `control_status = ST_COOLING`; `== OP_BATTERY` → `op_state = OP_BATTERY`, `sub_state = 3` (`BM_CHARGING`). While the delay is non-zero (monitor branch, faithfully preserved): `!in_oil_pressure_ok` → `ERR_LOW_OIL` + `OP_ERROR_SHUTDOWN`; `!engine_temp_ok` → `ERR_HIGH_ENGINE_TEMP` + `OP_ERROR_SHUTDOWN`.
- **Standby tail** (runs every tick after the switch): `!standby_override && in_truck_ignition` → `attempted_start_counter = 0`, `error_state = ERR_STANDBY`, `op_state = OP_ERROR_SHUTDOWN`.
- **`control_error_t` extends** with `ERR_STANDBY = 7` (after `ERR_STARTING_FAILURE = 6`; PIC `STANDBY`).
- Fixed-width integers only. Portable code under `App/services/` — **no HAL**. Firmware root `firmware/g0b1-apu/`. Every task ends green (`ctest`) and is committed; build is `-Wall -Wextra -Werror -funsigned-char` and must stay pristine.

### Deferred / carry-forward
- **`engine_temp_ok` derivation** from the M3-deferred engine-coolant sensor (reg 2) → bench; the flag defaults to `true` (OK) until wired.
- **Oil-pressure polarity** — confirm the physical switch wiring at bench (whether `SWITCH_CLOSED` = pressure good).
- **`op_state_previous` is set by the invoking mode** — M6c/d set it before transitioning to `OP_ENGINE_START`; the COOL_ON handoff targets `CC_MONITOR_TEMP`/`BM_CHARGING` are M6c/d entry states.
- reg 9 (RPM port-state), reg 41 (production test) still deferred. RPM-based stall detection lives in the running modes (M6c/d), not engine-start.
- The PIC standby block is under `#ifdef TRUCK_ENGINE_INTERRUPT`; this port includes it unconditionally (structurally present, gated by `standby_override`).

---

### Task 1: apu_ctx_t extensions + ERR_STANDBY + ES enum + init resets

**Files:**
- Modify: `firmware/g0b1-apu/App/services/control.h` (extend `control_error_t`, `apu_ctx_t`)
- Modify: `firmware/g0b1-apu/App/services/control.c` (reset new fields in `control_init`)
- Create: `firmware/g0b1-apu/Tests/test_control_ctx_es.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Produces (`control.h`): `control_error_t` gains `ERR_STANDBY` (=7). `apu_ctx_t` gains `uint8_t op_state_previous;` (`control_op_state_t`), `uint8_t attempted_start_counter;`, `int16_t external_temperature;`, `uint8_t ext_temp_sensor_state;`, `bool engine_temp_ok;`, `bool standby_override;`.
- `control_init` resets: `op_state_previous = OP_OFF`, `attempted_start_counter = 0`, `external_temperature = 0`, `ext_temp_sensor_state = 0`, `engine_temp_ok = true`, `standby_override = false`.

- [ ] **Step 1: Extend `control_error_t` in `control.h`** — add `ERR_STANDBY` after `ERR_STARTING_FAILURE`:

```c
typedef enum {
    ERR_NONE = 0, ERR_LOW_OIL, ERR_HIGH_ENGINE_TEMP, ERR_LOW_BATTERY,
    ERR_AC_LOW_PRESSURE, ERR_AC_HIGH_PRESSURE, ERR_STARTING_FAILURE, ERR_STANDBY
} control_error_t;
```

- [ ] **Step 2: Extend `apu_ctx_t` in `control.h`** — add the six fields before the closing brace (after `evap_fan_always_on`):

```c
    /* --- M6b engine-start --- */
    uint8_t  op_state_previous;        /* control_op_state_t: mode that invoked engine start */
    uint8_t  attempted_start_counter;  /* start attempts this cycle */
    int16_t  external_temperature;     /* degF, from M3 sensors (glow-plug timing) */
    uint8_t  ext_temp_sensor_state;    /* SENSOR_ON/OFF from M3 */
    bool     engine_temp_ok;           /* false => over-temp fault (sensor derivation deferred; default true) */
    bool     standby_override;         /* Modbus reg 32; when true, suppress standby shutdown */
```

- [ ] **Step 3: Write the failing test `Tests/test_control_ctx_es.c`**

```c
#include "unity.h"
#include "control.h"

static apu_ctx_t ctx;
void setUp(void) { control_init(&ctx); }
void tearDown(void) {}

static void test_err_standby_value(void) {
    TEST_ASSERT_EQUAL_INT(7, ERR_STANDBY);           /* PIC STANDBY = 7 */
}

static void test_init_resets_es_fields(void) {
    TEST_ASSERT_EQUAL_UINT8(OP_OFF, ctx.op_state_previous);
    TEST_ASSERT_EQUAL_UINT8(0, ctx.attempted_start_counter);
    TEST_ASSERT_EQUAL_INT16(0, ctx.external_temperature);
    TEST_ASSERT_EQUAL_UINT8(0, ctx.ext_temp_sensor_state);
    TEST_ASSERT_TRUE(ctx.engine_temp_ok);            /* default OK until sensor wired */
    TEST_ASSERT_FALSE(ctx.standby_override);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_err_standby_value);
    RUN_TEST(test_init_resets_es_fields);
    return UNITY_END();
}
```

- [ ] **Step 4: Register the test in `Tests/CMakeLists.txt`** (append; link `control.c` + `fan_speed.c` since `control.h` pulls `fan_speed.h`)

```cmake
add_unity_test(test_control_ctx_es test_control_ctx_es.c ../App/services/control.c ../App/services/fan_speed.c)
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_ctx_es --output-on-failure`
Expected: build fails — `ERR_STANDBY` / new ctx fields undefined.

- [ ] **Step 6: Add the field resets to `control_init` in `control.c`** (after `ctx->evap_fan_always_on = false;`)

```c
    ctx->op_state_previous = OP_OFF;
    ctx->attempted_start_counter = 0;
    ctx->external_temperature = 0;
    ctx->ext_temp_sensor_state = 0;
    ctx->engine_temp_ok = true;
    ctx->standby_override = false;
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_ctx_es --output-on-failure`
Expected: PASS (2 tests). Run the full suite too — the extended `apu_ctx_t`/`control_error_t` must not break M6a tests.

- [ ] **Step 8: Commit**

```bash
git add firmware/g0b1-apu/App/services/control.h firmware/g0b1-apu/App/services/control.c firmware/g0b1-apu/Tests/test_control_ctx_es.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): control — apu_ctx_t engine-start fields + ERR_STANDBY(7) + init resets"
```

---

### Task 2: control_sample_sensors + reg-32 standby-override binding

**Files:**
- Modify: `firmware/g0b1-apu/App/services/control.h` (add prototype)
- Create: `firmware/g0b1-apu/App/services/control_sample.c`
- Modify: `firmware/g0b1-apu/App/services/control_io.c` (bind reg 32)
- Create: `firmware/g0b1-apu/Tests/test_control_sample.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: M3 `sensors.h` (`sensors_get_ext_temp_f`, `sensors_get_ext_state`), M4b `mb_regmodel.h`.
- Produces: `void control_sample_sensors(apu_ctx_t *ctx);` — `ctx->external_temperature = sensors_get_ext_temp_f(); ctx->ext_temp_sensor_state = sensors_get_ext_state();`.
- Modifies `control_regs_register` to also bind reg **32** (standby override, rw: read `standby_override`, write sets it 0/1 → nonzero stored as `true`).

- [ ] **Step 1: Add the prototype to `control.h`**

```c
void control_sample_sensors(apu_ctx_t *ctx);
```

- [ ] **Step 2: Write the failing test `Tests/test_control_sample.c`**

```c
#include "unity.h"
#include "control.h"
#include "sensors.h"
#include "sensors_cal.h"
#include "mb_regmodel.h"

static apu_ctx_t ctx;
void setUp(void) { mb_reg_reset(); sensors_init(VREF_CAL_DEFAULT, 0); control_init(&ctx); control_regs_register(&ctx); }
void tearDown(void) {}

static void test_sample_copies_ext_temp_and_state(void) {
    for (int i = 0; i < SENS_AVG_DEFAULT; i++) sensors_add_sample(SENS_EXT, 1971); /* -> 32 degF, ON */
    control_sample_sensors(&ctx);
    TEST_ASSERT_EQUAL_INT16(32, ctx.external_temperature);
    TEST_ASSERT_EQUAL_UINT8(SENSOR_ON, ctx.ext_temp_sensor_state);
}

static void test_reg32_standby_override_rw(void) {
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(32, 1));
    TEST_ASSERT_TRUE(ctx.standby_override);
    uint16_t o = 0;
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_read(32, &o));
    TEST_ASSERT_EQUAL_UINT16(1, o);
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(32, 0));
    TEST_ASSERT_FALSE(ctx.standby_override);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_sample_copies_ext_temp_and_state);
    RUN_TEST(test_reg32_standby_override_rw);
    return UNITY_END();
}
```

- [ ] **Step 3: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_control_sample test_control_sample.c ../App/services/control_sample.c ../App/services/control_io.c ../App/services/control.c ../App/services/sensors.c ../App/services/mb_regmodel.c ../App/services/fan_speed.c)
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_sample --output-on-failure`
Expected: build fails — `control_sample_sensors` undefined / reg 32 not bound.

- [ ] **Step 5: Write `App/services/control_sample.c`**

```c
#include "control.h"
#include "sensors.h"

void control_sample_sensors(apu_ctx_t *ctx) {
    ctx->external_temperature = sensors_get_ext_temp_f();
    ctx->ext_temp_sensor_state = sensors_get_ext_state();
}
```

- [ ] **Step 6: Add the reg-32 binding to `control_io.c`** — add the accessors (near the other `static` accessors) and the bind line in `control_regs_register`:

```c
static modbus_exc_t rd_standby(uint16_t r, uint16_t *o) { (void)r; *o = s_ctx->standby_override ? 1u : 0u; return MB_EXC_NONE; }
static modbus_exc_t wr_standby(uint16_t r, uint16_t v) { (void)r; s_ctx->standby_override = (v != 0u); return MB_EXC_NONE; }
```

and in `control_regs_register`, after the existing binds:

```c
    mb_reg_bind(32, rd_standby, wr_standby);
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_sample --output-on-failure`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add firmware/g0b1-apu/App/services/control.h firmware/g0b1-apu/App/services/control_sample.c firmware/g0b1-apu/App/services/control_io.c firmware/g0b1-apu/Tests/test_control_sample.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): control — sample ext-temp sensor into ctx + bind reg 32 (standby override)"
```

---

### Task 3: Engine-start crank sequence (GLOWPLUG → FUEL → STARTER → ENGINE_ON)

**Files:**
- Modify: `firmware/g0b1-apu/App/services/control.h` (add prototype)
- Create: `firmware/g0b1-apu/App/services/control_engine_start.c`
- Create: `firmware/g0b1-apu/Tests/test_control_engine_start.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `apu_ctx_t` (Task 1), M5 `app_timers.h`, M3 `sensors.h` (`SENSOR_OFF`).
- Produces: `void control_engine_start_mode(apu_ctx_t *ctx);` (register for `OP_ENGINE_START` in Task 6). This task implements the switch cases `ES_GLOWPLUG_ON`, `ES_FUEL_ON`, `ES_STARTER_ON`, `ES_ENGINE_ON` (+ `default`); `ES_CHECK_PRESSURE` and `ES_COOL_ON` + the standby tail are added in Tasks 4–5.
- Produces the `ES_*` sub-state enum + a `static es_set_glow_duration(ctx)` helper.

- [ ] **Step 1: Add the prototype to `control.h`**

```c
void control_engine_start_mode(apu_ctx_t *ctx);   /* register for OP_ENGINE_START */
```

- [ ] **Step 2: Write the failing test `Tests/test_control_engine_start.c`**

```c
#include "unity.h"
#include "control.h"
#include "app_timers.h"
#include "sensors.h"

static apu_ctx_t ctx;
void setUp(void) { app_timers_init(); control_init(&ctx); ctx.op_state = OP_ENGINE_START; ctx.sub_state = 0; }
void tearDown(void) {}

static void test_glow_duration_by_temp(void) {
    ctx.ext_temp_sensor_state = SENSOR_ON; ctx.external_temperature = 104;  /* 8s branch */
    control_engine_start_mode(&ctx);
    TEST_ASSERT_TRUE(ctx.out.glow_plug);
    TEST_ASSERT_EQUAL_UINT8(ST_WARMING_UP, ctx.control_status);
    TEST_ASSERT_EQUAL_UINT16(80, app_timer_get(SCALE_HUNDRED_MS, GLOW_PLUG_ON_TMR));
    TEST_ASSERT_EQUAL_UINT8(1, ctx.attempted_start_counter);
    TEST_ASSERT_EQUAL_UINT8(2, ctx.sub_state);          /* ES_FUEL_ON */
}

static void test_glow_no_sensor_28s(void) {
    ctx.ext_temp_sensor_state = SENSOR_OFF;
    control_engine_start_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT16(280, app_timer_get(SCALE_HUNDRED_MS, GLOW_PLUG_ON_TMR));
}

static void test_glow_hot_zero_and_off(void) {
    ctx.ext_temp_sensor_state = SENSOR_ON; ctx.external_temperature = 130;  /* >=122 */
    control_engine_start_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT16(0, app_timer_get(SCALE_HUNDRED_MS, GLOW_PLUG_ON_TMR));
    TEST_ASSERT_FALSE(ctx.out.glow_plug);
}

static void test_fuel_on_after_glow(void) {
    ctx.sub_state = 2 /*ES_FUEL_ON*/;
    /* glow timer 0, short-delay 0 -> fuel on */
    control_engine_start_mode(&ctx);
    TEST_ASSERT_TRUE(ctx.out.fuel_pump);
    TEST_ASSERT_FALSE(ctx.out.glow_plug);
    TEST_ASSERT_EQUAL_UINT16(100, app_timer_get(SCALE_TEN_MS, SHORT_DELAY_TMR)); /* 1s */
    TEST_ASSERT_EQUAL_UINT8(3, ctx.sub_state);          /* ES_STARTER_ON */
}

static void test_starter_on_after_fuel(void) {
    ctx.sub_state = 3 /*ES_STARTER_ON*/;                /* short-delay 0 */
    control_engine_start_mode(&ctx);
    TEST_ASSERT_TRUE(ctx.out.starter);
    TEST_ASSERT_EQUAL_UINT8(ST_STARTING, ctx.control_status);
    TEST_ASSERT_EQUAL_UINT16(400, app_timer_get(SCALE_TEN_MS, SHORT_DELAY_TMR)); /* 4s */
    TEST_ASSERT_EQUAL_UINT8(4, ctx.sub_state);          /* ES_ENGINE_ON */
}

static void test_engine_on_stops_starter_and_postheats(void) {
    ctx.sub_state = 4 /*ES_ENGINE_ON*/; ctx.external_temperature = 100; /* <122 -> post-heat */
    ctx.out.starter = true;
    control_engine_start_mode(&ctx);
    TEST_ASSERT_FALSE(ctx.out.starter);
    TEST_ASSERT_TRUE(ctx.out.glow_plug);                /* post-heat */
    TEST_ASSERT_EQUAL_UINT16(50, app_timer_get(SCALE_HUNDRED_MS, GLOW_PLUG_ON_TMR)); /* 5s */
    TEST_ASSERT_EQUAL_UINT16(1000, app_timer_get(SCALE_TEN_MS, SHORT_DELAY_TMR));    /* 10s */
    TEST_ASSERT_EQUAL_UINT8(5, ctx.sub_state);          /* ES_CHECK_PRESSURE */
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_glow_duration_by_temp);
    RUN_TEST(test_glow_no_sensor_28s);
    RUN_TEST(test_glow_hot_zero_and_off);
    RUN_TEST(test_fuel_on_after_glow);
    RUN_TEST(test_starter_on_after_fuel);
    RUN_TEST(test_engine_on_stops_starter_and_postheats);
    return UNITY_END();
}
```

- [ ] **Step 3: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_control_engine_start test_control_engine_start.c ../App/services/control_engine_start.c ../App/services/control.c ../App/services/app_timers.c ../App/services/sensors.c ../App/services/fan_speed.c)
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_engine_start --output-on-failure`
Expected: build fails — `control_engine_start_mode` undefined.

- [ ] **Step 5: Write `App/services/control_engine_start.c`** (crank sequence; Tasks 4–5 append cases)

```c
#include "control.h"
#include "app_timers.h"
#include "sensors.h"   /* SENSOR_OFF */

enum { ES_GLOWPLUG_ON = 0, ES_HEAT_ON, ES_FUEL_ON, ES_STARTER_ON,
       ES_ENGINE_ON, ES_CHECK_PRESSURE, ES_COOL_ON };

static void es_set_glow_duration(apu_ctx_t *ctx) {
    if (ctx->ext_temp_sensor_state == SENSOR_OFF) {
        app_timer_set(SCALE_HUNDRED_MS, GLOW_PLUG_ON_TMR, 280);   /* 28 s */
    } else if (ctx->external_temperature >= 122) {
        app_timer_set(SCALE_HUNDRED_MS, GLOW_PLUG_ON_TMR, 0);
        ctx->out.glow_plug = false;
    } else if (ctx->external_temperature >= 104) {
        app_timer_set(SCALE_HUNDRED_MS, GLOW_PLUG_ON_TMR, 80);    /* 8 s */
    } else if (ctx->external_temperature >= 68) {
        app_timer_set(SCALE_HUNDRED_MS, GLOW_PLUG_ON_TMR, 100);   /* 10 s */
    } else if (ctx->external_temperature >= 32) {
        app_timer_set(SCALE_HUNDRED_MS, GLOW_PLUG_ON_TMR, 160);   /* 16 s */
    } else {
        app_timer_set(SCALE_HUNDRED_MS, GLOW_PLUG_ON_TMR, 290);   /* 29 s */
    }
}

void control_engine_start_mode(apu_ctx_t *ctx) {
    switch (ctx->sub_state) {
        case ES_GLOWPLUG_ON:
            ctx->out.glow_plug = true;
            ctx->control_status = ST_WARMING_UP;
            es_set_glow_duration(ctx);
            ctx->attempted_start_counter++;
            ctx->sub_state = ES_FUEL_ON;
            break;
        case ES_FUEL_ON:
            if (app_timer_expired(SCALE_HUNDRED_MS, GLOW_PLUG_ON_TMR)) {
                ctx->out.glow_plug = false;
                if (app_timer_expired(SCALE_TEN_MS, SHORT_DELAY_TMR)) {
                    ctx->out.fuel_pump = true;
                    app_timer_set(SCALE_TEN_MS, SHORT_DELAY_TMR, 100);   /* 1 s */
                    ctx->sub_state = ES_STARTER_ON;
                }
            }
            break;
        case ES_STARTER_ON:
            if (app_timer_expired(SCALE_TEN_MS, SHORT_DELAY_TMR)) {
                ctx->out.starter = true;
                ctx->control_status = ST_STARTING;
                app_timer_set(SCALE_TEN_MS, SHORT_DELAY_TMR, 400);       /* 4 s */
                ctx->sub_state = ES_ENGINE_ON;
            }
            break;
        case ES_ENGINE_ON:
            if (app_timer_expired(SCALE_TEN_MS, SHORT_DELAY_TMR)) {
                ctx->out.starter = false;
                if (ctx->external_temperature < 122) {
                    ctx->out.glow_plug = true;
                    app_timer_set(SCALE_HUNDRED_MS, GLOW_PLUG_ON_TMR, 50); /* post-heat 5 s */
                }
                app_timer_set(SCALE_TEN_MS, SHORT_DELAY_TMR, 1000);      /* 10 s */
                ctx->sub_state = ES_CHECK_PRESSURE;
            }
            break;
        default:
            break;
    }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_engine_start --output-on-failure`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add firmware/g0b1-apu/App/services/control.h firmware/g0b1-apu/App/services/control_engine_start.c firmware/g0b1-apu/Tests/test_control_engine_start.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): control — engine-start crank sequence (glow/fuel/starter/engine-on)"
```

---

### Task 4: Engine-start CHECK_PRESSURE (success / retry / 5-attempt failure)

**Files:**
- Modify: `firmware/g0b1-apu/App/services/control_engine_start.c` (add `ES_CHECK_PRESSURE` case)
- Modify: `firmware/g0b1-apu/Tests/test_control_engine_start.c` (add tests)

**Interfaces:**
- Adds the `ES_CHECK_PRESSURE` case to the switch (before `default`): glow off when `GLOW_PLUG_ON_TMR` expired; when `SHORT_DELAY_TMR` expired — if `!in_oil_pressure_ok` (oil low): `attempted_start_counter >= 5` → `error_state = ERR_STARTING_FAILURE`, `op_state = OP_ERROR_SHUTDOWN`, `attempted_start_counter = 0`; else `out.fuel_pump = false`, `sub_state = ES_GLOWPLUG_ON` (retry). If oil OK: `SHORT_DELAY_TMR = 0`, `attempted_start_counter = 0`, `engine_op_status = ST_RUNNING`, `control_status = ST_RUNNING`, `sub_state = ES_COOL_ON`.

- [ ] **Step 1: Add the failing tests to `test_control_engine_start.c`** (add these functions + `RUN_TEST` lines)

```c
static void test_check_pressure_oil_ok_runs(void) {
    ctx.sub_state = 5 /*ES_CHECK_PRESSURE*/;
    ctx.in_oil_pressure_ok = true;                     /* pressure good */
    ctx.attempted_start_counter = 3;
    /* SHORT_DELAY_TMR is 0 (expired) in a fresh app_timers_init */
    control_engine_start_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT8(ST_RUNNING, ctx.engine_op_status);
    TEST_ASSERT_EQUAL_UINT8(ST_RUNNING, ctx.control_status);
    TEST_ASSERT_EQUAL_UINT8(0, ctx.attempted_start_counter);
    TEST_ASSERT_EQUAL_UINT8(6, ctx.sub_state);         /* ES_COOL_ON */
}

static void test_check_pressure_oil_low_retry(void) {
    ctx.sub_state = 5; ctx.in_oil_pressure_ok = false; ctx.attempted_start_counter = 2;
    ctx.out.fuel_pump = true;
    control_engine_start_mode(&ctx);
    TEST_ASSERT_FALSE(ctx.out.fuel_pump);
    TEST_ASSERT_EQUAL_UINT8(0, ctx.sub_state);         /* ES_GLOWPLUG_ON retry */
    TEST_ASSERT_EQUAL_INT(OP_ENGINE_START, ctx.op_state); /* still starting */
}

static void test_check_pressure_oil_low_5th_attempt_fails(void) {
    ctx.sub_state = 5; ctx.in_oil_pressure_ok = false; ctx.attempted_start_counter = 5;
    control_engine_start_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT8(ERR_STARTING_FAILURE, ctx.error_state);
    TEST_ASSERT_EQUAL_INT(OP_ERROR_SHUTDOWN, ctx.op_state);
    TEST_ASSERT_EQUAL_UINT8(0, ctx.attempted_start_counter);
}
```
Register: `RUN_TEST(test_check_pressure_oil_ok_runs); RUN_TEST(test_check_pressure_oil_low_retry); RUN_TEST(test_check_pressure_oil_low_5th_attempt_fails);`

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_engine_start --output-on-failure`
Expected: FAIL — `ES_CHECK_PRESSURE` falls through `default`, no transition.

- [ ] **Step 3: Add the `ES_CHECK_PRESSURE` case to `control_engine_start.c`** (insert before `default:`)

```c
        case ES_CHECK_PRESSURE:
            if (app_timer_expired(SCALE_HUNDRED_MS, GLOW_PLUG_ON_TMR)) {
                ctx->out.glow_plug = false;
            }
            if (app_timer_expired(SCALE_TEN_MS, SHORT_DELAY_TMR)) {
                if (!ctx->in_oil_pressure_ok) {                 /* oil low (PIC NOK) */
                    if (ctx->attempted_start_counter >= 5) {
                        ctx->attempted_start_counter = 0;
                        ctx->error_state = ERR_STARTING_FAILURE;
                        ctx->op_state = OP_ERROR_SHUTDOWN;
                    } else {
                        ctx->out.fuel_pump = false;
                        ctx->sub_state = ES_GLOWPLUG_ON;        /* retry */
                    }
                } else {                                        /* oil OK */
                    app_timer_set(SCALE_TEN_MS, SHORT_DELAY_TMR, 0);
                    ctx->attempted_start_counter = 0;
                    ctx->engine_op_status = ST_RUNNING;
                    ctx->control_status = ST_RUNNING;
                    ctx->sub_state = ES_COOL_ON;
                }
            }
            break;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_engine_start --output-on-failure`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add firmware/g0b1-apu/App/services/control_engine_start.c firmware/g0b1-apu/Tests/test_control_engine_start.c
git commit -m "feat(g0b1-apu): control — engine-start CHECK_PRESSURE (run / retry / 5-attempt STARTING_FAILURE)"
```

---

### Task 5: Engine-start COOL_ON handoff + over-temp/oil-monitor + standby tail

**Files:**
- Modify: `firmware/g0b1-apu/App/services/control_engine_start.c` (add `ES_COOL_ON` case + post-switch standby tail)
- Modify: `firmware/g0b1-apu/Tests/test_control_engine_start.c` (add tests)

**Interfaces:**
- Adds the `ES_COOL_ON` case: when `SHORT_DELAY_TMR` expired — `op_state_previous == OP_CLIMATE` → `op_state = OP_CLIMATE`, `sub_state = 2`, `control_status = ST_COOLING`; `== OP_BATTERY` → `op_state = OP_BATTERY`, `sub_state = 3`. Else (delay non-zero, monitor): `!in_oil_pressure_ok` → `ERR_LOW_OIL` + `OP_ERROR_SHUTDOWN`; `!engine_temp_ok` → `ERR_HIGH_ENGINE_TEMP` + `OP_ERROR_SHUTDOWN`.
- Adds, **after the switch**, the standby tail: `if (!ctx->standby_override && ctx->in_truck_ignition) { ctx->attempted_start_counter = 0; ctx->error_state = ERR_STANDBY; ctx->op_state = OP_ERROR_SHUTDOWN; }`.

- [ ] **Step 1: Add the failing tests to `test_control_engine_start.c`**

```c
static void test_cool_on_handoff_climate(void) {
    ctx.sub_state = 6 /*ES_COOL_ON*/; ctx.op_state_previous = OP_CLIMATE;
    /* SHORT_DELAY_TMR == 0 */
    control_engine_start_mode(&ctx);
    TEST_ASSERT_EQUAL_INT(OP_CLIMATE, ctx.op_state);
    TEST_ASSERT_EQUAL_UINT8(2, ctx.sub_state);         /* CC_MONITOR_TEMP */
    TEST_ASSERT_EQUAL_UINT8(ST_COOLING, ctx.control_status);
}

static void test_cool_on_handoff_battery(void) {
    ctx.sub_state = 6; ctx.op_state_previous = OP_BATTERY;
    control_engine_start_mode(&ctx);
    TEST_ASSERT_EQUAL_INT(OP_BATTERY, ctx.op_state);
    TEST_ASSERT_EQUAL_UINT8(3, ctx.sub_state);         /* BM_CHARGING */
}

static void test_cool_on_monitor_oil_low_shuts_down(void) {
    ctx.sub_state = 6; ctx.op_state_previous = OP_CLIMATE;
    app_timer_set(SCALE_TEN_MS, SHORT_DELAY_TMR, 5);   /* non-zero -> monitor branch */
    ctx.in_oil_pressure_ok = false;
    control_engine_start_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT8(ERR_LOW_OIL, ctx.error_state);
    TEST_ASSERT_EQUAL_INT(OP_ERROR_SHUTDOWN, ctx.op_state);
}

static void test_cool_on_monitor_over_temp_shuts_down(void) {
    ctx.sub_state = 6; ctx.op_state_previous = OP_CLIMATE;
    app_timer_set(SCALE_TEN_MS, SHORT_DELAY_TMR, 5);
    ctx.in_oil_pressure_ok = true; ctx.engine_temp_ok = false;
    control_engine_start_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT8(ERR_HIGH_ENGINE_TEMP, ctx.error_state);
    TEST_ASSERT_EQUAL_INT(OP_ERROR_SHUTDOWN, ctx.op_state);
}

static void test_standby_shutdown_when_truck_running(void) {
    ctx.sub_state = 0 /*any state*/; ctx.standby_override = false; ctx.in_truck_ignition = true;
    ctx.attempted_start_counter = 3;
    control_engine_start_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT8(ERR_STANDBY, ctx.error_state);
    TEST_ASSERT_EQUAL_INT(OP_ERROR_SHUTDOWN, ctx.op_state);
    TEST_ASSERT_EQUAL_UINT8(0, ctx.attempted_start_counter);
}

static void test_standby_suppressed_by_override(void) {
    ctx.sub_state = 0; ctx.standby_override = true; ctx.in_truck_ignition = true;
    control_engine_start_mode(&ctx);
    TEST_ASSERT_NOT_EQUAL_INT(OP_ERROR_SHUTDOWN, ctx.op_state); /* override suppresses standby */
}
```
Register all six with `RUN_TEST(...)`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_engine_start --output-on-failure`
Expected: FAIL — `ES_COOL_ON` unhandled + no standby tail.

- [ ] **Step 3: Add the `ES_COOL_ON` case + standby tail to `control_engine_start.c`** (insert the case before `default:`; add the standby block after the closing `}` of the switch)

```c
        case ES_COOL_ON:
            if (app_timer_expired(SCALE_TEN_MS, SHORT_DELAY_TMR)) {
                if (ctx->op_state_previous == OP_CLIMATE) {
                    ctx->op_state = OP_CLIMATE;
                    ctx->control_status = ST_COOLING;
                    ctx->sub_state = 2;             /* CC_MONITOR_TEMP */
                } else if (ctx->op_state_previous == OP_BATTERY) {
                    ctx->op_state = OP_BATTERY;
                    ctx->sub_state = 3;             /* BM_CHARGING */
                }
            } else {
                if (!ctx->in_oil_pressure_ok) {
                    ctx->error_state = ERR_LOW_OIL;
                    ctx->op_state = OP_ERROR_SHUTDOWN;
                }
                if (!ctx->engine_temp_ok) {
                    ctx->error_state = ERR_HIGH_ENGINE_TEMP;
                    ctx->op_state = OP_ERROR_SHUTDOWN;
                }
            }
            break;
```

After the `switch (...) { ... }` closing brace, before the function's closing `}`:

```c
    /* Standby: APU must not run while the truck engine is on (unless overridden). */
    if (!ctx->standby_override && ctx->in_truck_ignition) {
        ctx->attempted_start_counter = 0;
        ctx->error_state = ERR_STANDBY;
        ctx->op_state = OP_ERROR_SHUTDOWN;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_engine_start --output-on-failure`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add firmware/g0b1-apu/App/services/control_engine_start.c firmware/g0b1-apu/Tests/test_control_engine_start.c
git commit -m "feat(g0b1-apu): control — engine-start COOL_ON handoff + over-temp/oil monitor + standby shutdown"
```

---

### Task 6: Register OP_ENGINE_START + wire sample step + end-to-end integration

**Files:**
- Modify: `firmware/g0b1-apu/App/services/control_app.c` (register engine-start; add sample step to the slot)
- Create: `firmware/g0b1-apu/Tests/test_control_engine_start_integration.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- `control_app_init` also calls `control_register_mode(OP_ENGINE_START, control_engine_start_mode)`.
- `control_10ms_slot` also calls `control_sample_sensors(&s_ctx)` (before/after inputs — before tick), so the engine-start glow logic sees live external temperature.
- The integration test drives a full start through the real scheduler: seed `op_state=OP_ENGINE_START`, `op_state_previous=OP_CLIMATE`, external temp; advance the scheduler through glow → fuel → starter → crank → oil-OK → RUNNING → COOL_ON handoff to `OP_CLIMATE`.

- [ ] **Step 1: Modify `control_app.c`** — add to `control_app_init` (after the OFF registration):

```c
    control_register_mode(OP_ENGINE_START, control_engine_start_mode);
```
and add to `control_10ms_slot` (as the first line, before `control_inputs_service`):

```c
    control_sample_sensors(&s_ctx);
```

- [ ] **Step 2: Write the failing test `Tests/test_control_engine_start_integration.c`**

```c
#include "unity.h"
#include "control.h"
#include "sched.h"
#include "app_timers.h"
#include "sensors.h"
#include "sensors_cal.h"
#include "bsp_io.h"
#include "bsp_pwm.h"
#include "mb_regmodel.h"
#include "fake_bsp_io.h"
#include "fake_bsp_pwm.h"

static bsp_io_backend_t io_be;
static bsp_pwm_backend_t pwm_be;

void setUp(void) {
    fake_bsp_io_init(&io_be);   bsp_io_init(&io_be);
    fake_bsp_pwm_init(&pwm_be); bsp_pwm_init(&pwm_be);
    mb_reg_reset();
    sensors_init(VREF_CAL_DEFAULT, 0);
    sched_init();
    control_app_init();
    sched_register(SLOT_10MS, control_10ms_slot);
}
void tearDown(void) {}

static void advance(uint16_t total_ms) {
    for (uint16_t t = 0; t < total_ms; t++) { sched_service(1); sched_run(); }
}

/* Full engine start: hot engine (glow 0s) -> ~1s fuel hold -> 4s crank -> 10s pressure wait,
   oil pressure good (debounced) -> RUNNING -> hand back to CLIMATE. Total ~15 s.
   NOTE: control_10ms_slot runs control_inputs_service AND control_sample_sensors every tick,
   so the oil-pressure state and external temperature MUST be driven through the fakes/sensors,
   not set on the ctx directly (the slot overwrites them). */
static void test_full_start_to_climate_handoff(void) {
    apu_ctx_t *c = control_app_ctx();
    /* Hot external temp so the glow-plug window is 0 s. Drive the M3 ext-NTC sensor:
       a raw count of 239 (just above NTC_OVERMAX_CNT) interpolates to ~246 degF (>=122). */
    for (int i = 0; i < SENS_AVG_DEFAULT; i++) sensors_add_sample(SENS_EXT, 239);
    /* Oil pressure good: drive the fake input high; it debounces over 500 ms, well before the
       ~5 s point where CHECK_PRESSURE reads it. */
    fake_bsp_io_set_input(IN_OIL_PRESSURE, true);
    c->op_state = OP_ENGINE_START;
    c->op_state_previous = OP_CLIMATE;
    c->engine_temp_ok = true;             /* not overwritten by any slot step yet (sensor deferred) */
    c->sub_state = 0;

    advance(16000);   /* covers glow(0s) + 1s fuel hold + 4s crank + 10s pressure wait + handoff */
    TEST_ASSERT_EQUAL_INT(OP_CLIMATE, c->op_state);        /* handed back to climate */
    TEST_ASSERT_EQUAL_UINT8(ST_RUNNING, c->engine_op_status);
    TEST_ASSERT_EQUAL_UINT8(2, c->sub_state);             /* CC_MONITOR_TEMP entry */
}

static void test_standby_aborts_start(void) {
    apu_ctx_t *c = control_app_ctx();
    c->op_state = OP_ENGINE_START; c->sub_state = 0; c->standby_override = false;
    fake_bsp_io_set_input(IN_TRUCK_IGNITION, true);       /* truck engine running */
    /* Truck-ignition debounces over CONTROL_INPUT_DEBOUNCE_TIME (50) service calls; the 10 ms
       slot services it once per 10 ms, so ~500 ms + margin, then the standby tail fires. */
    advance(700);
    TEST_ASSERT_EQUAL_INT(OP_ERROR_SHUTDOWN, c->op_state);
    TEST_ASSERT_EQUAL_UINT8(ERR_STANDBY, c->error_state);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_full_start_to_climate_handoff);
    RUN_TEST(test_standby_aborts_start);
    return UNITY_END();
}
```

*Note on the integration test — two slot side-effects to respect: (1) `control_10ms_slot` runs `control_sample_sensors` every tick, overwriting `ctx->external_temperature` from the M3 sensor, so the test drives the ext-NTC sensor (`sensors_add_sample(SENS_EXT, …)`), not the ctx field; count `239` interpolates to ~246 °F (`>= 122` → glow 0 s). (2) The slot also runs `control_inputs_service`, overwriting `ctx->in_oil_pressure_ok`/`in_truck_ignition` from the debounced fake inputs, so oil-pressure and truck-ignition are driven via `fake_bsp_io_set_input(...)` (each debounces over 500 ms). If the chosen ext-temp count does not reliably yield `>= 122 °F`, the glow window can be up to 29 s — either pick a hotter count or extend `advance()` to ~45000 ms so the assertion is deterministic regardless of glow duration.*

- [ ] **Step 3: Register the test in `Tests/CMakeLists.txt`** (full source set)

```cmake
add_unity_test(test_control_engine_start_integration test_control_engine_start_integration.c \
    ../App/services/control.c ../App/services/control_outputs.c ../App/services/control_powerup.c \
    ../App/services/control_off.c ../App/services/control_io.c ../App/services/control_app.c \
    ../App/services/control_engine_start.c ../App/services/control_sample.c \
    ../App/services/sched.c ../App/services/app_timers.c ../App/services/io_debounce.c \
    ../App/services/bsp_io.c ../App/services/bsp_pwm.c ../App/services/fan_speed.c \
    ../App/services/sensors.c ../App/services/mb_regmodel.c fakes/fake_bsp_io.c fakes/fake_bsp_pwm.c)
```

- [ ] **Step 4: Run the integration test**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_engine_start_integration --output-on-failure`
Expected: build first, then the full-start and standby-abort scenarios pass. If the hot-glow timing is fiddly, apply the note's fallback (longer first advance). A genuine composition bug → fix the offending module, not the test.

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build --output-on-failure`
Expected: all tests pass (43 prior M1–M6a + 6 new M6b = **49 executables**), zero warnings under `-Werror`.

- [ ] **Step 6: Commit**

```bash
git add firmware/g0b1-apu/App/services/control_app.c firmware/g0b1-apu/Tests/test_control_engine_start_integration.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): control — register OP_ENGINE_START + sample-sensors wiring + end-to-end start"
```

---

## Deferred to later M6 sub-milestones / bench

- **M6c (climate)** registers `OP_CLIMATE`; sets `op_state_previous = OP_CLIMATE` before invoking `OP_ENGINE_START`; enters at `sub_state = CC_MONITOR_TEMP` (=2) after the engine-start handoff.
- **M6d (battery + error)** registers `OP_BATTERY` (sets `op_state_previous`, enters at `BM_CHARGING` =3) and `OP_ERROR_SHUTDOWN` (consumes the `error_state`/`op_state` this milestone sets). M6d also extends `control_error_t` with the remaining PIC codes `ENGINE_STALLED`/`NO_RPM_DETECTED`/`HIGH_AC_PRESSURE_ERROR` (8–10) for its stall/pressure logic.
- **`engine_temp_ok` sensor derivation** (M3 engine-coolant temp reg 2) + **oil-pressure switch polarity** → bench.
- reg 9 (RPM port-state), reg 41 (production test), RPM-based stall detection (running modes) still deferred.

## Carry-forward items to confirm

- **Oil-pressure polarity** (`in_oil_pressure_ok` true = pressure good) — confirm the physical switch wiring at bench.
- **Glow-plug duration table + crank times** — validated against the PIC constants; confirm against the engine at bench (OI-7-style).
- **Standby block** was `#ifdef TRUCK_ENGINE_INTERRUPT` in the PIC — confirm it should be active in the shipping build (it is gated by `standby_override`/reg 32 here).

---

## Self-Review

**Spec coverage (§8.2):** `engine_start_state_list` ported with same states/transitions/timings ✅ (Tasks 3–5); modes request outputs into `apu_ctx_t`, mapped by `outputs_apply` (M6a) ✅; glow/fuel/starter crank + temperature-keyed glow duration ✅ (Task 3); oil-pressure start detection + 5-attempt `STARTING_FAILURE` ✅ (Task 4); hand-back to the invoking climate/battery mode ✅ (Task 5); over-temp / oil-monitor / standby fault shutdowns ✅ (Task 5, structurally; sensor derivations deferred); sensor value into control ✅ (Task 2 sample step); reg-32 standby-override bound ✅ (Task 2, retiring the M4b deferral); registered into the M6a dispatcher with no dispatcher edits ✅ (Task 6). `ES_HEAT_ON` preserved-but-unused, cold storage excluded — consistent with the PIC/OI-6. RPM stall detection, engine-temp sensor derivation, reg 9/41 ⏸ deferred (documented).

**Placeholder scan:** no TBD/TODO. The one timing-sensitive integration vector (hitting a `>=122 °F` external-temp reading through the M3 sensor) has an explicit fallback (extend the first advance to cover the 29 s glow window) so the test is deterministic regardless.

**Type consistency:** `apu_ctx_t`'s new fields (Task 1) are used identically by `control_sample_sensors` (Task 2), the ES handler (Tasks 3–5), and the integration (Task 6). `ERR_STANDBY`/`ERR_STARTING_FAILURE`/`ERR_LOW_OIL`/`ERR_HIGH_ENGINE_TEMP`, the `ST_*` statuses, and `OP_ERROR_SHUTDOWN`/`OP_CLIMATE`/`OP_BATTERY` come from M6a `control.h`. The ES handler uses M5 `app_timer_set/expired` + the `GLOW_PLUG_ON_TMR`/`SHORT_DELAY_TMR` indices (SCALE_HUNDRED_MS/SCALE_TEN_MS) verbatim, and M3 `SENSOR_OFF`/`sensors_get_ext_temp_f`/`sensors_get_ext_state`. `control_regs_register` reg-32 accessors follow the M6a `control_io.c` pattern. Each test's CMake dependency list compiles only the sources it exercises; the Task 6 integration links the full M6a+M6b + M5 + M3 + M4b-regmodel set.
