# STM32G0 APU Port — Milestone 5: BSP Abstraction + Cooperative Scheduler — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the portable, host-tested infrastructure layer the control state machines (M6) will sit on — a cooperative due-flag time-triggered scheduler, the PIC countdown-timer arrays, discrete-input debounce, and the relay/PWM output-hardware abstraction (backend interface + in-memory fake) — preserving the PIC firmware's slot cadences, timer enum indices, debounce semantics, and evap-fan duty ratios.

**Architecture:** A due-flag scheduler (`sched`) driven by an externally-supplied millisecond delta sets slot due-flags at the 10/50/100 ms · 1/5 s · 1 min cadences and dispatches each to a registered handler; it decrements the five `app_timers` countdown arrays at their exact per-scale rates (accurate under superloop jitter). Discrete inputs go through an `io_debounce` integrator (`discrete_input_t`). The relay + fan-PWM hardware is abstracted behind function-pointer backends (`bsp_io_backend_t`/`bsp_pwm_backend_t`, same pattern as `nvm_backend`/`i2c_backend`) with in-memory fakes, so M6's `outputs_apply` is host-testable; `fan_speed` maps LOW/MED/HIGH to duty. The concrete on-target HAL (GPIO, TIM2 PWM, ADC1+DMA, TIM3 capture, SysTick) and the flash/RTC/UART drivers are **deferred to hardware bring-up**.

**Tech Stack:** C11, CMake + Unity (host). Reuses `App/include/types.h` (M1). No other service dependency (this is the layer *below* the services).

**Design spec:** `docs/superpowers/specs/2026-08-12-pic18-to-stm32g0-apu-port-design.md` §5 (BSP layer), §8.1 (scheduler & main loop), §8.3 (I/O model), §4 (pin map). Prereq: M1 (`firmware/g0b1-apu/` harness + `types.h`). Source of truth: PIC `main.h` (`flag0` due-bits, the five `*_timer_list` enums, `discrete_input_t`, `DEBOUNCE_TIME`, `evap_speed_list`), spec §4 output pin map.

## Global Constraints

- **Scheduler slots** (period in ms): `SLOT_10MS`=10, `SLOT_50MS`=50, `SLOT_100MS`=100, `SLOT_1S`=1000, `SLOT_5S`=5000, `SLOT_1MIN`=60000. Preserves the PIC `do_10ms…do_1minute` flags.
- **Timer arrays** (`app_timers`) with **exact PIC enum indices**, decremented at their scale rate:
  - `SCALE_MS` (1 ms): `EVAP_PWM_PERIOD_TMR`=0, `EVAP_PWM_ON_TMR`=1 (count 2).
  - `SCALE_TEN_MS` (10 ms): `SHORT_DELAY_TMR`=0, `RPM_STOP_TMR`=1 (count 2).
  - `SCALE_HUNDRED_MS` (100 ms): `GLOW_PLUG_ON_TMR`=0, `RPM_LOW_TMR`=1 (count 2).
  - `SCALE_SECOND` (1 s): `POWER_UP_TMR`=0, `EVENT_INTERVAL_TMR`=1, `COMP_EVAP_DELAY_TMR`=2, `BATT_STABLE_TMR`=3, `COMPRESOR_OUT_TMR`=4, `FUEL_PUMP_ONOFF_TIMER`=5, `EVAP_FORCED_ON_TMR`=6 (count 7).
  - `SCALE_MINUTE` (1 min): `CHARGING_BATT_TMR`=0, `NEXT_OIL_WARNING_TMR`=1, `DEFROST_CYCLE_TMR`=2, `CLMT_LOW_BATT_TMR`=3, `CABIN_TEMP_WARMUP_TMR`=4 (count 5).
  - Timers are `uint16_t` countdowns; decrement stops at 0; `expired` == (value 0).
