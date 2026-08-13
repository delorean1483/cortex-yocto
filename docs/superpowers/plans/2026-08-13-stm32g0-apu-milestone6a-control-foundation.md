# STM32G0 APU Port — Milestone 6a: Control Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the portable, host-tested control-application foundation — the shared `apu_ctx_t` context, the top-level state-machine dispatcher, `outputs_apply` (control requests → BSP), the POWER_UP and OFF modes, discrete-input processing, the control/input register bindings, and scheduler wiring — that the mode milestones (M6b engine-start, M6c climate, M6d battery+error) plug into.

**Architecture:** A single `apu_ctx_t` replaces the PIC's `op_state`/per-mode `state` + output flags + statuses + `flag2` globals. Control modes are registered handlers (`control_register_mode`, mirroring the M5 `sched_register` / M4b `mb_reg_bind` seam): `control_tick(ctx)` applies the op-mode-request transition (the PIC `UpdateSwitches` mapping) then dispatches the handler for `ctx->op_state`. Modes only *request* outputs into `ctx`; one `outputs_apply(ctx)` maps them to `bsp_io`/`bsp_pwm` — the bit-banged evap PWM becomes a real `bsp_pwm_set` with the M5 `fan_speed` mapping. M6a registers POWER_UP and OFF; M6b/c/d register their modes with zero dispatcher edits. The control statuses and debounced inputs are exposed through the M4b register model, completing regs 1–52.

**Tech Stack:** C11, CMake + Unity (host). Reuses M4b `mb_regmodel`, M5 `bsp_io`/`bsp_pwm`/`fan_speed`/`io_debounce`/`app_timers`/`sched`, `types.h`.

**Design spec:** `docs/superpowers/specs/2026-08-12-pic18-to-stm32g0-apu-port-design.md` §8 (control application). Prereqs: M4b (register model), M5 (BSP + scheduler). Source of truth: PIC `main.c` (`StateMachine`, `PowerUpMode`, `OffMode`, `UpdateSwitches`, `UpdateOutputs`), `main.h` (op_type / control_status / operation_mode / error / oil / temp-display enums).

## Global Constraints

- **Behavior is preserved faithfully** (same states/transitions/timings), restructured into `apu_ctx_t`. Apply the resolved open items: **OI-1** heat = `OUT_HEAT_REVERSER` energized (reverse fan), no separate cool output; **OI-2** condenser fan = relay + PWM ramp (curve is M6c); **OI-6** cold storage excluded (the `OP_COLD_STORAGE` enum slot is preserved but never dispatched).
- **Enums preserve the PIC numeric values** (`control.h`):
  - `control_op_state_t`: `OP_POWER_UP=0, OP_OFF, OP_ENGINE_START, OP_CLIMATE, OP_BATTERY, OP_COLD_STORAGE, OP_ERROR_SHUTDOWN, OP_STATE_COUNT` (8).
  - `control_status_t`: `ST_OFF=0, ST_WARMING_UP, ST_STARTING, ST_RUNNING, ST_DEFROST, ST_CHARGING, ST_COOLING, ST_CHILLIN`.
  - `op_mode_t`: `MODE_OFF=0, MODE_CLIMATE, MODE_BATTERY` (Modbus reg 10 values).
  - `control_error_t`: `ERR_NONE=0, ERR_LOW_OIL, ERR_HIGH_ENGINE_TEMP, ERR_LOW_BATTERY, ERR_AC_LOW_PRESSURE, ERR_AC_HIGH_PRESSURE, ERR_STARTING_FAILURE`.
  - `oil_state_t`: `OIL_GOOD=0, OIL_CHANGE_SOON, OIL_CHANGE_NEEDED, OIL_CHANGE_PAST_DUE, OIL_WARNING_DISMISSED`.
  - `temp_display_t`: `TD_REAL_TIME=0, TD_CC_SETTING, TD_CS_SETTING`.
