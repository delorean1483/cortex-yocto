# APU Component Test — Firmware Implementation Plan (Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a guarded, host-testable diagnostic mode to the STM32 APU firmware that lets gobi-agent actuate individual outputs one at a time via three new Modbus holding registers, with entry interlocks, single-active output selection, and auto-timeout failsafes.

**Architecture:** A new `OP_DIAG` op-state owns `ctx->out` while active (so it never fights the normal mode handlers, and hardware is still driven through the single audited `outputs_apply()` path). Three registers bound like the existing control regs — `DIAG_MODE` (49, enter/exit, interlock-gated), `DIAG_OUT` (50, single-active actuate), `DIAG_STATUS` (41, energized-output bitmask) — plus two second-scale timers for the inactivity and engine-pulse failsafes. All logic lives in one new file, `App/services/control_diag.c`, host-tested with Unity.

**Tech Stack:** C11, Unity test framework (`Tests/`), CMake + ctest. Portable code under `App/services/` (no HAL). Compiled `-Wall -Wextra -Werror -funsigned-char`.

**Spec:** `docs/superpowers/specs/2026-09-01-apu-component-test-design.md`

**Repo / branch:** `g0b1-firmware`, branch `feat/stm32g0-apu-port`. Working tree for this plan: `firmware/g0b1-apu/` (paths below are relative to that directory).

## Global Constraints

- Registers are 1..52 (`MB_REG_MAX = 52`); regs 41/49/50 are in range — do **not** change `MB_REG_MAX`.
- Modbus exceptions: `MB_EXC_NONE=0`, `MB_EXC_ILLEGAL_ADDRESS=2`, `MB_EXC_ILLEGAL_VALUE=3` (`App/services/modbus_defs.h`).
- Register writers/readers have signatures `modbus_exc_t wr(uint16_t reg, uint16_t val)` / `modbus_exc_t rd(uint16_t reg, uint16_t *out)`; bind with `mb_reg_bind(reg, rd, wr)` (NULL writer = read-only). Cast unused `reg` to `(void)`.
- Output index == `bsp_out_t` enum value (`board_pins.h`): 0 `OUT_FUEL_PUMP`, 1 `OUT_STARTER`, 2 `OUT_GLOW_PLUG`, 3 `OUT_COMPRESSOR_CLUTCH`, 4 `OUT_HEAT_REVERSER`, 5 `OUT_EVAP_FAN`, 6 `OUT_CONDENSER_FAN`, 7 `OUT_COUNT`. Engine relays = indices 0,1,2.
- The `apu_outputs_t` field for Heat Reverser is `heat_reverse` (not `heat_reverser`). Fans are a bool plus a level: `evap_fan`+`evap_speed` (percent), `condenser_fan`+`condenser_duty` (permille).
- `DIAG_OUT` value encoding: `(index << 8) | state`, state 0/1.
- Timeouts: inactivity `DIAG_INACTIVITY_SEC = 10`; engine max-on cap Starter = 4 s, Fuel/Glow = 5 s.
- Interlock (refuse APU actuation): `ctx->in_truck_ignition && !ctx->standby_override` (mirrors `control_engine_start.c:111`). Entry additionally requires `op_state == OP_OFF && engine_op_status == ST_OFF && !out.fuel_pump`.
- Never block the superloop; the handler only reads timers and sets `ctx->out`.
- Build+run host tests from `firmware/g0b1-apu/`:
  ```bash
  cmake -S Tests -B Tests/build && cmake --build Tests/build
  ctest --test-dir Tests/build --output-on-failure
  ```
  Single test binary: `./Tests/build/test_control_diag` (or `ctest --test-dir Tests/build -R test_control_diag --output-on-failure`).
- Commit after each task with the whole tree building green.

---

## File Structure

- **Create** `App/services/control_diag.c` — all diagnostic-mode logic: module state (`s_ctx`, `s_active`), interlock helpers, `control_diag_mode()` handler, the three register accessors, and `control_diag_register()` (binds 49/50/41 + resets state).
- **Create** `Tests/test_control_diag.c` — Unity tests for all of the above.
- **Modify** `App/services/control.h` — add `OP_DIAG` to `control_op_state_t`; declare `control_diag_mode()` and `control_diag_register()`.
- **Modify** `App/services/app_timers.h` — add `DIAG_INACTIVITY_TMR`, `DIAG_ENGINE_TMR` to the `SCALE_SECOND` enum.
- **Modify** `App/services/control_app.c` — register the `OP_DIAG` handler and call `control_diag_register()` in `control_app_init()`.
- **Modify** `App/services/control_io.c` — `wr_mode` exits diag when a `MODE_OFF` write arrives while `op_state == OP_DIAG`.
- **Modify** `Tests/CMakeLists.txt` — add the `test_control_diag` target; add the `MODE_OFF`-exits-diag test lives in the existing `test_control_io` target (no new deps).

