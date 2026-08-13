# STM32G0 APU Port — Milestone 4b: Modbus RTU Engine + Register Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the portable, host-tested Modbus RTU server engine (full function-code set + 8 diagnostic counters) and the regs 1–52 register model that binds it to the existing service accessors (sensors/M3, RTC+calendar/M4a, NVM/M2, plus firmware-rev and reset-request), preserving the PIC firmware's display register contract.

**Architecture:** A **provider-registration** register model (`mb_regmodel`) owns a `reg → {read_fn, write_fn}` table; each service registers its handlers at init (extending Milestone 1's `mb_reg_read_fn` callback seam and matching the `nvm_backend`/`i2c_backend` abstraction pattern). The `mb_engine` dispatches Modbus function codes over that table, reusing M1's `modbus_crc16` + `mb_check_frame`, and produces response frames — pure frame-in/frame-out. Registers whose providers are not yet built (M5 `bsp_io`, M6 `control`) simply have no binding and return exception `ILLEGAL_DATA_ADDRESS` (0x02) until those milestones call `mb_reg_bind`. The UART HAL driver (`drv_modbus_uart`: USART1 + DE + RTO) and the real `NVIC_SystemReset` action are **deferred to hardware bring-up**.

**Tech Stack:** C11, CMake + Unity (host). Reuses `types.h` (M1), `modbus_crc16` + `mb_check_frame` (M1), `sensors`/`rpm` (M3), `rtc`/`rtc_calendar` (M4a), `nvm` (M2), and the M2/M4a test fakes.

**Design spec:** `docs/superpowers/specs/2026-08-12-pic18-to-stm32g0-apu-port-design.md` §7.3 (register model), §7.4 (RTU engine). Prereqs: M1 (CRC/frame), M2 (NVM), M3 (sensors/rpm), M4a (rtc/calendar). Source of truth: PIC `modbus_server.c` (FC handlers, diagnostics), `parameters.c`/`parameters.h` (`MB_Display_HoldingReg` dispatch, reg enum 1–52).

## Global Constraints

- **Registers are 1-based; wire addresses are 0-based.** A read/write of wire start-address `S`, index `i` dispatches register `S + i + 1` (PIC: `MB_Display_HoldingReg(temp_word1 + ndx2 + 1, …)`). Range check preserved: `(start + count) <= 53` (`MB_REG_LIMIT`, PIC `MAX_HOLDING_REG_PARAMETER_DISP`); registers are 1..52 (`MB_REG_MAX`).
- **Function codes** (implemented): `0x03` read-holding, `0x04` read-input (same dispatch as 0x03), `0x06` write-single, `0x10` write-multiple, `0x07` read-exception-status, `0x08` diagnostics, `0x11` report-slave-id. Unknown FC → exception `ILLEGAL_FUNCTION` (0x01). File FCs `0x41/0x42` are **reserved for the future bootloader — not implemented**.
- **Exceptions:** `ILLEGAL_FUNCTION=1`, `ILLEGAL_DATA_ADDRESS=2`, `ILLEGAL_DATA_VALUE=3`; error response sets the FC's MSB (`| 0x80`). Quantity out of `1..0x7D` → `ILLEGAL_DATA_VALUE`; `(start+count) > 53` → `ILLEGAL_DATA_ADDRESS`; unbound register → `ILLEGAL_DATA_ADDRESS`; write to a read-only (no write_fn) register → `ILLEGAL_DATA_ADDRESS`; provider value-range failure → `ILLEGAL_DATA_VALUE`.
- **Diagnostics (FC 0x08):** sub-functions `0x00` return-query-data (loopback), `0x01` restart-comm (loopback), `0x0A` clear-counters, `0x0B..0x12` return the 8 counters (`counter[sub − 0x0B]`), `0x14` clear-overrun-flag (no-op ack), `0xAA` enter-test-mode. `MB_COUNTER_COUNT = 8`, `MB_DIAG_FIRST_COUNTER = 0x0B`.
- **Addressing:** slave address **1** (`MB_SLAVE_ADDR`); broadcast **0** → processed but **no response**. Frames not addressed to us and bad-CRC frames → **no response**.
- **Wire format is big-endian 16-bit** (hi byte first). CRC-16 (poly 0xA001, init 0xFFFF) is appended little-endian (lo, hi) exactly as M1's `modbus_crc16` + M1 frame layout. **Reuse `modbus_crc16`; never reimplement CRC.**
- **Register↔provider binding** (this milestone binds the ✅ rows; ⏸ rows have no binding → `ILLEGAL_DATA_ADDRESS` until their milestone registers them):

  | Provider (file) | Registers | Status |
  |---|---|---|
  | `mbp_sensors` (M3 `sensors`/`rpm`) | 1, 3, 6, 38, 51 | ✅ read-only |
  | `mbp_rtc` (M4a `rtc`/`rtc_calendar`) | 24–31 (calendar rw), 42–48 (RTCC rw), 52 (SRAM ro) | ✅ |
  | `mbp_nvm` (M2 `nvm`) | 11, 20, 21 (counters, word), 12 (fan speed, byte), 13, 14, 15, 16 (settings, word), 19 (unit, byte), 36, 37 (calibration, word) | ✅ rw |
  | `mbp_sys` (fw-rev + reset) | 39 (relay fw, ro const), 40 (display fw, rw RAM), 34 (reset-request → callback), 35 (boot flag, rw RAM) | ✅ |
  | `bsp_io` (M5) | 7, 8, 9, 41 | ⏸ → 0x02 |
  | `control` (M6) | 2, 4, 5, 10, 17, 18, 22, 23, 33 | ⏸ → 0x02 |
  | `control`/overrides (M6) | 32, 49, 50 | ⏸ → 0x02 (RAM override flags — no NVM address in M2's map; control-domain) |

- Fixed-width integers only (`<stdint.h>` via `types.h`). Portable code under `App/services/` — **no HAL**. Firmware root `firmware/g0b1-apu/`. Every task ends green (`ctest`) and is committed; build is `-Wall -Wextra -Werror -funsigned-char` and must stay pristine. Response buffers are caller-provided, ≥ 256 bytes (`MB_MAX_FRAME`).

### Deferred / carry-forward
- **`drv_modbus_uart` HAL** (USART1 PA9/PA10, DE PB3, DMA, RTO 3.5-char frame gap) → bench; it feeds bytes to / drains bytes from `mb_engine_process`.
- **Real `NVIC_SystemReset` + boot-flag stash** (RTC-SRAM) behind the reg-34 reset-request callback → bench.
- **M5/M6 provider registration:** `bsp_io` binds regs 7,8,9,41; `control` binds regs 2,4,5,10,17,18,22,23,33,32,49,50 — each calls `mb_reg_bind` for its own registers, no engine edits.
- **RTCC stage-seeding (from M4a):** the `mbp_rtc` write path seeds the RTCC stage from the live clock before each field write + commit (Task 8), honoring M4a's documented seam.

---

### Task 1: Shared defs + register-model core (provider table + dispatch)

**Files:**
- Create: `firmware/g0b1-apu/App/services/modbus_defs.h`
- Create: `firmware/g0b1-apu/App/services/mb_regmodel.h`
- Create: `firmware/g0b1-apu/App/services/mb_regmodel.c`
- Create: `firmware/g0b1-apu/Tests/test_mb_regmodel.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Produces (`modbus_defs.h`): FC/exception/field-offset/diagnostic/addressing constants; `typedef enum { MB_EXC_NONE=0, MB_EXC_ILLEGAL_FUNCTION=1, MB_EXC_ILLEGAL_ADDRESS=2, MB_EXC_ILLEGAL_VALUE=3 } modbus_exc_t;`
- Produces (`mb_regmodel.h`): `typedef modbus_exc_t (*mb_reg_read_fn)(uint16_t reg, uint16_t *out);` `typedef modbus_exc_t (*mb_reg_write_fn)(uint16_t reg, uint16_t val);` `void mb_reg_reset(void);` `void mb_reg_bind(uint16_t reg, mb_reg_read_fn rd, mb_reg_write_fn wr);` `modbus_exc_t mb_reg_read(uint16_t reg, uint16_t *out);` `modbus_exc_t mb_reg_write(uint16_t reg, uint16_t val);`

- [ ] **Step 1: Write `App/services/modbus_defs.h`**

```c
#ifndef MODBUS_DEFS_H
#define MODBUS_DEFS_H
#include "types.h"

/* Function codes (0x41/0x42 file FCs reserved for bootloader, not implemented). */
#define MB_FC_READ_HOLDING     0x03u
#define MB_FC_READ_INPUT       0x04u
#define MB_FC_WRITE_SINGLE     0x06u
#define MB_FC_READ_EXCEPTION   0x07u
#define MB_FC_DIAGNOSTICS      0x08u
#define MB_FC_WRITE_MULTIPLE   0x10u
#define MB_FC_REPORT_SLAVE_ID  0x11u
#define MB_ERROR_RESPONSE      0x80u

typedef enum {
    MB_EXC_NONE             = 0,
    MB_EXC_ILLEGAL_FUNCTION = 1,
    MB_EXC_ILLEGAL_ADDRESS  = 2,
    MB_EXC_ILLEGAL_VALUE    = 3
} modbus_exc_t;

/* PDU field offsets within the RTU frame. */
#define MB_F_ADDR      0u
#define MB_F_FUNCTION  1u
#define MB_F_START_HI  2u
#define MB_F_START_LO  3u
#define MB_F_QTY_HI    4u
#define MB_F_QTY_LO    5u
#define MB_HEADER_SIZE 6u

/* Register model. Registers are 1..52; wire range check is (start+count) <= 53. */
#define MB_REG_MAX     52u
#define MB_REG_LIMIT   53u

/* Diagnostics (FC 0x08) sub-functions. */
#define MB_DIAG_RETURN_QUERY   0x00u
#define MB_DIAG_RESTART_COMM   0x01u
#define MB_DIAG_CLEAR_COUNTERS 0x0Au
#define MB_DIAG_FIRST_COUNTER  0x0Bu   /* 0x0B..0x12 -> counter[sub-0x0B] */
#define MB_DIAG_LAST_COUNTER   0x12u
#define MB_DIAG_CLR_OVERRUN    0x14u
#define MB_DIAG_ENTER_TEST     0xAAu
#define MB_COUNTER_COUNT       8u

/* Addressing + buffer. */
#define MB_SLAVE_ADDR      1u
#define MB_BROADCAST_ADDR  0u
#define MB_MAX_FRAME       256u

#endif /* MODBUS_DEFS_H */
```

- [ ] **Step 2: Write `App/services/mb_regmodel.h`**

```c
#ifndef MB_REGMODEL_H
#define MB_REGMODEL_H
#include "modbus_defs.h"

/* A provider read returns MB_EXC_NONE and sets *out, or an exception code.
   A provider write returns MB_EXC_NONE, or ILLEGAL_VALUE for out-of-range. */
typedef modbus_exc_t (*mb_reg_read_fn)(uint16_t reg, uint16_t *out);
typedef modbus_exc_t (*mb_reg_write_fn)(uint16_t reg, uint16_t val);

void         mb_reg_reset(void);   /* drop all bindings */
void         mb_reg_bind(uint16_t reg, mb_reg_read_fn rd, mb_reg_write_fn wr); /* wr NULL = read-only */
modbus_exc_t mb_reg_read(uint16_t reg, uint16_t *out);  /* unbound/no reader -> ILLEGAL_ADDRESS */
modbus_exc_t mb_reg_write(uint16_t reg, uint16_t val);  /* unbound/no writer -> ILLEGAL_ADDRESS */

#endif /* MB_REGMODEL_H */
```

- [ ] **Step 3: Write the failing test `Tests/test_mb_regmodel.c`**

```c
#include "unity.h"
#include "mb_regmodel.h"

void setUp(void) { mb_reg_reset(); }
void tearDown(void) {}

static uint16_t s_val;
static modbus_exc_t rd_ok(uint16_t reg, uint16_t *out) { (void)reg; *out = s_val; return MB_EXC_NONE; }
static modbus_exc_t wr_ok(uint16_t reg, uint16_t val) { (void)reg; s_val = val; return MB_EXC_NONE; }
static modbus_exc_t wr_range(uint16_t reg, uint16_t val) { (void)reg; return val <= 2 ? MB_EXC_NONE : MB_EXC_ILLEGAL_VALUE; }

static void test_unbound_reads_illegal_address(void) {
    uint16_t o = 0xAAAA;
    TEST_ASSERT_EQUAL_INT(MB_EXC_ILLEGAL_ADDRESS, mb_reg_read(10, &o));
    TEST_ASSERT_EQUAL_INT(MB_EXC_ILLEGAL_ADDRESS, mb_reg_write(10, 5));
}

static void test_bound_rw_roundtrip(void) {
    mb_reg_bind(13, rd_ok, wr_ok);
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(13, 1234));
    uint16_t o = 0;
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_read(13, &o));
    TEST_ASSERT_EQUAL_UINT16(1234, o);
}