- **Op-mode-request transition** (PIC `UpdateSwitches`, fires only on a *change* of the requested mode): `MODE_OFF` → `op_state=OP_OFF`, `error_state=ERR_NONE`, `sub_state=0`; `MODE_CLIMATE` → `op_state=OP_CLIMATE`, `sub_state=0`; `MODE_BATTERY` → `op_state=OP_BATTERY`, `sub_state=0`. (In the PIC, climate/battery modes enter ENGINE_START from within — M6c/d.)
- **POWER_UP timing:** enter → outputs off, statuses `ST_OFF`, `app_timer_set(SCALE_SECOND, POWER_UP_TMR, 1)` (the PIC literal is `1`; the "5 seconds" source comment is stale — preserve the literal), `app_timer_set(SCALE_MINUTE, CABIN_TEMP_WARMUP_TMR, 10)`, advance sub_state; then when `POWER_UP_TMR` expired → `op_state=OP_OFF`. (The PIC's ADC pre-reads in POWER_UP are hardware sampling — handled by the deferred `bsp_adc`, omitted here.)
- **outputs_apply mapping:** relays via `bsp_out_set(OUT_*)`; evap fan: `bsp_out_set(OUT_EVAP_FAN, out.evap_fan)` and, when on, `bsp_pwm_set(PWM_EVAP_FAN, fan_speed_permille(out.evap_speed))` else duty 0; heat: `bsp_out_set(OUT_HEAT_REVERSER, out.heat_reverse)`; condenser: `bsp_out_set(OUT_CONDENSER_FAN, out.condenser_fan)` + `bsp_pwm_set(PWM_CONDENSER_FAN, out.condenser_duty)`. Fuel pump / starter / glow plug / compressor clutch map 1:1 to their `OUT_*`.
- **Register bindings** (into M4b `mb_reg_bind`, reading/writing the module ctx): reg **10** op-mode (rw: read `mode_request`, write sets it), **17** error (ro: `error_state`), **18** oil-change (ro: `oil_change_state`), **22** engine-status (ro: `engine_op_status`), **23** control-status (ro: `control_status`), **33** temp-display (rw: `temp_display_state`, valid 0..2 else `ILLEGAL_VALUE`), **7** oil-pressure state (ro: debounced `in_oil_pressure_ok`), **8** truck-engine state (ro: debounced `in_truck_ignition`). Reg **9** (RPM port-state, raw tach) and **41** (production test) stay deferred to a later M6 sub-milestone.
- Fixed-width integers only (`<stdint.h>`/`<stdbool.h>` via `types.h`). Portable code under `App/services/` — **no HAL**. Firmware root `firmware/g0b1-apu/`. Every task ends green (`ctest`) and is committed; build is `-Wall -Wextra -Werror -funsigned-char` and must stay pristine.

### Deferred / carry-forward
- **M6b/c/d** register their mode handlers (`OP_ENGINE_START`/`OP_CLIMATE`/`OP_BATTERY`/`OP_ERROR_SHUTDOWN`) into the M6a dispatcher via `control_register_mode` — no dispatcher edits.
- reg **9** (RPM port-state) + reg **41** (production-test mode; drives outputs directly) → later M6 sub-milestone / bench.
- The concrete `bsp_*` HAL under `bsp_io`/`bsp_pwm` + the ADC sampling the PIC POWER_UP pre-reads → bench (M1 Task 1).
- `main()` superloop: `control_init` → register modes → `sched_register(SLOT_10MS, control_10ms_slot)` → run — the target-side wiring pairs with M1 Task 1.

---

### Task 1: apu_ctx_t + control enums + dispatcher (register + tick)

**Files:**
- Create: `firmware/g0b1-apu/App/services/control.h`
- Create: `firmware/g0b1-apu/App/services/control.c`
- Create: `firmware/g0b1-apu/Tests/test_control_dispatch.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Produces (`control.h`): the enums above; `apu_outputs_t`, `apu_ctx_t`; `typedef void (*control_mode_fn)(apu_ctx_t *ctx);` `void control_init(apu_ctx_t *ctx);` `void control_register_mode(control_op_state_t st, control_mode_fn fn);` `void control_tick(apu_ctx_t *ctx);`
- `control_init`: zeroes the ctx to a safe idle (`op_state=OP_POWER_UP`, `sub_state=0`, all outputs off, statuses `ST_OFF`, `error_state=ERR_NONE`, `mode_request=MODE_OFF`, inputs false) and clears the mode-handler table (module-static).
- `control_tick`: first applies the op-mode-request transition **only when `mode_request` changed since the last tick** (tracked in a module-static `s_mode_prev`), per the mapping in Global Constraints; then, if a handler is registered for `ctx->op_state`, calls it. Unregistered op_state → no-op (safe hold).

- [ ] **Step 1: Write `App/services/control.h`**

```c
#ifndef CONTROL_H
#define CONTROL_H
#include "types.h"
#include "fan_speed.h"   /* fan_speed_t for the evap-fan request */

typedef enum {
    OP_POWER_UP = 0, OP_OFF, OP_ENGINE_START, OP_CLIMATE, OP_BATTERY,
    OP_COLD_STORAGE, OP_ERROR_SHUTDOWN, OP_STATE_COUNT
} control_op_state_t;

typedef enum {
    ST_OFF = 0, ST_WARMING_UP, ST_STARTING, ST_RUNNING, ST_DEFROST,
    ST_CHARGING, ST_COOLING, ST_CHILLIN
} control_status_t;

typedef enum { MODE_OFF = 0, MODE_CLIMATE, MODE_BATTERY } op_mode_t;

typedef enum {
    ERR_NONE = 0, ERR_LOW_OIL, ERR_HIGH_ENGINE_TEMP, ERR_LOW_BATTERY,
    ERR_AC_LOW_PRESSURE, ERR_AC_HIGH_PRESSURE, ERR_STARTING_FAILURE
} control_error_t;

typedef enum {
    OIL_GOOD = 0, OIL_CHANGE_SOON, OIL_CHANGE_NEEDED, OIL_CHANGE_PAST_DUE, OIL_WARNING_DISMISSED
} oil_state_t;

typedef enum { TD_REAL_TIME = 0, TD_CC_SETTING, TD_CS_SETTING } temp_display_t;

/* Output *requests* the modes set; outputs_apply() maps them to bsp_io/bsp_pwm. */
typedef struct {
    bool fuel_pump, starter, glow_plug, compressor_clutch, heat_reverse;
    bool evap_fan;          fan_speed_t evap_speed;
    bool condenser_fan;     uint16_t condenser_duty;   /* permille */
} apu_outputs_t;

typedef struct {
    control_op_state_t op_state;
    uint8_t            sub_state;         /* per-mode state (PIC `state`) */
    apu_outputs_t      out;               /* requested outputs */
    uint8_t            engine_op_status;  /* control_status_t */
    uint8_t            control_status;    /* control_status_t */
    uint8_t            error_state;       /* control_error_t */
    uint8_t            oil_change_state;  /* oil_state_t */
    uint8_t            temp_display_state;/* temp_display_t */
    uint8_t            mode_request;      /* op_mode_t (Modbus reg 10) */
    bool               in_oil_pressure_ok;/* debounced oil pressure */
    bool               in_truck_ignition; /* debounced truck ignition */
    bool               evap_fan_always_on;/* flag2 equivalent */
} apu_ctx_t;

typedef void (*control_mode_fn)(apu_ctx_t *ctx);

void control_init(apu_ctx_t *ctx);
void control_register_mode(control_op_state_t st, control_mode_fn fn);
void control_tick(apu_ctx_t *ctx);   /* apply mode-request transition, then dispatch */

#endif /* CONTROL_H */
```

- [ ] **Step 2: Write the failing test `Tests/test_control_dispatch.c`**

```c
#include "unity.h"
#include "control.h"

static apu_ctx_t ctx;
static int s_climate_calls, s_off_calls;
static void fake_climate(apu_ctx_t *c) { (void)c; s_climate_calls++; }
static void fake_off(apu_ctx_t *c) { (void)c; s_off_calls++; }

void setUp(void) {
    control_init(&ctx);
    s_climate_calls = 0; s_off_calls = 0;
    /* fresh registration each test: OP_OFF and OP_CLIMATE handlers */
    control_register_mode(OP_OFF, fake_off);
    control_register_mode(OP_CLIMATE, fake_climate);
}
void tearDown(void) {}

static void test_init_state(void) {
    TEST_ASSERT_EQUAL_INT(OP_POWER_UP, ctx.op_state);
    TEST_ASSERT_EQUAL_UINT8(ST_OFF, ctx.control_status);
    TEST_ASSERT_EQUAL_UINT8(ERR_NONE, ctx.error_state);
    TEST_ASSERT_FALSE(ctx.out.fuel_pump);
}

static void test_dispatch_calls_registered_handler(void) {
    ctx.op_state = OP_OFF;
    control_tick(&ctx);
    TEST_ASSERT_EQUAL_INT(1, s_off_calls);
    TEST_ASSERT_EQUAL_INT(0, s_climate_calls);
}

static void test_unregistered_op_state_is_safe_hold(void) {
    ctx.op_state = OP_ENGINE_START;    /* no handler registered */
    control_tick(&ctx);                /* must not crash, no dispatch */
    TEST_ASSERT_EQUAL_INT(0, s_off_calls);
    TEST_ASSERT_EQUAL_INT(0, s_climate_calls);
}

static void test_mode_request_change_transitions_op_state(void) {
    ctx.op_state = OP_OFF;
    ctx.mode_request = MODE_CLIMATE;   /* changed from init MODE_OFF */
    control_tick(&ctx);
    TEST_ASSERT_EQUAL_INT(OP_CLIMATE, ctx.op_state);  /* transition applied */
    TEST_ASSERT_EQUAL_UINT8(0, ctx.sub_state);
    TEST_ASSERT_EQUAL_INT(1, s_climate_calls);        /* then dispatched climate */
}

static void test_mode_request_off_resets_error(void) {
    ctx.op_state = OP_CLIMATE; ctx.error_state = ERR_LOW_OIL;
    ctx.mode_request = MODE_CLIMATE; control_tick(&ctx);   /* establish prev=CLIMATE */
    ctx.mode_request = MODE_OFF;     control_tick(&ctx);
    TEST_ASSERT_EQUAL_INT(OP_OFF, ctx.op_state);
    TEST_ASSERT_EQUAL_UINT8(ERR_NONE, ctx.error_state);
}

static void test_no_transition_when_mode_unchanged(void) {
    ctx.op_state = OP_CLIMATE; ctx.mode_request = MODE_CLIMATE;
    control_tick(&ctx);                 /* prev becomes CLIMATE, dispatch climate */
    ctx.op_state = OP_ENGINE_START;     /* pretend climate handed off to engine-start */
    control_tick(&ctx);                 /* mode_request unchanged -> NO transition back */
    TEST_ASSERT_EQUAL_INT(OP_ENGINE_START, ctx.op_state);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_init_state);
    RUN_TEST(test_dispatch_calls_registered_handler);
    RUN_TEST(test_unregistered_op_state_is_safe_hold);
    RUN_TEST(test_mode_request_change_transitions_op_state);
    RUN_TEST(test_mode_request_off_resets_error);
    RUN_TEST(test_no_transition_when_mode_unchanged);
    return UNITY_END();
}
```

*Note: `control_init` must reset the module-static `s_mode_prev` to `MODE_OFF` so each test's first change is detected relative to a known baseline; the `setUp`-per-test isolation depends on it.*

- [ ] **Step 3: Register the test in `Tests/CMakeLists.txt`** (append)

```cmake
add_unity_test(test_control_dispatch test_control_dispatch.c ../App/services/control.c ../App/services/fan_speed.c)
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_dispatch --output-on-failure`
Expected: build fails — `control_*` undefined.

- [ ] **Step 5: Write `App/services/control.c`** (dispatcher; POWER_UP/OFF handlers are added in Tasks 3–4)

```c
#include "control.h"

