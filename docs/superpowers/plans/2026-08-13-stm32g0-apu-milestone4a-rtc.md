# STM32G0 APU Port — Milestone 4a: RTC Service (MCP7940N) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the portable, host-tested RTC service for the external MCP7940N real-time clock — BCD↔struct time conversion, get/set time, oscillator start, battery-backup enable, oscillator-running check, battery-backed SRAM access (Modbus reg 52), the RTCC register accessors (regs 42–48), and the calendar-start parameter accessors (regs 24–31) — all over an abstract I²C backend so the logic runs on the host.

**Architecture:** An `i2c_backend_t` interface abstracts the I²C device (register-addressed read/write to the single MCP7940N). On top sits `rtc.c` — the portable RTC service (register map, BCD conversion, time/oscillator/backup/SRAM ops, RTCC accessors with a staged shadow + atomic commit) — and `rtc_calendar.c` — thin calendar-start param accessors backed by the Milestone-2 NVM store. Host tests drive everything through an in-memory MCP7940N simulator (`fake_i2c`, mirroring M2's `fake_nor`). The concrete HAL I²C driver (I²C1 on PB6/PB7) that implements `i2c_backend_t` is **deferred to hardware bring-up**; the auto-start calendar-vs-live-clock comparison is **deferred to the control milestone (M6)** per spec §7.2.

**Tech Stack:** C11, CMake + Unity (host). Reuses `App/include/types.h` (M1) and the NVM store `nvm_read_byte`/`nvm_write_byte` + `Tests/fakes/fake_nor.c` (M2). No `modbus`/`sensors` dependency.

**Design spec:** `docs/superpowers/specs/2026-08-12-pic18-to-stm32g0-apu-port-design.md` §7.2 (RTC), §4 (I²C1 pin map), §7.3 (register contract). Prereqs: M1 (harness + `types.h`), M2 (NVM store + `fake_nor` + `EE_CLND_*` map).

**Source of truth for preserved behavior:** PIC `parameters.c` (`get_/set_rtcc_*` buffered via `rtcc_mod_*`; `get_/set_clnd_start_*` = `read_/write_eeprom_byte(EE_CLND_START_*)`), `parameters.h` register enum (regs 24–31, 42–48, 52). New-board RTC part: **MCP7940N** on I²C1 (spec §4/§7.2).

## Global Constraints

- **Device:** Microchip **MCP7940N** I²C RTC (7-bit addr `0x6F`; the address is baked into the deferred HAL backend, not referenced by portable code). Timekeeping registers `0x00–0x08`, battery-backed SRAM `0x20–0x5F` (64 bytes).
- **MCP7940N register map** (⚠️ **verify bit positions against the MCP7940N datasheet during Task 2** — same "first-cut, verify" discipline as M3's TMP6131 table; the BCD math and masks below are the testable core):
  `RTCSEC 0x00` (bit7 **ST**, bits6–0 sec BCD) · `RTCMIN 0x01` (min BCD) · `RTCHOUR 0x02` (bit6 12/24, bit5 AM/PM-or-10hr, hour BCD) · `RTCWKDAY 0x03` (bit5 **OSCRUN** read-only, bit4 PWRFAIL, bit3 **VBATEN**, bits2–0 weekday 1–7) · `RTCDATE 0x04` (date BCD) · `RTCMTH 0x05` (bit5 LPYR, month BCD) · `RTCYEAR 0x06` (year BCD 00–99) · `CONTROL 0x07` · `OSCTRIM 0x08`.
- **Time representation:** internal `rtc_time_t` is **24-hour** (`hour` 0–23). The RTCC hour register is written/read in **24-hour mode** (RTCHOUR bit6 = 0). *(The calendar-start block carries its own AM/PM byte, reg 31, for the display; the RTCC regs 42–48 have no AM/PM field. 12h/AM-PM handling of the live clock is a carry-forward to confirm with the display.)*
- **Preserved register contract** (PIC `parameters.h`; the Modbus binding of these accessors happens in M4b — this milestone produces the accessors only):
  - RTCC set/get (live clock): reg **42** year · **43** month · **44** day(date) · **45** weekday · **46** hour · **47** minute · **48** second.
  - Calendar-start params: reg **24** state(on/off) · **25** mode · **26** year · **27** month · **28** date · **29** hour · **30** min · **31** am/pm.
  - reg **52** = battery-backed SRAM byte at offset 0 (PIC read "MCP79410 EEPROM addr 0x00"; new board is MCP7940N → SRAM `0x20`. **Part-difference carry-forward.**)
- **Calendar-start params are stored in NVM** at the M2 `EE_CLND_START_*` addresses (raw bytes, no BCD interpretation in the accessor — the display/control layer owns interpretation): `EE_CLND_START_ONOFF=50`, `MODE=51`, `YEAR=52`, `MONTH=53`, `DATE=54`, `HOUR=55`, `MIN=56`, `AMPM=57`.
- **BCD:** `bin→bcd = ((bin/10)<<4)|(bin%10)`; `bcd→bin = (bcd>>4)*10 + (bcd&0x0F)`. Valid for 0–99.
- Fixed-width integers only (`<stdint.h>` via `types.h`). Portable code under `App/services/` — **no HAL**. Firmware root `firmware/g0b1-apu/`. Every task ends green (`ctest`) and is committed; build is `-Wall -Wextra -Werror -funsigned-char` and must stay pristine.

### Deferred / carry-forward
- **HAL I²C backend** (`i2c_backend_t` impl over I²C1, PB6/PB7) → hardware bring-up; not host-testable.
- **Auto-start scheduling** (compare calendar-start params vs live RTC to decide APU auto-start) → control milestone (M6), per spec §7.2.
- ⚠️ **Verify MCP7940N register bit positions** vs datasheet (Task 2).
- **12h/AM-PM vs 24h** for the live RTCC hour — default 24h here; confirm the display's expectation.
- **reg 52 part difference** — PIC MCP79410 EEPROM vs new MCP7940N SRAM; mapped to SRAM offset 0.
- **RTCC stage-seeding seam (for M4b):** `rtcc_commit()` writes all 7 fields from the persistent `s_rtcc_stage` buffer. M4b's Modbus write-handler must either require a full 7-field RTCC write before calling `rtcc_commit()`, OR seed the stage from `rtc_get_time()` before a partial edit — otherwise an un-staged sibling field commits stale/zero (e.g. month=0/date=0). Also: RTCC setters do no range validation (M4b validates before staging); RTCC getters/`rtc_reg52_read` cannot surface an I²C read error (mandated `uint16_t`/`uint8_t` return) — M4b's read path owns fault reporting if needed. (M4a final-review carry-forwards.)

---

### Task 1: I²C backend interface + in-memory MCP7940N fake

**Files:**
- Create: `firmware/g0b1-apu/App/services/i2c_backend.h`
- Create: `firmware/g0b1-apu/Tests/fakes/fake_i2c.h`, `firmware/g0b1-apu/Tests/fakes/fake_i2c.c`
- Create: `firmware/g0b1-apu/Tests/test_fake_i2c.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Produces: `i2c_backend_t` (below); `void fake_i2c_init(i2c_backend_t *be)` (wire the fake + zero its 256-byte register file), `void fake_i2c_reset(void)`, `uint8_t *fake_i2c_raw(void)` (register array, for assertions).
- Fake models the MCP7940N oscillator: a `write` to `RTCSEC (0x00)` propagates the **ST** bit (0x80) into **OSCRUN** (0x20 of `RTCWKDAY 0x03`) — set ST → set OSCRUN, clear ST → clear OSCRUN — so oscillator-running tests are meaningful on the host.

- [ ] **Step 1: Write `App/services/i2c_backend.h`**

```c
#ifndef I2C_BACKEND_H
#define I2C_BACKEND_H
#include <stdint.h>
/* Abstract I2C device: register-addressed access to a single fixed device
   (the MCP7940N). read()/write() move `len` bytes starting at register `reg`.
   Both return 0 on success, non-zero on error. The concrete HAL implementation
   (I2C1) is deferred to hardware bring-up. */
typedef struct i2c_backend {
    int  (*read)(void *ctx, uint8_t reg, uint8_t *buf, uint16_t len);
    int  (*write)(void *ctx, uint8_t reg, const uint8_t *buf, uint16_t len);
    void *ctx;
} i2c_backend_t;
#endif /* I2C_BACKEND_H */
```

- [ ] **Step 2: Write `Tests/fakes/fake_i2c.h`**

```c
#ifndef FAKE_I2C_H
#define FAKE_I2C_H
#include "i2c_backend.h"
#define FAKE_I2C_REG_COUNT 256u
void     fake_i2c_init(i2c_backend_t *be); /* wire be to the fake; zero all regs */
void     fake_i2c_reset(void);             /* zero all regs */
uint8_t *fake_i2c_raw(void);               /* backing register array */
#endif
```

- [ ] **Step 3: Write the failing test `Tests/test_fake_i2c.c`**

```c
#include "unity.h"
#include "fake_i2c.h"

static i2c_backend_t be;
void setUp(void) { fake_i2c_init(&be); }
void tearDown(void) {}

static void test_write_then_read_roundtrip(void) {
    uint8_t out[3] = {0x11, 0x22, 0x33};
    uint8_t in[3] = {0};
    TEST_ASSERT_EQUAL_INT(0, be.write(be.ctx, 0x04, out, 3));
    TEST_ASSERT_EQUAL_INT(0, be.read(be.ctx, 0x04, in, 3));
    TEST_ASSERT_EQUAL_UINT8_ARRAY(out, in, 3);
}

static void test_raw_reflects_writes(void) {
    uint8_t v = 0x59;
    be.write(be.ctx, 0x06, &v, 1);
    TEST_ASSERT_EQUAL_UINT8(0x59, fake_i2c_raw()[0x06]);
}

static void test_st_bit_sets_oscrun(void) {
    uint8_t sec = 0x80; /* ST set */
    be.write(be.ctx, 0x00, &sec, 1);
    TEST_ASSERT_EQUAL_UINT8(0x20, fake_i2c_raw()[0x03] & 0x20); /* OSCRUN mirrored */
    sec = 0x00; /* ST clear */
    be.write(be.ctx, 0x00, &sec, 1);
    TEST_ASSERT_EQUAL_UINT8(0x00, fake_i2c_raw()[0x03] & 0x20);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_write_then_read_roundtrip);
    RUN_TEST(test_raw_reflects_writes);
    RUN_TEST(test_st_bit_sets_oscrun);
    return UNITY_END();
}
```

- [ ] **Step 4: Register the test in `Tests/CMakeLists.txt`** (append after the existing `add_unity_test` lines)

```cmake
add_unity_test(test_fake_i2c test_fake_i2c.c fakes/fake_i2c.c)
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_fake_i2c --output-on-failure`
Expected: build fails — `fake_i2c_*` undefined.

- [ ] **Step 6: Write `Tests/fakes/fake_i2c.c`**

```c
#include "fake_i2c.h"
#include <string.h>

static uint8_t s_regs[FAKE_I2C_REG_COUNT];

static int fi_read(void *ctx, uint8_t reg, uint8_t *buf, uint16_t len) {
    (void)ctx;
    for (uint16_t i = 0; i < len; i++) buf[i] = s_regs[(uint8_t)(reg + i)];
    return 0;
}
static int fi_write(void *ctx, uint8_t reg, const uint8_t *buf, uint16_t len) {
    (void)ctx;
    for (uint16_t i = 0; i < len; i++) s_regs[(uint8_t)(reg + i)] = buf[i];
    /* Model the oscillator: RTCSEC(0x00) ST bit -> RTCWKDAY(0x03) OSCRUN bit. */
    if (reg == 0x00 && len >= 1) {
        if (buf[0] & 0x80) s_regs[0x03] |= 0x20;
        else               s_regs[0x03] &= (uint8_t)~0x20;
    }
    return 0;
}
void fake_i2c_reset(void) { memset(s_regs, 0, sizeof s_regs); }
uint8_t *fake_i2c_raw(void) { return s_regs; }
void fake_i2c_init(i2c_backend_t *be) {
    fake_i2c_reset();
    be->read = fi_read;
    be->write = fi_write;
    be->ctx = 0;
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_fake_i2c --output-on-failure`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add firmware/g0b1-apu/App/services/i2c_backend.h firmware/g0b1-apu/Tests/fakes/fake_i2c.h firmware/g0b1-apu/Tests/fakes/fake_i2c.c firmware/g0b1-apu/Tests/test_fake_i2c.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "test(g0b1-apu): I2C backend interface + in-memory MCP7940N fake"
```

---

### Task 2: BCD helpers + `rtc_time_t` + register-map constants

**Files:**
- Create: `firmware/g0b1-apu/App/services/rtc.h`
- Create: `firmware/g0b1-apu/App/services/rtc.c`
- Create: `firmware/g0b1-apu/Tests/test_rtc_bcd.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Produces: `rtc_time_t` (below); `uint8_t rtc_bcd_to_bin(uint8_t bcd);` `uint8_t rtc_bin_to_bcd(uint8_t bin);`
- Produces (register-map + bit-mask `#define`s in `rtc.c`, reused by Tasks 3–5): `MCP_RTCSEC 0x00 … MCP_OSCTRIM 0x08`, `MCP_SRAM_BASE 0x20`, `MCP_SRAM_SIZE 64`, `MCP_ST_BIT 0x80`, `MCP_VBATEN 0x08`, `MCP_OSCRUN 0x20`, `MCP_12_24_BIT 0x40`.

- [ ] **Step 1: Write `App/services/rtc.h`** (struct + BCD prototypes; later tasks append prototypes)

```c
#ifndef RTC_H
#define RTC_H
#include "types.h"
#include "i2c_backend.h"

/* 24-hour time. year is 0..99 (=> 20xx). weekday 1..7, date 1..31, month 1..12. */
typedef struct {
    uint8_t sec;
    uint8_t min;
    uint8_t hour;     /* 0..23 */
    uint8_t weekday;  /* 1..7  */
    uint8_t date;     /* 1..31 */
    uint8_t month;    /* 1..12 */
    uint8_t year;     /* 0..99 */
} rtc_time_t;

uint8_t rtc_bcd_to_bin(uint8_t bcd);
uint8_t rtc_bin_to_bcd(uint8_t bin);

#endif /* RTC_H */
```

- [ ] **Step 2: Write the failing test `Tests/test_rtc_bcd.c`**

```c
#include "unity.h"
#include "rtc.h"

void setUp(void) {}
void tearDown(void) {}

static void test_bcd_to_bin_known(void) {
    TEST_ASSERT_EQUAL_UINT8(0,  rtc_bcd_to_bin(0x00));
    TEST_ASSERT_EQUAL_UINT8(9,  rtc_bcd_to_bin(0x09));
    TEST_ASSERT_EQUAL_UINT8(23, rtc_bcd_to_bin(0x23));
    TEST_ASSERT_EQUAL_UINT8(59, rtc_bcd_to_bin(0x59));
    TEST_ASSERT_EQUAL_UINT8(99, rtc_bcd_to_bin(0x99));
}

static void test_bin_to_bcd_known(void) {
    TEST_ASSERT_EQUAL_UINT8(0x00, rtc_bin_to_bcd(0));
    TEST_ASSERT_EQUAL_UINT8(0x09, rtc_bin_to_bcd(9));
    TEST_ASSERT_EQUAL_UINT8(0x13, rtc_bin_to_bcd(13));
    TEST_ASSERT_EQUAL_UINT8(0x45, rtc_bin_to_bcd(45));
    TEST_ASSERT_EQUAL_UINT8(0x99, rtc_bin_to_bcd(99));
}

static void test_bcd_roundtrip_0_to_99(void) {
    for (uint8_t v = 0; v <= 99; v++)
        TEST_ASSERT_EQUAL_UINT8(v, rtc_bcd_to_bin(rtc_bin_to_bcd(v)));
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_bcd_to_bin_known);
    RUN_TEST(test_bin_to_bcd_known);
    RUN_TEST(test_bcd_roundtrip_0_to_99);
    return UNITY_END();
}
```

- [ ] **Step 3: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_rtc_bcd test_rtc_bcd.c ../App/services/rtc.c)
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_rtc_bcd --output-on-failure`
Expected: build fails — `rtc_bcd_to_bin`/`rtc_bin_to_bcd` undefined.

- [ ] **Step 5: Write `App/services/rtc.c`** (register map + BCD; later tasks append)

```c
#include "rtc.h"

/* MCP7940N register map (verify bit positions vs datasheet — see plan Global Constraints). */
#define MCP_RTCSEC    0x00u
#define MCP_RTCMIN    0x01u
#define MCP_RTCHOUR   0x02u
#define MCP_RTCWKDAY  0x03u
#define MCP_RTCDATE   0x04u
#define MCP_RTCMTH    0x05u
#define MCP_RTCYEAR   0x06u
#define MCP_CONTROL   0x07u
#define MCP_OSCTRIM   0x08u
#define MCP_SRAM_BASE 0x20u
#define MCP_SRAM_SIZE 64u

#define MCP_ST_BIT    0x80u  /* RTCSEC  bit7: start oscillator            */
#define MCP_OSCRUN    0x20u  /* RTCWKDAY bit5: oscillator running (RO)     */
#define MCP_VBATEN    0x08u  /* RTCWKDAY bit3: enable battery backup       */
#define MCP_12_24_BIT 0x40u  /* RTCHOUR bit6: 1=12-hour mode (we use 24h)  */

uint8_t rtc_bcd_to_bin(uint8_t bcd) {
    return (uint8_t)(((bcd >> 4) & 0x0Fu) * 10u + (bcd & 0x0Fu));
}
uint8_t rtc_bin_to_bcd(uint8_t bin) {
    return (uint8_t)(((bin / 10u) << 4) | (bin % 10u));
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_rtc_bcd --output-on-failure`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add firmware/g0b1-apu/App/services/rtc.h firmware/g0b1-apu/App/services/rtc.c firmware/g0b1-apu/Tests/test_rtc_bcd.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): rtc — BCD helpers, rtc_time_t, MCP7940N register map"
```

---

### Task 3: RTC init + get/set time over the I²C backend

**Files:**
- Modify: `firmware/g0b1-apu/App/services/rtc.h` (add init + time prototypes)
- Modify: `firmware/g0b1-apu/App/services/rtc.c` (add backend pointer + get/set time)
- Create: `firmware/g0b1-apu/Tests/test_rtc_time.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `rtc_time_t`, BCD helpers, register defines (Task 2); `i2c_backend_t` (Task 1); `fake_i2c` (Task 1).
- Produces: `void rtc_init(const i2c_backend_t *be);` `int rtc_get_time(rtc_time_t *t);` `int rtc_set_time(const rtc_time_t *t);`
- `rtc_set_time` writes 24-hour time; sets **ST** (osc running) in RTCSEC and **VBATEN** (backup enabled) in RTCWKDAY as it writes. `rtc_get_time` masks control bits off each field. Both return the backend's status (0 = success).

- [ ] **Step 1: Add prototypes to `rtc.h`** (after the BCD prototypes)

```c
void rtc_init(const i2c_backend_t *be);
int  rtc_get_time(rtc_time_t *t);
int  rtc_set_time(const rtc_time_t *t);
```

- [ ] **Step 2: Write the failing test `Tests/test_rtc_time.c`**

```c
#include "unity.h"
#include "rtc.h"
#include "fake_i2c.h"

static i2c_backend_t be;
void setUp(void) { fake_i2c_init(&be); rtc_init(&be); }
void tearDown(void) {}

static void test_set_then_get_roundtrip(void) {
    rtc_time_t in = { .sec=45, .min=30, .hour=13, .weekday=1, .date=15, .month=6, .year=25 };
    rtc_time_t out = {0};
    TEST_ASSERT_EQUAL_INT(0, rtc_set_time(&in));
    TEST_ASSERT_EQUAL_INT(0, rtc_get_time(&out));
    TEST_ASSERT_EQUAL_UINT8(45, out.sec);
    TEST_ASSERT_EQUAL_UINT8(30, out.min);
    TEST_ASSERT_EQUAL_UINT8(13, out.hour);
    TEST_ASSERT_EQUAL_UINT8(1,  out.weekday);
    TEST_ASSERT_EQUAL_UINT8(15, out.date);
    TEST_ASSERT_EQUAL_UINT8(6,  out.month);
    TEST_ASSERT_EQUAL_UINT8(25, out.year);
}

static void test_set_time_encodes_bcd_and_control_bits(void) {
    rtc_time_t in = { .sec=45, .min=30, .hour=13, .weekday=1, .date=15, .month=6, .year=25 };
    rtc_set_time(&in);
    uint8_t *r = fake_i2c_raw();
    TEST_ASSERT_EQUAL_UINT8(0xC5, r[0x00]);            /* ST(0x80) | sec BCD 0x45 */
    TEST_ASSERT_EQUAL_UINT8(0x30, r[0x01]);            /* min BCD */
    TEST_ASSERT_EQUAL_UINT8(0x13, r[0x02] & 0x3F);     /* hour BCD, 24h (bit6 clear) */
    TEST_ASSERT_EQUAL_UINT8(0x00, r[0x02] & 0x40);     /* 24-hour mode */
    TEST_ASSERT_EQUAL_UINT8(0x08, r[0x03] & 0x08);     /* VBATEN set */
    TEST_ASSERT_EQUAL_UINT8(0x25, r[0x06]);            /* year BCD */
}

static void test_get_time_masks_control_bits(void) {
    uint8_t *r = fake_i2c_raw();
    r[0x00] = 0xC5;  /* ST(0x80) | sec BCD 0x45 */
    r[0x03] = 0x2B;  /* OSCRUN(0x20) | VBATEN(0x08) | weekday 3 */
    r[0x02] = 0x13;  /* hour 13, 24h */
    rtc_time_t out = {0};
    rtc_get_time(&out);
    TEST_ASSERT_EQUAL_UINT8(45, out.sec);      /* ST masked off */
    TEST_ASSERT_EQUAL_UINT8(3,  out.weekday);  /* OSCRUN/VBATEN masked off */
    TEST_ASSERT_EQUAL_UINT8(13, out.hour);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_set_then_get_roundtrip);
    RUN_TEST(test_set_time_encodes_bcd_and_control_bits);
    RUN_TEST(test_get_time_masks_control_bits);
    return UNITY_END();
}
```

- [ ] **Step 3: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_rtc_time test_rtc_time.c ../App/services/rtc.c fakes/fake_i2c.c)
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_rtc_time --output-on-failure`
Expected: build fails — `rtc_init`/`rtc_get_time`/`rtc_set_time` undefined.

- [ ] **Step 5: Implement in `rtc.c`** (append; add the static backend pointer above the functions)

```c
static const i2c_backend_t *s_be;

void rtc_init(const i2c_backend_t *be) { s_be = be; }

int rtc_get_time(rtc_time_t *t) {
    uint8_t r[7];
    int rc = s_be->read(s_be->ctx, MCP_RTCSEC, r, 7);
    if (rc) return rc;
    t->sec     = rtc_bcd_to_bin((uint8_t)(r[0] & 0x7Fu));
    t->min     = rtc_bcd_to_bin((uint8_t)(r[1] & 0x7Fu));
    t->hour    = rtc_bcd_to_bin((uint8_t)(r[2] & 0x3Fu));  /* 24-hour */
    t->weekday = (uint8_t)(r[3] & 0x07u);
    t->date    = rtc_bcd_to_bin((uint8_t)(r[4] & 0x3Fu));
    t->month   = rtc_bcd_to_bin((uint8_t)(r[5] & 0x1Fu));
    t->year    = rtc_bcd_to_bin(r[6]);
    return 0;
}

int rtc_set_time(const rtc_time_t *t) {
    uint8_t r[7];
    r[0] = (uint8_t)(MCP_ST_BIT | rtc_bin_to_bcd(t->sec));   /* keep oscillator running */
    r[1] = rtc_bin_to_bcd(t->min);
    r[2] = rtc_bin_to_bcd(t->hour);                          /* 24-hour (bit6 = 0) */
    r[3] = (uint8_t)(MCP_VBATEN | (t->weekday & 0x07u));     /* enable battery backup */
    r[4] = rtc_bin_to_bcd(t->date);
    r[5] = rtc_bin_to_bcd(t->month);
    r[6] = rtc_bin_to_bcd(t->year);
    return s_be->write(s_be->ctx, MCP_RTCSEC, r, 7);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_rtc_time --output-on-failure`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add firmware/g0b1-apu/App/services/rtc.h firmware/g0b1-apu/App/services/rtc.c firmware/g0b1-apu/Tests/test_rtc_time.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): rtc — init + get/set time over I2C backend (24h, ST+VBATEN)"
