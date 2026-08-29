# STM32G0 APU Port — Milestone 6e: Runtime Hours + Oil-Change Warnings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the PIC `Do_1minute` runtime-accounting behavior — accumulate machine/engine/oil-change runtime hours into NVM once per hour, and raise oil-change warnings from the accumulated oil hours — as a background routine on a new 1-minute scheduler slot. Completes the software port of the PIC application behavior.

**Architecture:** A new `control_runtime.c` with `control_service_runtime(apu_ctx_t *ctx)` (minute accumulation + saturating single-word NVM hour bump) and `control_oil_change_check(apu_ctx_t *ctx)` (threshold/dismissal/re-warn state machine), called by a new `control_1min_slot()` in `control_app.c` registered on the M5 `SLOT_1MIN`. No new control mode, no dispatcher change. Reg 18 (`oil_change_state`) becomes read/write so the display can dismiss the warning.

**Tech Stack:** C11, CMake + Unity (host). Reuses M6a `control` (ctx, `oil_change_state`/reg 18, `control_io`, `control_app`), M5 `app_timers` (`NEXT_OIL_WARNING_TMR`, `sched` `SLOT_1MIN`), M2 `nvm` (counter words), M4b register model (regs 11/20/21 already read the words).

**Design spec:** `docs/superpowers/specs/2026-08-14-stm32g0-apu-milestone6e-runtime-oil-design.md`. Source of truth: PIC `main.c` `Do_1minute` (~L1107–1188), `main.h` oil constants + `oil_message_state_list`.

## Global Constraints

- **Behavior preserved faithfully** (same thresholds, timings, structure), restructured into `apu_ctx_t` + M5/M2 services.
- **Single 16-bit saturating word per counter** — NO multi-word carry chain, no `_END` symbols. Each of `MACHINE_RUNTIME_START`(10), `ENGINE_RUNTIME_START`(12), `ENGINE_OILTIME_START`(14) is one NVM word, bumped per hour, **saturating at 65535** (`if (w < 65535u) w++`), no wrap.
- **Accumulation cadence:** machine hours accumulate always (every minute); engine + oil hours accumulate only while `ctx->out.fuel_pump`. Each minute-accumulator rolls over at 60 → reset to 0 + bump its NVM word. On the **oil** rollover, call `control_oil_change_check`.
- **Oil-change constants** (PIC `main.h`): `HOURS_OIL_CHANGE_SOON = 500`, `HOURS_OIL_CHANGE_NOW = 580`, `HOURS_OIL_CHANGE_MISSED = 700`. Re-warn reload: `1200` min (20 hr) for SOON/NEEDED, `300` min (5 hr) for PAST_DUE. Timer index `NEXT_OIL_WARNING_TMR` on `SCALE_MINUTE` (auto-decremented by sched; `app_timer_expired` true when == 0).
- **`oil_state_t`** (existing, control.h): `OIL_GOOD=0, OIL_CHANGE_SOON=1, OIL_CHANGE_NEEDED=2, OIL_CHANGE_PAST_DUE=3, OIL_WARNING_DISMISSED=4`.
- **Reg 18 read/write:** add `wr_oilc` validated `v > OIL_WARNING_DISMISSED → MB_EXC_ILLEGAL_VALUE`, rebind `mb_reg_bind(18, rd_oilc, wr_oilc)`.
- **New ctx fields:** `uint8_t machine_run_min;`, `uint8_t engine_run_min;`, `uint8_t engine_oil_min;` (internal minute accumulators; reset to 0 in `control_init`).
- No new `apu_outputs_t`, no new enum/error codes, no NVM-map change. Fixed-width integers only. Portable code under `App/services/` — no HAL. Firmware root `firmware/g0b1-apu/`. Every task ends green (`ctest`) and is committed; build is `-Wall -Wextra -Werror -funsigned-char` and must stay pristine.

