# STM32G0 APU Port — Milestone 3: Sensor Conversion Service — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the portable, host-tested `sensors` service that converts 12-bit / 3.000 V-ref ADC counts into the PIC firmware's preserved engineering-unit encodings (battery centivolts, external NTC °F, on-board enclosure °F), plus a pluggable engine-RPM source interface with host-tested RPM→engine-status classification.

**Architecture:** Pure, stateless `counts → engineering-unit` conversion functions (no HAL) plus a thin RAM-shadow/averaging layer, exactly mirroring how Milestone 2 put portable logic over an abstract backend and deferred the on-target driver. Host tests feed known ADC counts (derived from the board schematic) directly into the conversions; the real ADC1 + circular-DMA + hardware-oversampling driver (`bsp_adc`) and the real RPM timer-capture are **deferred to hardware bring-up** (see "Deferred" section). Every conversion coefficient and lookup table lives in a single `sensors_cal.h` so the OI-7 bench-calibration pass edits numbers only.

**Tech Stack:** C11, CMake + Unity (host). Reuses `App/include/types.h` from Milestone 1. No `modbus_crc` dependency.

**Design spec:** `docs/superpowers/specs/2026-08-12-pic18-to-stm32g0-apu-port-design.md` §6 (Sensor Re-Scaling), §4 (pin map / ADC channels), §7.3 (register contract). Prereq: Milestone 1 complete (`firmware/g0b1-apu/` harness + `App/include/types.h`).

**Source of truth for preserved behavior:** PIC `analog.c` (`ReadNTCTemperature`, `FindNTCTemperature`, `Find_Cabin_Temperature`, battery math), `parameters.h` register enum, `main.h` (`ENGINE_RPM_LOW_LIMIT`). New-board analog front-end derived from `G0B1 APU Manager R1.pdf` p.3 (Analog Op-Amp Inputs); old-board front-end from `6513F000-99SCH.pdf` p.4–5.

## Global Constraints

- **ADC front-end:** 12-bit, external **3.000 V** precision reference on VREF+ → **4096 counts = 3.000 V** (`ADC_FULL_SCALE_CNT = 4096`, `ADC_VREF_MV = 3000`).
- **ADC channel order** (spec §4 pin map, filled by the deferred `bsp_adc`): `IN0`=enclosure (PA0), `IN1`=A/C high-side P (PA1), `IN2`=A/C low-side P (PA2), `IN3`=battery (PA3), `IN4`=external temp (PA4), `IN5`=engine coolant (PA5). **M3 implements IN0, IN3, IN4 only.**
- **Preserved register contract** (PIC `parameters.h`; Modbus binding itself is deferred to the register-model milestone — M3 only produces the accessors):
  - reg **1** `HR_DSPL_CABIN_TEMP` = on-board **enclosure** temp, °F ← `sensors_get_encl_temp_f()`
  - reg **3** `HR_DSPL_EXT_TEMP_ADC` = external-temp **raw averaged ADC count** ← `sensors_get_ext_adc()`
  - reg **6** `HR_DSPL_BATT_VOLTAGE` = battery **centivolts** ← `sensors_get_batt_cv()`
  - reg **38** `HR_RELAY_ENGINE_RPM` = engine **RPM** ← `rpm_read()`
  - reg **51** `HR_DSPL_EXTERNAL_TEMP` = external NTC temp, °F ← `sensors_get_ext_temp_f()`
- **Calibration trims** (from NVM, Milestone 2 defaults): `vref_calibration` (reg 36, default **250**), `temperature_calibration` (reg 37, default **0**). Both are re-based for the 3.000 V ref but keep the PIC's trim *mechanism* (`×vref_calibration/250` on counts; `+temperature_calibration` on °F).
- **Temperature clamp** (preserve PIC `Find_Cabin_Temperature`): output °F clamped to **[−67, +302]**.
- **Averaging** (preserve PIC): enclosure = **8**-sample rolling; other channels = N-sample (`SENS_AVG_DEFAULT = 8`; per-channel N is a documented carry-forward).
- **Engine-running threshold** (PIC `main.h`): `ENGINE_RPM_LOW_LIMIT = 1000` RPM.
- **Fixed-width integers only** (`<stdint.h>` via `types.h`); temperatures are **signed** (`int16_t`), counts/voltages **unsigned** (`uint16_t`).
- Portable code under `App/services/` — **no HAL**. Firmware root `firmware/g0b1-apu/`. All coefficients/tables isolated in `App/services/sensors_cal.h`. Every task ends green (`ctest`) and is committed.

### Derived conversions (reference — implemented across Tasks 1–3)

- **Battery (IN3):** 30.1 kΩ / 5.1 kΩ divider (ratio 0.144886) into a unity-gain buffer (U8A). Schematic legend: 11.0 V→1.59375 V (2176 cnt), 12.0 V→1.73864 V (2374 cnt), 14.5 V→2.10085 V (2868 cnt). Nominal **0.505517 cV/count**. Integer form with the `vref_calibration` trim:
  `batt_cV = round(counts × vref_calibration × 2 / 989)` → at `vref_calibration=250`: 2176→1100, 2374→1200, 2868→1450.
- **External NTC (IN4):** 10 kΩ pull-up to **3.3 V** rail, off-board NTC to GND (U9A), ADC ref 3.000 V ⇒ **non-ratiometric**. Old board (`6513F000-99SCH.pdf`) uses the same 10 kΩ/NTC-to-GND topology, ratiometric to its ADC ref ⇒ `cnt_new = cnt_old × (4096/1024) × (3.3/3.0) = cnt_old × 4.4`. The 14-point Kohler table's count column is rescaled ×4.4 (Task 2). Disconnect/short → `ext_temp_sensor_state`.
- **Enclosure (IN0):** 3.000 V ref through R64 10 kΩ fixed to R65 = **TMP6131** (TI linear silicon PTC, 10 kΩ @ 25 °C) to GND (U9B) ⇒ **ratiometric**: `S = R_ptc/R25 = counts/(4096−counts)`; 25 °C→S=1.0→**2048 cnt**. Temperature from the TMP6131 datasheet R/R25–vs–T curve (Task 3). Replaces the PIC's 7-zone cabin piecewise-linear entirely (different sensor).