```

---

### Task 4: Oscillator start / backup enable / running-check + SRAM (reg 52)

**Files:**
- Modify: `firmware/g0b1-apu/App/services/rtc.h` (add prototypes)
- Modify: `firmware/g0b1-apu/App/services/rtc.c` (add ops)
- Create: `firmware/g0b1-apu/Tests/test_rtc_osc_sram.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `rtc_init`, register defines, backend (Tasks 2–3).
- Produces: `int rtc_osc_start(void);` (set ST), `int rtc_backup_enable(void);` (set VBATEN), `bool rtc_osc_running(void);` (read OSCRUN), `int rtc_sram_read(uint8_t off, uint8_t *buf, uint16_t len);`, `int rtc_sram_write(uint8_t off, const uint8_t *buf, uint16_t len);` (off 0..63 → `MCP_SRAM_BASE+off`), `uint8_t rtc_reg52_read(void);` (SRAM offset 0 — Modbus reg 52).

- [ ] **Step 1: Add prototypes to `rtc.h`**

```c
int     rtc_osc_start(void);
int     rtc_backup_enable(void);
bool    rtc_osc_running(void);
int     rtc_sram_read(uint8_t off, uint8_t *buf, uint16_t len);
int     rtc_sram_write(uint8_t off, const uint8_t *buf, uint16_t len);
uint8_t rtc_reg52_read(void);
```