static control_mode_fn s_mode[OP_STATE_COUNT];
static uint8_t s_mode_prev;   /* last applied mode_request, for change detection */

void control_init(apu_ctx_t *ctx) {
    for (uint8_t i = 0; i < OP_STATE_COUNT; i++) s_mode[i] = 0;
    s_mode_prev = MODE_OFF;
    ctx->op_state = OP_POWER_UP;
    ctx->sub_state = 0;
    ctx->out = (apu_outputs_t){0};
    ctx->engine_op_status = ST_OFF;
    ctx->control_status = ST_OFF;
    ctx->error_state = ERR_NONE;
    ctx->oil_change_state = OIL_GOOD;
    ctx->temp_display_state = TD_REAL_TIME;
    ctx->mode_request = MODE_OFF;
    ctx->in_oil_pressure_ok = false;
    ctx->in_truck_ignition = false;
    ctx->evap_fan_always_on = false;
}

void control_register_mode(control_op_state_t st, control_mode_fn fn) {
    if (st < OP_STATE_COUNT) s_mode[st] = fn;
}

/* PIC UpdateSwitches: on a mode-request change, jump op_state. */
static void apply_mode_request(apu_ctx_t *ctx) {
    if (ctx->mode_request == s_mode_prev) return;
    s_mode_prev = ctx->mode_request;
    switch (ctx->mode_request) {
        case MODE_OFF:     ctx->op_state = OP_OFF;     ctx->error_state = ERR_NONE; ctx->sub_state = 0; break;
        case MODE_CLIMATE: ctx->op_state = OP_CLIMATE; ctx->sub_state = 0; break;
        case MODE_BATTERY: ctx->op_state = OP_BATTERY; ctx->sub_state = 0; break;
        default:           ctx->op_state = OP_OFF;     ctx->sub_state = 0; break;
    }
}