### Deferred / carry-forward
- Multi-word counter chain (>65535 hr) — not ported (single-word chosen).
- Runtime oil-timer reset on service (PIC resets `ENGINE_OILTIME` only on factory-init) — a "reset oil hours" command deferred to bench/HMI.
- Display-side re-warn cadence + the actual dismissal write — validated on the real display at bench; M6e provides reg-18 writability + the state machine.
- `OP_COLD_STORAGE` remains descoped (OI-6).

---

### Task 1: apu_ctx_t runtime fields + init resets

**Files:**
- Modify: `firmware/g0b1-apu/App/services/control.h` (extend `apu_ctx_t`)
- Modify: `firmware/g0b1-apu/App/services/control.c` (reset new fields in `control_init`)
- Create: `firmware/g0b1-apu/Tests/test_control_ctx_rt.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Produces (`control.h`): `apu_ctx_t` gains `uint8_t machine_run_min;`, `uint8_t engine_run_min;`, `uint8_t engine_oil_min;`.
- `control_init` resets all three to 0.

- [ ] **Step 1: Extend `apu_ctx_t` in `control.h`** — add before the closing brace (after the M6d `batt_monitor_setting;` field):

```c
    /* --- M6e runtime hours --- */
    uint8_t  machine_run_min;          /* minutes since last machine-hour rollover */
    uint8_t  engine_run_min;           /* minutes since last engine-hour rollover (fuel on) */
    uint8_t  engine_oil_min;           /* minutes since last oil-hour rollover (fuel on) */
```

- [ ] **Step 2: Write the failing test `Tests/test_control_ctx_rt.c`** (poison ctx to non-zero before `control_init`, per the M6d reset-test lesson, so the resets are a real regression check)

```c
#include "unity.h"
#include "control.h"
#include <string.h>

static apu_ctx_t ctx;
void setUp(void) { memset(&ctx, 0xFF, sizeof(ctx)); control_init(&ctx); }
void tearDown(void) {}

static void test_init_resets_runtime_fields(void) {
    TEST_ASSERT_EQUAL_UINT8(0, ctx.machine_run_min);
    TEST_ASSERT_EQUAL_UINT8(0, ctx.engine_run_min);
    TEST_ASSERT_EQUAL_UINT8(0, ctx.engine_oil_min);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_init_resets_runtime_fields);
    return UNITY_END();
}
```

- [ ] **Step 3: Register the test in `Tests/CMakeLists.txt`** (append; link `control.c` + `fan_speed.c`)

```cmake
add_unity_test(test_control_ctx_rt test_control_ctx_rt.c ../App/services/control.c ../App/services/fan_speed.c)
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_ctx_rt --output-on-failure`
Expected: build fails — new ctx fields undefined.

- [ ] **Step 5: Add the field resets to `control_init` in `control.c`** (after `ctx->batt_monitor_setting = 0;`)

```c
    ctx->machine_run_min = 0;
    ctx->engine_run_min = 0;
    ctx->engine_oil_min = 0;
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_ctx_rt --output-on-failure`
Expected: PASS (1 test). Run the full suite too (expect 57 executables green: 56 prior + 1 new).

- [ ] **Step 7: Commit**

```bash
git add firmware/g0b1-apu/App/services/control.h firmware/g0b1-apu/App/services/control.c firmware/g0b1-apu/Tests/test_control_ctx_rt.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): control — apu_ctx_t runtime-minute fields + init resets"
```

---

### Task 2: Reg 18 (oil_change_state) read/write

**Files:**
- Modify: `firmware/g0b1-apu/App/services/control_io.c` (add `wr_oilc`, rebind reg 18)
- Create: `firmware/g0b1-apu/Tests/test_control_reg18.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Modifies `control_regs_register` so reg 18 is `mb_reg_bind(18, rd_oilc, wr_oilc)`. `wr_oilc` writes `oil_change_state`, rejecting `> OIL_WARNING_DISMISSED` with `MB_EXC_ILLEGAL_VALUE`.