### ⚠️ Findings surfaced by the exact derivation (carry-forward to OI-7 bench pass)

- **F1 — External-NTC disconnect detection is compromised.** Because the NTC divider is excited at 3.3 V but the ADC references 3.000 V, the old disconnect count (1020 → ×4.4 = 4488) exceeds the 4095 ADC max: an **open sensor saturates at 4095, indistinguishable from a genuine ≤ −4 °F reading**. M3 flags disconnect only at rail saturation (`NTC_DISCONNECT_CNT = 4090`, provisional) and floors cold readings at −4 °F, matching old behavior as closely as the hardware allows. Resolving true open-detection is a hardware/bench decision.
- **F2 — External NTC is non-ratiometric** (depends on 3.3 V buck-rail accuracy); enclosure (3.000 V ref) is ratiometric. Note for the bench-calibration asymmetry.
- **F3 — TMP6131 R/R25 values** in `sensors_cal.h` are first-cut from the TMP61 datasheet curve and must be verified against TI SNIS183 (Task 3 Step 1) and the bench pass.
- **F4 — Bottom ~2 °F of external range clipped** (same root cause as F1): readings colder than ≈ −2 °F fold into the saturated band.

---

### Task 1: Calibration header + battery conversion

**Files:**
- Create: `firmware/g0b1-apu/App/services/sensors_cal.h`
- Create: `firmware/g0b1-apu/App/services/sensors.h`
- Create: `firmware/g0b1-apu/App/services/sensors.c`
- Create: `firmware/g0b1-apu/Tests/test_sensors_battery.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Produces: `uint16_t sensors_battery_cv(uint16_t counts, uint16_t vref_cal);` — battery voltage in centivolts from an averaged ADC count and the `vref_calibration` trim.
- Produces (in `sensors_cal.h`): `ADC_FULL_SCALE_CNT` (4096), `ADC_VREF_MV` (3000), `BATT_CV_NUM` (2), `BATT_CV_DEN` (989), `VREF_CAL_DEFAULT` (250).

- [ ] **Step 1: Write `App/services/sensors_cal.h`** (battery section; the temp tables are appended in Tasks 2–3)

```c
#ifndef SENSORS_CAL_H
#define SENSORS_CAL_H
/* All sensor conversion coefficients and lookup tables live here so the
 * OI-7 bench-calibration pass edits numbers only. Derived from
 * "G0B1 APU Manager R1.pdf" p.3 (new front-end) and
 * "6513F000-99SCH.pdf" p.4-5 (old PIC front-end).
 *
 * The lookup-TABLE definitions (added in Tasks 2-3) are emitted only in the
 * TU that #defines SENSORS_CAL_OWNER before including this header (sensors.c).
 * Every other includer (test files, rpm.c) sees the scalar #defines only, so
 * an unused static-const table never trips -Werror,-Wunused-const-variable. */
#include "types.h"

/* ADC front-end: 12-bit, external 3.000 V precision reference. */
#define ADC_FULL_SCALE_CNT  4096
#define ADC_VREF_MV         3000
#define VREF_CAL_DEFAULT    250     /* reg 36 nominal (PIC VREF_CAL_INIT) */

/* Battery (IN3): 30.1k/5.1k divider (0.144886) + unity buffer (U8A).
 * batt_cV = round(counts * vref_cal * BATT_CV_NUM / BATT_CV_DEN).
 * At vref_cal=250 => 0.505517 cV/count (2176->1100, 2374->1200, 2868->1450). */
#define BATT_CV_NUM   2
#define BATT_CV_DEN   989

#endif /* SENSORS_CAL_H */
```

- [ ] **Step 2: Write `App/services/sensors.h`** (battery prototype only for now)

```c
#ifndef SENSORS_H
#define SENSORS_H
#include "types.h"

/* Battery voltage (centivolts) from an averaged ADC count and the reg-36 trim.
 * Rounded integer form of the schematic-derived 0.505517 cV/count. */
uint16_t sensors_battery_cv(uint16_t counts, uint16_t vref_cal);

#endif /* SENSORS_H */
```

- [ ] **Step 3: Write the failing test `Tests/test_sensors_battery.c`**

```c
#include "unity.h"
#include "sensors.h"
#include "sensors_cal.h"

void setUp(void) {}
void tearDown(void) {}

/* Schematic legend golden points at nominal calibration (vref_cal=250). */
static void test_battery_legend_points(void) {
    TEST_ASSERT_EQUAL_UINT16(1100, sensors_battery_cv(2176, VREF_CAL_DEFAULT)); /* 11.00 V */
    TEST_ASSERT_EQUAL_UINT16(1200, sensors_battery_cv(2374, VREF_CAL_DEFAULT)); /* 12.00 V */
    TEST_ASSERT_EQUAL_UINT16(1450, sensors_battery_cv(2868, VREF_CAL_DEFAULT)); /* 14.50 V */
}

static void test_battery_zero(void) {
    TEST_ASSERT_EQUAL_UINT16(0, sensors_battery_cv(0, VREF_CAL_DEFAULT));
}