---

### Task 1: DIAG_MODE enter/exit + entry interlock + register 49

**Files:**
- Create: `App/services/control_diag.c`
- Create: `Tests/test_control_diag.c`
- Modify: `App/services/control.h` (add `OP_DIAG`, declarations)
- Modify: `App/services/app_timers.h` (add two `SCALE_SECOND` timer ids)
- Modify: `Tests/CMakeLists.txt` (add `test_control_diag` target)
- Test: `Tests/test_control_diag.c`

**Interfaces:**
- Produces: `void control_diag_register(apu_ctx_t *ctx)` — binds regs 49/50/41 and resets module state (`s_active = -1`). Call after `mb_reg_reset()`.
- Produces: reg 49 `DIAG_MODE` — write 1 = enter (returns `MB_EXC_ILLEGAL_VALUE` if the interlock fails; idempotent keepalive if already `OP_DIAG`), write 0 = exit, write >1 = `MB_EXC_ILLEGAL_VALUE`; read = 1 when `op_state == OP_DIAG` else 0.
- Produces: `void control_diag_mode(apu_ctx_t *ctx)` (stub in this task; filled in Tasks 2–3).

- [ ] **Step 1: Add `OP_DIAG` and declarations to `control.h`**

In `App/services/control.h`, extend the op-state enum (append before `OP_STATE_COUNT`; existing values are unchanged):

```c
typedef enum {
    OP_POWER_UP = 0, OP_OFF, OP_ENGINE_START, OP_CLIMATE, OP_BATTERY,
    OP_COLD_STORAGE, OP_ERROR_SHUTDOWN, OP_DIAG, OP_STATE_COUNT
} control_op_state_t;
```

And add these declarations near the other mode-fn declarations (after `control_error_shutdown_mode`):

```c
void control_diag_mode(apu_ctx_t *ctx);       /* register for OP_DIAG */
void control_diag_register(apu_ctx_t *ctx);   /* binds regs 49/50/41, resets state */
```

- [ ] **Step 2: Add the two diag timer ids to `app_timers.h`**

In `App/services/app_timers.h`, extend the `SCALE_SECOND` enum (append before `NUM_ONE_SECOND_TIMER`):

```c
enum { POWER_UP_TMR = 0, EVENT_INTERVAL_TMR, COMP_EVAP_DELAY_TMR, BATT_STABLE_TMR,
       COMPRESOR_OUT_TMR, FUEL_PUMP_ONOFF_TIMER, EVAP_FORCED_ON_TMR,
       DIAG_INACTIVITY_TMR, DIAG_ENGINE_TMR, NUM_ONE_SECOND_TIMER };
```

- [ ] **Step 3: Write the failing test for reg 49 enter/exit + interlock**

Create `Tests/test_control_diag.c`:

```c
#include "unity.h"
#include "mb_regmodel.h"
#include "control.h"
#include "app_timers.h"
#include "board_pins.h"

static apu_ctx_t ctx;

/* Put ctx in the exact state Component Test entry requires. */
static void ctx_ready_off(void) {
    control_init(&ctx);
    app_timers_init();
    ctx.op_state = OP_OFF;
    ctx.engine_op_status = ST_OFF;
    ctx.out.fuel_pump = false;
    ctx.in_truck_ignition = false;
    ctx.standby_override = false;
}

void setUp(void) {
    mb_reg_reset();
    ctx_ready_off();
    control_diag_register(&ctx);
}
void tearDown(void) {}

static void test_enter_from_off_ok(void) {
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(49, 1));
    TEST_ASSERT_EQUAL_INT(OP_DIAG, ctx.op_state);
    uint16_t o = 0;
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_read(49, &o));
    TEST_ASSERT_EQUAL_UINT16(1, o);
}

static void test_enter_refused_when_ignition_on(void) {
    ctx.in_truck_ignition = true;
    TEST_ASSERT_EQUAL_INT(MB_EXC_ILLEGAL_VALUE, mb_reg_write(49, 1));
    TEST_ASSERT_EQUAL_INT(OP_OFF, ctx.op_state);
}

static void test_enter_allowed_ignition_on_with_override(void) {
    ctx.in_truck_ignition = true;
    ctx.standby_override = true;
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(49, 1));
    TEST_ASSERT_EQUAL_INT(OP_DIAG, ctx.op_state);
}

static void test_enter_refused_when_not_off(void) {
    ctx.op_state = OP_CLIMATE;
    TEST_ASSERT_EQUAL_INT(MB_EXC_ILLEGAL_VALUE, mb_reg_write(49, 1));
    TEST_ASSERT_EQUAL_INT(OP_CLIMATE, ctx.op_state);
}

static void test_exit_returns_to_off(void) {
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(49, 1));
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(49, 0));
    TEST_ASSERT_EQUAL_INT(OP_OFF, ctx.op_state);
    uint16_t o = 1;
    mb_reg_read(49, &o);
    TEST_ASSERT_EQUAL_UINT16(0, o);
}

static void test_bad_mode_value_illegal(void) {
    TEST_ASSERT_EQUAL_INT(MB_EXC_ILLEGAL_VALUE, mb_reg_write(49, 2));
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_enter_from_off_ok);
    RUN_TEST(test_enter_refused_when_ignition_on);
    RUN_TEST(test_enter_allowed_ignition_on_with_override);
    RUN_TEST(test_enter_refused_when_not_off);
    RUN_TEST(test_exit_returns_to_off);
    RUN_TEST(test_bad_mode_value_illegal);
    return UNITY_END();
}
```

- [ ] **Step 4: Register the test target in `Tests/CMakeLists.txt`**

Add after the `test_control_io` line:

```cmake
add_unity_test(test_control_diag test_control_diag.c ../App/services/control_diag.c ../App/services/control.c ../App/services/app_timers.c ../App/services/mb_regmodel.c ../App/services/fan_speed.c)
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cmake -S Tests -B Tests/build && cmake --build Tests/build`
Expected: FAIL to build/link — `control_diag.c` does not exist / `control_diag_register` undefined.

- [ ] **Step 6: Implement `control_diag.c` (mode enter/exit + interlock + reg 49)**

Create `App/services/control_diag.c`:

```c
#include "control.h"
#include "app_timers.h"
#include "board_pins.h"
#include "mb_regmodel.h"

#define DIAG_INACTIVITY_SEC 10u

static apu_ctx_t *s_ctx;
static int8_t     s_active = -1;   /* -1 = none, else bsp_out_t index */

/* Refuse energizing the APU while the truck engine is on (no override). */
static bool diag_engine_gate_ok(const apu_ctx_t *ctx) {
    return !(ctx->in_truck_ignition && !ctx->standby_override);
}
static bool diag_entry_ok(const apu_ctx_t *ctx) {
    return ctx->op_state == OP_OFF
        && ctx->engine_op_status == ST_OFF
        && !ctx->out.fuel_pump
        && diag_engine_gate_ok(ctx);
}

static void diag_enter(apu_ctx_t *ctx) {
    control_deenergize_all(ctx);
    s_active = -1;
    ctx->op_state = OP_DIAG;
    app_timer_set(SCALE_SECOND, DIAG_INACTIVITY_TMR, DIAG_INACTIVITY_SEC);
}
static void diag_exit(apu_ctx_t *ctx) {
    control_deenergize_all(ctx);
    s_active = -1;
    ctx->op_state = OP_OFF;
}

static modbus_exc_t rd_diag_mode(uint16_t r, uint16_t *o) {
    (void)r; *o = (s_ctx->op_state == OP_DIAG) ? 1u : 0u; return MB_EXC_NONE;
}
static modbus_exc_t wr_diag_mode(uint16_t r, uint16_t v) {
    (void)r;
    if (v == 0u) { diag_exit(s_ctx); return MB_EXC_NONE; }
    if (v != 1u) return MB_EXC_ILLEGAL_VALUE;
    if (s_ctx->op_state == OP_DIAG) {   /* keepalive */
        app_timer_set(SCALE_SECOND, DIAG_INACTIVITY_TMR, DIAG_INACTIVITY_SEC);
        return MB_EXC_NONE;
    }
    if (!diag_entry_ok(s_ctx)) return MB_EXC_ILLEGAL_VALUE;
    diag_enter(s_ctx);
    return MB_EXC_NONE;
}

/* Filled in Task 2. */
static modbus_exc_t wr_diag_out(uint16_t r, uint16_t v) { (void)r; (void)v; return MB_EXC_ILLEGAL_VALUE; }
static modbus_exc_t rd_diag_status(uint16_t r, uint16_t *o) { (void)r; *o = 0u; return MB_EXC_NONE; }

void control_diag_register(apu_ctx_t *ctx) {
    s_ctx = ctx;
    s_active = -1;
    mb_reg_bind(49, rd_diag_mode,   wr_diag_mode);
    mb_reg_bind(50, 0,              wr_diag_out);
    mb_reg_bind(41, rd_diag_status, 0);
}

/* Filled in Tasks 2–3. */
void control_diag_mode(apu_ctx_t *ctx) { (void)ctx; }
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cmake --build Tests/build && ctest --test-dir Tests/build -R test_control_diag --output-on-failure`
Expected: PASS (6 tests).