static void test_readonly_write_is_illegal_address(void) {
    mb_reg_bind(6, rd_ok, 0);            /* read-only */
    uint16_t o; s_val = 77;
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_read(6, &o));
    TEST_ASSERT_EQUAL_UINT16(77, o);
    TEST_ASSERT_EQUAL_INT(MB_EXC_ILLEGAL_ADDRESS, mb_reg_write(6, 1));
}

static void test_provider_value_range(void) {
    mb_reg_bind(19, rd_ok, wr_range);
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(19, 2));
    TEST_ASSERT_EQUAL_INT(MB_EXC_ILLEGAL_VALUE, mb_reg_write(19, 3));
}

static void test_out_of_range_reg_illegal_address(void) {
    uint16_t o;
    TEST_ASSERT_EQUAL_INT(MB_EXC_ILLEGAL_ADDRESS, mb_reg_read(0, &o));   /* reg 0 invalid */
    TEST_ASSERT_EQUAL_INT(MB_EXC_ILLEGAL_ADDRESS, mb_reg_read(53, &o));  /* > MB_REG_MAX */
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_unbound_reads_illegal_address);
    RUN_TEST(test_bound_rw_roundtrip);
    RUN_TEST(test_readonly_write_is_illegal_address);
    RUN_TEST(test_provider_value_range);
    RUN_TEST(test_out_of_range_reg_illegal_address);
    return UNITY_END();
}
```

- [ ] **Step 4: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_mb_regmodel test_mb_regmodel.c ../App/services/mb_regmodel.c)
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_mb_regmodel --output-on-failure`
Expected: build fails — `mb_reg_*` undefined.

- [ ] **Step 6: Write `App/services/mb_regmodel.c`**

```c
#include "mb_regmodel.h"

typedef struct { mb_reg_read_fn rd; mb_reg_write_fn wr; } mb_reg_slot_t;
static mb_reg_slot_t s_slots[MB_REG_MAX + 1u];   /* index by register number 1..52 */

void mb_reg_reset(void) {
    for (uint16_t r = 0; r <= MB_REG_MAX; r++) { s_slots[r].rd = 0; s_slots[r].wr = 0; }
}

void mb_reg_bind(uint16_t reg, mb_reg_read_fn rd, mb_reg_write_fn wr) {
    if (reg >= 1u && reg <= MB_REG_MAX) { s_slots[reg].rd = rd; s_slots[reg].wr = wr; }
}

modbus_exc_t mb_reg_read(uint16_t reg, uint16_t *out) {
    if (reg < 1u || reg > MB_REG_MAX || s_slots[reg].rd == 0) return MB_EXC_ILLEGAL_ADDRESS;
    return s_slots[reg].rd(reg, out);
}

modbus_exc_t mb_reg_write(uint16_t reg, uint16_t val) {
    if (reg < 1u || reg > MB_REG_MAX || s_slots[reg].wr == 0) return MB_EXC_ILLEGAL_ADDRESS;
    return s_slots[reg].wr(reg, val);
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_mb_regmodel --output-on-failure`
Expected: PASS (5 tests).

- [ ] **Step 8: Commit**

```bash
git add firmware/g0b1-apu/App/services/modbus_defs.h firmware/g0b1-apu/App/services/mb_regmodel.h firmware/g0b1-apu/App/services/mb_regmodel.c firmware/g0b1-apu/Tests/test_mb_regmodel.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): modbus — register-model provider table + dispatch (unbound -> 0x02)"
```

---

### Task 2: Engine core + FC 0x03/0x04 (read holding / input)

**Files:**
- Create: `firmware/g0b1-apu/App/services/mb_engine.h`
- Create: `firmware/g0b1-apu/App/services/mb_engine.c`
- Create: `firmware/g0b1-apu/Tests/test_mb_engine_read.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `mb_regmodel.h` (dispatch), M1 `modbus_crc.h` (`modbus_crc16`), M1 `modbus_frame.h` (`mb_check_frame`).
- Produces: `void mb_engine_init(void);` `void mb_engine_process(const uint8_t *req, uint16_t req_len, uint8_t *resp, uint16_t *resp_len);` — `*resp_len = 0` means no response (not-for-us, bad CRC, or broadcast). Reads use `mb_reg_read`; FC 0x03 and 0x04 share the same handler.
- The response for a successful read: `[addr][fc][bytecount=2*count][hi,lo per reg...]` + CRC (lo,hi). If any register read returns an exception, the whole response is the exception frame `[addr][fc|0x80][exccode]` + CRC (PIC returns on first error).

- [ ] **Step 1: Write `App/services/mb_engine.h`**

```c
#ifndef MB_ENGINE_H
#define MB_ENGINE_H
#include "modbus_defs.h"

void mb_engine_init(void);   /* reset diagnostic counters + test-mode flag */

/* Process one received RTU frame (bytes addr..crc_hi). Writes the response into
   resp (caller supplies >= MB_MAX_FRAME bytes) and its length into *resp_len.
   *resp_len == 0 => send nothing (frame not for us, bad CRC, or broadcast). */
void mb_engine_process(const uint8_t *req, uint16_t req_len, uint8_t *resp, uint16_t *resp_len);

uint16_t mb_engine_counter(uint8_t idx);   /* idx 0..MB_COUNTER_COUNT-1 */
bool     mb_engine_test_mode(void);

#endif /* MB_ENGINE_H */
```

- [ ] **Step 2: Write the failing test `Tests/test_mb_engine_read.c`**

```c
#include "unity.h"
#include "mb_engine.h"
#include "mb_regmodel.h"
#include "modbus_crc.h"
#include <string.h>

static uint16_t s_regs[MB_REG_MAX + 1];
static modbus_exc_t rd_shadow(uint16_t reg, uint16_t *out) { *out = s_regs[reg]; return MB_EXC_NONE; }

void setUp(void) {
    mb_reg_reset();
    mb_engine_init();
    for (uint16_t r = 1; r <= MB_REG_MAX; r++) { s_regs[r] = 0; mb_reg_bind(r, rd_shadow, 0); }
}
void tearDown(void) {}

/* Build [addr][fc][starthi][startlo][cnthi][cntlo] + CRC into buf; return length. */
static uint16_t build_req(uint8_t *buf, uint8_t fc, uint16_t start, uint16_t cnt) {
    buf[0] = MB_SLAVE_ADDR; buf[1] = fc;
    buf[2] = (uint8_t)(start >> 8); buf[3] = (uint8_t)start;
    buf[4] = (uint8_t)(cnt >> 8);   buf[5] = (uint8_t)cnt;
    uint16_t crc = modbus_crc16(buf, 6);
    buf[6] = (uint8_t)crc; buf[7] = (uint8_t)(crc >> 8);
    return 8;
}
static void assert_crc_ok(const uint8_t *f, uint16_t len) {
    uint16_t crc = modbus_crc16(f, (uint16_t)(len - 2));
    TEST_ASSERT_EQUAL_UINT8((uint8_t)crc, f[len - 2]);
    TEST_ASSERT_EQUAL_UINT8((uint8_t)(crc >> 8), f[len - 1]);
}

static void test_read_holding_two_regs(void) {
    s_regs[1] = 0x1234; s_regs[2] = 0x5678;
    uint8_t req[16], resp[MB_MAX_FRAME]; uint16_t rl = 0;
    uint16_t n = build_req(req, MB_FC_READ_HOLDING, 0, 2); /* wire start 0 -> regs 1,2 */
    mb_engine_process(req, n, resp, &rl);
    TEST_ASSERT_EQUAL_UINT16(9, rl);                    /* addr fc bc + 4 data + 2 crc */
    TEST_ASSERT_EQUAL_UINT8(MB_SLAVE_ADDR, resp[0]);
    TEST_ASSERT_EQUAL_UINT8(MB_FC_READ_HOLDING, resp[1]);
    TEST_ASSERT_EQUAL_UINT8(4, resp[2]);                /* byte count */
    TEST_ASSERT_EQUAL_UINT8(0x12, resp[3]); TEST_ASSERT_EQUAL_UINT8(0x34, resp[4]);
    TEST_ASSERT_EQUAL_UINT8(0x56, resp[5]); TEST_ASSERT_EQUAL_UINT8(0x78, resp[6]);
    assert_crc_ok(resp, rl);
}

static void test_read_input_shares_dispatch(void) {
    s_regs[6] = 0x0BEE;
    uint8_t req[16], resp[MB_MAX_FRAME]; uint16_t rl = 0;
    uint16_t n = build_req(req, MB_FC_READ_INPUT, 5, 1); /* wire 5 -> reg 6 */
    mb_engine_process(req, n, resp, &rl);
    TEST_ASSERT_EQUAL_UINT8(MB_FC_READ_INPUT, resp[1]);
    TEST_ASSERT_EQUAL_UINT8(2, resp[2]);
    TEST_ASSERT_EQUAL_UINT8(0x0B, resp[3]); TEST_ASSERT_EQUAL_UINT8(0xEE, resp[4]);
    assert_crc_ok(resp, rl);
}

static void test_read_unbound_register_exception(void) {
    mb_reg_reset();                                     /* nothing bound now */
    uint8_t req[16], resp[MB_MAX_FRAME]; uint16_t rl = 0;
    uint16_t n = build_req(req, MB_FC_READ_HOLDING, 0, 1);
    mb_engine_process(req, n, resp, &rl);
    TEST_ASSERT_EQUAL_UINT16(5, rl);                    /* addr fc|80 exc + crc */
    TEST_ASSERT_EQUAL_UINT8(MB_FC_READ_HOLDING | MB_ERROR_RESPONSE, resp[1]);
    TEST_ASSERT_EQUAL_UINT8(MB_EXC_ILLEGAL_ADDRESS, resp[2]);
    assert_crc_ok(resp, rl);
}

static void test_count_zero_is_illegal_value(void) {
    uint8_t req[16], resp[MB_MAX_FRAME]; uint16_t rl = 0;
    uint16_t n = build_req(req, MB_FC_READ_HOLDING, 0, 0);
    mb_engine_process(req, n, resp, &rl);
    TEST_ASSERT_EQUAL_UINT8(MB_FC_READ_HOLDING | MB_ERROR_RESPONSE, resp[1]);
    TEST_ASSERT_EQUAL_UINT8(MB_EXC_ILLEGAL_VALUE, resp[2]);
}

static void test_range_over_limit_illegal_address(void) {
    uint8_t req[16], resp[MB_MAX_FRAME]; uint16_t rl = 0;
    uint16_t n = build_req(req, MB_FC_READ_HOLDING, 52, 2); /* 52+2=54 > 53 */
    mb_engine_process(req, n, resp, &rl);
    TEST_ASSERT_EQUAL_UINT8(MB_EXC_ILLEGAL_ADDRESS, resp[2]);
}

static void test_bad_crc_no_response(void) {
    uint8_t req[16], resp[MB_MAX_FRAME]; uint16_t rl = 99;
    uint16_t n = build_req(req, MB_FC_READ_HOLDING, 0, 1);
    req[7] ^= 0xFF;                                     /* corrupt CRC */
    mb_engine_process(req, n, resp, &rl);
    TEST_ASSERT_EQUAL_UINT16(0, rl);
}

static void test_wrong_address_no_response(void) {
    uint8_t req[16], resp[MB_MAX_FRAME]; uint16_t rl = 99;
    uint16_t n = build_req(req, MB_FC_READ_HOLDING, 0, 1);
    req[0] = 2; uint16_t crc = modbus_crc16(req, 6);    /* re-CRC for addr 2 */
    req[6] = (uint8_t)crc; req[7] = (uint8_t)(crc >> 8);
    mb_engine_process(req, n, resp, &rl);
    TEST_ASSERT_EQUAL_UINT16(0, rl);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_read_holding_two_regs);
    RUN_TEST(test_read_input_shares_dispatch);
    RUN_TEST(test_read_unbound_register_exception);
    RUN_TEST(test_count_zero_is_illegal_value);
    RUN_TEST(test_range_over_limit_illegal_address);
    RUN_TEST(test_bad_crc_no_response);
    RUN_TEST(test_wrong_address_no_response);
    return UNITY_END();
}
```

- [ ] **Step 3: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_mb_engine_read test_mb_engine_read.c ../App/services/mb_engine.c ../App/services/mb_regmodel.c ../App/services/modbus_frame.c ../App/services/modbus_crc.c)
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_mb_engine_read --output-on-failure`
Expected: build fails — `mb_engine_*` undefined.