void control_tick(apu_ctx_t *ctx) {
    apply_mode_request(ctx);
    if (ctx->op_state < OP_STATE_COUNT && s_mode[ctx->op_state]) s_mode[ctx->op_state](ctx);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_dispatch --output-on-failure`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add firmware/g0b1-apu/App/services/control.h firmware/g0b1-apu/App/services/control.c firmware/g0b1-apu/Tests/test_control_dispatch.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): control — apu_ctx_t + mode-handler dispatcher (register + tick + mode-request transition)"
```

---

### Task 2: outputs_apply — control requests → bsp_io/bsp_pwm

**Files:**
- Modify: `firmware/g0b1-apu/App/services/control.h` (add prototype)
- Create: `firmware/g0b1-apu/App/services/control_outputs.c`
- Create: `firmware/g0b1-apu/Tests/test_control_outputs.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `apu_ctx_t` (Task 1), M5 `bsp_io.h`/`bsp_pwm.h`/`fan_speed.h`, `board_pins.h`.
- Produces: `void outputs_apply(const apu_ctx_t *ctx);` — maps `ctx->out` to the BSP per the Global Constraints mapping. Evap fan off → PWM duty 0; condenser fan off → PWM duty 0.

- [ ] **Step 1: Add the prototype to `control.h`** (after `control_tick`)

```c
void outputs_apply(const apu_ctx_t *ctx);
```

- [ ] **Step 2: Write the failing test `Tests/test_control_outputs.c`**

```c
#include "unity.h"
#include "control.h"
#include "bsp_io.h"
#include "bsp_pwm.h"
#include "fan_speed.h"
#include "fake_bsp_io.h"
#include "fake_bsp_pwm.h"

static apu_ctx_t ctx;
static bsp_io_backend_t io_be;
static bsp_pwm_backend_t pwm_be;

void setUp(void) {
    fake_bsp_io_init(&io_be);   bsp_io_init(&io_be);
    fake_bsp_pwm_init(&pwm_be); bsp_pwm_init(&pwm_be);
    control_init(&ctx);
}
void tearDown(void) {}

static void test_relays_map_one_to_one(void) {
    ctx.out.fuel_pump = true; ctx.out.starter = true; ctx.out.glow_plug = true;
    ctx.out.compressor_clutch = true;
    outputs_apply(&ctx);
    TEST_ASSERT_TRUE(fake_bsp_io_out(OUT_FUEL_PUMP));
    TEST_ASSERT_TRUE(fake_bsp_io_out(OUT_STARTER));
    TEST_ASSERT_TRUE(fake_bsp_io_out(OUT_GLOW_PLUG));
    TEST_ASSERT_TRUE(fake_bsp_io_out(OUT_COMPRESSOR_CLUTCH));
    TEST_ASSERT_FALSE(fake_bsp_io_out(OUT_HEAT_REVERSER)); /* not requested */
}

static void test_heat_reverse_maps_to_heat_reverser(void) {
    ctx.out.heat_reverse = true;
    outputs_apply(&ctx);
    TEST_ASSERT_TRUE(fake_bsp_io_out(OUT_HEAT_REVERSER));  /* OI-1 */
}

static void test_evap_fan_on_sets_relay_and_pwm_duty(void) {
    ctx.out.evap_fan = true; ctx.out.evap_speed = FAN_MEDIUM;
    outputs_apply(&ctx);
    TEST_ASSERT_TRUE(fake_bsp_io_out(OUT_EVAP_FAN));
    TEST_ASSERT_EQUAL_UINT16(545, fake_bsp_pwm_duty(PWM_EVAP_FAN)); /* FAN_MEDIUM */
}

static void test_evap_fan_off_zeroes_pwm(void) {
    ctx.out.evap_fan = true; ctx.out.evap_speed = FAN_HIGH; outputs_apply(&ctx);
    ctx.out.evap_fan = false; outputs_apply(&ctx);
    TEST_ASSERT_FALSE(fake_bsp_io_out(OUT_EVAP_FAN));
    TEST_ASSERT_EQUAL_UINT16(0, fake_bsp_pwm_duty(PWM_EVAP_FAN));
}

static void test_condenser_fan_relay_and_duty(void) {
    ctx.out.condenser_fan = true; ctx.out.condenser_duty = 700;
    outputs_apply(&ctx);
    TEST_ASSERT_TRUE(fake_bsp_io_out(OUT_CONDENSER_FAN));
    TEST_ASSERT_EQUAL_UINT16(700, fake_bsp_pwm_duty(PWM_CONDENSER_FAN));
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_relays_map_one_to_one);
    RUN_TEST(test_heat_reverse_maps_to_heat_reverser);
    RUN_TEST(test_evap_fan_on_sets_relay_and_pwm_duty);
    RUN_TEST(test_evap_fan_off_zeroes_pwm);
    RUN_TEST(test_condenser_fan_relay_and_duty);
    return UNITY_END();
}
```

- [ ] **Step 3: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_control_outputs test_control_outputs.c ../App/services/control_outputs.c ../App/services/bsp_io.c ../App/services/bsp_pwm.c ../App/services/fan_speed.c fakes/fake_bsp_io.c fakes/fake_bsp_pwm.c)
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_outputs --output-on-failure`
Expected: build fails — `outputs_apply` undefined.

- [ ] **Step 5: Write `App/services/control_outputs.c`**

```c
#include "control.h"
#include "bsp_io.h"
#include "bsp_pwm.h"
#include "fan_speed.h"
#include "board_pins.h"

void outputs_apply(const apu_ctx_t *ctx) {
    const apu_outputs_t *o = &ctx->out;
    bsp_out_set(OUT_FUEL_PUMP,         o->fuel_pump);
    bsp_out_set(OUT_STARTER,           o->starter);
    bsp_out_set(OUT_GLOW_PLUG,         o->glow_plug);
    bsp_out_set(OUT_COMPRESSOR_CLUTCH, o->compressor_clutch);
    bsp_out_set(OUT_HEAT_REVERSER,     o->heat_reverse);   /* OI-1 */

    bsp_out_set(OUT_EVAP_FAN, o->evap_fan);
    bsp_pwm_set(PWM_EVAP_FAN, o->evap_fan ? fan_speed_permille(o->evap_speed) : 0u);

    bsp_out_set(OUT_CONDENSER_FAN, o->condenser_fan);
    bsp_pwm_set(PWM_CONDENSER_FAN, o->condenser_fan ? o->condenser_duty : 0u);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_outputs --output-on-failure`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add firmware/g0b1-apu/App/services/control.h firmware/g0b1-apu/App/services/control_outputs.c firmware/g0b1-apu/Tests/test_control_outputs.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): control — outputs_apply maps requests to bsp_io/bsp_pwm (evap PWM, heat-reverse, condenser)"
```

---

### Task 3: POWER_UP mode handler

**Files:**
- Modify: `firmware/g0b1-apu/App/services/control.h` (add prototype)
- Create: `firmware/g0b1-apu/App/services/control_powerup.c`
- Create: `firmware/g0b1-apu/Tests/test_control_powerup.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `apu_ctx_t` (Task 1), M5 `app_timers.h`.
- Produces: `void control_powerup_mode(apu_ctx_t *ctx);` — the POWER_UP handler (register with `control_register_mode(OP_POWER_UP, control_powerup_mode)`). sub_state 0: all outputs off, statuses `ST_OFF`, `app_timer_set(SCALE_SECOND, POWER_UP_TMR, 1)`, `app_timer_set(SCALE_MINUTE, CABIN_TEMP_WARMUP_TMR, 10)`, sub_state→1. sub_state 1: when `app_timer_expired(SCALE_SECOND, POWER_UP_TMR)` → `op_state=OP_OFF`, sub_state=0.