- [ ] **Step 1: Write the failing test `Tests/test_control_reg18.c`** (models the M6b reg-32 round-trip test)

```c
#include "unity.h"
#include "control.h"
#include "mb_regmodel.h"

static apu_ctx_t ctx;
void setUp(void) { mb_reg_reset(); control_init(&ctx); control_regs_register(&ctx); }
void tearDown(void) {}

static void test_reg18_write_dismissed(void) {
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(18, OIL_WARNING_DISMISSED));
    TEST_ASSERT_EQUAL_UINT8(OIL_WARNING_DISMISSED, ctx.oil_change_state);
    uint16_t o = 0;
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_read(18, &o));
    TEST_ASSERT_EQUAL_UINT16(OIL_WARNING_DISMISSED, o);
}

static void test_reg18_write_out_of_range_rejected(void) {
    TEST_ASSERT_EQUAL_INT(MB_EXC_ILLEGAL_VALUE, mb_reg_write(18, OIL_WARNING_DISMISSED + 1));
    TEST_ASSERT_EQUAL_UINT8(OIL_GOOD, ctx.oil_change_state);   /* unchanged from init */
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_reg18_write_dismissed);
    RUN_TEST(test_reg18_write_out_of_range_rejected);
    return UNITY_END();
}
```

- [ ] **Step 2: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_control_reg18 test_control_reg18.c ../App/services/control_io.c ../App/services/control.c ../App/services/mb_regmodel.c ../App/services/fan_speed.c)
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_reg18 --output-on-failure`
Expected: FAIL — reg 18 write returns an exception (no writer bound), so `test_reg18_write_dismissed` fails on the first assert.

- [ ] **Step 4: Add `wr_oilc` + rebind in `control_io.c`** — add the accessor near the other `wr_*` statics:

```c
static modbus_exc_t wr_oilc(uint16_t r, uint16_t v) { (void)r; if (v > OIL_WARNING_DISMISSED) return MB_EXC_ILLEGAL_VALUE; s_ctx->oil_change_state = (uint8_t)v; return MB_EXC_NONE; }
```
and change the reg-18 bind in `control_regs_register` from `mb_reg_bind(18, rd_oilc, 0);` to:

```c
    mb_reg_bind(18, rd_oilc, wr_oilc);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_reg18 --output-on-failure`
Expected: PASS (2 tests). Full suite (expect 58 executables green).

- [ ] **Step 6: Commit**

```bash
git add firmware/g0b1-apu/App/services/control_io.c firmware/g0b1-apu/Tests/test_control_reg18.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): control — reg 18 (oil_change_state) read/write for display dismissal"
```

---

### Task 3: control_oil_change_check (threshold/dismissal/re-warn)

**Files:**
- Modify: `firmware/g0b1-apu/App/services/control.h` (add prototype)
- Create: `firmware/g0b1-apu/App/services/control_runtime.c` (constants + `control_oil_change_check`)
- Create: `firmware/g0b1-apu/Tests/test_control_runtime.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: M2 `nvm.h` (`nvm_read_word`) + `nvm_map.h` (`ENGINE_OILTIME_START`), M5 `app_timers.h` (`NEXT_OIL_WARNING_TMR`, `SCALE_MINUTE`).
- Produces: `void control_oil_change_check(apu_ctx_t *ctx);` — reads the oil-hours word + `NEXT_OIL_WARNING_TMR`, updates `ctx->oil_change_state` per the faithful cascade. Defines the `HOURS_*` + re-warn constants (in control_runtime.c). `control_service_runtime` is added in Task 4.

- [ ] **Step 1: Add the prototype to `control.h`**

```c
void control_oil_change_check(apu_ctx_t *ctx);
```

- [ ] **Step 2: Write the failing test `Tests/test_control_runtime.c`**