- [ ] **Step 2: Write the failing test `Tests/test_rtc_osc_sram.c`**

```c
#include "unity.h"
#include "rtc.h"
#include "fake_i2c.h"

static i2c_backend_t be;
void setUp(void) { fake_i2c_init(&be); rtc_init(&be); }
void tearDown(void) {}

static void test_osc_start_sets_st_and_reports_running(void) {
    TEST_ASSERT_FALSE(rtc_osc_running());          /* fresh regs: OSCRUN clear */
    TEST_ASSERT_EQUAL_INT(0, rtc_osc_start());
    TEST_ASSERT_EQUAL_UINT8(0x80, fake_i2c_raw()[0x00] & 0x80); /* ST set */
    TEST_ASSERT_TRUE(rtc_osc_running());            /* fake mirrors ST -> OSCRUN */
}

static void test_backup_enable_sets_vbaten(void) {
    TEST_ASSERT_EQUAL_INT(0, rtc_backup_enable());
    TEST_ASSERT_EQUAL_UINT8(0x08, fake_i2c_raw()[0x03] & 0x08);
}

static void test_sram_roundtrip(void) {
    uint8_t out[4] = {0xDE,0xAD,0xBE,0xEF};
    uint8_t in[4] = {0};
    TEST_ASSERT_EQUAL_INT(0, rtc_sram_write(0, out, 4));
    TEST_ASSERT_EQUAL_UINT8(0xDE, fake_i2c_raw()[0x20]);   /* SRAM base */
    TEST_ASSERT_EQUAL_INT(0, rtc_sram_read(0, in, 4));
    TEST_ASSERT_EQUAL_UINT8_ARRAY(out, in, 4);
}

static void test_reg52_reads_sram_offset0(void) {
    uint8_t v = 0x55;
    rtc_sram_write(0, &v, 1);
    TEST_ASSERT_EQUAL_UINT8(0x55, rtc_reg52_read());
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_osc_start_sets_st_and_reports_running);
    RUN_TEST(test_backup_enable_sets_vbaten);
    RUN_TEST(test_sram_roundtrip);
    RUN_TEST(test_reg52_reads_sram_offset0);
    return UNITY_END();
}
```