- [ ] **Step 5: Write `App/services/mb_engine.c`** (core + read path; later tasks append write/diag/report handlers to `dispatch_fc`)

```c
#include "mb_engine.h"
#include "mb_regmodel.h"
#include "modbus_crc.h"
#include "modbus_frame.h"

static uint16_t s_counter[MB_COUNTER_COUNT];
static bool     s_test_mode;

void mb_engine_init(void) {
    for (uint8_t i = 0; i < MB_COUNTER_COUNT; i++) s_counter[i] = 0;
    s_test_mode = false;
}
uint16_t mb_engine_counter(uint8_t idx) { return (idx < MB_COUNTER_COUNT) ? s_counter[idx] : 0; }
bool     mb_engine_test_mode(void) { return s_test_mode; }

/* Finalize an exception response into resp; returns its length. */
static uint16_t make_exception(uint8_t *resp, uint8_t fc, modbus_exc_t exc) {
    resp[MB_F_ADDR] = MB_SLAVE_ADDR;
    resp[MB_F_FUNCTION] = (uint8_t)(fc | MB_ERROR_RESPONSE);
    resp[2] = (uint8_t)exc;
    return 3u;
}

/* Append CRC (lo,hi) after `len` bytes; return total length. */
static uint16_t finalize(uint8_t *resp, uint16_t len) {
    uint16_t crc = modbus_crc16(resp, len);
    resp[len] = (uint8_t)crc;
    resp[len + 1] = (uint8_t)(crc >> 8);
    return (uint16_t)(len + 2u);
}

/* FC 0x03 / 0x04: read `count` regs starting at 1-based (start+1). */
static uint16_t handle_read(const uint8_t *req, uint8_t *resp) {
    uint8_t  fc    = req[MB_F_FUNCTION];
    uint16_t start = (uint16_t)(req[MB_F_START_HI] << 8) | req[MB_F_START_LO];
    uint16_t count = (uint16_t)(req[MB_F_QTY_HI] << 8) | req[MB_F_QTY_LO];

    if (count < 1u || count > 0x7Du) return finalize(resp, make_exception(resp, fc, MB_EXC_ILLEGAL_VALUE));
    if ((uint32_t)start + count > MB_REG_LIMIT) return finalize(resp, make_exception(resp, fc, MB_EXC_ILLEGAL_ADDRESS));

    uint16_t idx = MB_F_FUNCTION + 1u;
    resp[MB_F_ADDR] = MB_SLAVE_ADDR;
    resp[MB_F_FUNCTION] = fc;
    resp[idx++] = (uint8_t)(count * 2u);
    for (uint16_t i = 0; i < count; i++) {
        uint16_t val = 0;
        modbus_exc_t exc = mb_reg_read((uint16_t)(start + i + 1u), &val);
        if (exc != MB_EXC_NONE) return finalize(resp, make_exception(resp, fc, exc));
        resp[idx++] = (uint8_t)(val >> 8);
        resp[idx++] = (uint8_t)val;
    }
    return finalize(resp, idx);
}

/* Returns response length (pre-CRC handlers call finalize themselves), or 0 for no response. */
static uint16_t dispatch_fc(const uint8_t *req, uint16_t req_len, uint8_t *resp) {
    (void)req_len;
    switch (req[MB_F_FUNCTION]) {
        case MB_FC_READ_HOLDING:
        case MB_FC_READ_INPUT:
            return handle_read(req, resp);
        default:
            return finalize(resp, make_exception(resp, req[MB_F_FUNCTION], MB_EXC_ILLEGAL_FUNCTION));
    }
}

void mb_engine_process(const uint8_t *req, uint16_t req_len, uint8_t *resp, uint16_t *resp_len) {
    *resp_len = 0;
    mb_frame_status_t st = mb_check_frame(req, req_len, MB_SLAVE_ADDR);
    if (st != MB_FRAME_OK) return;                 /* not-for-us / short / bad CRC -> silent */
    if (req[MB_F_ADDR] == MB_BROADCAST_ADDR) {     /* broadcast: act, no response (no read/broadcast here) */
        return;
    }
    *resp_len = dispatch_fc(req, req_len, resp);
}
```

*Note: `mb_check_frame` (M1) already rejects frames whose address is neither ours nor broadcast; the explicit broadcast guard above suppresses the response for broadcast writes handled in later tasks.*

- [ ] **Step 6: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_mb_engine_read --output-on-failure`
Expected: PASS (7 tests).

- [ ] **Step 7: Commit**

```bash
git add firmware/g0b1-apu/App/services/mb_engine.h firmware/g0b1-apu/App/services/mb_engine.c firmware/g0b1-apu/Tests/test_mb_engine_read.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): modbus engine — FC 0x03/0x04 read holding/input over register model"
```

*Prereq (verified): M1's `mb_check_frame` returns `MB_FRAME_OK` for a broadcast frame (`modbus_frame.c` rejects only `buf[0] != our_addr && buf[0] != 0x00`), so the broadcast guard above is reachable and the Task-2 code is correct as written. Task 6 later replaces the `mb_check_frame` call with a direct `modbus_crc16` validation to formalize the counter policy — no change needed here.*

---

### Task 3: FC 0x06 write-single + 0x10 write-multiple

**Files:**
- Modify: `firmware/g0b1-apu/App/services/mb_engine.c` (add write handlers to `dispatch_fc`)
- Create: `firmware/g0b1-apu/Tests/test_mb_engine_write.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `mb_reg_write` (Task 1), engine helpers (Task 2).
- Produces (behavior): FC 0x06 writes register `start+1` from value bytes `[4][5]`, response **echoes the 6-byte request** (`[addr][0x06][starthi][startlo][valhi][vallo]` + CRC). FC 0x10 writes `count` regs from the payload (byte-count at `[6]`, values from `[7]`), response is `[addr][0x10][starthi][startlo][cnthi][cntlo]` + CRC. Any write exception → exception frame (PIC keeps the last error; here return the first exception encountered).

- [ ] **Step 1: Write the failing test `Tests/test_mb_engine_write.c`**

```c
#include "unity.h"
#include "mb_engine.h"
#include "mb_regmodel.h"
#include "modbus_crc.h"

static uint16_t s_regs[MB_REG_MAX + 1];
static modbus_exc_t rd_sh(uint16_t reg, uint16_t *out) { *out = s_regs[reg]; return MB_EXC_NONE; }
static modbus_exc_t wr_sh(uint16_t reg, uint16_t val) { s_regs[reg] = val; return MB_EXC_NONE; }
static modbus_exc_t wr_max2(uint16_t reg, uint16_t val) { if (val > 2) return MB_EXC_ILLEGAL_VALUE; s_regs[reg] = val; return MB_EXC_NONE; }

void setUp(void) {
    mb_reg_reset(); mb_engine_init();
    for (uint16_t r = 1; r <= MB_REG_MAX; r++) { s_regs[r] = 0; mb_reg_bind(r, rd_sh, wr_sh); }
}
void tearDown(void) {}

static void put_crc(uint8_t *b, uint16_t n) { uint16_t c = modbus_crc16(b, n); b[n] = (uint8_t)c; b[n+1] = (uint8_t)(c >> 8); }
static void assert_crc_ok(const uint8_t *f, uint16_t len) {
    uint16_t c = modbus_crc16(f, (uint16_t)(len - 2));
    TEST_ASSERT_EQUAL_UINT8((uint8_t)c, f[len-2]);
    TEST_ASSERT_EQUAL_UINT8((uint8_t)(c >> 8), f[len-1]);
}

static void test_write_single_echoes_request(void) {
    uint8_t req[16] = { MB_SLAVE_ADDR, MB_FC_WRITE_SINGLE, 0x00, 0x0C, 0x03, 0xE8 }; /* wire 12 -> reg 13, val 1000 */
    put_crc(req, 6);
    uint8_t resp[MB_MAX_FRAME]; uint16_t rl = 0;
    mb_engine_process(req, 8, resp, &rl);
    TEST_ASSERT_EQUAL_UINT16(8, rl);
    for (int i = 0; i < 6; i++) TEST_ASSERT_EQUAL_UINT8(req[i], resp[i]); /* echo */
    assert_crc_ok(resp, rl);
    TEST_ASSERT_EQUAL_UINT16(1000, s_regs[13]);
}

static void test_write_single_value_range_exception(void) {
    mb_reg_bind(19, rd_sh, wr_max2);
    uint8_t req[16] = { MB_SLAVE_ADDR, MB_FC_WRITE_SINGLE, 0x00, 0x12, 0x00, 0x05 }; /* wire 18 -> reg 19, val 5 */
    put_crc(req, 6);
    uint8_t resp[MB_MAX_FRAME]; uint16_t rl = 0;
    mb_engine_process(req, 8, resp, &rl);
    TEST_ASSERT_EQUAL_UINT8(MB_FC_WRITE_SINGLE | MB_ERROR_RESPONSE, resp[1]);
    TEST_ASSERT_EQUAL_UINT8(MB_EXC_ILLEGAL_VALUE, resp[2]);
}

static void test_write_single_readonly_illegal_address(void) {
    mb_reg_bind(6, rd_sh, 0);                       /* read-only */
    uint8_t req[16] = { MB_SLAVE_ADDR, MB_FC_WRITE_SINGLE, 0x00, 0x05, 0x00, 0x01 };
    put_crc(req, 6);
    uint8_t resp[MB_MAX_FRAME]; uint16_t rl = 0;
    mb_engine_process(req, 8, resp, &rl);
    TEST_ASSERT_EQUAL_UINT8(MB_EXC_ILLEGAL_ADDRESS, resp[2]);
}

static void test_write_multiple_two_regs(void) {
    /* wire start 12 -> regs 13,14; count 2; byte-count 4; values 1000, 70 */
    uint8_t req[32] = { MB_SLAVE_ADDR, MB_FC_WRITE_MULTIPLE, 0x00, 0x0C, 0x00, 0x02, 0x04,
                        0x03, 0xE8, 0x00, 0x46 };
    put_crc(req, 11);
    uint8_t resp[MB_MAX_FRAME]; uint16_t rl = 0;
    mb_engine_process(req, 13, resp, &rl);
    TEST_ASSERT_EQUAL_UINT16(8, rl);               /* addr fc starthi startlo cnthi cntlo + crc */
    TEST_ASSERT_EQUAL_UINT8(MB_FC_WRITE_MULTIPLE, resp[1]);
    TEST_ASSERT_EQUAL_UINT8(0x00, resp[2]); TEST_ASSERT_EQUAL_UINT8(0x0C, resp[3]);
    TEST_ASSERT_EQUAL_UINT8(0x00, resp[4]); TEST_ASSERT_EQUAL_UINT8(0x02, resp[5]);
    assert_crc_ok(resp, rl);
    TEST_ASSERT_EQUAL_UINT16(1000, s_regs[13]);
    TEST_ASSERT_EQUAL_UINT16(70, s_regs[14]);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_write_single_echoes_request);
    RUN_TEST(test_write_single_value_range_exception);
    RUN_TEST(test_write_single_readonly_illegal_address);
    RUN_TEST(test_write_multiple_two_regs);
    return UNITY_END();
}
```

- [ ] **Step 2: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_mb_engine_write test_mb_engine_write.c ../App/services/mb_engine.c ../App/services/mb_regmodel.c ../App/services/modbus_frame.c ../App/services/modbus_crc.c)
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_mb_engine_write --output-on-failure`
Expected: FAIL — write FCs fall through to `ILLEGAL_FUNCTION`.

- [ ] **Step 4: Add the write handlers to `mb_engine.c`** (insert `handle_write_single`/`handle_write_multiple` above `dispatch_fc`, and add the cases)

```c
static uint16_t handle_write_single(const uint8_t *req, uint8_t *resp) {
    uint16_t start = (uint16_t)(req[MB_F_START_HI] << 8) | req[MB_F_START_LO];
    uint16_t val   = (uint16_t)(req[MB_F_QTY_HI] << 8) | req[MB_F_QTY_LO]; /* value in bytes 4,5 */
    modbus_exc_t exc = mb_reg_write((uint16_t)(start + 1u), val);
    if (exc != MB_EXC_NONE) return finalize(resp, make_exception(resp, MB_FC_WRITE_SINGLE, exc));
    for (uint16_t i = 0; i < MB_HEADER_SIZE; i++) resp[i] = req[i];   /* echo request */
    return finalize(resp, MB_HEADER_SIZE);
}