- **Discrete inputs** (`io_debounce`): `IN_OIL_PRESSURE`=0, `IN_TRUCK_IGNITION`=1 (the two genuine digital inputs; the PIC's H/L-side-pressure and engine-temp are analog on the new board, handled by M3). `DEBOUNCE_TIME` = **10** service calls (at the 10 ms slot ⇒ 100 ms). Commit the debounced state after `debounce_time` **consecutive identical** raw samples. `SWITCH_OPEN`=0, `SWITCH_CLOSED`=1.
- **Output pin map** (`board_pins.h`, spec §4): relays `OUT_FUEL_PUMP`=0, `OUT_STARTER`, `OUT_GLOW_PLUG`, `OUT_COMPRESSOR_CLUTCH`, `OUT_HEAT_REVERSER`, `OUT_EVAP_FAN`, `OUT_CONDENSER_FAN` (count 7); PWM channels `PWM_EVAP_FAN`=0, `PWM_CONDENSER_FAN`=1 (count 2). Relays are active-high (de-energized = false); the active-level normalization vs the ULN2003/buffering is the concrete HAL's job (deferred).
- **Fan speed → duty** (`fan_speed`, permille 0..1000, preserving PIC 7/12/22 ms of 22 ms): `LOW`=**318** (round 7000/22), `MEDIUM`=**545** (round 12000/22), `HIGH`=**1000**. `bsp_pwm_set` duty unit is **permille (0..1000)**.
- **BSP backends** are function-pointer interfaces (like `nvm_backend`/`i2c_backend`); portable façades hold a module-static backend pointer and delegate. In-memory fakes live in `Tests/fakes/`.
- Fixed-width integers only (`<stdint.h>`/`<stdbool.h>` via `types.h`). Portable code under `App/services/` — **no HAL**. Firmware root `firmware/g0b1-apu/`. Every task ends green (`ctest`) and is committed; build is `-Wall -Wextra -Werror -funsigned-char` and must stay pristine.

### Deferred / carry-forward (bench)
- **Concrete `bsp_*` HAL**: `bsp_io` (GPIO relays via ULN2003; RC/BJT-buffered digital inputs), `bsp_pwm` (TIM2 CH1 PC4 / CH2 PC5), `bsp_adc` (ADC1 + circular DMA → feeds M3 `sensors_add_sample`), `bsp_rpm` (TIM3_CH1 capture → implements M3 `rpm_source`), `bsp_now_ms` (SysTick 1 ms → feeds `sched_service`).
- **Drivers**: `drv_s25fl064` (→ M2 `nvm_backend`, split program() at 256-byte pages), `drv_mcp7940n` (→ M4a `i2c_backend`), `drv_modbus_uart` (→ M4b `mb_engine_process`).
- **`.ioc` peripheral config + `main()` superloop** (register control slots, `iwdg_kick`) — pairs with M1 Task 1 (USER-OWNED at the bench).
- **Debounce-algorithm reconciliation**: the exact PIC `ServiceSwitch` body was not in the ported source; this milestone implements a correct "N consecutive identical samples" integrator with the `discrete_input_t` fields — reconcile against the original if it surfaces.
- Condenser-fan PWM ramp-with-head-pressure curve (OI-2) — control layer (M6).

---

### Task 1: board_pins.h + bsp_io backend + in-memory fake

**Files:**
- Create: `firmware/g0b1-apu/App/services/board_pins.h`
- Create: `firmware/g0b1-apu/App/services/bsp_io_backend.h`
- Create: `firmware/g0b1-apu/App/services/bsp_io.h`, `firmware/g0b1-apu/App/services/bsp_io.c`
- Create: `firmware/g0b1-apu/Tests/fakes/fake_bsp_io.h`, `firmware/g0b1-apu/Tests/fakes/fake_bsp_io.c`
- Create: `firmware/g0b1-apu/Tests/test_bsp_io.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Produces (`board_pins.h`): `typedef enum { OUT_FUEL_PUMP=0, OUT_STARTER, OUT_GLOW_PLUG, OUT_COMPRESSOR_CLUTCH, OUT_HEAT_REVERSER, OUT_EVAP_FAN, OUT_CONDENSER_FAN, OUT_COUNT } bsp_out_t;` `typedef enum { PWM_EVAP_FAN=0, PWM_CONDENSER_FAN, PWM_COUNT } bsp_pwm_ch_t;` `typedef enum { IN_OIL_PRESSURE=0, IN_TRUCK_IGNITION, IN_COUNT } bsp_in_t;`
- Produces (`bsp_io_backend.h`): `typedef struct bsp_io_backend { void (*out_set)(void *ctx, uint8_t out, bool on); bool (*out_get)(void *ctx, uint8_t out); bool (*in_read)(void *ctx, uint8_t in); void *ctx; } bsp_io_backend_t;`
- Produces (`bsp_io.h`): `void bsp_io_init(const bsp_io_backend_t *be);` `void bsp_out_set(bsp_out_t out, bool on);` `bool bsp_out_get(bsp_out_t out);` `bool bsp_in_read(bsp_in_t in);`
- Produces (`fake_bsp_io.h`): `void fake_bsp_io_init(bsp_io_backend_t *be);` (wires the fake, all outputs off), `void fake_bsp_io_set_input(bsp_in_t in, bool level);` (drive a fake input), `bool fake_bsp_io_out(bsp_out_t out);` (read recorded relay state).

- [ ] **Step 1: Write `App/services/board_pins.h`**

```c
#ifndef BOARD_PINS_H
#define BOARD_PINS_H
/* Logical output/input identifiers (spec §4). Physical pin/active-level mapping
   lives in the concrete bsp_io HAL (deferred to bench). */
typedef enum {
    OUT_FUEL_PUMP = 0, OUT_STARTER, OUT_GLOW_PLUG, OUT_COMPRESSOR_CLUTCH,
    OUT_HEAT_REVERSER, OUT_EVAP_FAN, OUT_CONDENSER_FAN, OUT_COUNT
} bsp_out_t;
typedef enum { PWM_EVAP_FAN = 0, PWM_CONDENSER_FAN, PWM_COUNT } bsp_pwm_ch_t;
typedef enum { IN_OIL_PRESSURE = 0, IN_TRUCK_IGNITION, IN_COUNT } bsp_in_t;
#endif /* BOARD_PINS_H */
```

- [ ] **Step 2: Write `App/services/bsp_io_backend.h`**

```c
#ifndef BSP_IO_BACKEND_H
#define BSP_IO_BACKEND_H
#include "types.h"
/* Abstract relay-output + digital-input hardware. Concrete HAL (GPIO/ULN2003)
   deferred to bench. */
typedef struct bsp_io_backend {
    void (*out_set)(void *ctx, uint8_t out, bool on);
    bool (*out_get)(void *ctx, uint8_t out);
    bool (*in_read)(void *ctx, uint8_t in);
    void *ctx;
} bsp_io_backend_t;
#endif /* BSP_IO_BACKEND_H */
```

- [ ] **Step 3: Write `App/services/bsp_io.h`**

```c
#ifndef BSP_IO_H
#define BSP_IO_H
#include "types.h"
#include "board_pins.h"
#include "bsp_io_backend.h"
void bsp_io_init(const bsp_io_backend_t *be);
void bsp_out_set(bsp_out_t out, bool on);
bool bsp_out_get(bsp_out_t out);
bool bsp_in_read(bsp_in_t in);
#endif /* BSP_IO_H */
```

- [ ] **Step 4: Write `Tests/fakes/fake_bsp_io.h`**

```c
#ifndef FAKE_BSP_IO_H
#define FAKE_BSP_IO_H
#include "bsp_io_backend.h"
#include "board_pins.h"
void fake_bsp_io_init(bsp_io_backend_t *be);      /* wire fake; all outputs off, inputs low */
void fake_bsp_io_set_input(bsp_in_t in, bool level);
bool fake_bsp_io_out(bsp_out_t out);              /* recorded relay state */
#endif /* FAKE_BSP_IO_H */
```

- [ ] **Step 5: Write the failing test `Tests/test_bsp_io.c`**

```c
#include "unity.h"
#include "bsp_io.h"
#include "fake_bsp_io.h"

static bsp_io_backend_t be;
void setUp(void) { fake_bsp_io_init(&be); bsp_io_init(&be); }
void tearDown(void) {}

static void test_out_set_get_roundtrip(void) {
    TEST_ASSERT_FALSE(bsp_out_get(OUT_FUEL_PUMP));
    bsp_out_set(OUT_FUEL_PUMP, true);
    TEST_ASSERT_TRUE(bsp_out_get(OUT_FUEL_PUMP));
    TEST_ASSERT_TRUE(fake_bsp_io_out(OUT_FUEL_PUMP)); /* recorded in the fake */
    bsp_out_set(OUT_FUEL_PUMP, false);
    TEST_ASSERT_FALSE(bsp_out_get(OUT_FUEL_PUMP));
}

static void test_outputs_independent(void) {
    bsp_out_set(OUT_STARTER, true);
    bsp_out_set(OUT_CONDENSER_FAN, true);
    TEST_ASSERT_TRUE(bsp_out_get(OUT_STARTER));
    TEST_ASSERT_TRUE(bsp_out_get(OUT_CONDENSER_FAN));
    TEST_ASSERT_FALSE(bsp_out_get(OUT_GLOW_PLUG));    /* untouched */
}

static void test_input_read(void) {
    TEST_ASSERT_FALSE(bsp_in_read(IN_OIL_PRESSURE));
    fake_bsp_io_set_input(IN_OIL_PRESSURE, true);
    TEST_ASSERT_TRUE(bsp_in_read(IN_OIL_PRESSURE));
    TEST_ASSERT_FALSE(bsp_in_read(IN_TRUCK_IGNITION)); /* independent */
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_out_set_get_roundtrip);
    RUN_TEST(test_outputs_independent);
    RUN_TEST(test_input_read);
    return UNITY_END();
}
```

- [ ] **Step 6: Register the test in `Tests/CMakeLists.txt`** (append)

```cmake
add_unity_test(test_bsp_io test_bsp_io.c ../App/services/bsp_io.c fakes/fake_bsp_io.c)
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_bsp_io --output-on-failure`
Expected: build fails — `bsp_io_*` / `fake_bsp_io_*` undefined.

- [ ] **Step 8: Write `App/services/bsp_io.c`**

```c
#include "bsp_io.h"

static const bsp_io_backend_t *s_be;

void bsp_io_init(const bsp_io_backend_t *be) { s_be = be; }
void bsp_out_set(bsp_out_t out, bool on) { if (s_be && s_be->out_set) s_be->out_set(s_be->ctx, (uint8_t)out, on); }
bool bsp_out_get(bsp_out_t out) { return (s_be && s_be->out_get) ? s_be->out_get(s_be->ctx, (uint8_t)out) : false; }
bool bsp_in_read(bsp_in_t in) { return (s_be && s_be->in_read) ? s_be->in_read(s_be->ctx, (uint8_t)in) : false; }
```

- [ ] **Step 9: Write `Tests/fakes/fake_bsp_io.c`**

```c
#include "fake_bsp_io.h"