- [ ] **Step 3: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_rtc_osc_sram test_rtc_osc_sram.c ../App/services/rtc.c fakes/fake_i2c.c)
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_rtc_osc_sram --output-on-failure`
Expected: build fails — new symbols undefined.

- [ ] **Step 5: Implement in `rtc.c`** (append; include `<stdbool.h>` comes via `types.h`)

```c
static int rtc_set_bits(uint8_t reg, uint8_t mask) {
    uint8_t v;
    int rc = s_be->read(s_be->ctx, reg, &v, 1);
    if (rc) return rc;
    v |= mask;
    return s_be->write(s_be->ctx, reg, &v, 1);
}

int rtc_osc_start(void)     { return rtc_set_bits(MCP_RTCSEC, MCP_ST_BIT); }
int rtc_backup_enable(void) { return rtc_set_bits(MCP_RTCWKDAY, MCP_VBATEN); }

bool rtc_osc_running(void) {
    uint8_t v = 0;
    if (s_be->read(s_be->ctx, MCP_RTCWKDAY, &v, 1)) return false;
    return (v & MCP_OSCRUN) != 0u;
}

int rtc_sram_read(uint8_t off, uint8_t *buf, uint16_t len) {
    if ((uint16_t)off + len > MCP_SRAM_SIZE) return -1;
    return s_be->read(s_be->ctx, (uint8_t)(MCP_SRAM_BASE + off), buf, len);
}
int rtc_sram_write(uint8_t off, const uint8_t *buf, uint16_t len) {
    if ((uint16_t)off + len > MCP_SRAM_SIZE) return -1;
    return s_be->write(s_be->ctx, (uint8_t)(MCP_SRAM_BASE + off), buf, len);
}
uint8_t rtc_reg52_read(void) {
    uint8_t v = 0;
    rtc_sram_read(0, &v, 1);
    return v;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_rtc_osc_sram --output-on-failure`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add firmware/g0b1-apu/App/services/rtc.h firmware/g0b1-apu/App/services/rtc.c firmware/g0b1-apu/Tests/test_rtc_osc_sram.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): rtc — oscillator start/backup/running + SRAM access (reg 52)"
```

---

### Task 5: RTCC register accessors (regs 42–48) — staged shadow + atomic commit

**Files:**
- Modify: `firmware/g0b1-apu/App/services/rtc.h` (add RTCC accessor prototypes)
- Modify: `firmware/g0b1-apu/App/services/rtc.c` (add shadow + accessors + commit)
- Create: `firmware/g0b1-apu/Tests/test_rtc_rtcc.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `rtc_get_time`/`rtc_set_time` (Task 3).
- Produces: staged setters `void rtcc_set_year/month/day/weekday/hour/minute/second(uint16_t v);` (buffer into a module `rtc_time_t` shadow), `int rtcc_commit(void);` (write the staged shadow to hardware atomically via `rtc_set_time`), and live getters `uint16_t rtcc_get_year/month/day/weekday/hour/minute/second(void);` (each performs a fresh `rtc_get_time` and returns the field). This preserves the PIC's buffer-then-commit `rtcc_mod_*` pattern; the getters read the live clock (used to display current time).
- Register mapping (for M4b): 42→year, 43→month, 44→day(date), 45→weekday, 46→hour, 47→minute, 48→second.

- [ ] **Step 1: Add prototypes to `rtc.h`**

```c
void rtcc_set_year(uint16_t v);
void rtcc_set_month(uint16_t v);
void rtcc_set_day(uint16_t v);
void rtcc_set_weekday(uint16_t v);
void rtcc_set_hour(uint16_t v);
void rtcc_set_minute(uint16_t v);
void rtcc_set_second(uint16_t v);
int  rtcc_commit(void);
uint16_t rtcc_get_year(void);
uint16_t rtcc_get_month(void);
uint16_t rtcc_get_day(void);
uint16_t rtcc_get_weekday(void);
uint16_t rtcc_get_hour(void);
uint16_t rtcc_get_minute(void);
uint16_t rtcc_get_second(void);
```

- [ ] **Step 2: Write the failing test `Tests/test_rtc_rtcc.c`**

```c
#include "unity.h"
#include "rtc.h"
#include "fake_i2c.h"

static i2c_backend_t be;
void setUp(void) { fake_i2c_init(&be); rtc_init(&be); }
void tearDown(void) {}

static void test_stage_commit_then_get_live(void) {
    rtcc_set_year(25); rtcc_set_month(6); rtcc_set_day(15);
    rtcc_set_weekday(1); rtcc_set_hour(13); rtcc_set_minute(30); rtcc_set_second(45);
    TEST_ASSERT_EQUAL_INT(0, rtcc_commit());
    TEST_ASSERT_EQUAL_UINT16(25, rtcc_get_year());
    TEST_ASSERT_EQUAL_UINT16(6,  rtcc_get_month());
    TEST_ASSERT_EQUAL_UINT16(15, rtcc_get_day());
    TEST_ASSERT_EQUAL_UINT16(1,  rtcc_get_weekday());
    TEST_ASSERT_EQUAL_UINT16(13, rtcc_get_hour());
    TEST_ASSERT_EQUAL_UINT16(30, rtcc_get_minute());
    TEST_ASSERT_EQUAL_UINT16(45, rtcc_get_second());
}

static void test_stage_without_commit_does_not_change_clock(void) {
    /* Commit a known baseline. */
    rtcc_set_year(20); rtcc_set_month(1); rtcc_set_day(1);
    rtcc_set_weekday(1); rtcc_set_hour(0); rtcc_set_minute(0); rtcc_set_second(0);
    rtcc_commit();
    /* Stage a new year but do NOT commit. */
    rtcc_set_year(99);
    TEST_ASSERT_EQUAL_UINT16(20, rtcc_get_year());  /* live clock still baseline */
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_stage_commit_then_get_live);
    RUN_TEST(test_stage_without_commit_does_not_change_clock);
    return UNITY_END();
}
```

- [ ] **Step 3: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_rtc_rtcc test_rtc_rtcc.c ../App/services/rtc.c fakes/fake_i2c.c)
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_rtc_rtcc --output-on-failure`
Expected: build fails — RTCC symbols undefined.