static uint16_t handle_write_multiple(const uint8_t *req, uint8_t *resp) {
    uint16_t start = (uint16_t)(req[MB_F_START_HI] << 8) | req[MB_F_START_LO];
    uint16_t count = (uint16_t)(req[MB_F_QTY_HI] << 8) | req[MB_F_QTY_LO];
    if (count < 1u || count > 0x7Du) return finalize(resp, make_exception(resp, MB_FC_WRITE_MULTIPLE, MB_EXC_ILLEGAL_VALUE));
    if ((uint32_t)start + count > MB_REG_LIMIT) return finalize(resp, make_exception(resp, MB_FC_WRITE_MULTIPLE, MB_EXC_ILLEGAL_ADDRESS));
    uint16_t ndx = MB_HEADER_SIZE + 1u;    /* skip byte-count at [6]; values start at [7] */
    for (uint16_t i = 0; i < count; i++) {
        uint16_t val = (uint16_t)(req[ndx] << 8) | req[ndx + 1u];
        ndx += 2u;
        modbus_exc_t exc = mb_reg_write((uint16_t)(start + i + 1u), val);
        if (exc != MB_EXC_NONE) return finalize(resp, make_exception(resp, MB_FC_WRITE_MULTIPLE, exc));
    }
    resp[MB_F_ADDR] = MB_SLAVE_ADDR;
    resp[MB_F_FUNCTION] = MB_FC_WRITE_MULTIPLE;
    resp[MB_F_START_HI] = req[MB_F_START_HI]; resp[MB_F_START_LO] = req[MB_F_START_LO];
    resp[MB_F_QTY_HI]   = req[MB_F_QTY_HI];   resp[MB_F_QTY_LO]   = req[MB_F_QTY_LO];
    return finalize(resp, MB_HEADER_SIZE);
}
```

Add to `dispatch_fc`'s switch:

```c
        case MB_FC_WRITE_SINGLE:   return handle_write_single(req, resp);
        case MB_FC_WRITE_MULTIPLE: return handle_write_multiple(req, resp);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_mb_engine_write --output-on-failure`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add firmware/g0b1-apu/App/services/mb_engine.c firmware/g0b1-apu/Tests/test_mb_engine_write.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): modbus engine — FC 0x06 write-single + 0x10 write-multiple"
```

---

### Task 4: FC 0x07 exception-status + 0x11 report-slave-id

**Files:**
- Modify: `firmware/g0b1-apu/App/services/mb_engine.c` (add handlers + a slave-id string)
- Create: `firmware/g0b1-apu/Tests/test_mb_engine_misc.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Produces (behavior): FC 0x07 → `[addr][0x07][0x00]` + CRC (one exception-status byte, always 0). FC 0x11 → `[addr][0x11][bytecount][id bytes…]` + CRC where the id is the NUL-terminated ASCII string `"EF-G0B1R"` (byte count = strlen).

- [ ] **Step 1: Write the failing test `Tests/test_mb_engine_misc.c`**

```c
#include "unity.h"
#include "mb_engine.h"
#include "mb_regmodel.h"
#include "modbus_crc.h"
#include <string.h>

void setUp(void) { mb_reg_reset(); mb_engine_init(); }
void tearDown(void) {}

static void put_crc(uint8_t *b, uint16_t n) { uint16_t c = modbus_crc16(b, n); b[n]=(uint8_t)c; b[n+1]=(uint8_t)(c>>8); }
static void assert_crc_ok(const uint8_t *f, uint16_t len) {
    uint16_t c = modbus_crc16(f, (uint16_t)(len-2));
    TEST_ASSERT_EQUAL_UINT8((uint8_t)c, f[len-2]);
    TEST_ASSERT_EQUAL_UINT8((uint8_t)(c>>8), f[len-1]);
}

static void test_read_exception_status(void) {
    uint8_t req[8] = { MB_SLAVE_ADDR, MB_FC_READ_EXCEPTION }; put_crc(req, 2);
    uint8_t resp[MB_MAX_FRAME]; uint16_t rl = 0;
    mb_engine_process(req, 4, resp, &rl);
    TEST_ASSERT_EQUAL_UINT16(5, rl);
    TEST_ASSERT_EQUAL_UINT8(MB_FC_READ_EXCEPTION, resp[1]);
    TEST_ASSERT_EQUAL_UINT8(0x00, resp[2]);
    assert_crc_ok(resp, rl);
}

static void test_report_slave_id(void) {
    uint8_t req[8] = { MB_SLAVE_ADDR, MB_FC_REPORT_SLAVE_ID }; put_crc(req, 2);
    uint8_t resp[MB_MAX_FRAME]; uint16_t rl = 0;
    mb_engine_process(req, 4, resp, &rl);
    TEST_ASSERT_EQUAL_UINT8(MB_FC_REPORT_SLAVE_ID, resp[1]);
    uint8_t bc = resp[2];
    TEST_ASSERT_EQUAL_UINT8((uint8_t)strlen("EF-G0B1R"), bc);
    TEST_ASSERT_EQUAL_MEMORY("EF-G0B1R", &resp[3], bc);
    TEST_ASSERT_EQUAL_UINT16(3 + bc + 2, rl);
    assert_crc_ok(resp, rl);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_read_exception_status);
    RUN_TEST(test_report_slave_id);
    return UNITY_END();
}
```

- [ ] **Step 2: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_mb_engine_misc test_mb_engine_misc.c ../App/services/mb_engine.c ../App/services/mb_regmodel.c ../App/services/modbus_frame.c ../App/services/modbus_crc.c)
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_mb_engine_misc --output-on-failure`
Expected: FAIL — both FCs currently return `ILLEGAL_FUNCTION`.

- [ ] **Step 4: Add the handlers to `mb_engine.c`** (add `#include <string.h>` at top; insert handlers above `dispatch_fc`; add the cases)

```c
static const char MB_SLAVE_ID[] = "EF-G0B1R";

static uint16_t handle_read_exception(uint8_t *resp) {
    resp[MB_F_ADDR] = MB_SLAVE_ADDR;
    resp[MB_F_FUNCTION] = MB_FC_READ_EXCEPTION;
    resp[2] = 0x00u;
    return finalize(resp, 3u);
}

static uint16_t handle_report_slave_id(uint8_t *resp) {
    uint8_t n = (uint8_t)strlen(MB_SLAVE_ID);
    resp[MB_F_ADDR] = MB_SLAVE_ADDR;
    resp[MB_F_FUNCTION] = MB_FC_REPORT_SLAVE_ID;
    resp[2] = n;                                   /* byte count */
    for (uint8_t i = 0; i < n; i++) resp[3u + i] = (uint8_t)MB_SLAVE_ID[i];
    return finalize(resp, (uint16_t)(3u + n));
}
```

Add to `dispatch_fc`'s switch:

```c
        case MB_FC_READ_EXCEPTION:   return handle_read_exception(resp);
        case MB_FC_REPORT_SLAVE_ID:  return handle_report_slave_id(resp);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_mb_engine_misc --output-on-failure`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add firmware/g0b1-apu/App/services/mb_engine.c firmware/g0b1-apu/Tests/test_mb_engine_misc.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): modbus engine — FC 0x07 exception status + 0x11 report slave id"
```

---

### Task 5: FC 0x08 diagnostics — counters + sub-functions + enter-test-mode

**Files:**
- Modify: `firmware/g0b1-apu/App/services/mb_engine.c` (add diagnostics handler + counter increment helper)
- Create: `firmware/g0b1-apu/Tests/test_mb_engine_diag.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `s_counter`/`s_test_mode` (Task 2), `mb_engine_counter`/`mb_engine_test_mode`.
- Produces (behavior): FC 0x08 with sub-function in bytes `[2][3]`, data in `[4][5]`.
  - `0x00` return-query-data / `0x01` restart-comm → **loopback**: echo the request payload (sub + data) → `[addr][0x08][subhi][sublo][datahi][datalo]` + CRC.
  - `0x0A` clear-counters → zero all counters, echo `[addr][0x08][0x00][0x0A][datahi][datalo]` + CRC.
  - `0x0B..0x12` → respond `[addr][0x08][subhi][sublo][counterhi][counterlo]` + CRC (counter = `mb_engine_counter(sub − 0x0B)`).
  - `0x14` clear-overrun-flag → echo (no-op ack).
  - `0xAA` enter-test-mode → set test-mode flag, echo.
  - other sub-function → echo (PIC default is a benign echo/no-op; preserve).
- Adds a `bump(idx)` helper (used by Task 6's frame-flow counters).

- [ ] **Step 1: Write the failing test `Tests/test_mb_engine_diag.c`**

```c
#include "unity.h"
#include "mb_engine.h"
#include "mb_regmodel.h"
#include "modbus_crc.h"

void setUp(void) { mb_reg_reset(); mb_engine_init(); }
void tearDown(void) {}

/* Build [addr][0x08][subhi][sublo][datahi][datalo] + CRC. */
static uint16_t build_diag(uint8_t *b, uint16_t sub, uint16_t data) {
    b[0] = MB_SLAVE_ADDR; b[1] = MB_FC_DIAGNOSTICS;
    b[2] = (uint8_t)(sub >> 8); b[3] = (uint8_t)sub;
    b[4] = (uint8_t)(data >> 8); b[5] = (uint8_t)data;
    uint16_t c = modbus_crc16(b, 6); b[6] = (uint8_t)c; b[7] = (uint8_t)(c >> 8);
    return 8;
}
static void assert_crc_ok(const uint8_t *f, uint16_t len) {
    uint16_t c = modbus_crc16(f, (uint16_t)(len - 2));
    TEST_ASSERT_EQUAL_UINT8((uint8_t)c, f[len-2]);
    TEST_ASSERT_EQUAL_UINT8((uint8_t)(c >> 8), f[len-1]);
}

static void test_return_query_data_loopback(void) {
    uint8_t req[8], resp[MB_MAX_FRAME]; uint16_t rl = 0;
    uint16_t n = build_diag(req, MB_DIAG_RETURN_QUERY, 0xBEEF);
    mb_engine_process(req, n, resp, &rl);
    TEST_ASSERT_EQUAL_UINT16(8, rl);
    for (int i = 0; i < 6; i++) TEST_ASSERT_EQUAL_UINT8(req[i], resp[i]); /* echo */
    assert_crc_ok(resp, rl);
}

static void test_enter_test_mode_sets_flag(void) {
    TEST_ASSERT_FALSE(mb_engine_test_mode());
    uint8_t req[8], resp[MB_MAX_FRAME]; uint16_t rl = 0;
    uint16_t n = build_diag(req, MB_DIAG_ENTER_TEST, 0);
    mb_engine_process(req, n, resp, &rl);
    TEST_ASSERT_TRUE(mb_engine_test_mode());
    for (int i = 0; i < 6; i++) TEST_ASSERT_EQUAL_UINT8(req[i], resp[i]);
}

static void test_return_counter_subfunction(void) {
    /* Drive one valid frame so the bus-message counter (idx 0) increments. */
    uint8_t rd[8] = { MB_SLAVE_ADDR, MB_FC_READ_EXCEPTION }; uint16_t c = modbus_crc16(rd, 2);
    rd[2] = (uint8_t)c; rd[3] = (uint8_t)(c >> 8);
    uint8_t resp[MB_MAX_FRAME]; uint16_t rl = 0;
    mb_engine_process(rd, 4, resp, &rl);

    /* The diagnostics read itself also counts as a bus message, so its reported
       value must equal the LIVE counter after the call (not a pre-captured one). */
    uint8_t req[8]; uint16_t n = build_diag(req, MB_DIAG_FIRST_COUNTER, 0); /* 0x0B -> counter[0] */
    mb_engine_process(req, n, resp, &rl);
    uint16_t got = (uint16_t)(resp[4] << 8) | resp[5];
    TEST_ASSERT_GREATER_THAN_UINT16(0, got);
    TEST_ASSERT_EQUAL_UINT16(mb_engine_counter(0), got);
    assert_crc_ok(resp, rl);
}

static void test_clear_counters(void) {
    uint8_t rd[8] = { MB_SLAVE_ADDR, MB_FC_READ_EXCEPTION }; uint16_t c = modbus_crc16(rd, 2);
    rd[2] = (uint8_t)c; rd[3] = (uint8_t)(c >> 8);
    uint8_t resp[MB_MAX_FRAME]; uint16_t rl = 0;
    mb_engine_process(rd, 4, resp, &rl);
    TEST_ASSERT_GREATER_THAN_UINT16(0, mb_engine_counter(0));
    uint8_t req[8]; uint16_t n = build_diag(req, MB_DIAG_CLEAR_COUNTERS, 0);
    mb_engine_process(req, n, resp, &rl);
    TEST_ASSERT_EQUAL_UINT16(0, mb_engine_counter(0));
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_return_query_data_loopback);
    RUN_TEST(test_enter_test_mode_sets_flag);
    RUN_TEST(test_return_counter_subfunction);
    RUN_TEST(test_clear_counters);
    return UNITY_END();
}
```

*Note: `test_return_counter_subfunction`/`test_clear_counters` depend on the frame-flow counter increment. If Task 6 has not yet wired counters, add a minimal `bump(0)` on a successful dispatch in this task (Step 4) so the counter is non-zero; Task 6 formalizes the full counter set.*

- [ ] **Step 2: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_mb_engine_diag test_mb_engine_diag.c ../App/services/mb_engine.c ../App/services/mb_regmodel.c ../App/services/modbus_frame.c ../App/services/modbus_crc.c)
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_mb_engine_diag --output-on-failure`
Expected: FAIL — diagnostics returns `ILLEGAL_FUNCTION`.

- [ ] **Step 4: Add the diagnostics handler + counter bump to `mb_engine.c`** (insert `bump`, `handle_diagnostics` above `dispatch_fc`; add the case; and increment `bump(0)` for each processed non-broadcast request in `mb_engine_process` just before `dispatch_fc` — Task 6 extends this)

```c
static void bump(uint8_t idx) { if (idx < MB_COUNTER_COUNT && s_counter[idx] != 0xFFFFu) s_counter[idx]++; }