static bool s_out[OUT_COUNT];
static bool s_in[IN_COUNT];

static void fi_out_set(void *ctx, uint8_t out, bool on) { (void)ctx; if (out < OUT_COUNT) s_out[out] = on; }
static bool fi_out_get(void *ctx, uint8_t out) { (void)ctx; return (out < OUT_COUNT) ? s_out[out] : false; }
static bool fi_in_read(void *ctx, uint8_t in) { (void)ctx; return (in < IN_COUNT) ? s_in[in] : false; }

void fake_bsp_io_init(bsp_io_backend_t *be) {
    for (int i = 0; i < OUT_COUNT; i++) s_out[i] = false;
    for (int i = 0; i < IN_COUNT; i++) s_in[i] = false;
    be->out_set = fi_out_set; be->out_get = fi_out_get; be->in_read = fi_in_read; be->ctx = 0;
}
void fake_bsp_io_set_input(bsp_in_t in, bool level) { if (in < IN_COUNT) s_in[in] = level; }
bool fake_bsp_io_out(bsp_out_t out) { return (out < OUT_COUNT) ? s_out[out] : false; }
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_bsp_io --output-on-failure`
Expected: PASS (3 tests).

- [ ] **Step 11: Commit**

```bash
git add firmware/g0b1-apu/App/services/board_pins.h firmware/g0b1-apu/App/services/bsp_io_backend.h firmware/g0b1-apu/App/services/bsp_io.h firmware/g0b1-apu/App/services/bsp_io.c firmware/g0b1-apu/Tests/fakes/fake_bsp_io.h firmware/g0b1-apu/Tests/fakes/fake_bsp_io.c firmware/g0b1-apu/Tests/test_bsp_io.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): bsp_io — board pin map + relay/input backend interface + fake"
```

---

### Task 2: bsp_pwm backend + fake + fan_speed mapping

**Files:**
- Create: `firmware/g0b1-apu/App/services/bsp_pwm_backend.h`
- Create: `firmware/g0b1-apu/App/services/bsp_pwm.h`, `firmware/g0b1-apu/App/services/bsp_pwm.c`
- Create: `firmware/g0b1-apu/App/services/fan_speed.h`, `firmware/g0b1-apu/App/services/fan_speed.c`
- Create: `firmware/g0b1-apu/Tests/fakes/fake_bsp_pwm.h`, `firmware/g0b1-apu/Tests/fakes/fake_bsp_pwm.c`
- Create: `firmware/g0b1-apu/Tests/test_bsp_pwm.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `board_pins.h` (`bsp_pwm_ch_t`) from Task 1.
- Produces (`bsp_pwm_backend.h`): `typedef struct bsp_pwm_backend { void (*set)(void *ctx, uint8_t ch, uint16_t permille); uint16_t (*get)(void *ctx, uint8_t ch); void *ctx; } bsp_pwm_backend_t;`
- Produces (`bsp_pwm.h`): `void bsp_pwm_init(const bsp_pwm_backend_t *be);` `void bsp_pwm_set(bsp_pwm_ch_t ch, uint16_t permille);` (clamps > 1000 to 1000) `uint16_t bsp_pwm_get(bsp_pwm_ch_t ch);`
- Produces (`fan_speed.h`): `typedef enum { FAN_LOW=0, FAN_MEDIUM, FAN_HIGH } fan_speed_t;` `uint16_t fan_speed_permille(fan_speed_t s);` (LOW 318, MEDIUM 545, HIGH 1000; any other → 1000).
- Produces (`fake_bsp_pwm.h`): `void fake_bsp_pwm_init(bsp_pwm_backend_t *be);` `uint16_t fake_bsp_pwm_duty(bsp_pwm_ch_t ch);`

- [ ] **Step 1: Write `App/services/bsp_pwm_backend.h`**

```c
#ifndef BSP_PWM_BACKEND_H
#define BSP_PWM_BACKEND_H
#include "types.h"
/* Abstract fan-PWM hardware (duty in permille 0..1000). TIM2 CH1/CH2 HAL deferred. */
typedef struct bsp_pwm_backend {
    void     (*set)(void *ctx, uint8_t ch, uint16_t permille);
    uint16_t (*get)(void *ctx, uint8_t ch);
    void *ctx;
} bsp_pwm_backend_t;
#endif /* BSP_PWM_BACKEND_H */
```

- [ ] **Step 2: Write `App/services/bsp_pwm.h`**

```c
#ifndef BSP_PWM_H
#define BSP_PWM_H
#include "types.h"
#include "board_pins.h"
#include "bsp_pwm_backend.h"
#define BSP_PWM_MAX 1000u
void     bsp_pwm_init(const bsp_pwm_backend_t *be);
void     bsp_pwm_set(bsp_pwm_ch_t ch, uint16_t permille);  /* clamps to BSP_PWM_MAX */
uint16_t bsp_pwm_get(bsp_pwm_ch_t ch);
#endif /* BSP_PWM_H */
```

- [ ] **Step 3: Write `App/services/fan_speed.h`**

```c
#ifndef FAN_SPEED_H
#define FAN_SPEED_H
#include "types.h"
/* Evap-fan speed → PWM duty (permille), preserving PIC 7/12/22 ms of 22 ms. */
typedef enum { FAN_LOW = 0, FAN_MEDIUM, FAN_HIGH } fan_speed_t;
#define FAN_DUTY_LOW    318u   /* round(7000/22)  */
#define FAN_DUTY_MEDIUM 545u   /* round(12000/22) */
#define FAN_DUTY_HIGH   1000u
uint16_t fan_speed_permille(fan_speed_t s);
#endif /* FAN_SPEED_H */
```

- [ ] **Step 4: Write `Tests/fakes/fake_bsp_pwm.h`**

```c
#ifndef FAKE_BSP_PWM_H
#define FAKE_BSP_PWM_H
#include "bsp_pwm_backend.h"
#include "board_pins.h"
void     fake_bsp_pwm_init(bsp_pwm_backend_t *be);   /* wire fake; all duties 0 */
uint16_t fake_bsp_pwm_duty(bsp_pwm_ch_t ch);
#endif
```

- [ ] **Step 5: Write the failing test `Tests/test_bsp_pwm.c`**

```c
#include "unity.h"
#include "bsp_pwm.h"
#include "fan_speed.h"
#include "fake_bsp_pwm.h"

static bsp_pwm_backend_t be;
void setUp(void) { fake_bsp_pwm_init(&be); bsp_pwm_init(&be); }
void tearDown(void) {}

static void test_pwm_set_get_roundtrip(void) {
    bsp_pwm_set(PWM_EVAP_FAN, 545);
    TEST_ASSERT_EQUAL_UINT16(545, bsp_pwm_get(PWM_EVAP_FAN));
    TEST_ASSERT_EQUAL_UINT16(545, fake_bsp_pwm_duty(PWM_EVAP_FAN));
    TEST_ASSERT_EQUAL_UINT16(0, bsp_pwm_get(PWM_CONDENSER_FAN)); /* independent */
}

static void test_pwm_clamps_over_max(void) {
    bsp_pwm_set(PWM_EVAP_FAN, 1500);
    TEST_ASSERT_EQUAL_UINT16(BSP_PWM_MAX, bsp_pwm_get(PWM_EVAP_FAN));
}

static void test_fan_speed_duty_ratios(void) {
    TEST_ASSERT_EQUAL_UINT16(318,  fan_speed_permille(FAN_LOW));
    TEST_ASSERT_EQUAL_UINT16(545,  fan_speed_permille(FAN_MEDIUM));
    TEST_ASSERT_EQUAL_UINT16(1000, fan_speed_permille(FAN_HIGH));
}

static void test_fan_speed_applied_to_pwm(void) {
    bsp_pwm_set(PWM_EVAP_FAN, fan_speed_permille(FAN_LOW));
    TEST_ASSERT_EQUAL_UINT16(318, bsp_pwm_get(PWM_EVAP_FAN));
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_pwm_set_get_roundtrip);
    RUN_TEST(test_pwm_clamps_over_max);
    RUN_TEST(test_fan_speed_duty_ratios);
    RUN_TEST(test_fan_speed_applied_to_pwm);
    return UNITY_END();
}
```