- [ ] **Step 1: Add the prototype to `control.h`**

```c
void control_powerup_mode(apu_ctx_t *ctx);   /* register for OP_POWER_UP */
```

- [ ] **Step 2: Write the failing test `Tests/test_control_powerup.c`**

```c
#include "unity.h"
#include "control.h"
#include "app_timers.h"

static apu_ctx_t ctx;
void setUp(void) { app_timers_init(); control_init(&ctx); ctx.op_state = OP_POWER_UP; }
void tearDown(void) {}

static void test_entry_sets_timer_and_outputs_off(void) {
    ctx.out.fuel_pump = true;                     /* pretend stale */
    control_powerup_mode(&ctx);                   /* sub_state 0 */
    TEST_ASSERT_FALSE(ctx.out.fuel_pump);
    TEST_ASSERT_EQUAL_UINT8(ST_OFF, ctx.control_status);
    TEST_ASSERT_EQUAL_UINT16(1, app_timer_get(SCALE_SECOND, POWER_UP_TMR));
    TEST_ASSERT_EQUAL_UINT16(10, app_timer_get(SCALE_MINUTE, CABIN_TEMP_WARMUP_TMR));
    TEST_ASSERT_EQUAL_UINT8(1, ctx.sub_state);
}

static void test_holds_until_timer_expires_then_off(void) {
    control_powerup_mode(&ctx);                   /* sub 0 -> sets timer=1, sub=1 */
    control_powerup_mode(&ctx);                   /* sub 1, timer still 1 -> hold */
    TEST_ASSERT_EQUAL_INT(OP_POWER_UP, ctx.op_state);
    app_timers_tick(SCALE_SECOND);                /* timer 1 -> 0 */
    control_powerup_mode(&ctx);                   /* sub 1, expired -> OFF */
    TEST_ASSERT_EQUAL_INT(OP_OFF, ctx.op_state);
    TEST_ASSERT_EQUAL_UINT8(0, ctx.sub_state);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_entry_sets_timer_and_outputs_off);
    RUN_TEST(test_holds_until_timer_expires_then_off);
    return UNITY_END();
}
```

- [ ] **Step 3: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_control_powerup test_control_powerup.c ../App/services/control_powerup.c ../App/services/app_timers.c ../App/services/fan_speed.c)
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_powerup --output-on-failure`
Expected: build fails — `control_powerup_mode` undefined.

- [ ] **Step 5: Write `App/services/control_powerup.c`**

```c
#include "control.h"
#include "app_timers.h"

void control_powerup_mode(apu_ctx_t *ctx) {
    switch (ctx->sub_state) {
        case 0:
            ctx->out = (apu_outputs_t){0};                 /* all outputs off */
            ctx->engine_op_status = ST_OFF;
            ctx->control_status = ST_OFF;
            app_timer_set(SCALE_SECOND, POWER_UP_TMR, 1);  /* PIC literal (stale "5 s" comment) */
            app_timer_set(SCALE_MINUTE, CABIN_TEMP_WARMUP_TMR, 10);
            ctx->sub_state = 1;
            break;
        case 1:
            if (app_timer_expired(SCALE_SECOND, POWER_UP_TMR)) {
                ctx->op_state = OP_OFF;
                ctx->sub_state = 0;
            }
            break;
        default:
            ctx->op_state = OP_OFF;
            ctx->sub_state = 0;
            break;
    }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_powerup --output-on-failure`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add firmware/g0b1-apu/App/services/control.h firmware/g0b1-apu/App/services/control_powerup.c firmware/g0b1-apu/Tests/test_control_powerup.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): control — POWER_UP mode (settle timer -> OFF)"
```

---

### Task 4: OFF mode handler

**Files:**
- Modify: `firmware/g0b1-apu/App/services/control.h` (add prototype)
- Create: `firmware/g0b1-apu/App/services/control_off.c`
- Create: `firmware/g0b1-apu/Tests/test_control_off.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `apu_ctx_t` (Task 1).
- Produces: `void control_off_mode(apu_ctx_t *ctx);` — the OFF handler (register with `control_register_mode(OP_OFF, control_off_mode)`). Preserves PIC `OffMode`: all outputs off, `engine_op_status=ST_OFF`, `control_status=ST_OFF`, `error_state=ERR_NONE`, `evap_fan_always_on=false`. (OFF holds until an op-mode-request change moves `op_state` — handled by the dispatcher's `apply_mode_request`, not here.)

- [ ] **Step 1: Add the prototype to `control.h`**

```c
void control_off_mode(apu_ctx_t *ctx);   /* register for OP_OFF */
```

- [ ] **Step 2: Write the failing test `Tests/test_control_off.c`**

```c
#include "unity.h"
#include "control.h"

static apu_ctx_t ctx;
void setUp(void) { control_init(&ctx); ctx.op_state = OP_OFF; }
void tearDown(void) {}

static void test_off_clears_outputs_and_error(void) {
    ctx.out.compressor_clutch = true; ctx.out.evap_fan = true;
    ctx.error_state = ERR_LOW_OIL; ctx.control_status = ST_COOLING;
    ctx.evap_fan_always_on = true;
    control_off_mode(&ctx);
    TEST_ASSERT_FALSE(ctx.out.compressor_clutch);
    TEST_ASSERT_FALSE(ctx.out.evap_fan);
    TEST_ASSERT_EQUAL_UINT8(ERR_NONE, ctx.error_state);
    TEST_ASSERT_EQUAL_UINT8(ST_OFF, ctx.control_status);
    TEST_ASSERT_EQUAL_UINT8(ST_OFF, ctx.engine_op_status);
    TEST_ASSERT_FALSE(ctx.evap_fan_always_on);
}

static void test_off_holds_op_state(void) {
    control_off_mode(&ctx);
    TEST_ASSERT_EQUAL_INT(OP_OFF, ctx.op_state);   /* no self-transition */
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_off_clears_outputs_and_error);
    RUN_TEST(test_off_holds_op_state);
    return UNITY_END();
}
```

- [ ] **Step 3: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_control_off test_control_off.c ../App/services/control_off.c ../App/services/fan_speed.c)
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_off --output-on-failure`
Expected: build fails — `control_off_mode` undefined.

- [ ] **Step 5: Write `App/services/control_off.c`**