static uint16_t diag_echo(const uint8_t *req, uint8_t *resp) {
    for (uint16_t i = 0; i < MB_HEADER_SIZE; i++) resp[i] = req[i];
    return finalize(resp, MB_HEADER_SIZE);
}

static uint16_t handle_diagnostics(const uint8_t *req, uint8_t *resp) {
    uint16_t sub = (uint16_t)(req[MB_F_START_HI] << 8) | req[MB_F_START_LO];
    if (sub == MB_DIAG_CLEAR_COUNTERS) {
        for (uint8_t i = 0; i < MB_COUNTER_COUNT; i++) s_counter[i] = 0;
        return diag_echo(req, resp);
    }
    if (sub >= MB_DIAG_FIRST_COUNTER && sub <= MB_DIAG_LAST_COUNTER) {
        uint16_t v = s_counter[sub - MB_DIAG_FIRST_COUNTER];
        resp[MB_F_ADDR] = MB_SLAVE_ADDR; resp[MB_F_FUNCTION] = MB_FC_DIAGNOSTICS;
        resp[MB_F_START_HI] = req[MB_F_START_HI]; resp[MB_F_START_LO] = req[MB_F_START_LO];
        resp[MB_F_QTY_HI] = (uint8_t)(v >> 8); resp[MB_F_QTY_LO] = (uint8_t)v;
        return finalize(resp, MB_HEADER_SIZE);
    }
    if (sub == MB_DIAG_ENTER_TEST) s_test_mode = true;
    return diag_echo(req, resp);   /* query-data / restart / clr-overrun / enter-test / other */
}
```

Add to `dispatch_fc`'s switch:

```c
        case MB_FC_DIAGNOSTICS:      return handle_diagnostics(req, resp);
```

In `mb_engine_process`, immediately before `*resp_len = dispatch_fc(...)`, add `bump(0);` (bus-message counter). *(Task 6 replaces this with the full counter policy.)*

- [ ] **Step 5: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_mb_engine_diag --output-on-failure`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add firmware/g0b1-apu/App/services/mb_engine.c firmware/g0b1-apu/Tests/test_mb_engine_diag.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): modbus engine — FC 0x08 diagnostics (counters, clear, enter-test)"
```

---

### Task 6: Frame-flow counters + broadcast handling + engine integration

**Files:**
- Modify: `firmware/g0b1-apu/App/services/mb_engine.c` (formalize counter policy in `mb_engine_process`)
- Create: `firmware/g0b1-apu/Tests/test_mb_engine_flow.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Produces (behavior): counter indices, incremented per processed frame:
  - idx 0 (`RTRN_BUS_MESSAGE_CNT`): every frame that passes CRC and is addressed to us **or broadcast**.
  - idx 1 (`RTRN_BUS_COMM_ERR_CNT`): every frame that fails CRC (`MB_FRAME_BAD_CRC`).
  - idx 2 (`RTRN_BUS_EXCEPTN_CNT`): every response that is an exception frame.
  - idx 3 (`RTRN_SLAVE_MSG_CNT`): every frame addressed specifically to us (not broadcast) that we process.
  - Broadcast (addr 0) frames are dispatched (writes take effect) but produce **no response** (`*resp_len = 0`).
- The counter semantics preserve the PIC's `mb_counter[]` intent; the exact PIC increments live in the ISR path, so this milestone defines a clear, testable host-side policy (documented here) rather than a byte-identical ISR port.

- [ ] **Step 1: Write the failing test `Tests/test_mb_engine_flow.c`**

```c
#include "unity.h"
#include "mb_engine.h"
#include "mb_regmodel.h"
#include "modbus_crc.h"

static uint16_t s_regs[MB_REG_MAX + 1];
static modbus_exc_t rd_sh(uint16_t r, uint16_t *o) { *o = s_regs[r]; return MB_EXC_NONE; }
static modbus_exc_t wr_sh(uint16_t r, uint16_t v) { s_regs[r] = v; return MB_EXC_NONE; }

void setUp(void) {
    mb_reg_reset(); mb_engine_init();
    for (uint16_t r = 1; r <= MB_REG_MAX; r++) { s_regs[r] = 0; mb_reg_bind(r, rd_sh, wr_sh); }
}
void tearDown(void) {}

static void put_crc(uint8_t *b, uint16_t n) { uint16_t c = modbus_crc16(b, n); b[n]=(uint8_t)c; b[n+1]=(uint8_t)(c>>8); }

static void test_bus_and_slave_counters_on_valid_frame(void) {
    uint8_t req[8] = { MB_SLAVE_ADDR, MB_FC_READ_EXCEPTION }; put_crc(req, 2);
    uint8_t resp[MB_MAX_FRAME]; uint16_t rl = 0;
    mb_engine_process(req, 4, resp, &rl);
    TEST_ASSERT_EQUAL_UINT16(1, mb_engine_counter(0)); /* bus message */
    TEST_ASSERT_EQUAL_UINT16(1, mb_engine_counter(3)); /* slave message */
}

static void test_comm_err_counter_on_bad_crc(void) {
    uint8_t req[8] = { MB_SLAVE_ADDR, MB_FC_READ_EXCEPTION }; put_crc(req, 2);
    req[3] ^= 0xFF;                                    /* corrupt CRC */
    uint8_t resp[MB_MAX_FRAME]; uint16_t rl = 0;
    mb_engine_process(req, 4, resp, &rl);
    TEST_ASSERT_EQUAL_UINT16(0, rl);
    TEST_ASSERT_EQUAL_UINT16(1, mb_engine_counter(1)); /* comm error */
    TEST_ASSERT_EQUAL_UINT16(0, mb_engine_counter(0));
}

static void test_exception_counter(void) {
    mb_reg_reset();                                   /* reg 1 now unbound */
    uint8_t req[8] = { MB_SLAVE_ADDR, MB_FC_READ_HOLDING, 0, 0, 0, 1 }; put_crc(req, 6);
    uint8_t resp[MB_MAX_FRAME]; uint16_t rl = 0;
    mb_engine_process(req, 8, resp, &rl);
    TEST_ASSERT_EQUAL_UINT8(MB_FC_READ_HOLDING | MB_ERROR_RESPONSE, resp[1]);
    TEST_ASSERT_EQUAL_UINT16(1, mb_engine_counter(2)); /* exception */
}

static void test_broadcast_write_no_response_but_applies(void) {
    uint8_t req[16] = { MB_BROADCAST_ADDR, MB_FC_WRITE_SINGLE, 0x00, 0x0C, 0x03, 0xE8 };
    put_crc(req, 6);
    uint8_t resp[MB_MAX_FRAME]; uint16_t rl = 99;
    mb_engine_process(req, 8, resp, &rl);
    TEST_ASSERT_EQUAL_UINT16(0, rl);                  /* no response to broadcast */
    TEST_ASSERT_EQUAL_UINT16(1000, s_regs[13]);       /* write applied */
    TEST_ASSERT_EQUAL_UINT16(1, mb_engine_counter(0));/* bus message counted */
    TEST_ASSERT_EQUAL_UINT16(0, mb_engine_counter(3));/* not a slave-addressed message */
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_bus_and_slave_counters_on_valid_frame);
    RUN_TEST(test_comm_err_counter_on_bad_crc);
    RUN_TEST(test_exception_counter);
    RUN_TEST(test_broadcast_write_no_response_but_applies);
    return UNITY_END();
}
```

- [ ] **Step 2: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_mb_engine_flow test_mb_engine_flow.c ../App/services/mb_engine.c ../App/services/mb_regmodel.c ../App/services/modbus_frame.c ../App/services/modbus_crc.c)
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_mb_engine_flow --output-on-failure`
Expected: FAIL — broadcast handling / counter policy not yet formalized.

- [ ] **Step 4: Rewrite `mb_engine_process` in `mb_engine.c`** (replace the Task-2 body, including the interim `bump(0)` from Task 5, with the full policy; the frame must be CRC-validated for broadcast too, so validate the raw address before delegating to `mb_check_frame` which rejects non-matching addresses)

```c
void mb_engine_process(const uint8_t *req, uint16_t req_len, uint8_t *resp, uint16_t *resp_len) {
    *resp_len = 0;
    if (req_len < 4u) return;                          /* too short to hold addr+fc+crc */

    uint8_t addr = req[MB_F_ADDR];
    bool for_us = (addr == MB_SLAVE_ADDR);
    bool broadcast = (addr == MB_BROADCAST_ADDR);
    if (!for_us && !broadcast) return;                 /* not our address: silent */

    /* Validate CRC over the whole frame (last 2 bytes are the CRC, little-endian). */
    uint16_t crc = modbus_crc16(req, (uint16_t)(req_len - 2u));
    if ((uint8_t)crc != req[req_len - 2u] || (uint8_t)(crc >> 8) != req[req_len - 1u]) {
        bump(1);                                        /* comm error */
        return;
    }

    bump(0);                                            /* bus message */
    if (for_us) bump(3);                                /* slave message */

    uint16_t len = dispatch_fc(req, req_len, resp);
    if ((resp[MB_F_FUNCTION] & MB_ERROR_RESPONSE) != 0u) bump(2); /* exception */

    if (broadcast) { *resp_len = 0; return; }           /* no reply to broadcast */
    *resp_len = len;
}
```

*Because this path validates CRC directly via `modbus_crc16`, the engine no longer depends on `mb_check_frame` for dispatch. Keep the `#include "modbus_frame.h"` only if still referenced; otherwise remove it and drop `modbus_frame.c` from this and the other engine test targets' source lists. Verify with a clean build and update the CMake lines accordingly in this step.*

- [ ] **Step 5: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_mb_engine_flow --output-on-failure`
Expected: PASS (4 tests).

- [ ] **Step 6: Run all engine tests to confirm no regression from the `mb_engine_process` rewrite**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R "test_mb_engine" --output-on-failure`
Expected: PASS (read, write, misc, diag, flow). If removing `modbus_frame.c` from the link lines, ensure all four prior engine tests still build.

- [ ] **Step 7: Commit**

```bash
git add firmware/g0b1-apu/App/services/mb_engine.c firmware/g0b1-apu/Tests/test_mb_engine_flow.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): modbus engine — frame-flow counters + broadcast handling"
```

---

### Task 7: Sensors provider (regs 1, 3, 6, 38, 51)