- [ ] **Step 6: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_bsp_pwm test_bsp_pwm.c ../App/services/bsp_pwm.c ../App/services/fan_speed.c fakes/fake_bsp_pwm.c)
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_bsp_pwm --output-on-failure`
Expected: build fails — symbols undefined.

- [ ] **Step 8: Write `App/services/bsp_pwm.c`**

```c
#include "bsp_pwm.h"

static const bsp_pwm_backend_t *s_be;

void bsp_pwm_init(const bsp_pwm_backend_t *be) { s_be = be; }
void bsp_pwm_set(bsp_pwm_ch_t ch, uint16_t permille) {
    if (permille > BSP_PWM_MAX) permille = BSP_PWM_MAX;
    if (s_be && s_be->set) s_be->set(s_be->ctx, (uint8_t)ch, permille);
}
uint16_t bsp_pwm_get(bsp_pwm_ch_t ch) { return (s_be && s_be->get) ? s_be->get(s_be->ctx, (uint8_t)ch) : 0u; }
```

- [ ] **Step 9: Write `App/services/fan_speed.c`**

```c
#include "fan_speed.h"

uint16_t fan_speed_permille(fan_speed_t s) {
    switch (s) {
        case FAN_LOW:    return FAN_DUTY_LOW;
        case FAN_MEDIUM: return FAN_DUTY_MEDIUM;
        case FAN_HIGH:   return FAN_DUTY_HIGH;
        default:         return FAN_DUTY_HIGH;
    }
}
```

- [ ] **Step 10: Write `Tests/fakes/fake_bsp_pwm.c`**

```c
#include "fake_bsp_pwm.h"

static uint16_t s_duty[PWM_COUNT];

static void fp_set(void *ctx, uint8_t ch, uint16_t permille) { (void)ctx; if (ch < PWM_COUNT) s_duty[ch] = permille; }
static uint16_t fp_get(void *ctx, uint8_t ch) { (void)ctx; return (ch < PWM_COUNT) ? s_duty[ch] : 0u; }

void fake_bsp_pwm_init(bsp_pwm_backend_t *be) {
    for (int i = 0; i < PWM_COUNT; i++) s_duty[i] = 0u;
    be->set = fp_set; be->get = fp_get; be->ctx = 0;
}
uint16_t fake_bsp_pwm_duty(bsp_pwm_ch_t ch) { return (ch < PWM_COUNT) ? s_duty[ch] : 0u; }
```

- [ ] **Step 11: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_bsp_pwm --output-on-failure`
Expected: PASS (4 tests).

- [ ] **Step 12: Commit**

```bash
git add firmware/g0b1-apu/App/services/bsp_pwm_backend.h firmware/g0b1-apu/App/services/bsp_pwm.h firmware/g0b1-apu/App/services/bsp_pwm.c firmware/g0b1-apu/App/services/fan_speed.h firmware/g0b1-apu/App/services/fan_speed.c firmware/g0b1-apu/Tests/fakes/fake_bsp_pwm.h firmware/g0b1-apu/Tests/fakes/fake_bsp_pwm.c firmware/g0b1-apu/Tests/test_bsp_pwm.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): bsp_pwm — fan-PWM backend + fake + fan-speed duty mapping"
```

---

### Task 3: io_debounce — discrete input integrator

**Files:**
- Create: `firmware/g0b1-apu/App/services/io_debounce.h`, `firmware/g0b1-apu/App/services/io_debounce.c`
- Create: `firmware/g0b1-apu/Tests/test_io_debounce.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Produces: `typedef struct { uint8_t previous_state; uint8_t debounced_state; uint8_t service_needed; uint16_t debounce_tmr; uint16_t debounce_time; } discrete_input_t;`
- Produces: `void io_debounce_init(discrete_input_t *d, uint16_t debounce_time, uint8_t initial);` `void io_debounce_service(discrete_input_t *d, uint8_t raw);` (commit `debounced_state` after `debounce_time` consecutive identical raw samples; set `service_needed` on a commit that changes the state) `uint8_t io_debounce_state(const discrete_input_t *d);` `#define DEBOUNCE_TIME 10u`.
- Algorithm (integrator; see Global Constraints): a raw sample equal to the last raw increments `debounce_tmr` (capped at `debounce_time`); a differing raw restarts it at 1; when `debounce_tmr` reaches `debounce_time` and the committed `debounced_state` differs from the stable raw, commit it and set `service_needed`.

- [ ] **Step 1: Write `App/services/io_debounce.h`**

```c
#ifndef IO_DEBOUNCE_H
#define IO_DEBOUNCE_H
#include "types.h"

#define DEBOUNCE_TIME 10u   /* consecutive 10 ms-slot samples => 100 ms */
#define SWITCH_OPEN   0u
#define SWITCH_CLOSED 1u

typedef struct {
    uint8_t  previous_state;   /* last raw sample (internal) */
    uint8_t  debounced_state;  /* committed state read by the app */
    uint8_t  service_needed;   /* set on a state change; app clears */
    uint16_t debounce_tmr;     /* consecutive-identical-sample count (internal) */
    uint16_t debounce_time;    /* samples required to commit */
} discrete_input_t;

void    io_debounce_init(discrete_input_t *d, uint16_t debounce_time, uint8_t initial);
void    io_debounce_service(discrete_input_t *d, uint8_t raw);
uint8_t io_debounce_state(const discrete_input_t *d);

#endif /* IO_DEBOUNCE_H */
```

- [ ] **Step 2: Write the failing test `Tests/test_io_debounce.c`**