```c
#include "unity.h"
#include "control.h"
#include "app_timers.h"
#include "nvm.h"
#include "nvm_map.h"
#include "fake_nor.h"

static nvm_backend_t nor;
static apu_ctx_t ctx;
void setUp(void) { fake_nor_init(&nor); nvm_init(&nor); app_timers_init(); control_init(&ctx); }
void tearDown(void) {}

static void test_oil_good_below_500(void) {
    nvm_write_word(ENGINE_OILTIME_START, 499);
    control_oil_change_check(&ctx);
    TEST_ASSERT_EQUAL_UINT8(OIL_GOOD, ctx.oil_change_state);
}

static void test_oil_soon_in_500_580(void) {
    nvm_write_word(ENGINE_OILTIME_START, 500);   /* timer 0 (fresh init) */
    control_oil_change_check(&ctx);
    TEST_ASSERT_EQUAL_UINT8(OIL_CHANGE_SOON, ctx.oil_change_state);
}

static void test_oil_needed_in_580_700(void) {
    nvm_write_word(ENGINE_OILTIME_START, 580);
    control_oil_change_check(&ctx);
    TEST_ASSERT_EQUAL_UINT8(OIL_CHANGE_NEEDED, ctx.oil_change_state);
}

static void test_oil_past_due_at_700(void) {
    nvm_write_word(ENGINE_OILTIME_START, 700);
    control_oil_change_check(&ctx);
    TEST_ASSERT_EQUAL_UINT8(OIL_CHANGE_PAST_DUE, ctx.oil_change_state);
}

static void test_oil_timer_running_holds_state(void) {
    nvm_write_word(ENGINE_OILTIME_START, 600);
    app_timer_set(SCALE_MINUTE, NEXT_OIL_WARNING_TMR, 100);   /* not expired */
    ctx.oil_change_state = OIL_GOOD;
    control_oil_change_check(&ctx);
    TEST_ASSERT_EQUAL_UINT8(OIL_GOOD, ctx.oil_change_state);   /* no change while timer runs */
}

static void test_oil_dismissed_reloads_timer_soon(void) {
    nvm_write_word(ENGINE_OILTIME_START, 550);
    ctx.oil_change_state = OIL_WARNING_DISMISSED;             /* timer 0 */
    control_oil_change_check(&ctx);
    TEST_ASSERT_EQUAL_UINT8(OIL_WARNING_DISMISSED, ctx.oil_change_state); /* stays dismissed */
    TEST_ASSERT_EQUAL_UINT16(1200, app_timer_get(SCALE_MINUTE, NEXT_OIL_WARNING_TMR));
}

static void test_oil_dismissed_reloads_timer_past_due(void) {
    nvm_write_word(ENGINE_OILTIME_START, 750);
    ctx.oil_change_state = OIL_WARNING_DISMISSED;
    control_oil_change_check(&ctx);
    TEST_ASSERT_EQUAL_UINT8(OIL_WARNING_DISMISSED, ctx.oil_change_state);
    TEST_ASSERT_EQUAL_UINT16(300, app_timer_get(SCALE_MINUTE, NEXT_OIL_WARNING_TMR));
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_oil_good_below_500);
    RUN_TEST(test_oil_soon_in_500_580);
    RUN_TEST(test_oil_needed_in_580_700);
    RUN_TEST(test_oil_past_due_at_700);
    RUN_TEST(test_oil_timer_running_holds_state);
    RUN_TEST(test_oil_dismissed_reloads_timer_soon);
    RUN_TEST(test_oil_dismissed_reloads_timer_past_due);
    return UNITY_END();
}
```