```c
#include "control.h"

void control_off_mode(apu_ctx_t *ctx) {
    ctx->out = (apu_outputs_t){0};        /* all outputs off */
    ctx->engine_op_status = ST_OFF;
    ctx->control_status = ST_OFF;
    ctx->error_state = ERR_NONE;          /* OffMode resets all error state */
    ctx->evap_fan_always_on = false;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_off --output-on-failure`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add firmware/g0b1-apu/App/services/control.h firmware/g0b1-apu/App/services/control_off.c firmware/g0b1-apu/Tests/test_control_off.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): control — OFF mode (outputs off + error reset)"
```

---

### Task 5: Input processing + control register bindings

**Files:**
- Modify: `firmware/g0b1-apu/App/services/control.h` (add prototypes)
- Create: `firmware/g0b1-apu/App/services/control_io.c`
- Create: `firmware/g0b1-apu/Tests/test_control_io.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `apu_ctx_t` (Task 1), M5 `bsp_io.h`/`io_debounce.h`, M4b `mb_regmodel.h`.
- Produces:
  - `void control_inputs_init(apu_ctx_t *ctx);` — init two `discrete_input_t` (oil pressure, truck ignition) with `DEBOUNCE_TIME`, both `SWITCH_OPEN`.
  - `void control_inputs_service(apu_ctx_t *ctx);` — read `bsp_in_read(IN_OIL_PRESSURE)`/`bsp_in_read(IN_TRUCK_IGNITION)` through `io_debounce_service`, store the debounced states in `ctx->in_oil_pressure_ok`/`ctx->in_truck_ignition`.
  - `void control_regs_register(apu_ctx_t *ctx);` — bind regs 10/17/18/22/23/33/7/8 into the M4b register model, reading/writing the stored ctx (module-static pointer).

- [ ] **Step 1: Add prototypes to `control.h`**

```c
void control_inputs_init(apu_ctx_t *ctx);
void control_inputs_service(apu_ctx_t *ctx);
void control_regs_register(apu_ctx_t *ctx);
```

- [ ] **Step 2: Write the failing test `Tests/test_control_io.c`**

```c
#include "unity.h"
#include "control.h"
#include "bsp_io.h"
#include "io_debounce.h"
#include "mb_regmodel.h"
#include "fake_bsp_io.h"

static apu_ctx_t ctx;
static bsp_io_backend_t io_be;

void setUp(void) {
    fake_bsp_io_init(&io_be); bsp_io_init(&io_be);
    mb_reg_reset();
    control_init(&ctx);
    control_inputs_init(&ctx);
    control_regs_register(&ctx);
}
void tearDown(void) {}

static void test_debounced_oil_input_reaches_ctx_and_reg7(void) {
    fake_bsp_io_set_input(IN_OIL_PRESSURE, true);
    for (int i = 0; i < DEBOUNCE_TIME; i++) control_inputs_service(&ctx); /* 10 samples -> commit */
    TEST_ASSERT_TRUE(ctx.in_oil_pressure_ok);
    uint16_t o = 0;
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_read(7, &o));   /* reg 7 = oil-pressure state */
    TEST_ASSERT_EQUAL_UINT16(1, o);
}

static void test_truck_ignition_reg8(void) {
    fake_bsp_io_set_input(IN_TRUCK_IGNITION, true);
    for (int i = 0; i < DEBOUNCE_TIME; i++) control_inputs_service(&ctx);
    uint16_t o = 0;
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_read(8, &o));
    TEST_ASSERT_EQUAL_UINT16(1, o);
}

static void test_op_mode_reg10_rw_drives_ctx(void) {
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(10, MODE_CLIMATE));
    TEST_ASSERT_EQUAL_UINT8(MODE_CLIMATE, ctx.mode_request);
    uint16_t o = 0;
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_read(10, &o));
    TEST_ASSERT_EQUAL_UINT16(MODE_CLIMATE, o);
}

static void test_status_regs_are_read_only(void) {
    ctx.error_state = ERR_LOW_OIL; ctx.control_status = ST_COOLING; ctx.engine_op_status = ST_RUNNING;
    uint16_t o = 0;
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_read(17, &o)); TEST_ASSERT_EQUAL_UINT16(ERR_LOW_OIL, o);
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_read(22, &o)); TEST_ASSERT_EQUAL_UINT16(ST_RUNNING, o);
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_read(23, &o)); TEST_ASSERT_EQUAL_UINT16(ST_COOLING, o);
    TEST_ASSERT_EQUAL_INT(MB_EXC_ILLEGAL_ADDRESS, mb_reg_write(17, 0)); /* read-only */
    TEST_ASSERT_EQUAL_INT(MB_EXC_ILLEGAL_ADDRESS, mb_reg_write(22, 0));
}

static void test_temp_display_reg33_rw_and_range(void) {
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(33, TD_CC_SETTING));
    TEST_ASSERT_EQUAL_UINT8(TD_CC_SETTING, ctx.temp_display_state);
    TEST_ASSERT_EQUAL_INT(MB_EXC_ILLEGAL_VALUE, mb_reg_write(33, 5));  /* > TD_CS_SETTING */
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_debounced_oil_input_reaches_ctx_and_reg7);
    RUN_TEST(test_truck_ignition_reg8);
    RUN_TEST(test_op_mode_reg10_rw_drives_ctx);
    RUN_TEST(test_status_regs_are_read_only);
    RUN_TEST(test_temp_display_reg33_rw_and_range);
    return UNITY_END();
}
```

- [ ] **Step 3: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_control_io test_control_io.c ../App/services/control_io.c ../App/services/bsp_io.c ../App/services/io_debounce.c ../App/services/mb_regmodel.c fakes/fake_bsp_io.c)
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_io --output-on-failure`
Expected: build fails — `control_inputs_*`/`control_regs_register` undefined.

- [ ] **Step 5: Write `App/services/control_io.c`**

```c
#include "control.h"
#include "bsp_io.h"
#include "io_debounce.h"
#include "mb_regmodel.h"

static discrete_input_t s_oil, s_ign;
static apu_ctx_t *s_ctx;

void control_inputs_init(apu_ctx_t *ctx) {
    io_debounce_init(&s_oil, DEBOUNCE_TIME, SWITCH_OPEN);
    io_debounce_init(&s_ign, DEBOUNCE_TIME, SWITCH_OPEN);
    ctx->in_oil_pressure_ok = false;
    ctx->in_truck_ignition = false;
}