- [ ] **Step 5: Implement in `rtc.c`** (append)

```c
static rtc_time_t s_rtcc_stage;   /* staged setters buffer here */

void rtcc_set_year(uint16_t v)    { s_rtcc_stage.year    = (uint8_t)v; }
void rtcc_set_month(uint16_t v)   { s_rtcc_stage.month   = (uint8_t)v; }
void rtcc_set_day(uint16_t v)     { s_rtcc_stage.date    = (uint8_t)v; }
void rtcc_set_weekday(uint16_t v) { s_rtcc_stage.weekday = (uint8_t)v; }
void rtcc_set_hour(uint16_t v)    { s_rtcc_stage.hour    = (uint8_t)v; }
void rtcc_set_minute(uint16_t v)  { s_rtcc_stage.min     = (uint8_t)v; }
void rtcc_set_second(uint16_t v)  { s_rtcc_stage.sec     = (uint8_t)v; }

int rtcc_commit(void) { return rtc_set_time(&s_rtcc_stage); }

static rtc_time_t rtcc_live(void) {
    rtc_time_t t = {0};
    rtc_get_time(&t);
    return t;
}
uint16_t rtcc_get_year(void)    { return rtcc_live().year; }
uint16_t rtcc_get_month(void)   { return rtcc_live().month; }
uint16_t rtcc_get_day(void)     { return rtcc_live().date; }
uint16_t rtcc_get_weekday(void) { return rtcc_live().weekday; }
uint16_t rtcc_get_hour(void)    { return rtcc_live().hour; }
uint16_t rtcc_get_minute(void)  { return rtcc_live().min; }
uint16_t rtcc_get_second(void)  { return rtcc_live().sec; }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_rtc_rtcc --output-on-failure`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add firmware/g0b1-apu/App/services/rtc.h firmware/g0b1-apu/App/services/rtc.c firmware/g0b1-apu/Tests/test_rtc_rtcc.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): rtc — RTCC accessors (regs 42-48) staged shadow + atomic commit"
```

---

### Task 6: Calendar-start parameter accessors (regs 24–31) over NVM

**Files:**
- Create: `firmware/g0b1-apu/App/services/rtc_calendar.h`
- Create: `firmware/g0b1-apu/App/services/rtc_calendar.c`
- Create: `firmware/g0b1-apu/Tests/test_rtc_calendar.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: M2 NVM store — `nvm_read_byte(uint16_t)`, `nvm_write_byte(uint16_t,uint8_t)` (from `nvm.h`); `EE_CLND_START_*` addresses (from `nvm_map.h`); `nvm_init` + `fake_nor` for tests.
- Produces (raw-byte pass-through; no BCD interpretation): `rtc_cal_get_state/mode/year/month/date/hour/min/ampm(void)` → `uint8_t`, and `rtc_cal_set_state/mode/year/month/date/hour/min/ampm(uint8_t)`.
- Register mapping (for M4b): 24→state, 25→mode, 26→year, 27→month, 28→date, 29→hour, 30→min, 31→ampm.