**Files:**
- Create: `firmware/g0b1-apu/App/services/mbp_sensors.h`
- Create: `firmware/g0b1-apu/App/services/mbp_sensors.c`
- Create: `firmware/g0b1-apu/Tests/test_mbp_sensors.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: M3 `sensors.h` (`sensors_get_encl_temp_f`, `sensors_get_ext_adc`, `sensors_get_batt_cv`, `sensors_get_ext_temp_f`, `sensors_add_sample`, `sensors_init`), M3 `rpm.h` (`rpm_read`, `rpm_source_t`), `mb_regmodel.h`.
- Produces: `void mbp_sensors_register(const rpm_source_t *rpm_src);` — binds regs 1 (enclosure °F), 3 (ext raw ADC), 6 (battery cV), 38 (RPM via `rpm_read(rpm_src)`), 51 (ext °F). All read-only (write_fn NULL). Temperatures are signed °F cast to `uint16_t` on the wire (two's-complement, matching the PIC's `(uint16_t)` cast of `INT16`).

- [ ] **Step 1: Write `App/services/mbp_sensors.h`**

```c
#ifndef MBP_SENSORS_H
#define MBP_SENSORS_H
#include "rpm.h"
/* Register the sensor read-only providers (Modbus regs 1,3,6,38,51).
   rpm_src supplies reg 38; pass the configured RPM source (may be NULL -> reg 38 reads 0). */
void mbp_sensors_register(const rpm_source_t *rpm_src);
#endif /* MBP_SENSORS_H */
```

- [ ] **Step 2: Write the failing test `Tests/test_mbp_sensors.c`**

```c
#include "unity.h"
#include "mbp_sensors.h"
#include "mb_regmodel.h"
#include "sensors.h"
#include "sensors_cal.h"
#include "rpm.h"

static uint16_t s_rpm;
static uint16_t fake_rpm(void *ctx) { (void)ctx; return s_rpm; }
static rpm_source_t src = { fake_rpm, 0 };

void setUp(void) {
    mb_reg_reset();
    sensors_init(VREF_CAL_DEFAULT, 0);
    mbp_sensors_register(&src);
}
void tearDown(void) {}

static void test_battery_reg6(void) {
    for (int i = 0; i < SENS_AVG_DEFAULT; i++) sensors_add_sample(SENS_BATT, 2374); /* 12.00 V */
    uint16_t o = 0;
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_read(6, &o));
    TEST_ASSERT_EQUAL_UINT16(1200, o);
}

static void test_ext_adc_reg3_and_temp_reg51(void) {
    for (int i = 0; i < SENS_AVG_DEFAULT; i++) sensors_add_sample(SENS_EXT, 1971);
    uint16_t adc = 0, f = 0;
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_read(3, &adc));
    TEST_ASSERT_EQUAL_UINT16(1971, adc);
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_read(51, &f));
    TEST_ASSERT_EQUAL_UINT16(32, f);
}

static void test_rpm_reg38(void) {
    s_rpm = 2400;
    uint16_t o = 0;
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_read(38, &o));
    TEST_ASSERT_EQUAL_UINT16(2400, o);
}

static void test_sensors_are_read_only(void) {
    TEST_ASSERT_EQUAL_INT(MB_EXC_ILLEGAL_ADDRESS, mb_reg_write(6, 1234)); /* no write_fn */
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_battery_reg6);
    RUN_TEST(test_ext_adc_reg3_and_temp_reg51);
    RUN_TEST(test_rpm_reg38);
    RUN_TEST(test_sensors_are_read_only);
    return UNITY_END();
}
```

- [ ] **Step 3: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_mbp_sensors test_mbp_sensors.c ../App/services/mbp_sensors.c ../App/services/mb_regmodel.c ../App/services/sensors.c ../App/services/rpm.c)
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_mbp_sensors --output-on-failure`
Expected: build fails — `mbp_sensors_register` undefined.

- [ ] **Step 5: Write `App/services/mbp_sensors.c`**

```c
#include "mbp_sensors.h"
#include "mb_regmodel.h"
#include "sensors.h"

static const rpm_source_t *s_rpm_src;

static modbus_exc_t rd_encl(uint16_t reg, uint16_t *o) { (void)reg; *o = (uint16_t)sensors_get_encl_temp_f(); return MB_EXC_NONE; }
static modbus_exc_t rd_extadc(uint16_t reg, uint16_t *o) { (void)reg; *o = sensors_get_ext_adc(); return MB_EXC_NONE; }
static modbus_exc_t rd_batt(uint16_t reg, uint16_t *o) { (void)reg; *o = sensors_get_batt_cv(); return MB_EXC_NONE; }
static modbus_exc_t rd_rpm(uint16_t reg, uint16_t *o) { (void)reg; *o = rpm_read(s_rpm_src); return MB_EXC_NONE; }
static modbus_exc_t rd_extf(uint16_t reg, uint16_t *o) { (void)reg; *o = (uint16_t)sensors_get_ext_temp_f(); return MB_EXC_NONE; }

void mbp_sensors_register(const rpm_source_t *rpm_src) {
    s_rpm_src = rpm_src;
    mb_reg_bind(1,  rd_encl,   0);
    mb_reg_bind(3,  rd_extadc, 0);
    mb_reg_bind(6,  rd_batt,   0);
    mb_reg_bind(38, rd_rpm,    0);
    mb_reg_bind(51, rd_extf,   0);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_mbp_sensors --output-on-failure`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add firmware/g0b1-apu/App/services/mbp_sensors.h firmware/g0b1-apu/App/services/mbp_sensors.c firmware/g0b1-apu/Tests/test_mbp_sensors.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): modbus — sensors provider (regs 1,3,6,38,51 read-only)"
```

---

### Task 8: RTC provider (calendar 24–31, RTCC 42–48, SRAM 52)

**Files:**
- Create: `firmware/g0b1-apu/App/services/mbp_rtc.h`
- Create: `firmware/g0b1-apu/App/services/mbp_rtc.c`
- Create: `firmware/g0b1-apu/Tests/test_mbp_rtc.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: M4a `rtc.h` (`rtc_get_time`, `rtcc_set_year/month/day/weekday/hour/minute/second`, `rtcc_commit`, `rtc_reg52_read`, `rtc_time_t`), M4a `rtc_calendar.h` (`rtc_cal_get/set_*`), `mb_regmodel.h`.
- Produces: `void mbp_rtc_register(void);` — binds:
  - 24 state, 25 mode, 26 year, 27 month, 28 date, 29 hour, 30 min, 31 ampm → `rtc_cal_get/set_*` (read-write, raw byte).
  - 42 year, 43 month, 44 day, 45 weekday, 46 hour, 47 minute, 48 second → RTCC. **Write path honors M4a's stage-seeding seam:** seed the stage from the live clock (`rtc_get_time`), apply the single field via the matching `rtcc_set_*`, then `rtcc_commit()`; read via a fresh `rtc_get_time`. Returns `MB_EXC_NONE` (I²C errors are not surfaced through the `uint16_t` accessor — carry-forward from M4a).
  - 52 → `rtc_reg52_read` (read-only SRAM byte).

- [ ] **Step 1: Write `App/services/mbp_rtc.h`**

```c
#ifndef MBP_RTC_H
#define MBP_RTC_H
/* Register the RTC/calendar providers (Modbus regs 24-31 calendar, 42-48 RTCC, 52 SRAM).
   rtc_init(...) must have been called first so the RTCC read/write path has a backend. */
void mbp_rtc_register(void);
#endif /* MBP_RTC_H */
```

- [ ] **Step 2: Write the failing test `Tests/test_mbp_rtc.c`**

```c
#include "unity.h"
#include "mbp_rtc.h"
#include "mb_regmodel.h"
#include "rtc.h"
#include "rtc_calendar.h"
#include "nvm.h"
#include "fake_i2c.h"
#include "fake_nor.h"

static i2c_backend_t i2c;
static nvm_backend_t nor;

void setUp(void) {
    mb_reg_reset();
    fake_i2c_init(&i2c); rtc_init(&i2c);
    fake_nor_init(&nor); nvm_init(&nor);     /* calendar accessors need NVM */
    mbp_rtc_register();
}
void tearDown(void) {}

static void test_calendar_reg_roundtrip(void) {
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(24, 1));      /* state */
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(27, 6));      /* month */
    uint16_t o = 0;
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_read(24, &o)); TEST_ASSERT_EQUAL_UINT16(1, o);
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_read(27, &o)); TEST_ASSERT_EQUAL_UINT16(6, o);
}

static void test_rtcc_write_seeds_and_commits(void) {
    /* Establish a baseline clock. */
    mb_reg_write(42, 25); mb_reg_write(43, 6); mb_reg_write(44, 15);
    mb_reg_write(45, 1);  mb_reg_write(46, 13); mb_reg_write(47, 30); mb_reg_write(48, 45);
    uint16_t o = 0;
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_read(42, &o)); TEST_ASSERT_EQUAL_UINT16(25, o);
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_read(46, &o)); TEST_ASSERT_EQUAL_UINT16(13, o);
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_read(48, &o)); TEST_ASSERT_EQUAL_UINT16(45, o);
}

static void test_rtcc_single_field_write_preserves_siblings(void) {
    /* Baseline, then change only the hour (reg 46); siblings must survive (stage seeded from live). */
    mb_reg_write(42, 25); mb_reg_write(43, 6); mb_reg_write(44, 15);
    mb_reg_write(45, 1);  mb_reg_write(46, 13); mb_reg_write(47, 30); mb_reg_write(48, 45);
    mb_reg_write(46, 9);                          /* change hour only */
    uint16_t o = 0;
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_read(46, &o)); TEST_ASSERT_EQUAL_UINT16(9, o);  /* changed */
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_read(43, &o)); TEST_ASSERT_EQUAL_UINT16(6, o);  /* sibling intact */
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_read(48, &o)); TEST_ASSERT_EQUAL_UINT16(45, o); /* sibling intact */
}

static void test_reg52_read_only(void) {
    uint8_t v = 0x5A; rtc_sram_write(0, &v, 1);
    uint16_t o = 0;
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_read(52, &o)); TEST_ASSERT_EQUAL_UINT16(0x5A, o);
    TEST_ASSERT_EQUAL_INT(MB_EXC_ILLEGAL_ADDRESS, mb_reg_write(52, 1));
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_calendar_reg_roundtrip);
    RUN_TEST(test_rtcc_write_seeds_and_commits);
    RUN_TEST(test_rtcc_single_field_write_preserves_siblings);
    RUN_TEST(test_reg52_read_only);
    return UNITY_END();
}
```

- [ ] **Step 3: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_mbp_rtc test_mbp_rtc.c ../App/services/mbp_rtc.c ../App/services/mb_regmodel.c ../App/services/rtc.c ../App/services/rtc_calendar.c ../App/services/nvm.c ../App/services/nvm_record.c ../App/services/nvm_defaults.c ../App/services/modbus_crc.c fakes/fake_i2c.c fakes/fake_nor.c)
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_mbp_rtc --output-on-failure`
Expected: build fails — `mbp_rtc_register` undefined.

- [ ] **Step 5: Write `App/services/mbp_rtc.c`**

```c
#include "mbp_rtc.h"
#include "mb_regmodel.h"
#include "rtc.h"
#include "rtc_calendar.h"

/* ---- calendar (regs 24-31): raw byte pass-through to NVM ---- */
static modbus_exc_t rd_cal(uint16_t reg, uint16_t *o) {
    switch (reg) {
        case 24: *o = rtc_cal_get_state(); break;  case 25: *o = rtc_cal_get_mode(); break;
        case 26: *o = rtc_cal_get_year(); break;   case 27: *o = rtc_cal_get_month(); break;
        case 28: *o = rtc_cal_get_date(); break;   case 29: *o = rtc_cal_get_hour(); break;
        case 30: *o = rtc_cal_get_min(); break;    case 31: *o = rtc_cal_get_ampm(); break;
        default: return MB_EXC_ILLEGAL_ADDRESS;
    }
    return MB_EXC_NONE;
}
static modbus_exc_t wr_cal(uint16_t reg, uint16_t v) {
    uint8_t b = (uint8_t)v;
    switch (reg) {
        case 24: rtc_cal_set_state(b); break;  case 25: rtc_cal_set_mode(b); break;
        case 26: rtc_cal_set_year(b); break;   case 27: rtc_cal_set_month(b); break;
        case 28: rtc_cal_set_date(b); break;   case 29: rtc_cal_set_hour(b); break;
        case 30: rtc_cal_set_min(b); break;    case 31: rtc_cal_set_ampm(b); break;
        default: return MB_EXC_ILLEGAL_ADDRESS;
    }
    return MB_EXC_NONE;
}