- [ ] **Step 3: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_control_runtime test_control_runtime.c ../App/services/control_runtime.c ../App/services/control.c ../App/services/app_timers.c ../App/services/nvm.c ../App/services/nvm_record.c ../App/services/nvm_defaults.c ../App/services/modbus_crc.c ../App/services/fan_speed.c fakes/fake_nor.c)
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_runtime --output-on-failure`
Expected: build fails — `control_oil_change_check` / `control_runtime.c` undefined.

- [ ] **Step 5: Write `App/services/control_runtime.c`** (constants + the check)

```c
#include "control.h"
#include "app_timers.h"
#include "nvm.h"
#include "nvm_map.h"

#define HOURS_OIL_CHANGE_SOON    500u
#define HOURS_OIL_CHANGE_NOW     580u
#define HOURS_OIL_CHANGE_MISSED  700u
#define OIL_REWARN_SOON          1200u   /* 20 hr */
#define OIL_REWARN_PAST_DUE      300u    /* 5 hr  */

void control_oil_change_check(apu_ctx_t *ctx) {
    uint16_t hours = nvm_read_word(ENGINE_OILTIME_START);
    if (hours < HOURS_OIL_CHANGE_SOON) {
        ctx->oil_change_state = OIL_GOOD;
    } else if (hours < HOURS_OIL_CHANGE_NOW && app_timer_expired(SCALE_MINUTE, NEXT_OIL_WARNING_TMR)) {
        if (ctx->oil_change_state != OIL_WARNING_DISMISSED) ctx->oil_change_state = OIL_CHANGE_SOON;
        else app_timer_set(SCALE_MINUTE, NEXT_OIL_WARNING_TMR, OIL_REWARN_SOON);
    } else if (hours < HOURS_OIL_CHANGE_MISSED && app_timer_expired(SCALE_MINUTE, NEXT_OIL_WARNING_TMR)) {
        if (ctx->oil_change_state != OIL_WARNING_DISMISSED) ctx->oil_change_state = OIL_CHANGE_NEEDED;
        else app_timer_set(SCALE_MINUTE, NEXT_OIL_WARNING_TMR, OIL_REWARN_SOON);
    } else if (app_timer_expired(SCALE_MINUTE, NEXT_OIL_WARNING_TMR)) {   /* hours >= 700 */
        if (ctx->oil_change_state != OIL_WARNING_DISMISSED) ctx->oil_change_state = OIL_CHANGE_PAST_DUE;
        else app_timer_set(SCALE_MINUTE, NEXT_OIL_WARNING_TMR, OIL_REWARN_PAST_DUE);
    }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_runtime --output-on-failure`
Expected: PASS (7 tests). Full suite (expect 59 executables green).

- [ ] **Step 7: Commit**

```bash
git add firmware/g0b1-apu/App/services/control.h firmware/g0b1-apu/App/services/control_runtime.c firmware/g0b1-apu/Tests/test_control_runtime.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): control — oil-change warning check (thresholds + dismissal + re-warn)"
```

---

### Task 4: control_service_runtime (minute accumulation + saturating NVM hour bump)

**Files:**
- Modify: `firmware/g0b1-apu/App/services/control.h` (add prototype)
- Modify: `firmware/g0b1-apu/App/services/control_runtime.c` (add helper + `control_service_runtime`)
- Modify: `firmware/g0b1-apu/Tests/test_control_runtime.c` (add tests)

**Interfaces:**
- Produces: `void control_service_runtime(apu_ctx_t *ctx);` — machine accumulation (always), engine + oil accumulation (while `out.fuel_pump`), saturating single-word NVM hour bump, calls `control_oil_change_check` on the oil rollover. Adds a static `bump_hour(addr)` helper.

- [ ] **Step 1: Add the prototype to `control.h`**

```c
void control_service_runtime(apu_ctx_t *ctx);
```

- [ ] **Step 2: Add the failing tests to `Tests/test_control_runtime.c`** (functions + `RUN_TEST` lines)

```c
static void test_machine_accumulates_without_fuel(void) {
    ctx.out.fuel_pump = false; ctx.machine_run_min = 59;
    nvm_write_word(MACHINE_RUNTIME_START, 10);
    control_service_runtime(&ctx);
    TEST_ASSERT_EQUAL_UINT8(0, ctx.machine_run_min);                  /* rolled over */
    TEST_ASSERT_EQUAL_UINT16(11, nvm_read_word(MACHINE_RUNTIME_START));
    TEST_ASSERT_EQUAL_UINT8(0, ctx.engine_run_min);                   /* engine untouched (no fuel) */
}