void control_inputs_service(apu_ctx_t *ctx) {
    io_debounce_service(&s_oil, bsp_in_read(IN_OIL_PRESSURE) ? SWITCH_CLOSED : SWITCH_OPEN);
    io_debounce_service(&s_ign, bsp_in_read(IN_TRUCK_IGNITION) ? SWITCH_CLOSED : SWITCH_OPEN);
    ctx->in_oil_pressure_ok = (io_debounce_state(&s_oil) == SWITCH_CLOSED);
    ctx->in_truck_ignition  = (io_debounce_state(&s_ign) == SWITCH_CLOSED);
}

/* ---- register accessors (module-static ctx) ---- */
static modbus_exc_t rd_oil(uint16_t r, uint16_t *o)   { (void)r; *o = s_ctx->in_oil_pressure_ok; return MB_EXC_NONE; }
static modbus_exc_t rd_ign(uint16_t r, uint16_t *o)   { (void)r; *o = s_ctx->in_truck_ignition;  return MB_EXC_NONE; }
static modbus_exc_t rd_mode(uint16_t r, uint16_t *o)  { (void)r; *o = s_ctx->mode_request;        return MB_EXC_NONE; }
static modbus_exc_t wr_mode(uint16_t r, uint16_t v)   { (void)r; if (v > MODE_BATTERY) return MB_EXC_ILLEGAL_VALUE; s_ctx->mode_request = (uint8_t)v; return MB_EXC_NONE; }
static modbus_exc_t rd_err(uint16_t r, uint16_t *o)   { (void)r; *o = s_ctx->error_state;         return MB_EXC_NONE; }
static modbus_exc_t rd_oilc(uint16_t r, uint16_t *o)  { (void)r; *o = s_ctx->oil_change_state;    return MB_EXC_NONE; }
static modbus_exc_t rd_eng(uint16_t r, uint16_t *o)   { (void)r; *o = s_ctx->engine_op_status;    return MB_EXC_NONE; }
static modbus_exc_t rd_ctrl(uint16_t r, uint16_t *o)  { (void)r; *o = s_ctx->control_status;      return MB_EXC_NONE; }
static modbus_exc_t rd_td(uint16_t r, uint16_t *o)    { (void)r; *o = s_ctx->temp_display_state;  return MB_EXC_NONE; }
static modbus_exc_t wr_td(uint16_t r, uint16_t v)     { (void)r; if (v > TD_CS_SETTING) return MB_EXC_ILLEGAL_VALUE; s_ctx->temp_display_state = (uint8_t)v; return MB_EXC_NONE; }

void control_regs_register(apu_ctx_t *ctx) {
    s_ctx = ctx;
    mb_reg_bind(7,  rd_oil,  0);
    mb_reg_bind(8,  rd_ign,  0);
    mb_reg_bind(10, rd_mode, wr_mode);
    mb_reg_bind(17, rd_err,  0);
    mb_reg_bind(18, rd_oilc, 0);
    mb_reg_bind(22, rd_eng,  0);
    mb_reg_bind(23, rd_ctrl, 0);
    mb_reg_bind(33, rd_td,   wr_td);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_io --output-on-failure`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add firmware/g0b1-apu/App/services/control.h firmware/g0b1-apu/App/services/control_io.c firmware/g0b1-apu/Tests/test_control_io.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): control — input debounce into ctx + control/input register bindings (regs 7,8,10,17,18,22,23,33)"
```

---

### Task 6: Scheduler wiring + end-to-end integration

**Files:**
- Modify: `firmware/g0b1-apu/App/services/control.h` (add prototypes)
- Create: `firmware/g0b1-apu/App/services/control_app.c`
- Create: `firmware/g0b1-apu/Tests/test_control_integration.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: all M6a modules + M5 `sched`.
- Produces:
  - `apu_ctx_t *control_app_ctx(void);` — accessor for the module-global ctx.
  - `void control_app_init(void);` — `control_init` the module ctx, `control_inputs_init`, register POWER_UP + OFF handlers, `control_regs_register`.
  - `void control_10ms_slot(void);` — the scheduler slot handler: `control_inputs_service(ctx)` → `control_tick(ctx)` → `outputs_apply(ctx)` on the module ctx.
- The integration test wires the fakes + M4b register model + M5 scheduler, calls `control_app_init`, `sched_register(SLOT_10MS, control_10ms_slot)`, and drives the scheduler to prove: POWER_UP→OFF via the settle timer; a reg-10 op-mode write drives OFF→OP_CLIMATE (transition reached, dispatcher holds there since climate is M6c); outputs applied.

- [ ] **Step 1: Add prototypes to `control.h`**

```c
apu_ctx_t *control_app_ctx(void);
void       control_app_init(void);
void       control_10ms_slot(void);
```

- [ ] **Step 2: Write `App/services/control_app.c`**

```c
#include "control.h"

static apu_ctx_t s_ctx;

apu_ctx_t *control_app_ctx(void) { return &s_ctx; }

void control_app_init(void) {
    control_init(&s_ctx);
    control_inputs_init(&s_ctx);
    control_register_mode(OP_POWER_UP, control_powerup_mode);
    control_register_mode(OP_OFF,      control_off_mode);
    control_regs_register(&s_ctx);
}

void control_10ms_slot(void) {
    control_inputs_service(&s_ctx);
    control_tick(&s_ctx);
    outputs_apply(&s_ctx);
}
```

- [ ] **Step 3: Write the failing test `Tests/test_control_integration.c`**

```c
#include "unity.h"
#include "control.h"
#include "sched.h"
#include "app_timers.h"
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
    sched_init();               /* also app_timers_init */
    control_app_init();
    sched_register(SLOT_10MS, control_10ms_slot);
}
void tearDown(void) {}

/* advance total_ms in 1 ms steps through the real scheduler. */
static void advance(uint16_t total_ms) {
    for (uint16_t t = 0; t < total_ms; t++) { sched_service(1); sched_run(); }
}

static void test_powerup_transitions_to_off_via_timer(void) {
    apu_ctx_t *c = control_app_ctx();
    TEST_ASSERT_EQUAL_INT(OP_POWER_UP, c->op_state);
    advance(10);                            /* first 10ms slot: sub 0 -> timer=1, sub=1 */
    TEST_ASSERT_EQUAL_INT(OP_POWER_UP, c->op_state);
    advance(1000);                          /* the 1 s POWER_UP_TMR expires */
    TEST_ASSERT_EQUAL_INT(OP_OFF, c->op_state);
}