/* ---- RTCC (regs 42-48): read live clock; write seeds stage from live then commits ---- */
static modbus_exc_t rd_rtcc(uint16_t reg, uint16_t *o) {
    rtc_time_t t = {0};
    rtc_get_time(&t);
    switch (reg) {
        case 42: *o = t.year; break;   case 43: *o = t.month; break;  case 44: *o = t.date; break;
        case 45: *o = t.weekday; break;case 46: *o = t.hour; break;   case 47: *o = t.min; break;
        case 48: *o = t.sec; break;    default: return MB_EXC_ILLEGAL_ADDRESS;
    }
    return MB_EXC_NONE;
}
static modbus_exc_t wr_rtcc(uint16_t reg, uint16_t v) {
    rtc_time_t t = {0};
    rtc_get_time(&t);                              /* seed stage from live clock (M4a seam) */
    rtcc_set_year(t.year);   rtcc_set_month(t.month);   rtcc_set_day(t.date);
    rtcc_set_weekday(t.weekday); rtcc_set_hour(t.hour); rtcc_set_minute(t.min);
    rtcc_set_second(t.sec);
    switch (reg) {                                 /* override the one field being written */
        case 42: rtcc_set_year(v); break;    case 43: rtcc_set_month(v); break;
        case 44: rtcc_set_day(v); break;     case 45: rtcc_set_weekday(v); break;
        case 46: rtcc_set_hour(v); break;    case 47: rtcc_set_minute(v); break;
        case 48: rtcc_set_second(v); break;  default: return MB_EXC_ILLEGAL_ADDRESS;
    }
    rtcc_commit();
    return MB_EXC_NONE;
}

/* ---- reg 52: battery-backed SRAM offset 0 (read-only) ---- */
static modbus_exc_t rd_reg52(uint16_t reg, uint16_t *o) { (void)reg; *o = rtc_reg52_read(); return MB_EXC_NONE; }

void mbp_rtc_register(void) {
    for (uint16_t r = 24; r <= 31; r++) mb_reg_bind(r, rd_cal, wr_cal);
    for (uint16_t r = 42; r <= 48; r++) mb_reg_bind(r, rd_rtcc, wr_rtcc);
    mb_reg_bind(52, rd_reg52, 0);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_mbp_rtc --output-on-failure`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add firmware/g0b1-apu/App/services/mbp_rtc.h firmware/g0b1-apu/App/services/mbp_rtc.c firmware/g0b1-apu/Tests/test_mbp_rtc.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): modbus — RTC provider (calendar 24-31, RTCC 42-48 seam-safe, SRAM 52)"
```

---

### Task 9: NVM provider (settings/counters/calibration)

**Files:**
- Create: `firmware/g0b1-apu/App/services/mbp_nvm.h`
- Create: `firmware/g0b1-apu/App/services/mbp_nvm.c`
- Create: `firmware/g0b1-apu/Tests/test_mbp_nvm.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: M2 `nvm.h` (`nvm_read_word/byte`, `nvm_write_word/byte`, `nvm_commit`), M2 `nvm_map.h`, `mb_regmodel.h`.
- Produces: `void mbp_nvm_register(void);` — binds (word unless noted): 11→`ENGINE_RUNTIME_START`(word), 20→`ENGINE_OILTIME_START`(word), 21→`MACHINE_RUNTIME_START`(word), 12→`EE_EVAP_FAN_SPEED`(byte, valid 0..2 → else `ILLEGAL_VALUE`), 13→`EE_MONITOR_BATT_SETTING`(word), 14→`EE_CLIMATE_TEMP_SETTING`(word), 15→`EE_STORAGE_TEMP_SETTING`(word), 16→`EE_STORAGE_BATT_SETTING`(word), 19→`EE_TEMP_UNIT`(byte, valid 0..1 → else `ILLEGAL_VALUE`), 36→`EE_VREF_CALIBRATION`(word), 37→`EE_TEMP_CALIBRATION`(word). Each write persists via `nvm_commit()` after the RAM update. *(NVM address constants are the M2 `nvm_map.h` names verbatim — the runtime counters carry the `_START` suffix.)*

- [ ] **Step 1: Write `App/services/mbp_nvm.h`**

```c
#ifndef MBP_NVM_H
#define MBP_NVM_H
/* Register the NVM-backed providers (settings/counters/calibration).
   nvm_init(...) must have been called first. */
void mbp_nvm_register(void);
#endif /* MBP_NVM_H */
```

- [ ] **Step 2: Write the failing test `Tests/test_mbp_nvm.c`**

```c
#include "unity.h"
#include "mbp_nvm.h"
#include "mb_regmodel.h"
#include "nvm.h"
#include "nvm_map.h"
#include "fake_nor.h"

static nvm_backend_t nor;
void setUp(void) { mb_reg_reset(); fake_nor_init(&nor); nvm_init(&nor); mbp_nvm_register(); }
void tearDown(void) {}

static void test_word_setting_roundtrip_and_address(void) {
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(13, 1250));  /* monitor batt */
    uint16_t o = 0;
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_read(13, &o));
    TEST_ASSERT_EQUAL_UINT16(1250, o);
    TEST_ASSERT_EQUAL_UINT16(1250, nvm_read_word(EE_MONITOR_BATT_SETTING));
}

static void test_counter_reg11_word(void) {
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(11, 5000));
    TEST_ASSERT_EQUAL_UINT16(5000, nvm_read_word(ENGINE_RUNTIME_START));
}

static void test_byte_reg_and_range(void) {
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(19, 1));     /* temp unit ok */
    TEST_ASSERT_EQUAL_UINT8(1, nvm_read_byte(EE_TEMP_UNIT));
    TEST_ASSERT_EQUAL_INT(MB_EXC_ILLEGAL_VALUE, mb_reg_write(19, 2));   /* out of range */
    TEST_ASSERT_EQUAL_INT(MB_EXC_ILLEGAL_VALUE, mb_reg_write(12, 3));   /* fan speed > 2 */
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(12, 2));            /* fan speed ok */
}

static void test_calibration_regs(void) {
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(36, 260));
    TEST_ASSERT_EQUAL_UINT16(260, nvm_read_word(EE_VREF_CALIBRATION));
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(37, 3));
    TEST_ASSERT_EQUAL_UINT16(3, nvm_read_word(EE_TEMP_CALIBRATION));
}

static void test_persist_across_reinit(void) {
    mb_reg_write(14, 70);                                        /* climate temp */
    nvm_init(&nor);                                             /* reload from backing store */
    TEST_ASSERT_EQUAL_UINT16(70, nvm_read_word(EE_CLIMATE_TEMP_SETTING));
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_word_setting_roundtrip_and_address);
    RUN_TEST(test_counter_reg11_word);
    RUN_TEST(test_byte_reg_and_range);
    RUN_TEST(test_calibration_regs);
    RUN_TEST(test_persist_across_reinit);
    return UNITY_END();
}
```

- [ ] **Step 3: Register the test in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_mbp_nvm test_mbp_nvm.c ../App/services/mbp_nvm.c ../App/services/mb_regmodel.c ../App/services/nvm.c ../App/services/nvm_record.c ../App/services/nvm_defaults.c ../App/services/modbus_crc.c fakes/fake_nor.c)
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_mbp_nvm --output-on-failure`
Expected: build fails — `mbp_nvm_register` undefined.

- [ ] **Step 5: Write `App/services/mbp_nvm.c`**

```c
#include "mbp_nvm.h"
#include "mb_regmodel.h"
#include "nvm.h"
#include "nvm_map.h"

/* reg -> (address, is_byte, max valid value or 0xFFFF for none). */
typedef struct { uint16_t reg; uint16_t addr; uint8_t is_byte; uint16_t vmax; } nvm_map_row_t;
static const nvm_map_row_t s_rows[] = {
    { 11, ENGINE_RUNTIME_START,    0, 0xFFFF },
    { 20, ENGINE_OILTIME_START,    0, 0xFFFF },
    { 21, MACHINE_RUNTIME_START,   0, 0xFFFF },
    { 12, EE_EVAP_FAN_SPEED,       1, 2 },
    { 13, EE_MONITOR_BATT_SETTING, 0, 0xFFFF },
    { 14, EE_CLIMATE_TEMP_SETTING, 0, 0xFFFF },
    { 15, EE_STORAGE_TEMP_SETTING, 0, 0xFFFF },
    { 16, EE_STORAGE_BATT_SETTING, 0, 0xFFFF },
    { 19, EE_TEMP_UNIT,            1, 1 },
    { 36, EE_VREF_CALIBRATION,     0, 0xFFFF },
    { 37, EE_TEMP_CALIBRATION,     0, 0xFFFF },
};
#define NVM_ROW_COUNT (sizeof s_rows / sizeof s_rows[0])

static const nvm_map_row_t *row_for(uint16_t reg) {
    for (unsigned i = 0; i < NVM_ROW_COUNT; i++) if (s_rows[i].reg == reg) return &s_rows[i];
    return 0;
}

static modbus_exc_t rd_nvm(uint16_t reg, uint16_t *o) {
    const nvm_map_row_t *r = row_for(reg);
    if (!r) return MB_EXC_ILLEGAL_ADDRESS;
    *o = r->is_byte ? nvm_read_byte(r->addr) : nvm_read_word(r->addr);
    return MB_EXC_NONE;
}
static modbus_exc_t wr_nvm(uint16_t reg, uint16_t v) {
    const nvm_map_row_t *r = row_for(reg);
    if (!r) return MB_EXC_ILLEGAL_ADDRESS;
    if (r->vmax != 0xFFFF && v > r->vmax) return MB_EXC_ILLEGAL_VALUE;
    if (r->is_byte) nvm_write_byte(r->addr, (uint8_t)v);
    else            nvm_write_word(r->addr, v);
    nvm_commit();
    return MB_EXC_NONE;
}

void mbp_nvm_register(void) {
    for (unsigned i = 0; i < NVM_ROW_COUNT; i++) mb_reg_bind(s_rows[i].reg, rd_nvm, wr_nvm);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R test_mbp_nvm --output-on-failure`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add firmware/g0b1-apu/App/services/mbp_nvm.h firmware/g0b1-apu/App/services/mbp_nvm.c firmware/g0b1-apu/Tests/test_mbp_nvm.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): modbus — NVM provider (settings/counters/calibration, regs 11-37)"
```

---

### Task 10: Sys provider (FW-rev + reset-request) + end-to-end integration

**Files:**
- Create: `firmware/g0b1-apu/App/services/mbp_sys.h`
- Create: `firmware/g0b1-apu/App/services/mbp_sys.c`
- Create: `firmware/g0b1-apu/Tests/test_mbp_sys.c`
- Create: `firmware/g0b1-apu/Tests/test_mb_integration.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Produces (`mbp_sys.h`): `#define MB_RELAY_FW_VERSION 100u` (reg 39 constant — the new STM32 relay-board firmware rev; bench may bump); `typedef void (*mb_reset_fn)(void);` `void mbp_sys_register(mb_reset_fn on_reset);` — binds 39 (relay fw, read-only const), 40 (display fw, read-write RAM), 34 (reset-request: **write** invokes `on_reset` if non-NULL; read returns 0), 35 (boot flag, read-write RAM). The real `NVIC_SystemReset` + boot-flag stash is supplied by `on_reset` at bench (deferred); host tests pass a fake.
- Consumes (integration test): all four provider `_register` functions + `mb_engine_process`.

- [ ] **Step 1: Write `App/services/mbp_sys.h`**

```c
#ifndef MBP_SYS_H
#define MBP_SYS_H
#include "types.h"
#define MB_RELAY_FW_VERSION 100u   /* reg 39: new STM32 relay-board firmware revision */

typedef void (*mb_reset_fn)(void); /* reg 34 write action; real NVIC_SystemReset deferred to bench */
void mbp_sys_register(mb_reset_fn on_reset);
#endif /* MBP_SYS_H */
```

- [ ] **Step 2: Write the failing tests `Tests/test_mbp_sys.c` and `Tests/test_mb_integration.c`**

`Tests/test_mbp_sys.c`:

```c
#include "unity.h"
#include "mbp_sys.h"
#include "mb_regmodel.h"

static int s_reset_calls;
static void fake_reset(void) { s_reset_calls++; }

void setUp(void) { mb_reg_reset(); s_reset_calls = 0; mbp_sys_register(fake_reset); }
void tearDown(void) {}

static void test_relay_fw_is_read_only_constant(void) {
    uint16_t o = 0;
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_read(39, &o));
    TEST_ASSERT_EQUAL_UINT16(MB_RELAY_FW_VERSION, o);
    TEST_ASSERT_EQUAL_INT(MB_EXC_ILLEGAL_ADDRESS, mb_reg_write(39, 1));
}

static void test_display_fw_rw(void) {
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(40, 250));
    uint16_t o = 0;
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_read(40, &o));
    TEST_ASSERT_EQUAL_UINT16(250, o);
}

static void test_reset_request_invokes_callback(void) {
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(34, 1));
    TEST_ASSERT_EQUAL_INT(1, s_reset_calls);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_relay_fw_is_read_only_constant);
    RUN_TEST(test_display_fw_rw);
    RUN_TEST(test_reset_request_invokes_callback);
    return UNITY_END();
}
```