```c
#include "unity.h"
#include "io_debounce.h"

static discrete_input_t d;
void setUp(void) { io_debounce_init(&d, DEBOUNCE_TIME, SWITCH_OPEN); }
void tearDown(void) {}

static void test_init_state(void) {
    TEST_ASSERT_EQUAL_UINT8(SWITCH_OPEN, io_debounce_state(&d));
}

static void test_commits_after_debounce_time_stable_samples(void) {
    for (unsigned i = 0; i < DEBOUNCE_TIME - 1u; i++) {   /* 9 samples: not yet */
        io_debounce_service(&d, SWITCH_CLOSED);
        TEST_ASSERT_EQUAL_UINT8(SWITCH_OPEN, io_debounce_state(&d));
    }
    io_debounce_service(&d, SWITCH_CLOSED);               /* 10th: commit */
    TEST_ASSERT_EQUAL_UINT8(SWITCH_CLOSED, io_debounce_state(&d));
    TEST_ASSERT_EQUAL_UINT8(1u, d.service_needed);
}

static void test_bounce_shorter_than_window_rejected(void) {
    for (unsigned i = 0; i < 5; i++) io_debounce_service(&d, SWITCH_CLOSED);
    io_debounce_service(&d, SWITCH_OPEN);                 /* glitch resets the run */
    for (unsigned i = 0; i < 5; i++) io_debounce_service(&d, SWITCH_CLOSED);
    TEST_ASSERT_EQUAL_UINT8(SWITCH_OPEN, io_debounce_state(&d)); /* never 10 in a row */
}

static void test_stable_at_committed_value_no_service(void) {
    for (unsigned i = 0; i < DEBOUNCE_TIME; i++) io_debounce_service(&d, SWITCH_CLOSED);
    d.service_needed = 0;
    for (unsigned i = 0; i < 20; i++) io_debounce_service(&d, SWITCH_CLOSED); /* stays CLOSED */
    TEST_ASSERT_EQUAL_UINT8(SWITCH_CLOSED, io_debounce_state(&d));
    TEST_ASSERT_EQUAL_UINT8(0u, d.service_needed);        /* no new change */
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_init_state);
    RUN_TEST(test_commits_after_debounce_time_stable_samples);
    RUN_TEST(test_bounce_shorter_than_window_rejected);
    RUN_TEST(test_stable_at_committed_value_no_service);
    return UNITY_END();
}
```

- [ ] **Step 3: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_io_debounce test_io_debounce.c ../App/services/io_debounce.c)
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_io_debounce --output-on-failure`
Expected: build fails — `io_debounce_*` undefined.

- [ ] **Step 5: Write `App/services/io_debounce.c`**

```c
#include "io_debounce.h"

void io_debounce_init(discrete_input_t *d, uint16_t debounce_time, uint8_t initial) {
    d->previous_state  = initial;
    d->debounced_state = initial;
    d->service_needed  = 0u;
    d->debounce_tmr    = 0u;
    d->debounce_time   = debounce_time;
}

void io_debounce_service(discrete_input_t *d, uint8_t raw) {
    if (raw != d->previous_state) {
        d->previous_state = raw;
        d->debounce_tmr = 1u;                 /* first sample of a new stable run */
    } else if (d->debounce_tmr < d->debounce_time) {
        d->debounce_tmr++;
    }
    if (d->debounce_tmr >= d->debounce_time && d->debounced_state != d->previous_state) {
        d->debounced_state = d->previous_state;
        d->service_needed = 1u;
    }
}

uint8_t io_debounce_state(const discrete_input_t *d) { return d->debounced_state; }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_io_debounce --output-on-failure`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add firmware/g0b1-apu/App/services/io_debounce.h firmware/g0b1-apu/App/services/io_debounce.c firmware/g0b1-apu/Tests/test_io_debounce.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): io_debounce — discrete-input integrator (DEBOUNCE_TIME, discrete_input_t)"
```

---

### Task 4: app_timers — countdown-timer arrays

**Files:**
- Create: `firmware/g0b1-apu/App/services/app_timers.h`, `firmware/g0b1-apu/App/services/app_timers.c`
- Create: `firmware/g0b1-apu/Tests/test_app_timers.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Produces: `typedef enum { SCALE_MS=0, SCALE_TEN_MS, SCALE_HUNDRED_MS, SCALE_SECOND, SCALE_MINUTE, SCALE_COUNT } app_timer_scale_t;` and the five index enums (verbatim from Global Constraints) with their `NUM_*` counts.
- Produces: `void app_timers_init(void);` (all timers 0) `void app_timer_set(app_timer_scale_t s, uint8_t idx, uint16_t ticks);` `uint16_t app_timer_get(app_timer_scale_t s, uint8_t idx);` `bool app_timer_expired(app_timer_scale_t s, uint8_t idx);` (== 0) `void app_timers_tick(app_timer_scale_t s);` (decrement every nonzero timer in scale `s` by 1; used by the scheduler in Task 5).
- Out-of-range `idx`/`s`: `set` is a no-op, `get` returns 0, `expired` returns true.

- [ ] **Step 1: Write `App/services/app_timers.h`**

```c
#ifndef APP_TIMERS_H
#define APP_TIMERS_H
#include "types.h"

typedef enum { SCALE_MS = 0, SCALE_TEN_MS, SCALE_HUNDRED_MS, SCALE_SECOND, SCALE_MINUTE, SCALE_COUNT } app_timer_scale_t;

enum { EVAP_PWM_PERIOD_TMR = 0, EVAP_PWM_ON_TMR, NUM_ONE_MS_TIMER };
enum { SHORT_DELAY_TMR = 0, RPM_STOP_TMR, NUM_TEN_MS_TIMER };
enum { GLOW_PLUG_ON_TMR = 0, RPM_LOW_TMR, NUM_100_MS_TIMER };
enum { POWER_UP_TMR = 0, EVENT_INTERVAL_TMR, COMP_EVAP_DELAY_TMR, BATT_STABLE_TMR,
       COMPRESOR_OUT_TMR, FUEL_PUMP_ONOFF_TIMER, EVAP_FORCED_ON_TMR, NUM_ONE_SECOND_TIMER };
enum { CHARGING_BATT_TMR = 0, NEXT_OIL_WARNING_TMR, DEFROST_CYCLE_TMR, CLMT_LOW_BATT_TMR,
       CABIN_TEMP_WARMUP_TMR, NUM_ONE_MINUTE_TIMER };

void     app_timers_init(void);
void     app_timer_set(app_timer_scale_t s, uint8_t idx, uint16_t ticks);
uint16_t app_timer_get(app_timer_scale_t s, uint8_t idx);
bool     app_timer_expired(app_timer_scale_t s, uint8_t idx);   /* value == 0 */
void     app_timers_tick(app_timer_scale_t s);                  /* decrement nonzero timers in scale s */

#endif /* APP_TIMERS_H */
```

- [ ] **Step 2: Write the failing test `Tests/test_app_timers.c`**

```c
#include "unity.h"
#include "app_timers.h"

void setUp(void) { app_timers_init(); }
void tearDown(void) {}

static void test_set_get_and_expired(void) {
    TEST_ASSERT_TRUE(app_timer_expired(SCALE_SECOND, POWER_UP_TMR));  /* 0 at init */
    app_timer_set(SCALE_SECOND, POWER_UP_TMR, 3);
    TEST_ASSERT_EQUAL_UINT16(3, app_timer_get(SCALE_SECOND, POWER_UP_TMR));
    TEST_ASSERT_FALSE(app_timer_expired(SCALE_SECOND, POWER_UP_TMR));
}

static void test_tick_decrements_to_zero_then_stops(void) {
    app_timer_set(SCALE_SECOND, BATT_STABLE_TMR, 2);
    app_timers_tick(SCALE_SECOND);
    TEST_ASSERT_EQUAL_UINT16(1, app_timer_get(SCALE_SECOND, BATT_STABLE_TMR));
    app_timers_tick(SCALE_SECOND);
    TEST_ASSERT_EQUAL_UINT16(0, app_timer_get(SCALE_SECOND, BATT_STABLE_TMR));
    TEST_ASSERT_TRUE(app_timer_expired(SCALE_SECOND, BATT_STABLE_TMR));
    app_timers_tick(SCALE_SECOND);                                    /* stays at 0 */
    TEST_ASSERT_EQUAL_UINT16(0, app_timer_get(SCALE_SECOND, BATT_STABLE_TMR));
}