/* Trim scales linearly: +4% vref_cal => +4% reading. */
static void test_battery_vref_trim(void) {
    uint16_t nom = sensors_battery_cv(2374, 250);
    uint16_t hi  = sensors_battery_cv(2374, 260);
    TEST_ASSERT_EQUAL_UINT16(1200, nom);
    TEST_ASSERT_UINT16_WITHIN(2, 1248, hi); /* 1200 * 260/250 = 1248 */
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_battery_legend_points);
    RUN_TEST(test_battery_zero);
    RUN_TEST(test_battery_vref_trim);
    return UNITY_END();
}
```

- [ ] **Step 4: Register the test in `Tests/CMakeLists.txt`**

Add after the existing `add_unity_test(...)` lines:

```cmake
add_unity_test(test_sensors_battery test_sensors_battery.c ../App/services/sensors.c)
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_sensors_battery --output-on-failure`
Expected: build fails — `sensors_battery_cv` undefined (no `sensors.c` body yet).

- [ ] **Step 6: Write the minimal implementation in `App/services/sensors.c`**

```c
#include "sensors.h"
#define SENSORS_CAL_OWNER   /* emit the lookup-table definitions in this TU */
#include "sensors_cal.h"

uint16_t sensors_battery_cv(uint16_t counts, uint16_t vref_cal) {
    uint32_t num = (uint32_t)counts * vref_cal * BATT_CV_NUM;
    return (uint16_t)((num + (BATT_CV_DEN / 2)) / BATT_CV_DEN); /* rounded */
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_sensors_battery --output-on-failure`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add firmware/g0b1-apu/App/services/sensors_cal.h firmware/g0b1-apu/App/services/sensors.h firmware/g0b1-apu/App/services/sensors.c firmware/g0b1-apu/Tests/test_sensors_battery.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): sensors — battery centivolt conversion (schematic-derived) + cal header"
```

---

### Task 2: External NTC temperature (Kohler re-map) + sensor state

**Files:**
- Modify: `firmware/g0b1-apu/App/services/sensors_cal.h` (append external-NTC table + thresholds)
- Modify: `firmware/g0b1-apu/App/services/sensors.h` (add prototype + state enum)
- Modify: `firmware/g0b1-apu/App/services/sensors.c` (add conversion + shared interpolation)
- Create: `firmware/g0b1-apu/Tests/test_sensors_ext_temp.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `sensors_cal.h`, `sensors.h` from Task 1.
- Produces: `int16_t sensors_ext_temp_f(uint16_t counts, uint16_t vref_cal, uint8_t *sensor_state);` — external NTC °F; sets `*sensor_state` to `SENSOR_ON`/`SENSOR_OFF`.
- Produces: `#define SENSOR_OFF 0`, `#define SENSOR_ON 1` in `sensors.h`.
- Produces (internal to `sensors.c`, reused by Task 3): `static int16_t sens_interp(const int32_t tbl[][2], uint8_t n, int32_t counts);` — descending-count table linear interpolation (port of PIC `FindNTCTemperature`).

- [ ] **Step 1: Append the external-NTC table to `sensors_cal.h`**

```c
/* External NTC (IN4): old Kohler 14-point table (10-bit counts -> degF), with
 * the count column rescaled x4.4 for the new 12-bit / 3.3V-excited / 3.000V-ref
 * front-end (see plan "Derived conversions"). Descending by count. */
#define EXT_NTC_TABLE_LEN   14
/* F1: open sensor saturates at 4095 (old 1020->4488 > ADC max), so disconnect
 * is only detectable at rail saturation. Provisional; confirm on bench. */
#define NTC_DISCONNECT_CNT  4090   /* >= this  => disconnected/too-cold => OFF, 0 degF */
#define NTC_SHORT_CNT       0      /* == this  => shorted => OFF, 0 degF */
#define NTC_FLOOR_CNT       3709   /* >  this (and < disconnect) => floor at -4 degF, ON */
#define NTC_FLOOR_F         (-4)
#define NTC_OVERMAX_CNT     238    /* <= this  => over max temp (>248 degF) => OFF, 0 degF */
#ifdef SENSORS_CAL_OWNER
static const int32_t ext_ntc_table[EXT_NTC_TABLE_LEN][2] = {
    {4488,   0}, {3709,  -4}, {2548,  20}, {1971,  32},
    {1518,  50}, {1074,  68}, { 924,  80}, { 774,  92},
    { 629, 104}, { 537, 120}, { 422, 140}, { 312, 176},
    { 264, 212}, { 238, 248},
};
#endif
```

- [ ] **Step 2: Add the state macros + prototype to `sensors.h`**

```c
#define SENSOR_OFF 0
#define SENSOR_ON  1

/* External NTC temperature (degF). Applies the reg-36 trim to the count
 * (calibration first, as the PIC did), then table interpolation. Sets
 * *sensor_state ON/OFF (disconnect/short/over-range => OFF, 0 degF). */
int16_t sensors_ext_temp_f(uint16_t counts, uint16_t vref_cal, uint8_t *sensor_state);
```

- [ ] **Step 3: Write the failing test `Tests/test_sensors_ext_temp.c`**

```c
#include "unity.h"
#include "sensors.h"
#include "sensors_cal.h"

void setUp(void) {}
void tearDown(void) {}

static void test_ext_table_breakpoints(void) {
    uint8_t st;
    TEST_ASSERT_EQUAL_INT16(32, sensors_ext_temp_f(1971, VREF_CAL_DEFAULT, &st)); /* 32 degF */
    TEST_ASSERT_EQUAL_UINT8(SENSOR_ON, st);
    TEST_ASSERT_EQUAL_INT16(68, sensors_ext_temp_f(1074, VREF_CAL_DEFAULT, &st)); /* 68 degF */
    TEST_ASSERT_EQUAL_INT16(212, sensors_ext_temp_f(264, VREF_CAL_DEFAULT, &st)); /* 212 degF breakpoint */
}

static void test_ext_interpolation_midpoint(void) {
    uint8_t st;
    /* Between {1971,32} and {1518,50}: midpoint count 1744 -> ~41 degF. */
    int16_t f = sensors_ext_temp_f(1744, VREF_CAL_DEFAULT, &st);
    TEST_ASSERT_UINT16_WITHIN(1, 41, (uint16_t)f);
    TEST_ASSERT_EQUAL_UINT8(SENSOR_ON, st);
}

static void test_ext_disconnect(void) {
    uint8_t st;
    int16_t f = sensors_ext_temp_f(4095, VREF_CAL_DEFAULT, &st); /* saturated / open */
    TEST_ASSERT_EQUAL_INT16(0, f);
    TEST_ASSERT_EQUAL_UINT8(SENSOR_OFF, st);
}

static void test_ext_short(void) {
    uint8_t st;
    int16_t f = sensors_ext_temp_f(0, VREF_CAL_DEFAULT, &st);
    TEST_ASSERT_EQUAL_INT16(0, f);
    TEST_ASSERT_EQUAL_UINT8(SENSOR_OFF, st);
}

static void test_ext_cold_floor(void) {
    uint8_t st;
    /* Between floor (3709) and disconnect (4090): floored at -4 degF, still ON. */
    int16_t f = sensors_ext_temp_f(3900, VREF_CAL_DEFAULT, &st);
    TEST_ASSERT_EQUAL_INT16(NTC_FLOOR_F, f);
    TEST_ASSERT_EQUAL_UINT8(SENSOR_ON, st);
}

static void test_ext_overmax_off(void) {
    uint8_t st;
    int16_t f = sensors_ext_temp_f(200, VREF_CAL_DEFAULT, &st); /* < overmax count => hotter than 248 */
    TEST_ASSERT_EQUAL_INT16(0, f);
    TEST_ASSERT_EQUAL_UINT8(SENSOR_OFF, st);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_ext_table_breakpoints);
    RUN_TEST(test_ext_interpolation_midpoint);
    RUN_TEST(test_ext_disconnect);
    RUN_TEST(test_ext_short);
    RUN_TEST(test_ext_cold_floor);
    RUN_TEST(test_ext_overmax_off);
    return UNITY_END();
}
```

- [ ] **Step 4: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_sensors_ext_temp test_sensors_ext_temp.c ../App/services/sensors.c)
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_sensors_ext_temp --output-on-failure`
Expected: build fails — `sensors_ext_temp_f` undefined.

- [ ] **Step 6: Implement in `sensors.c`** (add the shared interpolator + the conversion; include `sensors_cal.h` is already present from Task 1)

```c
/* Descending-count table linear interpolation (port of PIC FindNTCTemperature).
 * counts is expected to lie within (tbl[n-1][0], tbl[0][0]). */