- [ ] **Step 8: Commit**

```bash
git add App/services/control_diag.c App/services/control.h App/services/app_timers.h Tests/test_control_diag.c Tests/CMakeLists.txt
git commit -m "feat(diag): OP_DIAG enter/exit + entry interlock (reg 49)"
```

---

### Task 2: DIAG_OUT single-active actuation + engine gate + DIAG_STATUS bitmask + handler

**Files:**
- Modify: `App/services/control_diag.c` (fill `wr_diag_out`, `rd_diag_status`, `control_diag_mode`; add apply/helpers)
- Test: `Tests/test_control_diag.c` (add cases)

**Interfaces:**
- Consumes: `control_diag_register`, `diag_entry_ok`/`diag_engine_gate_ok`, `s_active` (Task 1).
- Produces: reg 50 `DIAG_OUT` writer — value `(index<<8)|state`; honored only in `OP_DIAG` (else `ILLEGAL_VALUE`); `index >= OUT_COUNT` → `ILLEGAL_VALUE`; engine index (0/1/2) with the gate failing → `ILLEGAL_VALUE`; `state==1` sets single-active, `state==0` clears if it is the active one.
- Produces: reg 41 `DIAG_STATUS` reader — bitmask `(1u << s_active)` when in `OP_DIAG` and `s_active >= 0`, else 0.
- Produces: `control_diag_mode()` applies the single active output to `ctx->out` each tick (starting from de-energized).

- [ ] **Step 1: Write the failing tests (append to `Tests/test_control_diag.c`)**

Add these test functions and their `RUN_TEST` lines in `main()`:

```c
static void test_out_refused_when_not_in_diag(void) {
    /* not entered */
    TEST_ASSERT_EQUAL_INT(MB_EXC_ILLEGAL_VALUE, mb_reg_write(50, (OUT_CONDENSER_FAN << 8) | 1));
}

static void test_low_risk_energize_sets_output_and_status(void) {
    mb_reg_write(49, 1);
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(50, (OUT_CONDENSER_FAN << 8) | 1));
    control_diag_mode(&ctx);
    TEST_ASSERT_TRUE(ctx.out.condenser_fan);
    TEST_ASSERT_EQUAL_UINT16(1000, ctx.out.condenser_duty);
    uint16_t o = 0;
    mb_reg_read(41, &o);
    TEST_ASSERT_EQUAL_UINT16((1u << OUT_CONDENSER_FAN), o);
}

static void test_single_active_releases_previous(void) {
    mb_reg_write(49, 1);
    mb_reg_write(50, (OUT_CONDENSER_FAN << 8) | 1);
    control_diag_mode(&ctx);
    TEST_ASSERT_TRUE(ctx.out.condenser_fan);
    mb_reg_write(50, (OUT_HEAT_REVERSER << 8) | 1);
    control_diag_mode(&ctx);
    TEST_ASSERT_FALSE(ctx.out.condenser_fan);
    TEST_ASSERT_TRUE(ctx.out.heat_reverse);
    uint16_t o = 0;
    mb_reg_read(41, &o);
    TEST_ASSERT_EQUAL_UINT16((1u << OUT_HEAT_REVERSER), o);
}

static void test_off_clears_active(void) {
    mb_reg_write(49, 1);
    mb_reg_write(50, (OUT_EVAP_FAN << 8) | 1);
    control_diag_mode(&ctx);
    TEST_ASSERT_TRUE(ctx.out.evap_fan);
    mb_reg_write(50, (OUT_EVAP_FAN << 8) | 0);
    control_diag_mode(&ctx);
    TEST_ASSERT_FALSE(ctx.out.evap_fan);
    uint16_t o = 9;
    mb_reg_read(41, &o);
    TEST_ASSERT_EQUAL_UINT16(0, o);
}

static void test_index_out_of_range_illegal(void) {
    mb_reg_write(49, 1);
    TEST_ASSERT_EQUAL_INT(MB_EXC_ILLEGAL_VALUE, mb_reg_write(50, (OUT_COUNT << 8) | 1));
}

static void test_engine_relay_refused_when_ignition_on(void) {
    mb_reg_write(49, 1);
    ctx.in_truck_ignition = true;   /* becomes true after entry */
    TEST_ASSERT_EQUAL_INT(MB_EXC_ILLEGAL_VALUE, mb_reg_write(50, (OUT_STARTER << 8) | 1));
}

static void test_engine_relay_allowed_when_off(void) {
    mb_reg_write(49, 1);
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(50, (OUT_STARTER << 8) | 1));
    control_diag_mode(&ctx);
    TEST_ASSERT_TRUE(ctx.out.starter);
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cmake --build Tests/build && ctest --test-dir Tests/build -R test_control_diag --output-on-failure`
Expected: FAIL — `DIAG_OUT` stubbed to `ILLEGAL_VALUE` / handler does nothing.