- [ ] **Step 1: Write `App/services/rtc_calendar.h`**

```c
#ifndef RTC_CALENDAR_H
#define RTC_CALENDAR_H
#include "types.h"
/* Calendar-start parameters (Modbus regs 24-31), stored as raw bytes in NVM at
   the EE_CLND_START_* addresses. The control layer (M6) interprets them against
   the live clock to decide auto-start; these accessors are pure storage. */
uint8_t rtc_cal_get_state(void);   void rtc_cal_set_state(uint8_t v);   /* reg 24 on/off */
uint8_t rtc_cal_get_mode(void);    void rtc_cal_set_mode(uint8_t v);    /* reg 25 */
uint8_t rtc_cal_get_year(void);    void rtc_cal_set_year(uint8_t v);    /* reg 26 */
uint8_t rtc_cal_get_month(void);   void rtc_cal_set_month(uint8_t v);   /* reg 27 */
uint8_t rtc_cal_get_date(void);    void rtc_cal_set_date(uint8_t v);    /* reg 28 */
uint8_t rtc_cal_get_hour(void);    void rtc_cal_set_hour(uint8_t v);    /* reg 29 */
uint8_t rtc_cal_get_min(void);     void rtc_cal_set_min(uint8_t v);     /* reg 30 */
uint8_t rtc_cal_get_ampm(void);    void rtc_cal_set_ampm(uint8_t v);    /* reg 31 */
#endif /* RTC_CALENDAR_H */
```

