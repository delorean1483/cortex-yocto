# Home Climate Control — Firmware Plan (Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a firmware auto-fan control law to the STM32 APU: a new `fan_auto` register (fw reg 9) and, in CLIMATE mode when `fan_auto=1`, drive the evap-fan percent from the cabin-vs-setpoint temperature gap instead of the manual reg-12 value.

**Architecture:** A pure percent-in/percent-out control law (`fan_auto_pct`) in `fan_speed.c`; a live-context flag `ctx->fan_auto` toggled by a Pattern-B R/W register in `control_io.c` (like reg 32 standby, no NVM); and a one-line branch at the top of `control_climate_mode()` selecting the auto law vs. the manual value. The applied fan rides the existing `ctx->out.evap_speed` → `outputs_apply()` → `fan_duty_permille()` path (the 318‰ hardware spin floor is applied downstream — the law works in percent 0–100).

**Tech Stack:** C11, STM32 HAL (CubeIDE project under `cube/`), Unity host tests via CMake/ctest under `Tests/`.

**Spec:** `docs/superpowers/specs/2026-09-02-home-climate-control-design.md` (§3 register contract, §4 control law).

**Repo/branch:** `g0b1-firmware`, branch `feat/stm32g0-apu-port` (local; the working copy is at `firmware/g0b1-apu/` in the cortex-yocto checkout). All paths below are relative to `firmware/g0b1-apu/`.

## Global Constraints

- Host tests build/run with: `cmake -S Tests -B Tests/build && cmake --build Tests/build` then `ctest --test-dir Tests/build --output-on-failure`. Flags are `-Wall -Wextra -Werror -funsigned-char` — no warnings allowed.
- `fan_auto` = **fw register 9** (confirmed free in the census; **do not use reg 15** — it is the cold-storage temp setting). Pattern B (live `ctx` flag), **not** NVM-backed.
- The auto-fan law operates in **percent 0–100**. Do not touch duty/permille in the law; `outputs_apply()` already calls `fan_duty_permille(pct)` which applies the 318‰ min-spin floor.
- Cabin temp and setpoint are **int16 degF** (`ctx->cabin_temperature`, `ctx->clmt_temp_setting`).
- Fan is applied only through `ctx->out.evap_speed` (percent). Never write PWM directly from the law.

---

### Task 1: Auto-fan control law (pure function)

**Files:**
- Modify: `App/services/fan_speed.h`, `App/services/fan_speed.c`
- Test: `Tests/test_fan_speed.c` (already links `fan_speed.c`)

**Interfaces:**
- Produces: `uint8_t fan_auto_pct(int16_t cabin_f, int16_t setpoint_f)` — evap-fan percent (0–100) for AUTO cooling. Consumed by Task 3.

**Law (cooling-focused):** `e = clamp(cabin_f - setpoint_f, 0, SPAN)`, `pct = MIN + (100 - MIN) * e / SPAN`. At/below target → `MIN`; ≥ `SPAN` over → `100`. Constants: `AUTO_FAN_MIN_PCT = 32`, `AUTO_FAN_SPAN_F = 6`.

- [ ] **Step 1: Write the failing tests** — append to `Tests/test_fan_speed.c` (and add the `RUN_TEST` lines to its `main()`):

```c
static void test_fan_auto_at_or_below_target_is_min(void) {
    TEST_ASSERT_EQUAL_UINT8(32, fan_auto_pct(70, 70));   /* at target */
    TEST_ASSERT_EQUAL_UINT8(32, fan_auto_pct(68, 70));   /* below target (cooling unit) */
}
static void test_fan_auto_ramps_with_gap(void) {
    TEST_ASSERT_EQUAL_UINT8(43, fan_auto_pct(71, 70));   /* +1F: 32 + 68*1/6 = 43 (trunc) */
    TEST_ASSERT_EQUAL_UINT8(66, fan_auto_pct(73, 70));   /* +3F: 32 + 68*3/6 = 66 */
}
static void test_fan_auto_saturates_at_100(void) {
    TEST_ASSERT_EQUAL_UINT8(100, fan_auto_pct(76, 70));  /* +6F: full */
    TEST_ASSERT_EQUAL_UINT8(100, fan_auto_pct(90, 70));  /* +20F: clamped */
}
```

- [ ] **Step 2: Run — expect FAIL** (`fan_auto_pct` undefined):

Run: `cmake --build Tests/build && ctest --test-dir Tests/build -R test_fan_speed --output-on-failure`
Expected: compile/link error (undefined `fan_auto_pct`).

- [ ] **Step 3: Implement** — add to `fan_speed.h`:

```c
#define AUTO_FAN_MIN_PCT 32u   /* auto-ramp floor (percent), tunable */
#define AUTO_FAN_SPAN_F   6    /* degF of cooling gap that maps to 100% */
uint8_t fan_auto_pct(int16_t cabin_f, int16_t setpoint_f);   /* AUTO cooling fan percent */
```

and to `fan_speed.c`:

```c
uint8_t fan_auto_pct(int16_t cabin_f, int16_t setpoint_f)
{
    int32_t e = (int32_t)cabin_f - (int32_t)setpoint_f;   /* cooling error, degF */
    if (e <= 0) return (uint8_t)AUTO_FAN_MIN_PCT;
    if (e >= AUTO_FAN_SPAN_F) return 100u;
    return (uint8_t)(AUTO_FAN_MIN_PCT + ((100u - AUTO_FAN_MIN_PCT) * (uint32_t)e) / (uint32_t)AUTO_FAN_SPAN_F);
}
```

- [ ] **Step 4: Run — expect PASS:** `ctest --test-dir Tests/build -R test_fan_speed --output-on-failure`

- [ ] **Step 5: Commit:**

```bash
git add App/services/fan_speed.h App/services/fan_speed.c Tests/test_fan_speed.c
git commit -m "feat(fw): fan_auto_pct — cooling-gap-to-fan-percent law (host-tested)"
```

---

### Task 2: `fan_auto` register (fw9) + ctx flag

**Files:**
- Modify: `App/services/control.h` (add `bool fan_auto;` to `apu_ctx_t`)
- Modify: `App/services/control_io.c` (rd/wr provider + bind reg 9 in `control_regs_register`)
- Test: `Tests/test_control_io.c` (already registered; links `control_io.c`, `mb_regmodel.c`, `control.c`)

**Interfaces:**
- Consumes: `mb_reg_bind`, `s_ctx` (module-static `apu_ctx_t*` set by `control_regs_register`).
- Produces: `ctx->fan_auto` (bool) — read by Task 3. Register 9: read = flag as 0/1; write 0/1 sets it, write >1 → `MB_EXC_ILLEGAL_VALUE`.

- [ ] **Step 1: Write the failing test** — append to `Tests/test_control_io.c` (+ `RUN_TEST` lines in its `main()`). Follow the existing `control_regs_register(&ctx)` setup in that file:

```c
static void test_fan_auto_reg_roundtrip_and_range(void) {
    apu_ctx_t ctx; memset(&ctx, 0, sizeof ctx);
    mb_reg_reset();
    control_regs_register(&ctx);
    uint16_t o = 0xFF;
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(9, 1));
    TEST_ASSERT_TRUE(ctx.fan_auto);
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_read(9, &o));
    TEST_ASSERT_EQUAL_UINT16(1, o);
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(9, 0));
    TEST_ASSERT_FALSE(ctx.fan_auto);
    TEST_ASSERT_EQUAL_INT(MB_EXC_ILLEGAL_VALUE, mb_reg_write(9, 2));   /* out of range */
}
```

- [ ] **Step 2: Run — expect FAIL** (`ctx.fan_auto` field / reg 9 unbound):

Run: `cmake --build Tests/build && ctest --test-dir Tests/build -R test_control_io --output-on-failure`
Expected: compile error (no `fan_auto` member) or `test_fan_auto_reg_roundtrip_and_range` FAIL (reg 9 unbound → `ILLEGAL_ADDRESS`).

- [ ] **Step 3a: Implement — add the field** to `apu_ctx_t` in `App/services/control.h` (near `evap_fan_speed`):

```c
    bool     fan_auto;           /* reg 9: 1 = auto-fan from cabin/setpoint gap, 0 = manual reg-12 */
```

- [ ] **Step 3b: Implement — provider + bind** in `App/services/control_io.c` (mirror `rd_standby`/`wr_standby`):

```c
static modbus_exc_t rd_fan_auto(uint16_t r, uint16_t *o) { (void)r; *o = s_ctx->fan_auto ? 1u : 0u; return MB_EXC_NONE; }
static modbus_exc_t wr_fan_auto(uint16_t r, uint16_t v) {
    (void)r;
    if (v > 1u) return MB_EXC_ILLEGAL_VALUE;
    s_ctx->fan_auto = (v != 0u);
    return MB_EXC_NONE;
}
/* ...inside control_regs_register(): */
    mb_reg_bind(9, rd_fan_auto, wr_fan_auto);
```

- [ ] **Step 4: Run — expect PASS:** `ctest --test-dir Tests/build -R test_control_io --output-on-failure`

- [ ] **Step 5: Commit:**

```bash
git add App/services/control.h App/services/control_io.c Tests/test_control_io.c
git commit -m "feat(fw): fan_auto register (reg 9) + ctx flag (host-tested)"
```

---