- [ ] **Step 3: Implement actuation in `control_diag.c`**

Replace the Task-1 stubs (`wr_diag_out`, `rd_diag_status`, `control_diag_mode`) and add helpers:

```c
static bool diag_is_engine(int8_t idx) { return idx >= 0 && idx <= OUT_GLOW_PLUG; }

/* Map the single active output onto ctx->out (called from de-energized state). */
static void diag_apply_active(apu_ctx_t *ctx) {
    switch (s_active) {
        case OUT_FUEL_PUMP:         ctx->out.fuel_pump = true; break;
        case OUT_STARTER:           ctx->out.starter = true; break;
        case OUT_GLOW_PLUG:         ctx->out.glow_plug = true; break;
        case OUT_COMPRESSOR_CLUTCH: ctx->out.compressor_clutch = true; break;
        case OUT_HEAT_REVERSER:     ctx->out.heat_reverse = true; break;
        case OUT_EVAP_FAN:          ctx->out.evap_fan = true; ctx->out.evap_speed = 100u; break;
        case OUT_CONDENSER_FAN:     ctx->out.condenser_fan = true; ctx->out.condenser_duty = 1000u; break;
        default: break;
    }
}

static modbus_exc_t rd_diag_status(uint16_t r, uint16_t *o) {
    (void)r;
    *o = (s_ctx->op_state == OP_DIAG && s_active >= 0) ? (uint16_t)(1u << s_active) : 0u;
    return MB_EXC_NONE;
}

static modbus_exc_t wr_diag_out(uint16_t r, uint16_t v) {
    (void)r;
    if (s_ctx->op_state != OP_DIAG) return MB_EXC_ILLEGAL_VALUE;
    uint8_t idx   = (uint8_t)(v >> 8);
    uint8_t state = (uint8_t)(v & 0xFFu);
    if (idx >= OUT_COUNT) return MB_EXC_ILLEGAL_VALUE;
    if (diag_is_engine((int8_t)idx) && !diag_engine_gate_ok(s_ctx)) return MB_EXC_ILLEGAL_VALUE;
    if (state) {
        s_active = (int8_t)idx;
        if (diag_is_engine(s_active))
            app_timer_set(SCALE_SECOND, DIAG_ENGINE_TMR, (s_active == OUT_STARTER) ? 4u : 5u);
    } else if (s_active == (int8_t)idx) {
        s_active = -1;
    }
    app_timer_set(SCALE_SECOND, DIAG_INACTIVITY_TMR, DIAG_INACTIVITY_SEC);
    return MB_EXC_NONE;
}

void control_diag_mode(apu_ctx_t *ctx) {
    control_deenergize_all(ctx);   /* single-active: clear, then apply the one */
    diag_apply_active(ctx);
}
```

Also delete the two Task-1 placeholder stubs of `wr_diag_out`/`rd_diag_status` and the empty `control_diag_mode` so only these definitions remain.

- [ ] **Step 4: Run to verify pass**