static int16_t sens_interp(const int32_t tbl[][2], uint8_t n, int32_t counts) {
    uint8_t hi = 0;                 /* index of next-higher count entry */
    while (hi < (n - 1) && counts <= tbl[hi][0]) hi++;
    uint8_t lo = (hi > 0) ? (uint8_t)(hi - 1) : 0;
    int32_t span   = tbl[lo][0] - tbl[hi][0];      /* counts between entries */
    int32_t offset = tbl[lo][0] - counts;          /* counts from lower entry */
    int32_t dtemp  = tbl[hi][1] - tbl[lo][1];
    if (span == 0) return (int16_t)tbl[lo][1];
    return (int16_t)(tbl[lo][1] + (offset * dtemp) / span);
}

int16_t sensors_ext_temp_f(uint16_t counts, uint16_t vref_cal, uint8_t *sensor_state) {
    /* Calibration first (PIC ReadNTCTemperature order). */
    int32_t c = ((int32_t)counts * vref_cal) / VREF_CAL_DEFAULT;

    if (c >= NTC_DISCONNECT_CNT || c <= NTC_OVERMAX_CNT || c == NTC_SHORT_CNT) {
        *sensor_state = SENSOR_OFF;                /* disconnect / over-range / short */
        return 0;
    }
    *sensor_state = SENSOR_ON;
    if (c > NTC_FLOOR_CNT) return NTC_FLOOR_F;     /* colder than -4 degF => floor */
    return sens_interp(ext_ntc_table, EXT_NTC_TABLE_LEN, c);
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_sensors_ext_temp --output-on-failure`
Expected: PASS (6 tests).

- [ ] **Step 8: Commit**

```bash
git add firmware/g0b1-apu/App/services/sensors_cal.h firmware/g0b1-apu/App/services/sensors.h firmware/g0b1-apu/App/services/sensors.c firmware/g0b1-apu/Tests/test_sensors_ext_temp.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): sensors — external NTC degF (Kohler x4.4 re-map) + disconnect/short state"
```

---

### Task 3: Enclosure temperature (TMP6131) conversion

**Files:**
- Modify: `firmware/g0b1-apu/App/services/sensors_cal.h` (append TMP6131 table + clamp limits)
- Modify: `firmware/g0b1-apu/App/services/sensors.h` (add prototype)
- Modify: `firmware/g0b1-apu/App/services/sensors.c` (add conversion + clamp)
- Create: `firmware/g0b1-apu/Tests/test_sensors_encl_temp.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `sens_interp` (Task 2), `sensors_cal.h`, `sensors.h`.
- Produces: `int16_t sensors_encl_temp_f(uint16_t counts, int16_t temp_cal);` — enclosure °F from a ratiometric count and the reg-37 offset trim, clamped to [−67, +302].

- [ ] **Step 1: Transcribe the TMP6131 R/R25 curve and append the table to `sensors_cal.h`**