`Tests/test_mb_integration.c` (end-to-end: real engine + all available providers over their fakes):

```c
#include "unity.h"
#include "mb_engine.h"
#include "mb_regmodel.h"
#include "mbp_sensors.h"
#include "mbp_rtc.h"
#include "mbp_nvm.h"
#include "mbp_sys.h"
#include "sensors.h"
#include "sensors_cal.h"
#include "rtc.h"
#include "nvm.h"
#include "modbus_crc.h"
#include "fake_i2c.h"
#include "fake_nor.h"

static i2c_backend_t i2c;
static nvm_backend_t nor;
static uint16_t s_rpm;
static uint16_t fake_rpm(void *c) { (void)c; return s_rpm; }
static rpm_source_t src = { fake_rpm, 0 };
static void noop_reset(void) {}

void setUp(void) {
    mb_reg_reset(); mb_engine_init();
    sensors_init(VREF_CAL_DEFAULT, 0);
    fake_i2c_init(&i2c); rtc_init(&i2c);
    fake_nor_init(&nor); nvm_init(&nor);
    mbp_sensors_register(&src);
    mbp_rtc_register();
    mbp_nvm_register();
    mbp_sys_register(noop_reset);
}
void tearDown(void) {}

static void put_crc(uint8_t *b, uint16_t n) { uint16_t c = modbus_crc16(b, n); b[n]=(uint8_t)c; b[n+1]=(uint8_t)(c>>8); }

static void test_read_battery_over_the_wire(void) {
    for (int i = 0; i < SENS_AVG_DEFAULT; i++) sensors_add_sample(SENS_BATT, 2374); /* 12.00 V */
    uint8_t req[8] = { MB_SLAVE_ADDR, MB_FC_READ_HOLDING, 0x00, 0x05, 0x00, 0x01 };  /* wire 5 -> reg 6 */
    put_crc(req, 6);
    uint8_t resp[MB_MAX_FRAME]; uint16_t rl = 0;
    mb_engine_process(req, 8, resp, &rl);
    TEST_ASSERT_EQUAL_UINT8(2, resp[2]);
    TEST_ASSERT_EQUAL_UINT16(1200, (uint16_t)(resp[3] << 8) | resp[4]);
}

static void test_write_setting_then_read_back_over_the_wire(void) {
    /* Write reg 14 (climate temp) = 70 via FC 0x06 (wire addr 13), then read it back via FC 0x03. */
    uint8_t w[8] = { MB_SLAVE_ADDR, MB_FC_WRITE_SINGLE, 0x00, 0x0D, 0x00, 0x46 };
    put_crc(w, 6);
    uint8_t resp[MB_MAX_FRAME]; uint16_t rl = 0;
    mb_engine_process(w, 8, resp, &rl);
    TEST_ASSERT_EQUAL_UINT16(8, rl);                  /* echo, not exception */

    uint8_t r[8] = { MB_SLAVE_ADDR, MB_FC_READ_HOLDING, 0x00, 0x0D, 0x00, 0x01 };
    put_crc(r, 6);
    mb_engine_process(r, 8, resp, &rl);
    TEST_ASSERT_EQUAL_UINT16(70, (uint16_t)(resp[3] << 8) | resp[4]);
}

static void test_unbound_control_register_exception_over_wire(void) {
    /* reg 10 (op-mode, M6) is unbound -> exception 0x02. wire addr 9. */
    uint8_t req[8] = { MB_SLAVE_ADDR, MB_FC_READ_HOLDING, 0x00, 0x09, 0x00, 0x01 };
    put_crc(req, 6);
    uint8_t resp[MB_MAX_FRAME]; uint16_t rl = 0;
    mb_engine_process(req, 8, resp, &rl);
    TEST_ASSERT_EQUAL_UINT8(MB_FC_READ_HOLDING | MB_ERROR_RESPONSE, resp[1]);
    TEST_ASSERT_EQUAL_UINT8(MB_EXC_ILLEGAL_ADDRESS, resp[2]);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_read_battery_over_the_wire);
    RUN_TEST(test_write_setting_then_read_back_over_the_wire);
    RUN_TEST(test_unbound_control_register_exception_over_wire);
    return UNITY_END();
}
```

- [ ] **Step 3: Register both tests in `Tests/CMakeLists.txt`**

```cmake
add_unity_test(test_mbp_sys test_mbp_sys.c ../App/services/mbp_sys.c ../App/services/mb_regmodel.c)
add_unity_test(test_mb_integration test_mb_integration.c \
    ../App/services/mb_engine.c ../App/services/mb_regmodel.c \
    ../App/services/mbp_sensors.c ../App/services/mbp_rtc.c ../App/services/mbp_nvm.c ../App/services/mbp_sys.c \
    ../App/services/sensors.c ../App/services/rpm.c \
    ../App/services/rtc.c ../App/services/rtc_calendar.c \
    ../App/services/nvm.c ../App/services/nvm_record.c ../App/services/nvm_defaults.c ../App/services/modbus_crc.c \
    fakes/fake_i2c.c fakes/fake_nor.c)
```

- [ ] **Step 4: Run both tests to verify they fail**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R "test_mbp_sys|test_mb_integration" --output-on-failure`
Expected: build fails — `mbp_sys_register` undefined.

- [ ] **Step 5: Write `App/services/mbp_sys.c`**

```c
#include "mbp_sys.h"
#include "mb_regmodel.h"

static uint16_t    s_dspl_fw;
static uint16_t    s_boot_flag;
static mb_reset_fn s_on_reset;

static modbus_exc_t rd_relay_fw(uint16_t reg, uint16_t *o) { (void)reg; *o = MB_RELAY_FW_VERSION; return MB_EXC_NONE; }
static modbus_exc_t rd_dspl_fw(uint16_t reg, uint16_t *o) { (void)reg; *o = s_dspl_fw; return MB_EXC_NONE; }
static modbus_exc_t wr_dspl_fw(uint16_t reg, uint16_t v) { (void)reg; s_dspl_fw = v; return MB_EXC_NONE; }
static modbus_exc_t rd_reset(uint16_t reg, uint16_t *o) { (void)reg; *o = 0; return MB_EXC_NONE; }
static modbus_exc_t wr_reset(uint16_t reg, uint16_t v) { (void)reg; (void)v; if (s_on_reset) s_on_reset(); return MB_EXC_NONE; }
static modbus_exc_t rd_boot(uint16_t reg, uint16_t *o) { (void)reg; *o = s_boot_flag; return MB_EXC_NONE; }
static modbus_exc_t wr_boot(uint16_t reg, uint16_t v) { (void)reg; s_boot_flag = v; return MB_EXC_NONE; }

void mbp_sys_register(mb_reset_fn on_reset) {
    s_on_reset = on_reset;
    s_dspl_fw = 0;
    s_boot_flag = 0;
    mb_reg_bind(34, rd_reset,    wr_reset);
    mb_reg_bind(35, rd_boot,     wr_boot);
    mb_reg_bind(39, rd_relay_fw, 0);        /* read-only constant */
    mb_reg_bind(40, rd_dspl_fw,  wr_dspl_fw);
}
```

- [ ] **Step 6: Run both tests to verify they pass**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build -R "test_mbp_sys|test_mb_integration" --output-on-failure`
Expected: PASS (3 + 3 tests).

- [ ] **Step 7: Run the full suite to confirm no regressions**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build --output-on-failure`
Expected: all tests pass (20 prior M1–M4a + 11 new M4b = **31 executables**), zero warnings under `-Werror`.

- [ ] **Step 8: Commit**

```bash
git add firmware/g0b1-apu/App/services/mbp_sys.h firmware/g0b1-apu/App/services/mbp_sys.c firmware/g0b1-apu/Tests/test_mbp_sys.c firmware/g0b1-apu/Tests/test_mb_integration.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): modbus — sys provider (fw-rev + reset) + end-to-end integration"
```

---

## Deferred to hardware bring-up / later milestones

- **`drv_modbus_uart` HAL** — USART1 (PA9/PA10) + hardware DE (PB3) + DMA RX/TX + RTO 3.5-char frame gap; feeds received bytes to `mb_engine_process` and transmits the response. On-target only.
- **Real reset action** — the reg-34 `on_reset` callback wired to `NVIC_SystemReset()` + a boot-flag stash in RTC-SRAM for the future bootloader.
- **M5 `bsp_io` provider** — binds regs 7 (oil-pressure state), 8 (truck-engine state), 9 (RPM port-state), 41 (production-test mode; drives outputs via `bsp_io`/`bsp_pwm`).
- **M6 `control` provider** — binds regs 2, 4, 5 (engine-coolant temp + A/C pressures — the M3-deferred raw-count sensors), 10 (op-mode), 17 (error state), 18 (oil-change state), 22 (engine status), 23 (climate status), 33 (temp-display state), and the override flags 32/49/50 (AC/standby overrides — control-domain RAM state).
- **Optimized RTCC batch commit** — Task 8 commits once per RTCC field write (seed-from-live then commit) to honor M4a's stage-seeding seam; a batched "write 42–48 then one commit" optimization can replace it at UART integration if the per-field I²C cost matters.

## Carry-forward items to confirm

- **Counter-policy fidelity:** the frame-flow counters (Task 6) implement a clear host-testable policy for the 8 diagnostic counters rather than a byte-identical port of the PIC ISR's increments; reconcile against the display's expectations during bench bring-up.
- **Slave-ID string** (`"EF-G0B1R"`) — confirm the display doesn't parse a specific legacy ID; adjust if it does.
- **`MB_RELAY_FW_VERSION`** (reg 39 = 100) — set the real shipping firmware revision at bench.

---

## Self-Review

**Spec coverage (§7.3, §7.4):** register model dispatch (regs 1–52) ✅ (Task 1, provider table); FC 0x03 ✅ (Task 2, extends M1); FC 0x04 ✅ (Task 2, shared dispatch); FC 0x06/0x10 ✅ (Task 3); FC 0x07/0x11 ✅ (Task 4); FC 0x08 full diagnostics + 9-counter set (8 returnable counters 0x0B–0x12) + 0xAA test-mode ✅ (Task 5); CRC-16 0xA001 / addr 1 / broadcast ✅ (reuses M1 `modbus_crc16`, Task 6); production-test (reg 41) ⏸ deferred to M5 (documented); file FCs 0x41/0x42 reserved (documented). Register bindings: sensors ✅ (Task 7), RTC/calendar ✅ (Task 8), NVM settings/counters/calibration ✅ (Task 9), FW-rev + reset ✅ (Task 10). Control/bsp_io registers ⏸ deferred → exception 0x02 (documented, tested in Task 10 integration).

**Placeholder scan:** no TBD/TODO. Two prereq-verification notes are explicit and actionable: (a) Task 2/Task 6 confirm M1 `mb_check_frame` broadcast behavior — resolved definitively in Task 6 by validating CRC directly via `modbus_crc16`, removing the `mb_check_frame` dependency; (b) Task 6 removes `modbus_frame.c` from engine link lines if unused, verified by clean build.

**Type consistency:** `modbus_exc_t`, `mb_reg_read_fn`/`mb_reg_write_fn`, and the `mb_reg_bind`/`mb_reg_read`/`mb_reg_write` signatures (Task 1) are used identically by the engine (Tasks 2–6) and every provider (Tasks 7–10). `mb_engine_process`/`mb_engine_counter`/`mb_engine_test_mode` (Task 2) are stable across Tasks 3–6. Field-offset and FC/exception/diagnostic constants come from the single `modbus_defs.h`. Provider `_register` functions (`mbp_sensors_register(const rpm_source_t*)`, `mbp_rtc_register(void)`, `mbp_nvm_register(void)`, `mbp_sys_register(mb_reset_fn)`) match their call sites in the Task 10 integration test. NVM register→address rows use M2 `nvm_map.h` names verbatim. RTCC accessor names (`rtcc_set_year/month/day/weekday/hour/minute/second`, `rtcc_commit`, `rtc_get_time`) match M4a exactly, and the write path honors M4a's documented stage-seeding seam.