static void test_engine_and_oil_accumulate_with_fuel(void) {
    ctx.out.fuel_pump = true; ctx.engine_run_min = 59; ctx.engine_oil_min = 59;
    nvm_write_word(ENGINE_RUNTIME_START, 20);
    nvm_write_word(ENGINE_OILTIME_START, 100);                        /* < 500 -> OIL_GOOD after check */
    control_service_runtime(&ctx);
    TEST_ASSERT_EQUAL_UINT16(21, nvm_read_word(ENGINE_RUNTIME_START));
    TEST_ASSERT_EQUAL_UINT16(101, nvm_read_word(ENGINE_OILTIME_START));
    TEST_ASSERT_EQUAL_UINT8(0, ctx.engine_oil_min);
    TEST_ASSERT_EQUAL_UINT8(OIL_GOOD, ctx.oil_change_state);          /* oil check ran */
}

static void test_engine_min_increments_no_rollover(void) {
    ctx.out.fuel_pump = true; ctx.engine_run_min = 5;
    nvm_write_word(ENGINE_RUNTIME_START, 20);
    control_service_runtime(&ctx);
    TEST_ASSERT_EQUAL_UINT8(6, ctx.engine_run_min);
    TEST_ASSERT_EQUAL_UINT16(20, nvm_read_word(ENGINE_RUNTIME_START)); /* no bump yet */
}

static void test_hour_bump_saturates_at_65535(void) {
    ctx.machine_run_min = 59;
    nvm_write_word(MACHINE_RUNTIME_START, 65535);
    control_service_runtime(&ctx);
    TEST_ASSERT_EQUAL_UINT16(65535, nvm_read_word(MACHINE_RUNTIME_START)); /* no wrap */
}
```
Register all four with `RUN_TEST(...)`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_runtime --output-on-failure`
Expected: FAIL — `control_service_runtime` undefined.

- [ ] **Step 4: Add the helper + `control_service_runtime` to `control_runtime.c`** (add the helper above `control_oil_change_check`; add the function below it)

```c
static void bump_hour(uint16_t addr) {
    uint16_t w = nvm_read_word(addr);
    if (w < 65535u) nvm_write_word(addr, (uint16_t)(w + 1u));
}

void control_service_runtime(apu_ctx_t *ctx) {
    /* Machine hours: always. */
    ctx->machine_run_min++;
    if (ctx->machine_run_min >= 60u) {
        ctx->machine_run_min = 0;
        bump_hour(MACHINE_RUNTIME_START);
    }
    /* Engine + oil hours: only while the engine is running. */
    if (ctx->out.fuel_pump) {
        ctx->engine_run_min++;
        if (ctx->engine_run_min >= 60u) {
            ctx->engine_run_min = 0;
            bump_hour(ENGINE_RUNTIME_START);
        }
        ctx->engine_oil_min++;
        if (ctx->engine_oil_min >= 60u) {
            ctx->engine_oil_min = 0;
            bump_hour(ENGINE_OILTIME_START);
            control_oil_change_check(ctx);
        }
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_runtime --output-on-failure`
Expected: PASS (11 tests). Full suite (expect 59 executables green — same count, more assertions).

- [ ] **Step 6: Commit**

```bash
git add firmware/g0b1-apu/App/services/control.h firmware/g0b1-apu/App/services/control_runtime.c firmware/g0b1-apu/Tests/test_control_runtime.c
git commit -m "feat(g0b1-apu): control — runtime-hour accumulation + saturating NVM bump (machine/engine/oil)"
```