static void test_tick_only_affects_its_scale(void) {
    app_timer_set(SCALE_SECOND, POWER_UP_TMR, 5);
    app_timer_set(SCALE_MINUTE, DEFROST_CYCLE_TMR, 5);
    app_timers_tick(SCALE_SECOND);
    TEST_ASSERT_EQUAL_UINT16(4, app_timer_get(SCALE_SECOND, POWER_UP_TMR));
    TEST_ASSERT_EQUAL_UINT16(5, app_timer_get(SCALE_MINUTE, DEFROST_CYCLE_TMR)); /* untouched */
}

static void test_multiple_timers_in_scale_decrement_together(void) {
    app_timer_set(SCALE_TEN_MS, SHORT_DELAY_TMR, 3);
    app_timer_set(SCALE_TEN_MS, RPM_STOP_TMR, 1);
    app_timers_tick(SCALE_TEN_MS);
    TEST_ASSERT_EQUAL_UINT16(2, app_timer_get(SCALE_TEN_MS, SHORT_DELAY_TMR));
    TEST_ASSERT_EQUAL_UINT16(0, app_timer_get(SCALE_TEN_MS, RPM_STOP_TMR));
}

static void test_out_of_range_safe(void) {
    app_timer_set(SCALE_TEN_MS, 99, 5);                    /* no-op, no crash */
    TEST_ASSERT_EQUAL_UINT16(0, app_timer_get(SCALE_TEN_MS, 99));
    TEST_ASSERT_TRUE(app_timer_expired(SCALE_TEN_MS, 99));
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_set_get_and_expired);
    RUN_TEST(test_tick_decrements_to_zero_then_stops);
    RUN_TEST(test_tick_only_affects_its_scale);
    RUN_TEST(test_multiple_timers_in_scale_decrement_together);
    RUN_TEST(test_out_of_range_safe);
    return UNITY_END();
}
```

- [ ] **Step 3: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_app_timers test_app_timers.c ../App/services/app_timers.c)
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_app_timers --output-on-failure`
Expected: build fails — `app_timer*` undefined.

- [ ] **Step 5: Write `App/services/app_timers.c`**

```c
#include "app_timers.h"

static const uint8_t s_count[SCALE_COUNT] = {
    NUM_ONE_MS_TIMER, NUM_TEN_MS_TIMER, NUM_100_MS_TIMER, NUM_ONE_SECOND_TIMER, NUM_ONE_MINUTE_TIMER
};
static uint16_t s_ms[NUM_ONE_MS_TIMER];
static uint16_t s_ten[NUM_TEN_MS_TIMER];
static uint16_t s_hun[NUM_100_MS_TIMER];
static uint16_t s_sec[NUM_ONE_SECOND_TIMER];
static uint16_t s_min[NUM_ONE_MINUTE_TIMER];
static uint16_t *const s_arr[SCALE_COUNT] = { s_ms, s_ten, s_hun, s_sec, s_min };

void app_timers_init(void) {
    for (uint8_t sc = 0; sc < SCALE_COUNT; sc++)
        for (uint8_t i = 0; i < s_count[sc]; i++) s_arr[sc][i] = 0u;
}
void app_timer_set(app_timer_scale_t s, uint8_t idx, uint16_t ticks) {
    if (s < SCALE_COUNT && idx < s_count[s]) s_arr[s][idx] = ticks;
}
uint16_t app_timer_get(app_timer_scale_t s, uint8_t idx) {
    return (s < SCALE_COUNT && idx < s_count[s]) ? s_arr[s][idx] : 0u;
}
bool app_timer_expired(app_timer_scale_t s, uint8_t idx) { return app_timer_get(s, idx) == 0u; }
void app_timers_tick(app_timer_scale_t s) {
    if (s >= SCALE_COUNT) return;
    for (uint8_t i = 0; i < s_count[s]; i++) if (s_arr[s][i] > 0u) s_arr[s][i]--;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_app_timers --output-on-failure`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add firmware/g0b1-apu/App/services/app_timers.h firmware/g0b1-apu/App/services/app_timers.c firmware/g0b1-apu/Tests/test_app_timers.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): app_timers — five countdown-timer arrays (PIC enum indices)"