static void test_op_mode_write_drives_off_to_climate(void) {
    advance(1100);                          /* settle into OFF */
    TEST_ASSERT_EQUAL_INT(OP_OFF, control_app_ctx()->op_state);
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(10, MODE_CLIMATE)); /* op-mode = climate */
    advance(10);                            /* next slot applies the transition */
    TEST_ASSERT_EQUAL_INT(OP_CLIMATE, control_app_ctx()->op_state);     /* reached (climate handler is M6c) */
}

static void test_off_keeps_outputs_deenergized(void) {
    advance(1100);                          /* OFF */
    TEST_ASSERT_FALSE(fake_bsp_io_out(OUT_FUEL_PUMP));
    TEST_ASSERT_FALSE(fake_bsp_io_out(OUT_COMPRESSOR_CLUTCH));
    TEST_ASSERT_EQUAL_UINT16(0, fake_bsp_pwm_duty(PWM_EVAP_FAN));
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_powerup_transitions_to_off_via_timer);
    RUN_TEST(test_op_mode_write_drives_off_to_climate);
    RUN_TEST(test_off_keeps_outputs_deenergized);
    return UNITY_END();
}
```

- [ ] **Step 4: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_control_integration test_control_integration.c \
    ../App/services/control.c ../App/services/control_outputs.c ../App/services/control_powerup.c \
    ../App/services/control_off.c ../App/services/control_io.c ../App/services/control_app.c \
    ../App/services/sched.c ../App/services/app_timers.c ../App/services/io_debounce.c \
    ../App/services/bsp_io.c ../App/services/bsp_pwm.c ../App/services/fan_speed.c \
    ../App/services/mb_regmodel.c fakes/fake_bsp_io.c fakes/fake_bsp_pwm.c)
```

- [ ] **Step 5: Run both new tests to verify they build/fail appropriately**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_integration --output-on-failure`
Expected: build fails first (until `control_app.c` compiles); once it builds, the test drives the composition. If a genuine composition bug appears, fix the offending module (not the test).

- [ ] **Step 6: Confirm it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_integration --output-on-failure`
Expected: PASS (3 tests).

- [ ] **Step 7: Run the full suite to confirm no regressions**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build --output-on-failure`
Expected: all tests pass (37 prior M1–M5 + 6 new M6a = **43 executables**), zero warnings under `-Werror`.

- [ ] **Step 8: Commit**

```bash
git add firmware/g0b1-apu/App/services/control.h firmware/g0b1-apu/App/services/control_app.c firmware/g0b1-apu/Tests/test_control_integration.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): control — app wiring + scheduler slot + end-to-end (POWER_UP->OFF->mode transition)"
```

---

## Deferred to later M6 sub-milestones / bench

- **M6b (engine start):** `control_engine_start_mode`, registered `OP_ENGINE_START`; glow-plug/starter/fuel-pump sequencing, RPM→`ST_RUNNING` detection, stall/no-RPM → `ERR_STARTING_FAILURE`. Binds reg **38** already (M4b sensors) and reg **9** (RPM port-state).
- **M6c (climate):** `control_climate_mode`, `OP_CLIMATE`; setpoint hysteresis, heat(`heat_reverse`)/cool, compressor + evap-fan speed, defrost, condenser-fan PWM ramp with head pressure (OI-2 curve). Enters `OP_ENGINE_START` when the engine isn't running.
- **M6d (battery + error):** `control_battery_mode` (`OP_BATTERY`, voltage-driven charging start/stop), `control_error_shutdown_mode` (`OP_ERROR_SHUTDOWN`), oil-change warning progression (reg 18 dismiss logic).
- **reg 41 production-test mode** (drives outputs directly) → later M6 / bench.
- **`main()` superloop + concrete HAL** under `bsp_io`/`bsp_pwm`, ADC sampling for the PIC POWER_UP pre-reads → M1 Task 1 (bench).

## Carry-forward items to confirm

- **POWER_UP settle = 1 s** (PIC literal, despite the stale "5 seconds" comment) — confirm intended duration at bench.
- The `apu_ctx_t` output/status fields cover POWER_UP+OFF; M6b/c/d may add `flag2`-equivalent booleans (e.g. `no_rpm_tmr_start`, `clmt_low_batt_tmr`) to the ctx as their logic needs them.

---

## Self-Review

**Spec coverage (§8):** shared `apu_ctx_t` replacing `flag0/1/2`+globals ✅ (Task 1); top-level `StateMachine` dispatcher ✅ (Task 1, registration table); modes request outputs → one `outputs_apply` → bsp_io/bsp_pwm ✅ (Task 2); evap-fan Low/Med/High → PWM duty ratios ✅ (Task 2, via M5 `fan_speed`); OI-1 heat=reverse/no cool output ✅ (Task 2); POWER_UP + OFF modes with preserved behavior ✅ (Tasks 3–4); debounced discrete inputs via `io_debounce` ✅ (Task 5); the preserved register contract for control/input regs ✅ (Task 5, retiring the M4b deferral); scheduler superloop cadence (10 ms control tick) ✅ (Task 6). Engine-start / climate / battery / error modes ⏸ M6b–d (documented, register into this dispatcher). Cold storage ⏸ excluded (OI-6). reg 41 ⏸ deferred (documented).

**Placeholder scan:** no TBD/TODO. The one preserved-value nuance (POWER_UP settle literal `1` vs stale "5 s" comment) is explicit and carried forward.

**Type consistency:** the enums, `apu_outputs_t`, `apu_ctx_t`, `control_mode_fn`, and `control_init`/`control_register_mode`/`control_tick` (Task 1) are used identically across `outputs_apply` (Task 2), the mode handlers (Tasks 3–4), `control_io` (Task 5), and `control_app` (Task 6). `outputs_apply` uses the M5 `OUT_*`/`PWM_*`/`fan_speed_permille` names verbatim; `control_io` uses M5 `bsp_in_read`/`io_debounce_*` and M4b `mb_reg_bind`/`modbus_exc_t` verbatim; `control_powerup` uses M5 `app_timer_*` + the `POWER_UP_TMR`/`CABIN_TEMP_WARMUP_TMR` indices verbatim. Each test's CMake dependency list compiles only the sources it exercises; the Task 6 integration test links the full M6a + M5 + M4b-regmodel set.