---

### Task 5: control_1min_slot + integration

**Files:**
- Modify: `firmware/g0b1-apu/App/services/control_app.c` (add `control_1min_slot`)
- Modify: `firmware/g0b1-apu/App/services/control.h` (add prototype)
- Create: `firmware/g0b1-apu/Tests/test_control_runtime_integration.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt` (new exe + add `control_runtime.c` to the 4 pre-existing integration tests — link fallout)

**Interfaces:**
- `control.h` gains `void control_1min_slot(void);`. `control_app.c` adds `control_1min_slot()` calling `control_service_runtime(&s_ctx)`. `control_app_init` is UNCHANGED (it registers modes, not slots — slot registration is the caller's job).
- Integration registers `SLOT_1MIN` and advances the real scheduler.

- [ ] **Step 1: Add the prototype to `control.h`** (near `control_10ms_slot`/`control_1s_slot`)

```c
void control_1min_slot(void);
```

- [ ] **Step 2: Add `control_1min_slot` to `control_app.c`** (after `control_1s_slot`)

```c
void control_1min_slot(void) {
    control_service_runtime(&s_ctx);
}
```

- [ ] **Step 3: Add `control_runtime.c` to the 4 pre-existing integration tests' CMake lines** — `control_app.c` now references `control_service_runtime`, so every test linking `control_app.c` needs `control_runtime.c` to link. Append `../App/services/control_runtime.c` to each of `test_control_integration`, `test_control_engine_start_integration`, `test_control_climate_integration`, `test_control_battery_integration`. (All four already link `nvm.c` + `app_timers.c`, which `control_runtime.c` needs — no other source is required.)

- [ ] **Step 4: Write the failing test `Tests/test_control_runtime_integration.c`**

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
    sched_register(SLOT_10MS,  control_10ms_slot);
    sched_register(SLOT_1MIN,  control_1min_slot);
}
void tearDown(void) {}

static void advance(uint32_t total_ms) {
    for (uint32_t t = 0; t < total_ms; t++) { sched_service(1); sched_run(); }
}

/* One minute of scheduler time fires SLOT_1MIN once, incrementing the machine minute counter.
   (60 min to bump the NVM hour is impractical to advance; the hour bump is unit-tested.) */
static void test_1min_slot_increments_machine_min(void) {
    apu_ctx_t *c = control_app_ctx();
    TEST_ASSERT_EQUAL_UINT8(0, c->machine_run_min);
    advance(60000);   /* 1 minute */
    TEST_ASSERT_EQUAL_UINT8(1, c->machine_run_min);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_1min_slot_increments_machine_min);
    return UNITY_END();
}
```

*(Note: `control_10ms_slot` runs `control_sample_sensors` + `control_tick` each 10 ms; that is fine — the engine is OFF (`op_state=OP_POWER_UP` after init settles to OFF), so `out.fuel_pump` is false and only the machine counter moves. If the 1-minute boundary is off-by-one against the scheduler's accumulation, adjust `advance()` to `60000`±a few ms until the single SLOT_1MIN fire lands; do not weaken the `== 1` assertion.)*

- [ ] **Step 5: Register the new exe in `Tests/CMakeLists.txt`** (full source set — mirror `test_control_battery_integration` + `control_runtime.c`)

```cmake
add_unity_test(test_control_runtime_integration test_control_runtime_integration.c
    ../App/services/control.c ../App/services/control_outputs.c ../App/services/control_powerup.c
    ../App/services/control_off.c ../App/services/control_io.c ../App/services/control_app.c
    ../App/services/control_engine_start.c ../App/services/control_climate.c ../App/services/control_battery.c
    ../App/services/control_error_shutdown.c ../App/services/control_sample.c ../App/services/control_runtime.c
    ../App/services/sched.c ../App/services/app_timers.c ../App/services/io_debounce.c
    ../App/services/bsp_io.c ../App/services/bsp_pwm.c ../App/services/fan_speed.c
    ../App/services/sensors.c ../App/services/mb_regmodel.c
    ../App/services/nvm.c ../App/services/nvm_record.c ../App/services/nvm_defaults.c ../App/services/modbus_crc.c
    fakes/fake_bsp_io.c fakes/fake_bsp_pwm.c fakes/fake_nor.c)