Run: `cmake --build Tests/build && ctest --test-dir Tests/build -R test_control_diag --output-on-failure`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add App/services/control_diag.c Tests/test_control_diag.c
git commit -m "feat(diag): single-active DIAG_OUT + engine gate + DIAG_STATUS (regs 50/41)"
```

---

### Task 3: Auto-timeout failsafes (inactivity exit + engine-pulse cap)

**Files:**
- Modify: `App/services/control_diag.c` (`control_diag_mode` checks the timers)
- Test: `Tests/test_control_diag.c` (add cases)

**Interfaces:**
- Consumes: `DIAG_INACTIVITY_TMR`, `DIAG_ENGINE_TMR`, `diag_is_engine`, `diag_exit` (Tasks 1–2).
- Produces: `control_diag_mode()` — on inactivity-timer expiry, `deenergize_all` + return to `OP_OFF`; on engine-pulse-timer expiry while an engine relay is active, drop that relay but stay in diag.

- [ ] **Step 1: Write the failing tests (append to `Tests/test_control_diag.c`)**

```c
/* Helper: advance the second-scale timers by n seconds. */
static void tick_seconds(int n) { for (int i = 0; i < n; i++) app_timers_tick(SCALE_SECOND); }

static void test_inactivity_timeout_exits(void) {
    mb_reg_write(49, 1);
    mb_reg_write(50, (OUT_CONDENSER_FAN << 8) | 1);
    control_diag_mode(&ctx);
    TEST_ASSERT_TRUE(ctx.out.condenser_fan);
    tick_seconds(10);                 /* inactivity was 10 s */
    control_diag_mode(&ctx);
    TEST_ASSERT_EQUAL_INT(OP_OFF, ctx.op_state);
    TEST_ASSERT_FALSE(ctx.out.condenser_fan);
}

static void test_out_write_refreshes_inactivity(void) {
    mb_reg_write(49, 1);
    mb_reg_write(50, (OUT_HEAT_REVERSER << 8) | 1);
    tick_seconds(9);
    mb_reg_write(50, (OUT_HEAT_REVERSER << 8) | 1);   /* heartbeat resets to 10 */
    tick_seconds(9);
    control_diag_mode(&ctx);
    TEST_ASSERT_EQUAL_INT(OP_DIAG, ctx.op_state);      /* still alive */
    TEST_ASSERT_TRUE(ctx.out.heat_reverse);
}

static void test_engine_pulse_cap_drops_relay_but_stays(void) {
    mb_reg_write(49, 1);
    mb_reg_write(50, (OUT_STARTER << 8) | 1);          /* cap 4 s */
    control_diag_mode(&ctx);
    TEST_ASSERT_TRUE(ctx.out.starter);
    tick_seconds(4);
    control_diag_mode(&ctx);
    TEST_ASSERT_FALSE(ctx.out.starter);                /* dropped */
    TEST_ASSERT_EQUAL_INT(OP_DIAG, ctx.op_state);      /* mode still active */
}
```

Add the three `RUN_TEST` lines to `main()`.

- [ ] **Step 2: Run to verify failure**

Run: `cmake --build Tests/build && ctest --test-dir Tests/build -R test_control_diag --output-on-failure`
Expected: FAIL — handler ignores the timers.

- [ ] **Step 3: Add the timer checks to `control_diag_mode`**

Replace `control_diag_mode` in `App/services/control_diag.c`:

```c
void control_diag_mode(apu_ctx_t *ctx) {
    if (app_timer_expired(SCALE_SECOND, DIAG_INACTIVITY_TMR)) { diag_exit(ctx); return; }
    if (diag_is_engine(s_active) && app_timer_expired(SCALE_SECOND, DIAG_ENGINE_TMR))
        s_active = -1;
    control_deenergize_all(ctx);
    diag_apply_active(ctx);
}
```

Note: on entry (Task 1) `DIAG_INACTIVITY_TMR` is set to 10 so it is non-zero (not expired) until 10 ticks elapse.

- [ ] **Step 4: Run to verify pass**

Run: `cmake --build Tests/build && ctest --test-dir Tests/build -R test_control_diag --output-on-failure`
Expected: PASS (16 tests).

- [ ] **Step 5: Commit**

```bash
git add App/services/control_diag.c Tests/test_control_diag.c
git commit -m "feat(diag): inactivity-exit + engine-pulse-cap failsafes"
```

---

### Task 4: Wire into app init + reg-10 MODE_OFF kill-switch

**Files:**
- Modify: `App/services/control_app.c` (register `OP_DIAG` handler + `control_diag_register`)
- Modify: `App/services/control_io.c` (`wr_mode` exits diag on `MODE_OFF`)
- Test: `Tests/test_control_io.c` (add MODE_OFF-exits-diag test — uses `control.c` only, already linked)

**Interfaces:**
- Consumes: `control_diag_register`, `control_diag_mode`, `OP_DIAG` (Tasks 1–3), `control_deenergize_all` (`control.c`).
- Produces: `control_app_init()` registers `OP_DIAG` and binds the diag regs; a `reg10 = MODE_OFF` write while in `OP_DIAG` de-energizes and returns to `OP_OFF`.

- [ ] **Step 1: Wire `control_app_init` in `control_app.c`**

Add the handler registration (after the `OP_ERROR_SHUTDOWN` line) and the register bind (after `control_regs_register`):

```c
    control_register_mode(OP_ERROR_SHUTDOWN, control_error_shutdown_mode);
    control_register_mode(OP_DIAG, control_diag_mode);
    control_regs_register(&s_ctx);
    control_diag_register(&s_ctx);