```

---

### Task 5: sched — cooperative due-flag scheduler (drives slots + timers)

**Files:**
- Create: `firmware/g0b1-apu/App/services/sched.h`, `firmware/g0b1-apu/App/services/sched.c`
- Create: `firmware/g0b1-apu/Tests/test_sched.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `app_timers.h` (Task 4) — the scheduler ticks the timer scales at their boundaries.
- Produces: `typedef enum { SLOT_10MS=0, SLOT_50MS, SLOT_100MS, SLOT_1S, SLOT_5S, SLOT_1MIN, SLOT_COUNT } sched_slot_t;` `typedef void (*sched_handler_fn)(void);` `void sched_init(void);` (clears accumulator/flags/handlers **and** calls `app_timers_init`) `void sched_register(sched_slot_t slot, sched_handler_fn h);` `void sched_service(uint16_t elapsed_ms);` (advance time: per whole ms, tick `SCALE_MS`; at each slot boundary set that slot's due-flag and tick its timer scale where one exists) `void sched_run(void);` (for each set due-flag, call its handler if registered, then clear the flag) `bool sched_slot_due(sched_slot_t slot);` (test hook).
- Slot→timer-scale coupling: `SLOT_10MS`→`SCALE_TEN_MS`, `SLOT_100MS`→`SCALE_HUNDRED_MS`, `SLOT_1S`→`SCALE_SECOND`, `SLOT_1MIN`→`SCALE_MINUTE`. `SLOT_50MS` and `SLOT_5S` have no timer scale (flags only). `SCALE_MS` is ticked every millisecond (no slot). Timer decrements happen **once per period boundary** (accurate under jitter); the due-flag is a boolean (collapses if multiple periods elapse before `sched_run`).

- [ ] **Step 1: Write `App/services/sched.h`**

```c
#ifndef SCHED_H
#define SCHED_H
#include "types.h"

typedef enum { SLOT_10MS = 0, SLOT_50MS, SLOT_100MS, SLOT_1S, SLOT_5S, SLOT_1MIN, SLOT_COUNT } sched_slot_t;
typedef void (*sched_handler_fn)(void);

void sched_init(void);                                  /* clears state + app_timers_init() */
void sched_register(sched_slot_t slot, sched_handler_fn h);
void sched_service(uint16_t elapsed_ms);                /* advance the clock */
void sched_run(void);                                   /* dispatch due slots to handlers */
bool sched_slot_due(sched_slot_t slot);                 /* test hook */

#endif /* SCHED_H */
```

- [ ] **Step 2: Write the failing test `Tests/test_sched.c`**

```c
#include "unity.h"
#include "sched.h"
#include "app_timers.h"

static uint32_t s_calls[SLOT_COUNT];
static void h_10ms(void)  { s_calls[SLOT_10MS]++; }
static void h_50ms(void)  { s_calls[SLOT_50MS]++; }
static void h_100ms(void) { s_calls[SLOT_100MS]++; }
static void h_1s(void)    { s_calls[SLOT_1S]++; }
static void h_5s(void)    { s_calls[SLOT_5S]++; }
static void h_1min(void)  { s_calls[SLOT_1MIN]++; }

void setUp(void) {
    sched_init();
    for (int i = 0; i < SLOT_COUNT; i++) s_calls[i] = 0;
    sched_register(SLOT_10MS, h_10ms);   sched_register(SLOT_50MS, h_50ms);
    sched_register(SLOT_100MS, h_100ms); sched_register(SLOT_1S, h_1s);
    sched_register(SLOT_5S, h_5s);       sched_register(SLOT_1MIN, h_1min);
}
void tearDown(void) {}

/* Advance `total` ms in `step`-ms increments, running the scheduler each step. */
static void advance(uint16_t total, uint16_t step) {
    for (uint16_t t = 0; t < total; t += step) { sched_service(step); sched_run(); }
}

static void test_10ms_slot_fires_each_10ms(void) {
    advance(100, 1);                       /* 100 ms in 1 ms steps */
    TEST_ASSERT_EQUAL_UINT32(10, s_calls[SLOT_10MS]);
    TEST_ASSERT_EQUAL_UINT32(2,  s_calls[SLOT_50MS]);
    TEST_ASSERT_EQUAL_UINT32(1,  s_calls[SLOT_100MS]);
    TEST_ASSERT_EQUAL_UINT32(0,  s_calls[SLOT_1S]);
}

static void test_second_and_minute_cadence(void) {
    advance(60000, 10);                    /* 60 s in 10 ms steps */
    TEST_ASSERT_EQUAL_UINT32(60,   s_calls[SLOT_1S]);
    TEST_ASSERT_EQUAL_UINT32(12,   s_calls[SLOT_5S]);
    TEST_ASSERT_EQUAL_UINT32(1,    s_calls[SLOT_1MIN]);
    TEST_ASSERT_EQUAL_UINT32(6000, s_calls[SLOT_10MS]);
}

static void test_scheduler_ticks_timer_scales(void) {
    app_timer_set(SCALE_SECOND, POWER_UP_TMR, 3);
    app_timer_set(SCALE_TEN_MS, SHORT_DELAY_TMR, 5);
    advance(1000, 1);                      /* 1 s: 100 ten-ms ticks, 1 second tick */
    TEST_ASSERT_EQUAL_UINT16(2, app_timer_get(SCALE_SECOND, POWER_UP_TMR)); /* 3 - 1 */
    TEST_ASSERT_EQUAL_UINT16(0, app_timer_get(SCALE_TEN_MS, SHORT_DELAY_TMR)); /* floored */
}

static void test_due_flag_collapses_but_timer_accurate_under_jitter(void) {
    /* One big 30 ms step: SLOT_10MS handler runs once (flag collapsed), but the
       10 ms timer scale decrements 3 times (accuracy preserved). */
    app_timer_set(SCALE_TEN_MS, SHORT_DELAY_TMR, 10);
    sched_service(30); sched_run();
    TEST_ASSERT_EQUAL_UINT32(1, s_calls[SLOT_10MS]);                       /* collapsed */
    TEST_ASSERT_EQUAL_UINT16(7, app_timer_get(SCALE_TEN_MS, SHORT_DELAY_TMR)); /* 10 - 3 */
}

static void test_unregistered_slot_is_safe(void) {
    sched_init();                          /* no handlers registered */
    sched_service(10); sched_run();        /* must not crash */
    TEST_ASSERT_TRUE(true);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_10ms_slot_fires_each_10ms);
    RUN_TEST(test_second_and_minute_cadence);
    RUN_TEST(test_scheduler_ticks_timer_scales);
    RUN_TEST(test_due_flag_collapses_but_timer_accurate_under_jitter);
    RUN_TEST(test_unregistered_slot_is_safe);
    return UNITY_END();
}
```

- [ ] **Step 3: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_sched test_sched.c ../App/services/sched.c ../App/services/app_timers.c)
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_sched --output-on-failure`
Expected: build fails — `sched_*` undefined.

- [ ] **Step 5: Write `App/services/sched.c`**

```c
#include "sched.h"
#include "app_timers.h"

static uint32_t s_ms;                       /* monotonic millisecond counter */
static bool     s_due[SLOT_COUNT];
static sched_handler_fn s_handler[SLOT_COUNT];

static const uint32_t s_period[SLOT_COUNT] = { 10u, 50u, 100u, 1000u, 5000u, 60000u };

void sched_init(void) {
    s_ms = 0u;
    for (uint8_t i = 0; i < SLOT_COUNT; i++) { s_due[i] = false; s_handler[i] = 0; }
    app_timers_init();
}

void sched_register(sched_slot_t slot, sched_handler_fn h) {
    if (slot < SLOT_COUNT) s_handler[slot] = h;
}

void sched_service(uint16_t elapsed_ms) {
    for (uint16_t k = 0; k < elapsed_ms; k++) {
        s_ms++;
        app_timers_tick(SCALE_MS);                             /* every 1 ms */
        if (s_ms % 10u   == 0u) { s_due[SLOT_10MS]  = true; app_timers_tick(SCALE_TEN_MS); }
        if (s_ms % 50u   == 0u) { s_due[SLOT_50MS]  = true; }
        if (s_ms % 100u  == 0u) { s_due[SLOT_100MS] = true; app_timers_tick(SCALE_HUNDRED_MS); }
        if (s_ms % 1000u == 0u) { s_due[SLOT_1S]    = true; app_timers_tick(SCALE_SECOND); }
        if (s_ms % 5000u == 0u) { s_due[SLOT_5S]    = true; }
        if (s_ms % 60000u== 0u) { s_due[SLOT_1MIN]  = true; app_timers_tick(SCALE_MINUTE); }
    }
}

void sched_run(void) {
    for (uint8_t i = 0; i < SLOT_COUNT; i++) {
        if (s_due[i]) {
            if (s_handler[i]) s_handler[i]();
            s_due[i] = false;
        }
    }
}

bool sched_slot_due(sched_slot_t slot) { return (slot < SLOT_COUNT) ? s_due[slot] : false; }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_sched --output-on-failure`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add firmware/g0b1-apu/App/services/sched.h firmware/g0b1-apu/App/services/sched.c firmware/g0b1-apu/Tests/test_sched.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): sched — cooperative due-flag scheduler (slots + per-scale timer ticks)"
```

---

### Task 6: End-to-end integration — scheduler drives inputs, timers, and outputs

**Files:**
- Create: `firmware/g0b1-apu/Tests/test_bsp_integration.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `sched`, `app_timers`, `io_debounce`, `bsp_io`, `bsp_pwm`, `fan_speed` + the two fakes. No new production code — this task proves the M5 modules compose.

- [ ] **Step 1: Write the failing test `Tests/test_bsp_integration.c`**

```c
#include "unity.h"
#include "sched.h"
#include "app_timers.h"
#include "io_debounce.h"
#include "bsp_io.h"
#include "bsp_pwm.h"
#include "fan_speed.h"
#include "fake_bsp_io.h"
#include "fake_bsp_pwm.h"

static bsp_io_backend_t  io_be;
static bsp_pwm_backend_t pwm_be;
static discrete_input_t  oil;

/* A 10 ms slot handler: sample the (debounced) oil-pressure input and, once it
   reads CLOSED, energize the fuel pump and drive the evap fan at LOW. */
static void ctrl_10ms(void) {
    io_debounce_service(&oil, bsp_in_read(IN_OIL_PRESSURE) ? SWITCH_CLOSED : SWITCH_OPEN);
    if (io_debounce_state(&oil) == SWITCH_CLOSED) {
        bsp_out_set(OUT_FUEL_PUMP, true);
        bsp_pwm_set(PWM_EVAP_FAN, fan_speed_permille(FAN_LOW));
    }
}