```

- [ ] **Step 6: Run the integration test**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_control_runtime_integration --output-on-failure`
Expected: build (all 4 pre-existing integration tests relink with `control_runtime.c`), then the 1-minute increment passes. If the boundary is off-by-one, apply the note's `advance()` tweak.

- [ ] **Step 7: Run the full suite to confirm no regressions**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build --output-on-failure`
Expected: all pass. Executable count: 56 (through M6d) + test_control_ctx_rt + test_control_reg18 + test_control_runtime + test_control_runtime_integration = **60 executables**, zero warnings under `-Werror`.

- [ ] **Step 8: Commit**

```bash
git add firmware/g0b1-apu/App/services/control_app.c firmware/g0b1-apu/App/services/control.h firmware/g0b1-apu/Tests/test_control_runtime_integration.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): control — control_1min_slot + runtime-accounting integration"
```

---

## Deferred to bench / later

- Multi-word counter chain (>65535 hr) — not ported (single-word saturating chosen).
- Runtime oil-timer reset on service (PIC resets `ENGINE_OILTIME` only on factory-init) — a "reset oil hours" command deferred to bench/HMI.
- Display-side re-warn cadence + the actual dismissal write — validated on the real display at bench.
- `OP_COLD_STORAGE` remains descoped (OI-6). After M6e the software port is functionally complete (minus cold storage); everything else is the USER-OWNED hardware bench bring-up.

## Carry-forward items to confirm

- **Oil thresholds 500/580/700 + re-warn 20 hr / 5 hr** — validated against the PIC constants; confirm against the display/service manual at bench.
- **Single-word saturating counter range (65535 hr)** — confirm acceptable for the product's expected life; revisit the multi-word chain only if not.

---

## Self-Review

**Spec coverage (design §2–§9):** the 1-minute routine (machine always, engine/oil while fuel on, saturating single-word bump) ✅ (Task 4); oil-change warning check (500/580/700 bands + dismissal + re-warn, `NEXT_OIL_WARNING_TMR`-gated) ✅ (Task 3); reg 18 read/write ✅ (Task 2); ctx minute fields ✅ (Task 1); `control_1min_slot` + integration + link fallout to the 4 tests ✅ (Task 5). No multi-word chain, no oil-reset command, no `OP_COLD_STORAGE` — all documented deferrals.

**Placeholder scan:** no TBD/TODO. The one timing-sensitive integration vector (1-minute boundary) carries an explicit `advance()`-tweak note without weakening the `== 1` assertion; the 60-min hour bump is unit-tested by direct accumulator/NVM drive.

**Type consistency:** the three ctx `uint8_t` minute fields (Task 1) are used identically by `control_service_runtime` (Task 4) and reset in `control_init`. `oil_change_state`/`OIL_*` from M6a control.h; `wr_oilc` follows the existing `wr_mode`/`wr_td` validated-writer pattern (Task 2). `nvm_read_word`/`nvm_write_word` + `MACHINE/ENGINE_RUNTIME_START`/`ENGINE_OILTIME_START` from M2. `NEXT_OIL_WARNING_TMR`/`SCALE_MINUTE`/`app_timer_get/set/expired` from M5. `control_oil_change_check` (Task 3) is called by `control_service_runtime` (Task 4); `control_1min_slot` (Task 5) calls the latter. Task 5 adds `control_runtime.c` to the 4 pre-existing integration tests (link fallout from `control_app.c` referencing `control_service_runtime`) and links the full set for the new integration test.