- [ ] **Step 2: Write the failing test `Tests/test_rtc_calendar.c`**

```c
#include "unity.h"
#include "rtc_calendar.h"
#include "nvm.h"
#include "nvm_map.h"
#include "fake_nor.h"

static nvm_backend_t be;
void setUp(void) { fake_nor_init(&be); nvm_init(&be); }
void tearDown(void) {}

static void test_state_roundtrip_and_address(void) {
    rtc_cal_set_state(1);
    TEST_ASSERT_EQUAL_UINT8(1, rtc_cal_get_state());
    TEST_ASSERT_EQUAL_UINT8(1, nvm_read_byte(EE_CLND_START_ONOFF)); /* correct EE addr */
}

static void test_all_fields_roundtrip_distinct_addresses(void) {
    rtc_cal_set_mode(2);  rtc_cal_set_year(0x25); rtc_cal_set_month(6);
    rtc_cal_set_date(15); rtc_cal_set_hour(9);    rtc_cal_set_min(30);
    rtc_cal_set_ampm(1);
    TEST_ASSERT_EQUAL_UINT8(2,    rtc_cal_get_mode());
    TEST_ASSERT_EQUAL_UINT8(0x25, rtc_cal_get_year());
    TEST_ASSERT_EQUAL_UINT8(6,    rtc_cal_get_month());
    TEST_ASSERT_EQUAL_UINT8(15,   rtc_cal_get_date());
    TEST_ASSERT_EQUAL_UINT8(9,    rtc_cal_get_hour());
    TEST_ASSERT_EQUAL_UINT8(30,   rtc_cal_get_min());
    TEST_ASSERT_EQUAL_UINT8(1,    rtc_cal_get_ampm());
    /* distinct EE addresses (no aliasing) */
    TEST_ASSERT_EQUAL_UINT8(2,    nvm_read_byte(EE_CLND_START_MODE));
    TEST_ASSERT_EQUAL_UINT8(0x25, nvm_read_byte(EE_CLND_START_YEAR));
    TEST_ASSERT_EQUAL_UINT8(1,    nvm_read_byte(EE_CLND_START_AMPM));
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_state_roundtrip_and_address);
    RUN_TEST(test_all_fields_roundtrip_distinct_addresses);
    return UNITY_END();
}
```