The enclosure divider is ratiometric to the 3.000 V ref: `S = R_ptc/R25 = counts/(4096 − counts)`, and each S maps to a count via `count = round(4096 × S / (S + 1))`. **Verify the R/R25 values below against the TI TMP6131 datasheet (SNIS183) resistance-ratio table (F3);** the 25 °C anchor (S=1.0 → 2048 cnt → 77 °F) is exact. Then append (descending count, matching `sens_interp`):

```c
/* Enclosure (IN0): TMP6131 (TI linear silicon PTC, 10k @ 25C) with a 10k fixed
 * top resistor, ratiometric to the 3.000 V ref. count = 4096*S/(S+1), S=R/R25.
 * degF from the TMP6131 R/R25-vs-T curve. R/R25 values are first-cut from the
 * TMP61 datasheet (SNIS183) and MUST be verified (F3); 25C=2048cnt is exact.
 * Descending by count for sens_interp(). */
#define ENCL_TABLE_LEN  6
/* Preserve PIC Find_Cabin_Temperature clamp. */
#define TEMP_CLAMP_MAX_F   302
#define TEMP_CLAMP_MIN_F   (-67)
#ifdef SENSORS_CAL_OWNER
static const int32_t encl_tmp6131_table[ENCL_TABLE_LEN][2] = {
    /* count, degF   (S=R/R25 -> degC -> degF) */
    {2533, 257},  /* S~1.62, 125 C */
    {2361, 185},  /* S~1.36,  85 C */
    {2191, 122},  /* S~1.15,  50 C */
    {2048,  77},  /* S=1.00,  25 C  (exact anchor) */
    {1894,  32},  /* S~0.86,   0 C */
    {1665, -40},  /* S~0.685,-40 C */
};
#endif
```

- [ ] **Step 2: Add the prototype to `sensors.h`**

```c
/* Enclosure (on-board TMP6131) temperature (degF), + reg-37 offset trim,
 * clamped to [TEMP_CLAMP_MIN_F, TEMP_CLAMP_MAX_F]. */
int16_t sensors_encl_temp_f(uint16_t counts, int16_t temp_cal);
```

- [ ] **Step 3: Write the failing test `Tests/test_sensors_encl_temp.c`**

```c
#include "unity.h"
#include "sensors.h"
#include "sensors_cal.h"

void setUp(void) {}
void tearDown(void) {}

static void test_encl_25c_anchor(void) {
    /* S=1.0 -> 2048 counts -> 25 C -> 77 degF (exact). */
    TEST_ASSERT_EQUAL_INT16(77, sensors_encl_temp_f(2048, 0));
}

static void test_encl_monotonic_increasing(void) {
    /* Higher count (hotter PTC) => higher degF. */
    TEST_ASSERT_TRUE(sensors_encl_temp_f(2361, 0) > sensors_encl_temp_f(2048, 0));
    TEST_ASSERT_TRUE(sensors_encl_temp_f(2048, 0) > sensors_encl_temp_f(1665, 0));
}

static void test_encl_calibration_offset(void) {
    int16_t base = sensors_encl_temp_f(2048, 0);
    TEST_ASSERT_EQUAL_INT16(base + 5, sensors_encl_temp_f(2048, 5));
}

static void test_encl_clamp_high(void) {
    TEST_ASSERT_EQUAL_INT16(TEMP_CLAMP_MAX_F, sensors_encl_temp_f(2533, 100)); /* 257+100 clamped */
}

static void test_encl_clamp_low(void) {
    TEST_ASSERT_EQUAL_INT16(TEMP_CLAMP_MIN_F, sensors_encl_temp_f(1665, -50)); /* -40-50 clamped */
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_encl_25c_anchor);
    RUN_TEST(test_encl_monotonic_increasing);
    RUN_TEST(test_encl_calibration_offset);
    RUN_TEST(test_encl_clamp_high);
    RUN_TEST(test_encl_clamp_low);
    return UNITY_END();
}
```

- [ ] **Step 4: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_sensors_encl_temp test_sensors_encl_temp.c ../App/services/sensors.c)
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_sensors_encl_temp --output-on-failure`
Expected: build fails — `sensors_encl_temp_f` undefined.

- [ ] **Step 6: Implement in `sensors.c`**

```c
int16_t sensors_encl_temp_f(uint16_t counts, int16_t temp_cal) {
    int16_t f = sens_interp(encl_tmp6131_table, ENCL_TABLE_LEN, (int32_t)counts);
    f = (int16_t)(f + temp_cal);
    if (f > TEMP_CLAMP_MAX_F) f = TEMP_CLAMP_MAX_F;
    if (f < TEMP_CLAMP_MIN_F) f = TEMP_CLAMP_MIN_F;
    return f;
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_sensors_encl_temp --output-on-failure`
Expected: PASS (5 tests).

- [ ] **Step 8: Commit**

```bash
git add firmware/g0b1-apu/App/services/sensors_cal.h firmware/g0b1-apu/App/services/sensors.h firmware/g0b1-apu/App/services/sensors.c firmware/g0b1-apu/Tests/test_sensors_encl_temp.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): sensors — enclosure TMP6131 degF (ratiometric) + [-67,302] clamp"
```

---

### Task 4: Sensor RAM shadow, averaging, and accessors

**Files:**
- Modify: `firmware/g0b1-apu/App/services/sensors_cal.h` (append averaging config + channel indices)
- Modify: `firmware/g0b1-apu/App/services/sensors.h` (add shadow API)
- Modify: `firmware/g0b1-apu/App/services/sensors.c` (add shadow/averaging state)
- Create: `firmware/g0b1-apu/Tests/test_sensors_shadow.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `sensors_battery_cv`, `sensors_ext_temp_f`, `sensors_encl_temp_f` (Tasks 1–3).
- Produces:
  - `typedef enum { SENS_ENCL = 0, SENS_EXT, SENS_BATT, SENS_CH_COUNT } sensor_ch_t;`
  - `void sensors_init(uint16_t vref_cal, int16_t temp_cal);`
  - `void sensors_set_cal(uint16_t vref_cal, int16_t temp_cal);`
  - `void sensors_add_sample(sensor_ch_t ch, uint16_t raw);` — accumulates; on reaching the channel's sample count, recomputes that channel's rolling average and its converted value.
  - `int16_t  sensors_get_encl_temp_f(void);` (reg 1)
  - `uint16_t sensors_get_ext_adc(void);` (reg 3 — averaged raw count)
  - `uint16_t sensors_get_batt_cv(void);` (reg 6)
  - `int16_t  sensors_get_ext_temp_f(void);` (reg 51)
  - `uint8_t  sensors_get_ext_state(void);`