### Task 3: Apply the law in CLIMATE mode

**Files:**
- Modify: `App/services/control_climate.c` (the `ctx->out.evap_speed = ...` line at the top of `control_climate_mode`)
- Test: `Tests/test_control_climate.c` (already links `fan_speed.c` + `control_climate.c`)

**Interfaces:**
- Consumes: `fan_auto_pct` (Task 1), `ctx->fan_auto` (Task 2), `ctx->cabin_temperature`, `ctx->clmt_temp_setting`.

- [ ] **Step 1: Write the failing tests** — append to `Tests/test_control_climate.c` (+ `RUN_TEST` lines). Use the file's direct-ctx injection pattern (`setUp` calls `control_init(&ctx); ctx.op_state = OP_CLIMATE;`):

```c
static void test_climate_manual_fan_unchanged(void) {
    ctx.fan_auto = false; ctx.evap_fan_speed = 40;
    control_climate_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT8(40, ctx.out.evap_speed);   /* manual path preserved */
}
static void test_climate_auto_fan_tracks_gap(void) {
    ctx.fan_auto = true; ctx.clmt_temp_setting = 70;
    ctx.cabin_temperature = 76;                          /* +6F -> 100% */
    control_climate_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT8(100, ctx.out.evap_speed);
    ctx.cabin_temperature = 70;                          /* at target -> MIN */
    control_climate_mode(&ctx);
    TEST_ASSERT_EQUAL_UINT8(32, ctx.out.evap_speed);
}
```

- [ ] **Step 2: Run — expect FAIL** (`test_climate_auto_fan_tracks_gap` sees the manual value):

Run: `cmake --build Tests/build && ctest --test-dir Tests/build -R test_control_climate --output-on-failure`
Expected: FAIL — `ctx.out.evap_speed` is still `ctx.evap_fan_speed` (0), not the law output.

- [ ] **Step 3: Implement** — at `control_climate.c` line ~38, replace the manual assignment:

```c
    /* AUTO (reg 9) drives fan from the cabin/setpoint gap; else the manual reg-12 value. */
    ctx->out.evap_speed = ctx->fan_auto
                        ? fan_auto_pct(ctx->cabin_temperature, ctx->clmt_temp_setting)
                        : ctx->evap_fan_speed;
```

Add `#include "fan_speed.h"` to `control_climate.c` if not already present.

- [ ] **Step 4: Run — expect PASS:** `ctest --test-dir Tests/build -R test_control_climate --output-on-failure`

- [ ] **Step 5: Commit:**

```bash
git add App/services/control_climate.c Tests/test_control_climate.c
git commit -m "feat(fw): drive evap fan from auto law in CLIMATE when fan_auto=1"
```

---

### Task 4: Full suite + register doc

**Files:**
- Modify: `Tests/CMakeLists.txt` only if a new source link is needed (it is **not** — `test_fan_speed`, `test_control_io`, `test_control_climate` already link the touched files; verify).
- Modify: `docs/g0b1-modbus-diag-registers.md` (or the canonical reg-map doc) — document reg 9.

- [ ] **Step 1: Configure + build the whole suite fresh:**

Run: `cmake -S Tests -B Tests/build && cmake --build Tests/build`
Expected: builds clean (no `-Werror` warnings).

- [ ] **Step 2: Run the entire suite:**

Run: `ctest --test-dir Tests/build --output-on-failure`
Expected: all tests PASS (the prior suite count + the new cases).

- [ ] **Step 3: Document reg 9** — add a row to the reg-map doc:

```
| 9 | fan_auto | R/W | 0=manual (evap fan uses reg 12), 1=auto (firmware sets evap fan from cabin−setpoint gap in CLIMATE). Out-of-range → ILLEGAL_VALUE. Live flag, not persisted. |
```

- [ ] **Step 4: Commit:**

```bash
git add docs/g0b1-modbus-diag-registers.md Tests/CMakeLists.txt
git commit -m "docs(fw): document fan_auto reg 9; confirm host suite green"
```

---

## Notes / accepted deviations
- Law params (`AUTO_FAN_MIN_PCT`, `AUTO_FAN_SPAN_F`) are compile-time constants (reflash to tune) per the spec's v1 decision; a live-tune register is a documented fast-follow.
- `fan_auto` is a live flag (resets to 0/manual on reboot); consistent with the APU booting to OFF and the UI re-asserting AUTO on selection.
- On-target integer temps make an explicit fractional deadband unnecessary (`e <= 0 → MIN`).
- **Bench validation (post-implementation, not a task here):** on real hardware, enter CLIMATE with `fan_auto=1` and confirm the evap fan ramps with the cabin/setpoint gap and floors at ~32% near target; confirm `fan_auto=0` restores the manual reg-12 value live.