- [ ] **Step 3: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_rtc_calendar test_rtc_calendar.c ../App/services/rtc_calendar.c ../App/services/nvm.c ../App/services/nvm_record.c ../App/services/nvm_defaults.c ../App/services/modbus_crc.c fakes/fake_nor.c)
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_rtc_calendar --output-on-failure`
Expected: build fails — `rtc_cal_*` undefined.

- [ ] **Step 5: Write `App/services/rtc_calendar.c`**

```c
#include "rtc_calendar.h"
#include "nvm.h"
#include "nvm_map.h"

uint8_t rtc_cal_get_state(void)  { return nvm_read_byte(EE_CLND_START_ONOFF); }
void    rtc_cal_set_state(uint8_t v) { nvm_write_byte(EE_CLND_START_ONOFF, v); }
uint8_t rtc_cal_get_mode(void)   { return nvm_read_byte(EE_CLND_START_MODE); }
void    rtc_cal_set_mode(uint8_t v)  { nvm_write_byte(EE_CLND_START_MODE, v); }
uint8_t rtc_cal_get_year(void)   { return nvm_read_byte(EE_CLND_START_YEAR); }
void    rtc_cal_set_year(uint8_t v)  { nvm_write_byte(EE_CLND_START_YEAR, v); }
uint8_t rtc_cal_get_month(void)  { return nvm_read_byte(EE_CLND_START_MONTH); }
void    rtc_cal_set_month(uint8_t v) { nvm_write_byte(EE_CLND_START_MONTH, v); }
uint8_t rtc_cal_get_date(void)   { return nvm_read_byte(EE_CLND_START_DATE); }
void    rtc_cal_set_date(uint8_t v)  { nvm_write_byte(EE_CLND_START_DATE, v); }
uint8_t rtc_cal_get_hour(void)   { return nvm_read_byte(EE_CLND_START_HOUR); }
void    rtc_cal_set_hour(uint8_t v)  { nvm_write_byte(EE_CLND_START_HOUR, v); }
uint8_t rtc_cal_get_min(void)    { return nvm_read_byte(EE_CLND_START_MIN); }
void    rtc_cal_set_min(uint8_t v)   { nvm_write_byte(EE_CLND_START_MIN, v); }
uint8_t rtc_cal_get_ampm(void)   { return nvm_read_byte(EE_CLND_START_AMPM); }
void    rtc_cal_set_ampm(uint8_t v)  { nvm_write_byte(EE_CLND_START_AMPM, v); }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_rtc_calendar --output-on-failure`
Expected: PASS (2 tests).

- [ ] **Step 7: Run the full suite to confirm no regressions**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build --output-on-failure`
Expected: all tests pass (14 prior M1–M3 + 6 new M4a = **20 executables**), zero warnings under `-Werror`.

- [ ] **Step 8: Commit**

```bash
git add firmware/g0b1-apu/App/services/rtc_calendar.h firmware/g0b1-apu/App/services/rtc_calendar.c firmware/g0b1-apu/Tests/test_rtc_calendar.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): rtc — calendar-start param accessors (regs 24-31) over NVM"
```

---

## Self-Review

**Spec coverage (§7.2):** MCP7940N get/set date-time (struct↔BCD) ✅ (Tasks 2–3); oscillator start ✅ (Task 4); backup-supply enable ✅ (Task 4); SRAM/reg-52 access ✅ (Task 4); RTCC set/get accessors regs 42–48 ✅ (Task 5); calendar-start params regs 24–31 in NVM ✅ (Task 6). Auto-start calendar-vs-clock comparison ⏸ deferred to control (M6) by decision (documented). Concrete HAL I²C backend ⏸ deferred to bring-up (documented). The `MB_Display_HoldingReg` binding of these accessors is M4b, not this milestone.

**Placeholder scan:** no TBD/TODO. The one datasheet-dependent input (MCP7940N register bit positions) is an explicit verify step (Task 2) with a carry-forward, and the BCD/mask logic it guards is fully specified and tested.

**Type consistency:** `i2c_backend_t.read/write` signatures are used identically by `fake_i2c` and `rtc.c`. `rtc_time_t` field names (`sec/min/hour/weekday/date/month/year`) are used consistently across `rtc_get_time`/`rtc_set_time`/`rtcc_*`. `rtc_bcd_to_bin`/`rtc_bin_to_bcd`, `rtc_init`, and the `MCP_*` defines introduced in Task 2 are reused verbatim in Tasks 3–5. `rtc_cal_*` (Task 6) and the `EE_CLND_START_*` addresses match M2's `nvm_map.h`. Each test's CMake deps compile only the sources it needs (`fake_i2c.c` for RTC tests; the NVM stack + `fake_nor.c` for the calendar test).