- [ ] **Step 1: Append averaging config to `sensors_cal.h`**

```c
/* Averaging (preserve PIC: enclosure 8-sample; others N-sample).
 * Per-channel N for non-enclosure channels is a carry-forward to confirm
 * against the original analog_data[].readings_to_average init. */
#define SENS_AVG_ENCL      8
#define SENS_AVG_DEFAULT   8
```

- [ ] **Step 2: Add the shadow API to `sensors.h`**

```c
typedef enum { SENS_ENCL = 0, SENS_EXT, SENS_BATT, SENS_CH_COUNT } sensor_ch_t;

void     sensors_init(uint16_t vref_cal, int16_t temp_cal);
void     sensors_set_cal(uint16_t vref_cal, int16_t temp_cal);
void     sensors_add_sample(sensor_ch_t ch, uint16_t raw);
int16_t  sensors_get_encl_temp_f(void);   /* reg 1  */
uint16_t sensors_get_ext_adc(void);       /* reg 3  */
uint16_t sensors_get_batt_cv(void);       /* reg 6  */
int16_t  sensors_get_ext_temp_f(void);    /* reg 51 */
uint8_t  sensors_get_ext_state(void);
```

- [ ] **Step 3: Write the failing test `Tests/test_sensors_shadow.c`**

```c
#include "unity.h"
#include "sensors.h"
#include "sensors_cal.h"

void setUp(void)    { sensors_init(VREF_CAL_DEFAULT, 0); }
void tearDown(void) {}

/* Average only updates once the sample count is reached. */
static void test_batt_average_and_convert(void) {
    for (int i = 0; i < SENS_AVG_DEFAULT; i++) sensors_add_sample(SENS_BATT, 2374);
    TEST_ASSERT_EQUAL_UINT16(1200, sensors_get_batt_cv()); /* 12.00 V */
}

static void test_average_mean_of_samples(void) {
    /* Half at 2176 (11.0V), half at 2868 (14.5V) => mean 2522 => ~1275 cV. */
    for (int i = 0; i < SENS_AVG_DEFAULT / 2; i++) sensors_add_sample(SENS_BATT, 2176);
    for (int i = 0; i < SENS_AVG_DEFAULT / 2; i++) sensors_add_sample(SENS_BATT, 2868);
    TEST_ASSERT_UINT16_WITHIN(3, 1275, sensors_get_batt_cv());
}

static void test_partial_window_holds_previous(void) {
    for (int i = 0; i < SENS_AVG_DEFAULT; i++) sensors_add_sample(SENS_BATT, 2374);
    sensors_add_sample(SENS_BATT, 0);          /* 1 sample into next window */
    TEST_ASSERT_EQUAL_UINT16(1200, sensors_get_batt_cv()); /* unchanged until window full */
}

static void test_ext_adc_and_temp_and_state(void) {
    for (int i = 0; i < SENS_AVG_DEFAULT; i++) sensors_add_sample(SENS_EXT, 1971);
    TEST_ASSERT_EQUAL_UINT16(1971, sensors_get_ext_adc());   /* reg 3 raw avg */
    TEST_ASSERT_EQUAL_INT16(32, sensors_get_ext_temp_f());   /* reg 51 degF */
    TEST_ASSERT_EQUAL_UINT8(SENSOR_ON, sensors_get_ext_state());
}

static void test_encl_channel(void) {
    for (int i = 0; i < SENS_AVG_ENCL; i++) sensors_add_sample(SENS_ENCL, 2048);
    TEST_ASSERT_EQUAL_INT16(77, sensors_get_encl_temp_f());  /* reg 1 */
}

static void test_set_cal_reconverts_on_next_window(void) {
    sensors_set_cal(VREF_CAL_DEFAULT, 5);                    /* +5 degF offset */
    for (int i = 0; i < SENS_AVG_ENCL; i++) sensors_add_sample(SENS_ENCL, 2048);
    TEST_ASSERT_EQUAL_INT16(82, sensors_get_encl_temp_f());  /* 77 + 5 */
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_batt_average_and_convert);
    RUN_TEST(test_average_mean_of_samples);
    RUN_TEST(test_partial_window_holds_previous);
    RUN_TEST(test_ext_adc_and_temp_and_state);
    RUN_TEST(test_encl_channel);
    RUN_TEST(test_set_cal_reconverts_on_next_window);
    return UNITY_END();
}
```

- [ ] **Step 4: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_sensors_shadow test_sensors_shadow.c ../App/services/sensors.c)
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_sensors_shadow --output-on-failure`
Expected: build fails — shadow API undefined.

- [ ] **Step 6: Implement the shadow in `sensors.c`** (add at the top after includes; conversions from Tasks 1–3 already present)

```c
typedef struct {
    uint32_t accum;
    uint16_t count;
    uint16_t window;      /* samples per average */
    uint16_t average;     /* last completed rolling average (raw counts) */
} sens_chan_t;