void setUp(void) {
    fake_bsp_io_init(&io_be);   bsp_io_init(&io_be);
    fake_bsp_pwm_init(&pwm_be); bsp_pwm_init(&pwm_be);
    io_debounce_init(&oil, DEBOUNCE_TIME, SWITCH_OPEN);
    sched_init();
    sched_register(SLOT_10MS, ctrl_10ms);
}
void tearDown(void) {}

static void advance(uint16_t total_ms) {
    for (uint16_t t = 0; t < total_ms; t += 1u) { sched_service(1u); sched_run(); }
}

static void test_debounced_input_drives_outputs_through_scheduler(void) {
    /* Oil pressure low the whole time -> nothing energizes. */
    advance(200);
    TEST_ASSERT_FALSE(fake_bsp_io_out(OUT_FUEL_PUMP));
    TEST_ASSERT_EQUAL_UINT16(0, fake_bsp_pwm_duty(PWM_EVAP_FAN));

    /* Now assert oil pressure; the 10 ms slot fires every 10 ms, so DEBOUNCE_TIME(10)
       consecutive samples = 100 ms until the debounced state commits and outputs latch. */
    fake_bsp_io_set_input(IN_OIL_PRESSURE, true);
    advance(90);                              /* 9 slot samples: not yet committed */
    TEST_ASSERT_FALSE(fake_bsp_io_out(OUT_FUEL_PUMP));
    advance(20);                              /* crosses the 10th sample -> commit */
    TEST_ASSERT_TRUE(fake_bsp_io_out(OUT_FUEL_PUMP));
    TEST_ASSERT_EQUAL_UINT16(318, fake_bsp_pwm_duty(PWM_EVAP_FAN)); /* FAN_LOW */
}

static void test_second_timer_expires_under_scheduler(void) {
    app_timer_set(SCALE_SECOND, POWER_UP_TMR, 2);
    advance(1000);
    TEST_ASSERT_FALSE(app_timer_expired(SCALE_SECOND, POWER_UP_TMR)); /* 1 left */
    advance(1000);
    TEST_ASSERT_TRUE(app_timer_expired(SCALE_SECOND, POWER_UP_TMR));  /* reached 0 */
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_debounced_input_drives_outputs_through_scheduler);
    RUN_TEST(test_second_timer_expires_under_scheduler);
    return UNITY_END();
}
```

- [ ] **Step 2: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_bsp_integration test_bsp_integration.c ../App/services/sched.c ../App/services/app_timers.c ../App/services/io_debounce.c ../App/services/bsp_io.c ../App/services/bsp_pwm.c ../App/services/fan_speed.c fakes/fake_bsp_io.c fakes/fake_bsp_pwm.c)
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_bsp_integration --output-on-failure`
Expected: FAIL at first run only if a module is missing; otherwise it should pass once all M5 modules exist. (If it fails on a genuine composition bug, fix the offending module, not the test.)

- [ ] **Step 4: Confirm it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_bsp_integration --output-on-failure`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build --output-on-failure`
Expected: all tests pass (31 prior M1–M4b + 6 new M5 = **37 executables**), zero warnings under `-Werror`.

- [ ] **Step 6: Commit**

```bash
git add firmware/g0b1-apu/Tests/test_bsp_integration.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "test(g0b1-apu): BSP/scheduler end-to-end — debounced input → timers → outputs over fakes"
```

---

## Deferred to hardware bring-up / later milestones

- **Concrete `bsp_*` HAL** implementing the backends: `bsp_io` (GPIO relay drive via ULN2003; RC/BJT-buffered digital-input read), `bsp_pwm` (TIM2 CH1 PC4 / CH2 PC5, ~1 kHz, duty from permille), `bsp_adc` (ADC1 + circular DMA over IN0–IN5, HW oversampling → feeds `sensors_add_sample`), `bsp_rpm` (TIM3_CH1 input-capture → implements `rpm_source`), `bsp_now_ms` (SysTick 1 ms → the `elapsed_ms` feeding `sched_service`).
- **Drivers**: `drv_s25fl064` (→ `nvm_backend`, page-split program), `drv_mcp7940n` (→ `i2c_backend`), `drv_modbus_uart` (USART1 + DE PB3 + DMA + RTO → `mb_engine_process`).
- **`main()` superloop + `.ioc`**: init (HAL → BSP → services → load NVM/factory-init → start ADC-DMA/RTC/Modbus), register the M6 control routines into the scheduler slots, superloop = `sched_service(bsp_now_ms delta)` + `sched_run()` + `iwdg_kick()`. Pairs with M1 Task 1 (USER-OWNED).
- **Large-`elapsed_ms` guard**: `sched_service` loops per-millisecond; on target `elapsed_ms` is ~1 (SysTick), so this is bounded. If a future caller can pass a very large delta, add a cap.
- **Debounce reconciliation** (carry-forward): confirm the integrator against the original PIC `ServiceSwitch` if it surfaces.

## Carry-forward items to confirm

- **Fan-duty ratios** (`fan_speed`): confirm ~32 %/55 %/100 % against the evap-fan behavior at bench; the permille values (318/545/1000) preserve the PIC 7/12/22-of-22 ratio exactly.
- **Slot handler set**: M6 registers the real control routines; the slot→work mapping (spec §8.1) is the M6 plan's responsibility.

---

## Self-Review

**Spec coverage (§5, §8.1, §8.3):** cooperative time-triggered scheduler with the PIC slot cadences ✅ (Task 5); `flag0` due-flags → `sched` due-flags ✅ (Task 5); the five `*_timer` arrays as `app_timers` with same enum indices ✅ (Task 4); `io_debounce` with `discrete_input_t`/`DEBOUNCE_TIME` ✅ (Task 3); BSP `bsp_io`/`bsp_pwm` logical hardware-free API ✅ (Tasks 1–2); evap-fan Low/Med/High duty ratios ✅ (Task 2). Concrete HAL (`bsp_adc`/`bsp_rpm`/`bsp_io`/`bsp_pwm` impls, `drv_*`, SysTick, `.ioc`, `main()` wiring) ⏸ deferred to bench (documented). `outputs_apply` + the control state machines that register into the slots are M6, not this milestone.

**Placeholder scan:** no TBD/TODO. The one non-portable-source-derived item (the exact PIC `ServiceSwitch` debounce body) is implemented as an explicit, documented integrator with the `discrete_input_t` fields and a reconciliation carry-forward — the algorithm is fully specified and hand-testable, not a hand-wave.

**Type consistency:** `bsp_out_t`/`bsp_pwm_ch_t`/`bsp_in_t` (Task 1 `board_pins.h`) are used by `bsp_io`/`bsp_pwm`/fakes and the integration test verbatim. `bsp_io_backend_t`/`bsp_pwm_backend_t` signatures match their façades and fakes. `discrete_input_t` fields (Task 3) match the test and the integration handler. `app_timer_scale_t` + the five index enums (Task 4) are used identically by `sched` (Task 5) and the tests; `sched_slot_t`/`sched_handler_fn` and the slot→scale coupling are consistent across `sched.c` and both test files. `fan_speed_t` + `FAN_DUTY_*` (Task 2) match the integration test's `fan_speed_permille(FAN_LOW)` → 318 assertion. Each test's CMake dependency list compiles only the sources it exercises.