```

- [ ] **Step 2: Write the failing MODE_OFF-exit test in `Tests/test_control_io.c`**

Add this test and its `RUN_TEST` line (the file already sets up `control_regs_register`; mirror its existing `setUp`). It exercises only `control.c` symbols, so no new link deps:

```c
static void test_mode_off_exits_diag(void) {
    /* g_ctx is the fixture ctx used by the existing tests in this file. */
    g_ctx.op_state = OP_DIAG;
    g_ctx.out.compressor_clutch = true;
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(10, MODE_OFF));
    TEST_ASSERT_EQUAL_INT(OP_OFF, g_ctx.op_state);
    TEST_ASSERT_FALSE(g_ctx.out.compressor_clutch);
}
```

(Use whatever the fixture ctx is named in `test_control_io.c`; read the file's `setUp` first and match it.)

- [ ] **Step 3: Run to verify failure**

Run: `cmake --build Tests/build && ctest --test-dir Tests/build -R test_control_io --output-on-failure`
Expected: FAIL — `wr_mode` does not exit diag, `op_state` stays `OP_DIAG`.

- [ ] **Step 4: Add the kill-switch to `wr_mode` in `control_io.c`**

Modify `wr_mode` (uses only `control.h` symbols already available in this file):

```c
static modbus_exc_t wr_mode(uint16_t r, uint16_t v) {
    (void)r;
    if (v > MODE_BATTERY) return MB_EXC_ILLEGAL_VALUE;
    if (v == MODE_OFF && s_ctx->op_state == OP_DIAG) {
        control_deenergize_all(s_ctx);
        s_ctx->op_state = OP_OFF;
    }
    s_ctx->mode_request = (uint8_t)v;
    return MB_EXC_NONE;
}
```

- [ ] **Step 5: Run to verify pass, and run the whole suite**

Run: `cmake --build Tests/build && ctest --test-dir Tests/build --output-on-failure`
Expected: PASS — `test_control_io`, `test_control_diag`, and every pre-existing test green.

- [ ] **Step 6: Commit**

```bash
git add App/services/control_app.c App/services/control_io.c Tests/test_control_io.c
git commit -m "feat(diag): register OP_DIAG in app init + reg-10 MODE_OFF kill-switch"
```

---

### Task 5: End-to-end integration check + register-map doc

**Files:**
- Modify: `Tests/test_control_integration.c` (add one end-to-end diag case; the target already links `control_app.c`, `control_diag.c` must be added)
- Modify: `Tests/CMakeLists.txt` (add `../App/services/control_diag.c` to `test_control_integration` and the other targets that link `control_app.c`)
- Create: `docs/g0b1-modbus-diag-registers.md` (the shared register-map contract)

**Interfaces:**
- Consumes: everything above, driven through the real `control_app_init()` / `control_10ms_slot()` path.

- [ ] **Step 1: Add `control_diag.c` to the integration link lines**

In `Tests/CMakeLists.txt`, every `add_unity_test` target whose source list includes `../App/services/control_app.c` must also list `../App/services/control_diag.c` (otherwise `control_diag_mode`/`control_diag_register` are undefined). Those targets are: `test_control_integration`, `test_control_engine_start_integration`, `test_control_climate_integration`, `test_control_battery_integration`, `test_control_runtime_integration`. Add `../App/services/control_diag.c` to each.

- [ ] **Step 2: Write the failing end-to-end test in `Tests/test_control_integration.c`**

Add (matching the file's existing setUp that calls `control_app_init()`):

```c
static void test_diag_end_to_end(void) {
    apu_ctx_t *c = control_app_ctx();
    /* land in OFF, engine stopped, ignition off */
    c->op_state = OP_OFF; c->engine_op_status = ST_OFF;
    c->out.fuel_pump = false; c->in_truck_ignition = false; c->standby_override = false;

    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(49, 1));
    TEST_ASSERT_EQUAL_INT(OP_DIAG, c->op_state);
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(50, (OUT_CONDENSER_FAN << 8) | 1));
    control_10ms_slot();                         /* dispatches OP_DIAG -> outputs_apply */
    uint16_t o = 0; mb_reg_read(41, &o);
    TEST_ASSERT_EQUAL_UINT16((1u << OUT_CONDENSER_FAN), o);
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(49, 0));
    TEST_ASSERT_EQUAL_INT(OP_OFF, c->op_state);
}
```

Add the `RUN_TEST` line. (Include `board_pins.h` in the test file if not already.)

- [ ] **Step 3: Run to verify failure, then it links + passes after Step 1**

Run: `cmake -S Tests -B Tests/build && cmake --build Tests/build`
Expected first: FAIL to link until Step 1's `control_diag.c` additions are in. With Step 1 applied, build succeeds; run:
`ctest --test-dir Tests/build -R test_control_integration --output-on-failure` → the new case FAILs only if wiring is wrong; expected PASS.

- [ ] **Step 4: Write the register-map contract doc**

Create `docs/g0b1-modbus-diag-registers.md`:

```markdown
# APU Component Test — Modbus register contract