static sens_chan_t s_chan[SENS_CH_COUNT];
static uint16_t s_vref_cal;
static int16_t  s_temp_cal;
static uint16_t s_batt_cv;
static int16_t  s_encl_f;
static int16_t  s_ext_f;
static uint8_t  s_ext_state;

void sensors_set_cal(uint16_t vref_cal, int16_t temp_cal) {
    s_vref_cal = vref_cal;
    s_temp_cal = temp_cal;
}

void sensors_init(uint16_t vref_cal, int16_t temp_cal) {
    for (int i = 0; i < SENS_CH_COUNT; i++) {
        s_chan[i].accum = 0;
        s_chan[i].count = 0;
        s_chan[i].average = 0;
        s_chan[i].window = SENS_AVG_DEFAULT;
    }
    s_chan[SENS_ENCL].window = SENS_AVG_ENCL;
    s_batt_cv = 0; s_encl_f = 0; s_ext_f = 0; s_ext_state = SENSOR_OFF;
    sensors_set_cal(vref_cal, temp_cal);
}

void sensors_add_sample(sensor_ch_t ch, uint16_t raw) {
    sens_chan_t *c = &s_chan[ch];
    c->accum += raw;
    if (++c->count < c->window) return;
    c->average = (uint16_t)(c->accum / c->window);
    c->accum = 0;
    c->count = 0;
    switch (ch) {
        case SENS_ENCL: s_encl_f = sensors_encl_temp_f(c->average, s_temp_cal); break;
        case SENS_EXT:  s_ext_f  = sensors_ext_temp_f(c->average, s_vref_cal, &s_ext_state); break;
        case SENS_BATT: s_batt_cv = sensors_battery_cv(c->average, s_vref_cal); break;
        default: break;
    }
}

int16_t  sensors_get_encl_temp_f(void) { return s_encl_f; }
uint16_t sensors_get_ext_adc(void)     { return s_chan[SENS_EXT].average; }
uint16_t sensors_get_batt_cv(void)     { return s_batt_cv; }
int16_t  sensors_get_ext_temp_f(void)  { return s_ext_f; }
uint8_t  sensors_get_ext_state(void)   { return s_ext_state; }
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_sensors_shadow --output-on-failure`
Expected: PASS (6 tests).

- [ ] **Step 8: Commit**

```bash
git add firmware/g0b1-apu/App/services/sensors_cal.h firmware/g0b1-apu/App/services/sensors.h firmware/g0b1-apu/App/services/sensors.c firmware/g0b1-apu/Tests/test_sensors_shadow.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): sensors — RAM shadow, per-channel averaging, and reg accessors"
```

---

### Task 5: RPM source interface + engine-status classification

**Files:**
- Create: `firmware/g0b1-apu/App/services/rpm.h`
- Create: `firmware/g0b1-apu/App/services/rpm.c`
- Create: `firmware/g0b1-apu/Tests/test_rpm.c`
- Modify: `firmware/g0b1-apu/App/services/sensors_cal.h` (append RPM threshold)
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Produces:
  - `typedef enum { RPM_ENGINE_NONE = 0, RPM_ENGINE_LOW, RPM_ENGINE_RUNNING } rpm_engine_state_t;`
  - `typedef struct rpm_source { uint16_t (*get_rpm)(void *ctx); void *ctx; } rpm_source_t;`
  - `uint16_t rpm_read(const rpm_source_t *src);` — reads the pluggable source (reg 38); returns 0 if `src`/`get_rpm` is NULL.
  - `rpm_engine_state_t rpm_classify(uint16_t rpm);` — `0`→NONE, `1..999`→LOW, `>=1000`→RUNNING.
- Produces (in `sensors_cal.h`): `#define ENGINE_RPM_LOW_LIMIT 1000`.

- [ ] **Step 1: Append the RPM threshold to `sensors_cal.h`**

```c
/* Engine-running threshold (PIC main.h ENGINE_RPM_LOW_LIMIT). */
#define ENGINE_RPM_LOW_LIMIT  1000
```

- [ ] **Step 2: Write `App/services/rpm.h`**

```c
#ifndef RPM_H
#define RPM_H
#include "types.h"

/* Engine status classified from RPM (debounce/anti-stall live in the control
 * milestone). Threshold ENGINE_RPM_LOW_LIMIT is in sensors_cal.h. */
typedef enum { RPM_ENGINE_NONE = 0, RPM_ENGINE_LOW, RPM_ENGINE_RUNNING } rpm_engine_state_t;

/* Pluggable RPM source: timer input-capture (default) or ADC IN6 on target;
 * a fake in host tests. The capture implementation is deferred to bring-up. */
typedef struct rpm_source { uint16_t (*get_rpm)(void *ctx); void *ctx; } rpm_source_t;

uint16_t           rpm_read(const rpm_source_t *src);
rpm_engine_state_t rpm_classify(uint16_t rpm);

#endif /* RPM_H */
```

- [ ] **Step 3: Write the failing test `Tests/test_rpm.c`**

```c
#include "unity.h"
#include "rpm.h"
#include "sensors_cal.h"

void setUp(void) {}
void tearDown(void) {}

static uint16_t s_fake_rpm;
static uint16_t fake_get_rpm(void *ctx) { (void)ctx; return s_fake_rpm; }

static void test_classify_boundaries(void) {
    TEST_ASSERT_EQUAL_INT(RPM_ENGINE_NONE,    rpm_classify(0));
    TEST_ASSERT_EQUAL_INT(RPM_ENGINE_LOW,     rpm_classify(1));
    TEST_ASSERT_EQUAL_INT(RPM_ENGINE_LOW,     rpm_classify(ENGINE_RPM_LOW_LIMIT - 1)); /* 999 */
    TEST_ASSERT_EQUAL_INT(RPM_ENGINE_RUNNING, rpm_classify(ENGINE_RPM_LOW_LIMIT));     /* 1000 */
    TEST_ASSERT_EQUAL_INT(RPM_ENGINE_RUNNING, rpm_classify(5000));
}

static void test_read_from_source(void) {
    rpm_source_t src = { fake_get_rpm, 0 };
    s_fake_rpm = 2400;
    TEST_ASSERT_EQUAL_UINT16(2400, rpm_read(&src));
}

static void test_read_null_source_is_zero(void) {
    TEST_ASSERT_EQUAL_UINT16(0, rpm_read(0));
    rpm_source_t empty = { 0, 0 };
    TEST_ASSERT_EQUAL_UINT16(0, rpm_read(&empty));
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_classify_boundaries);
    RUN_TEST(test_read_from_source);
    RUN_TEST(test_read_null_source_is_zero);
    return UNITY_END();
}
```

- [ ] **Step 4: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_rpm test_rpm.c ../App/services/rpm.c)
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_rpm --output-on-failure`
Expected: build fails — `rpm_read`/`rpm_classify` undefined.

- [ ] **Step 6: Write `App/services/rpm.c`**

```c
#include "rpm.h"
#include "sensors_cal.h"

uint16_t rpm_read(const rpm_source_t *src) {
    if (src == 0 || src->get_rpm == 0) return 0;
    return src->get_rpm(src->ctx);
}

rpm_engine_state_t rpm_classify(uint16_t rpm) {
    if (rpm == 0) return RPM_ENGINE_NONE;
    if (rpm < ENGINE_RPM_LOW_LIMIT) return RPM_ENGINE_LOW;
    return RPM_ENGINE_RUNNING;
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_rpm --output-on-failure`
Expected: PASS (3 tests).

- [ ] **Step 8: Run the full suite to confirm no regressions**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build --output-on-failure`
Expected: all tests pass (9 prior + 5 new = 14 executables), zero warnings under `-Werror`.

- [ ] **Step 9: Commit**

```bash
git add firmware/g0b1-apu/App/services/rpm.h firmware/g0b1-apu/App/services/rpm.c firmware/g0b1-apu/Tests/test_rpm.c firmware/g0b1-apu/App/services/sensors_cal.h firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): rpm — pluggable source interface + engine-status classification"
```

---

## Deferred to hardware bring-up / later milestones

- **`bsp_adc` HAL driver** (ADC1 + scan + circular DMA + HW oversampling over IN0–IN5, free-running non-blocking). Feeds `sensors_add_sample()` each sample slot. On-target only; not host-testable.
- **Real RPM capture** — `bsp_rpm` implementing `rpm_source_t.get_rpm` via TIM3_CH1 input-capture (default) or ADC IN6 (`RPM_SOURCE_*`). Confirm PA6 tach electrical behavior (OI-4).
- **Engine-coolant temp (reg 2) + A/C pressures (regs 4, 5)** — the raw-count sensors deferred by design decision. When un-deferred: engine coolant reuses the same NTC-divider treatment (U8B: 10k pull-up to 3.3 V, off-board thermistor); pressures need the 0.5–4.5 V→op-amp transfer and the OI-5 encoding decision (raw-count-equivalent vs PSI).
- **Modbus register binding** — wiring these accessors to the reg 1/3/6/38/51 dispatch belongs to the `params` register-model milestone (spec §7.3).
- **RPM debounce / anti-stall** — `RPM_LOW_TMR` / `RPM_STOP_TMR` timers and the `ENGINE_STALLED` / `NO_RPM_DETECTED` error transitions live in the control state-machine milestone; M3 supplies only the pure `rpm_classify()` primitive.

## Carry-forward items to confirm

- **F3:** verify the TMP6131 `R/R25` table values against TI datasheet SNIS183 (Task 3 leaves the 25 °C anchor exact; the rest are first-cut).
- **F1/F4:** confirm the external-NTC `NTC_DISCONNECT_CNT` behavior on the bench (open sensor vs very-cold ambiguity from the 3.3 V-excite / 3.000 V-ref mismatch).
- **Per-channel sample counts:** confirm the original `analog_data[].readings_to_average` for the non-enclosure channels (M3 defaults all non-enclosure channels to 8).
- **OI-7 bench-calibration pass:** re-trim `vref_calibration` / `temperature_calibration` and the temp tables against a reference once hardware is up.

---

## Self-Review

**Spec coverage (§6):** battery re-derivation ✅ (Task 1, exact from legend); external NTC re-derived table + disconnect/short state ✅ (Task 2); enclosure new curve ✅ (Task 3, TMP6131); averaging preserved ✅ (Task 4); calibration trims retained/re-based ✅ (Tasks 1–4). Engine coolant + pressures ⏸ deferred by design decision (documented). RPM (reg 38) + classification ✅ (Task 5). Register accessors for reg 1/3/6/38/51 ✅; Modbus binding deferred to §7.3 milestone (documented).

**Placeholder scan:** no TBD/TODO. The one datasheet-dependent input (TMP6131 R/R25) is an explicit, sourced transcription step with an exact anchor test and an F3 carry-forward — not a hand-wave.

**Type consistency:** `sensors_battery_cv(uint16_t,uint16_t)→uint16_t`, `sensors_ext_temp_f(uint16_t,uint16_t,uint8_t*)→int16_t`, `sensors_encl_temp_f(uint16_t,int16_t)→int16_t`, `sens_interp` signature, `sensor_ch_t` enum, and the `rpm_*` signatures are used identically across the tasks and tests that reference them. Test build deps in `CMakeLists.txt` each compile only the source they need.