Shared between g0b1-firmware (server) and cortex-yocto gobi-agent (master).
Slave id 1, holding registers, FC 0x03 read / 0x06 write.

| reg | name | dir | encoding / meaning |
|-----|------|-----|--------------------|
| 49 | DIAG_MODE   | R/W | write 1=enter (interlock-gated; refused -> ILLEGAL_VALUE), 0=exit. read=1 in diag else 0 |
| 50 | DIAG_OUT    | W   | value=(index<<8)\|state; index 0..6 = OUT_* order; honored only in diag; engine idx 0/1/2 gated |
| 41 | DIAG_STATUS | R   | bitmask, bit i = output i energized (single bit at most) |

Output index: 0 Fuel Pump, 1 Starter, 2 Glow Plug, 3 Compressor Clutch,
4 Heat Reverser, 5 Evap Fan, 6 Condenser Fan. Engine relays (0/1/2) require
engine off + ignition off (or standby-override). Timeouts: 10 s inactivity
drop-all + exit; engine max-on Starter 4 s / Fuel·Glow 5 s. Old firmware:
reg 49 unbound -> ILLEGAL_ADDRESS (graceful degrade).
```

- [ ] **Step 5: Run the full suite + commit**

Run: `ctest --test-dir Tests/build --output-on-failure`
Expected: entire suite PASS.

```bash
git add Tests/test_control_integration.c Tests/CMakeLists.txt docs/g0b1-modbus-diag-registers.md
git commit -m "test(diag): end-to-end via control_app + register-map contract doc"
```

---

## Self-Review

- **Spec coverage:** OP_DIAG op-state (Task 1,4) · reg 49/50/41 (Tasks 1,2) · entry interlock (Task 1) · single-active + engine gate (Task 2) · inactivity + engine-pulse timeouts (Task 3) · reg-10 MODE_OFF exit (Task 4) · graceful-degradation (unbound reg → ILLEGAL_ADDRESS, verified behaviorally by `mb_regmodel` semantics; documented Task 5) · shared register-map contract (Task 5). Boot safe-off / IWDG are unchanged by design (no task needed). Fan-at-100% encoded in `diag_apply_active` (Task 2).
- **Placeholder scan:** none — every step has concrete C and exact build/test commands. The Task-1 `wr_diag_out`/`rd_diag_status`/`control_diag_mode` are explicitly labelled stubs replaced in Task 2/3.
- **Type consistency:** `control_diag_register`/`control_diag_mode` signatures match `control.h` declarations; `mb_reg_bind(reg, rd, wr)` argument order matches `mb_regmodel.h`; `heat_reverse`/`evap_speed`/`condenser_duty` match `apu_outputs_t`; `OUT_*` indices match `board_pins.h`; exception constants match `modbus_defs.h`; timer ids added to the `SCALE_SECOND` group used with `app_timer_set/expired(SCALE_SECOND, …)`.
