# STM32G0 APU Port — Milestone 2: NVM (SPI-NOR Emulated EEPROM) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the portable, host-tested non-volatile parameter store — a wear-leveled, power-safe "emulated EEPROM" journal over an abstract NOR backend — that preserves the PIC firmware's byte-addressable EEPROM map and factory defaults.

**Architecture:** A `nvm_backend_t` interface abstracts the NOR flash (erase→0xFF, program can only clear bits, sector-granular erase). On top sits an append-only record journal across a multi-sector ring: each `nvm_commit()` writes a new CRC-checked snapshot record with a monotonic sequence number; boot loads the highest-sequence valid record (torn/interrupted writes are ignored, falling back to the previous good record); a blank device is factory-initialized. Reads/writes go through a RAM shadow of the parameter block. The on-target SPI driver (`drv_s25fl064`) that implements `nvm_backend_t` is **deferred to hardware bring-up** (see "Deferred" section) — everything in this plan is host-testable against an in-memory fake NOR.

**Tech Stack:** C11, CMake + Unity (host), reuses `modbus_crc16` from Milestone 1.

**Design spec:** `docs/superpowers/specs/2026-08-12-pic18-to-stm32g0-apu-port-design.md` §7.1. Prereq: Milestone 1 complete (`firmware/g0b1-apu/` harness + `App/services/modbus_crc`).

## Global Constraints

- **EEPROM address map** (bytes, from the PIC `eeprom.h`) is preserved exactly:
  `EE_VREF_CALIBRATION=0`(w), `EE_TEMP_CALIBRATION=2`(w), `MACHINE_RUNTIME=10`(w), `ENGINE_RUNTIME=12`(w), `ENGINE_OILTIME=14`(w), `EE_CLIMATE_TEMP_SETTING=20`(w), `EE_MONITOR_BATT_SETTING=22`(w), `EE_STORAGE_TEMP_SETTING=24`(w), `EE_STORAGE_BATT_SETTING=26`(w), `EE_EVAP_FAN_SPEED=30`(b), `EE_TEMP_UNIT=31`(b), `EEPROM_WRITTEN_FLAG=40`(sentinel byte `0x55`), `EE_CLND_START_ONOFF=50`, `EE_CLND_START_MODE=51`, `EE_CLND_START_YEAR=52`, `EE_CLND_START_MONTH=53`, `EE_CLND_START_DATE=54`, `EE_CLND_START_HOUR=55`, `EE_CLND_START_MIN=56`, `EE_CLND_START_AMPM=57`, `EE_BOOTLOADER_FLAG=200`.
- **Words are little-endian: low byte at `addr`, high byte at `addr+1`** (matches PIC `eeprom.c`).
- **Factory defaults** (12 V build; applied only when the sentinel is absent): VREF_CAL=250, TEMP_CAL=0, MACHINE/ENGINE/OIL runtime=0, CLIMATE_TEMP=70, MONITOR_BATT=1200, STORAGE_TEMP=30, STORAGE_BATT=1180, EVAP_FAN_SPEED=2 (HIGH), TEMP_UNIT=0 (FAHRENHEIT), CLND_ONOFF=0, CLND_MODE=1 (CLIMATE_CONTROL_MODE), CLND_YEAR=0x13, CLND_MONTH=0x01, CLND_DATE=0x10, CLND_HOUR=0x09, CLND_MIN=0x00, CLND_AMPM=0, BOOTLOADER_FLAG=0, and the sentinel byte at 40 = `0x55`.
- Record format: `magic`(u16 LE `0x4E56`) + `seq`(u32 LE) + `crc`(u16 LE = `modbus_crc16(payload,256)`) + `payload`(256 bytes) = 264-byte record. `NVM_PARAM_SIZE=256`.
- The NVM region must span **≥ 2 sectors** (the ring erases a sector before reusing it; the latest record must always live in a different sector than the one being erased).
- Portable code under `App/services/` — **no HAL**. Reuse `modbus_crc16`; do not reimplement CRC. Firmware root `firmware/g0b1-apu/`. Every task ends green (`ctest`) and committed.

---

### Task 1: NOR backend interface + in-memory fake

**Files:**
- Create: `firmware/g0b1-apu/App/services/nvm_backend.h`
- Create: `firmware/g0b1-apu/Tests/fakes/fake_nor.h`, `firmware/g0b1-apu/Tests/fakes/fake_nor.c`
- Create: `firmware/g0b1-apu/Tests/test_fake_nor.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Produces: `nvm_backend_t` (below); `void fake_nor_init(nvm_backend_t *be)` (wires a fully-erased 4×4096 fake), `void fake_nor_reset(void)` (erase all to 0xFF), `uint8_t *fake_nor_raw(void)` (backing array, for corruption tests), `uint32_t fake_nor_size(void)`.

- [ ] **Step 1: Write `App/services/nvm_backend.h`**

```c
#ifndef NVM_BACKEND_H
#define NVM_BACKEND_H
#include <stdint.h>
/* Abstract NOR flash. Erased state is 0xFF. program() may only clear bits
   (AND semantics) and must be called on erased space. erase() clears a whole
   sector to 0xFF. All ops return 0 on success, non-zero on error. */
typedef struct nvm_backend {
    uint32_t sector_size;
    uint32_t sector_count;
    int  (*read)(void *ctx, uint32_t addr, uint8_t *buf, uint32_t len);
    int  (*program)(void *ctx, uint32_t addr, const uint8_t *buf, uint32_t len);
    int  (*erase)(void *ctx, uint32_t sector_index);
    void *ctx;
} nvm_backend_t;
#endif
```

- [ ] **Step 2: Write the failing test `Tests/test_fake_nor.c`**

```c
#include "unity.h"
#include "fake_nor.h"
static nvm_backend_t be;
void setUp(void) { fake_nor_init(&be); }
void tearDown(void) {}

static void test_starts_erased(void) {
    uint8_t b[4]; TEST_ASSERT_EQUAL_INT(0, be.read(be.ctx, 0, b, 4));
    TEST_ASSERT_EACH_EQUAL_HEX8(0xFF, b, 4);
}
static void test_program_then_read(void) {
    uint8_t w[3] = {0x11,0x22,0x33};
    TEST_ASSERT_EQUAL_INT(0, be.program(be.ctx, 10, w, 3));
    uint8_t r[3]; be.read(be.ctx, 10, r, 3);
    TEST_ASSERT_EQUAL_HEX8_ARRAY(w, r, 3);
}
static void test_program_is_bit_clear_only(void) {           /* AND semantics */
    uint8_t a = 0xF0; be.program(be.ctx, 0, &a, 1);
    uint8_t b = 0x0F; be.program(be.ctx, 0, &b, 1);          /* 0xF0 & 0x0F */
    uint8_t r; be.read(be.ctx, 0, &r, 1);
    TEST_ASSERT_EQUAL_HEX8(0x00, r);
}
static void test_erase_restores_ff(void) {
    uint8_t a = 0x00; be.program(be.ctx, 5000, &a, 1);       /* sector 1 (4096..) */
    TEST_ASSERT_EQUAL_INT(0, be.erase(be.ctx, 1));
    uint8_t r; be.read(be.ctx, 5000, &r, 1);
    TEST_ASSERT_EQUAL_HEX8(0xFF, r);
    uint8_t s0; be.read(be.ctx, 0, &s0, 1);                  /* other sectors untouched: still 0xFF */
    TEST_ASSERT_EQUAL_HEX8(0xFF, s0);
}
static void test_out_of_bounds_errors(void) {
    uint8_t b; TEST_ASSERT_NOT_EQUAL(0, be.read(be.ctx, fake_nor_size(), &b, 1));
    TEST_ASSERT_NOT_EQUAL(0, be.erase(be.ctx, be.sector_count));
}
int main(void){
    UNITY_BEGIN();
    RUN_TEST(test_starts_erased); RUN_TEST(test_program_then_read);
    RUN_TEST(test_program_is_bit_clear_only); RUN_TEST(test_erase_restores_ff);
    RUN_TEST(test_out_of_bounds_errors);
    return UNITY_END();
}
```

- [ ] **Step 3: Register test + fakes include dir, run to verify it fails**

In `Tests/CMakeLists.txt`, add `${CMAKE_CURRENT_SOURCE_DIR}/fakes` to the `APP_INCLUDE` list, then add:
`add_unity_test(test_fake_nor test_fake_nor.c fakes/fake_nor.c)`
Run: `cmake -S firmware/g0b1-apu/Tests -B firmware/g0b1-apu/Tests/build && cmake --build firmware/g0b1-apu/Tests/build`
Expected: FAILS — `fake_nor.h` missing.

- [ ] **Step 4: Write `Tests/fakes/fake_nor.h`**

```c
#ifndef FAKE_NOR_H
#define FAKE_NOR_H
#include "nvm_backend.h"
#define FAKE_NOR_SECTOR_SIZE  4096u
#define FAKE_NOR_SECTOR_COUNT 4u
void fake_nor_init(nvm_backend_t *be);   /* wire be to the fake; start fully erased */
void fake_nor_reset(void);               /* erase all to 0xFF */
uint8_t *fake_nor_raw(void);             /* backing array (for corruption tests) */
uint32_t fake_nor_size(void);            /* total bytes */
#endif
```

- [ ] **Step 5: Write `Tests/fakes/fake_nor.c`**

```c
#include "fake_nor.h"
#include <string.h>

#define NOR_SIZE (FAKE_NOR_SECTOR_SIZE * FAKE_NOR_SECTOR_COUNT)
static uint8_t s_mem[NOR_SIZE];

static int f_read(void *ctx, uint32_t addr, uint8_t *buf, uint32_t len) {
    (void)ctx;
    if ((uint64_t)addr + len > NOR_SIZE) return -1;
    memcpy(buf, &s_mem[addr], len);
    return 0;
}
static int f_program(void *ctx, uint32_t addr, const uint8_t *buf, uint32_t len) {
    (void)ctx;
    if ((uint64_t)addr + len > NOR_SIZE) return -1;
    for (uint32_t i = 0; i < len; i++) s_mem[addr + i] &= buf[i];  /* AND: bits only clear */
    return 0;
}
static int f_erase(void *ctx, uint32_t sector) {
    (void)ctx;
    if (sector >= FAKE_NOR_SECTOR_COUNT) return -1;
    memset(&s_mem[sector * FAKE_NOR_SECTOR_SIZE], 0xFF, FAKE_NOR_SECTOR_SIZE);
    return 0;
}
void fake_nor_reset(void) { memset(s_mem, 0xFF, NOR_SIZE); }
void fake_nor_init(nvm_backend_t *be) {
    fake_nor_reset();
    be->sector_size  = FAKE_NOR_SECTOR_SIZE;
    be->sector_count = FAKE_NOR_SECTOR_COUNT;
    be->read = f_read; be->program = f_program; be->erase = f_erase; be->ctx = 0;
}
uint8_t *fake_nor_raw(void) { return s_mem; }
uint32_t fake_nor_size(void) { return NOR_SIZE; }
```

- [ ] **Step 6: Reconfigure + run to verify it passes**

Run: `cmake -S firmware/g0b1-apu/Tests -B firmware/g0b1-apu/Tests/build && cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_fake_nor --output-on-failure`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add firmware/g0b1-apu/App/services/nvm_backend.h firmware/g0b1-apu/Tests/fakes firmware/g0b1-apu/Tests/test_fake_nor.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): NOR backend interface + in-memory fake for host tests"
```

---

### Task 2: EEPROM map + factory defaults

**Files:**
- Create: `firmware/g0b1-apu/App/services/nvm_map.h`
- Create: `firmware/g0b1-apu/App/services/nvm_defaults.c`, `firmware/g0b1-apu/App/services/nvm_defaults.h`
- Create: `firmware/g0b1-apu/Tests/test_nvm_defaults.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Produces: `nvm_map.h` (the `EE_*` byte-offset constants + `NVM_PARAM_SIZE 256`); `void nvm_apply_factory_defaults(uint8_t *shadow)` — zero-fills `shadow[0..NVM_PARAM_SIZE)` then writes the factory values (little-endian words) at their EE offsets, including the `0x55` sentinel at `EEPROM_WRITTEN_FLAG`.

- [ ] **Step 1: Write `App/services/nvm_map.h`**

```c
#ifndef NVM_MAP_H
#define NVM_MAP_H
/* Byte offsets within the parameter block — preserved from the PIC eeprom.h.
   Words are little-endian: low byte at OFFSET, high byte at OFFSET+1. */
#define NVM_PARAM_SIZE            256u

#define EE_VREF_CALIBRATION       0u   /* word */
#define EE_TEMP_CALIBRATION       2u   /* word */
#define MACHINE_RUNTIME_START     10u  /* word */
#define ENGINE_RUNTIME_START      12u  /* word */
#define ENGINE_OILTIME_START      14u  /* word */
#define EE_CLIMATE_TEMP_SETTING   20u  /* word */
#define EE_MONITOR_BATT_SETTING   22u  /* word */
#define EE_STORAGE_TEMP_SETTING   24u  /* word */
#define EE_STORAGE_BATT_SETTING   26u  /* word */
#define EE_EVAP_FAN_SPEED         30u  /* byte */
#define EE_TEMP_UNIT              31u  /* byte */
#define EEPROM_WRITTEN_FLAG       40u  /* sentinel byte = 0x55 */
#define EE_CLND_START_ONOFF       50u
#define EE_CLND_START_MODE        51u
#define EE_CLND_START_YEAR        52u
#define EE_CLND_START_MONTH       53u
#define EE_CLND_START_DATE        54u
#define EE_CLND_START_HOUR        55u
#define EE_CLND_START_MIN         56u
#define EE_CLND_START_AMPM        57u
#define EE_BOOTLOADER_FLAG        200u

#define EE_SENTINEL_VALUE         0x55u
#endif
```

- [ ] **Step 2: Write the failing test `Tests/test_nvm_defaults.c`**

```c
#include "unity.h"
#include "nvm_map.h"
#include "nvm_defaults.h"
static uint8_t sh[NVM_PARAM_SIZE];
void setUp(void) {} void tearDown(void) {}

static uint16_t w(const uint8_t *s, unsigned a){ return (uint16_t)(s[a] | (s[a+1] << 8)); }

static void test_defaults(void) {
    for (unsigned i=0;i<NVM_PARAM_SIZE;i++) sh[i]=0xAA;   /* poison first */
    nvm_apply_factory_defaults(sh);
    TEST_ASSERT_EQUAL_UINT16(250,  w(sh, EE_VREF_CALIBRATION));
    TEST_ASSERT_EQUAL_UINT16(0,    w(sh, EE_TEMP_CALIBRATION));
    TEST_ASSERT_EQUAL_UINT16(0,    w(sh, MACHINE_RUNTIME_START));
    TEST_ASSERT_EQUAL_UINT16(0,    w(sh, ENGINE_RUNTIME_START));
    TEST_ASSERT_EQUAL_UINT16(0,    w(sh, ENGINE_OILTIME_START));
    TEST_ASSERT_EQUAL_UINT16(70,   w(sh, EE_CLIMATE_TEMP_SETTING));
    TEST_ASSERT_EQUAL_UINT16(1200, w(sh, EE_MONITOR_BATT_SETTING));
    TEST_ASSERT_EQUAL_UINT16(30,   w(sh, EE_STORAGE_TEMP_SETTING));
    TEST_ASSERT_EQUAL_UINT16(1180, w(sh, EE_STORAGE_BATT_SETTING));
    TEST_ASSERT_EQUAL_HEX8(2,      sh[EE_EVAP_FAN_SPEED]);  /* HIGH */
    TEST_ASSERT_EQUAL_HEX8(0,      sh[EE_TEMP_UNIT]);       /* FAHRENHEIT */
    TEST_ASSERT_EQUAL_HEX8(0x55,   sh[EEPROM_WRITTEN_FLAG]);
    TEST_ASSERT_EQUAL_HEX8(0,      sh[EE_CLND_START_ONOFF]);
    TEST_ASSERT_EQUAL_HEX8(1,      sh[EE_CLND_START_MODE]);
    TEST_ASSERT_EQUAL_HEX8(0x13,   sh[EE_CLND_START_YEAR]);
    TEST_ASSERT_EQUAL_HEX8(0x01,   sh[EE_CLND_START_MONTH]);
    TEST_ASSERT_EQUAL_HEX8(0x10,   sh[EE_CLND_START_DATE]);
    TEST_ASSERT_EQUAL_HEX8(0x09,   sh[EE_CLND_START_HOUR]);
    TEST_ASSERT_EQUAL_HEX8(0,      sh[EE_CLND_START_AMPM]);
    TEST_ASSERT_EQUAL_HEX8(0,      sh[EE_BOOTLOADER_FLAG]);
    TEST_ASSERT_EQUAL_HEX8(0,      sh[100]);               /* unused byte zeroed */
}
int main(void){ UNITY_BEGIN(); RUN_TEST(test_defaults); return UNITY_END(); }
```

- [ ] **Step 2b: Register + run to verify it fails**

Add `add_unity_test(test_nvm_defaults test_nvm_defaults.c ../App/services/nvm_defaults.c)` to `Tests/CMakeLists.txt`.
Run the build; expected FAIL — `nvm_defaults.h` missing.

- [ ] **Step 3: Write `App/services/nvm_defaults.h`**

```c
#ifndef NVM_DEFAULTS_H
#define NVM_DEFAULTS_H
#include <stdint.h>
/* Zero-fill shadow[0..NVM_PARAM_SIZE) then write the factory-default
   parameter values (little-endian words) at their EE offsets. */
void nvm_apply_factory_defaults(uint8_t *shadow);
#endif
```

- [ ] **Step 4: Write `App/services/nvm_defaults.c`**

```c
#include "nvm_defaults.h"
#include "nvm_map.h"
#include <string.h>

static void wr16(uint8_t *s, unsigned a, uint16_t v) {
    s[a]     = (uint8_t)(v & 0xFF);
    s[a + 1] = (uint8_t)(v >> 8);
}
void nvm_apply_factory_defaults(uint8_t *shadow) {
    memset(shadow, 0, NVM_PARAM_SIZE);
    wr16(shadow, EE_VREF_CALIBRATION,     250u);
    wr16(shadow, EE_TEMP_CALIBRATION,       0u);
    wr16(shadow, MACHINE_RUNTIME_START,     0u);
    wr16(shadow, ENGINE_RUNTIME_START,      0u);
    wr16(shadow, ENGINE_OILTIME_START,      0u);
    wr16(shadow, EE_CLIMATE_TEMP_SETTING,  70u);
    wr16(shadow, EE_MONITOR_BATT_SETTING, 1200u);
    wr16(shadow, EE_STORAGE_TEMP_SETTING,  30u);
    wr16(shadow, EE_STORAGE_BATT_SETTING,1180u);
    shadow[EE_EVAP_FAN_SPEED]   = 2u;   /* HIGH */
    shadow[EE_TEMP_UNIT]        = 0u;   /* FAHRENHEIT */
    shadow[EE_CLND_START_ONOFF] = 0u;
    shadow[EE_CLND_START_MODE]  = 1u;   /* CLIMATE_CONTROL_MODE */
    shadow[EE_CLND_START_YEAR]  = 0x13u;
    shadow[EE_CLND_START_MONTH] = 0x01u;
    shadow[EE_CLND_START_DATE]  = 0x10u;
    shadow[EE_CLND_START_HOUR]  = 0x09u;
    shadow[EE_CLND_START_MIN]   = 0x00u;
    shadow[EE_CLND_START_AMPM]  = 0u;
    shadow[EE_BOOTLOADER_FLAG]  = 0u;
    shadow[EEPROM_WRITTEN_FLAG] = EE_SENTINEL_VALUE;  /* 0x55, written last */
}
```

- [ ] **Step 5: Build + run to verify it passes**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_nvm_defaults --output-on-failure`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add firmware/g0b1-apu/App/services/nvm_map.h firmware/g0b1-apu/App/services/nvm_defaults.* firmware/g0b1-apu/Tests/test_nvm_defaults.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): NVM EEPROM map + factory defaults"
```

---

### Task 3: Record codec (write/read one journal record)

**Files:**
- Create: `firmware/g0b1-apu/App/services/nvm_record.h`, `firmware/g0b1-apu/App/services/nvm_record.c`
- Create: `firmware/g0b1-apu/Tests/test_nvm_record.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `modbus_crc16` (M1), `nvm_backend_t`, `NVM_PARAM_SIZE`.
- Produces (in `nvm_record.h`):
  ```c
  #define NVM_MAGIC        0x4E56u
  #define NVM_HEADER_SIZE  8u
  #define NVM_RECORD_SIZE  (NVM_HEADER_SIZE + NVM_PARAM_SIZE)  /* 264 */
  /* Program a record at byte offset `addr` of an already-erased region. Returns 0 on success. */
  int  nvm_record_write(const nvm_backend_t *be, uint32_t addr, uint32_t seq, const uint8_t *payload);
  /* Read+validate a record at `addr`. On a valid record (magic+CRC ok) fills *seq_out and
     payload_out[NVM_PARAM_SIZE] and returns true; otherwise returns false. */
  bool nvm_record_read(const nvm_backend_t *be, uint32_t addr, uint32_t *seq_out, uint8_t *payload_out);
  ```

- [ ] **Step 1: Write the failing test `Tests/test_nvm_record.c`**

```c
#include "unity.h"
#include "fake_nor.h"
#include "nvm_record.h"
#include <string.h>
static nvm_backend_t be;
void setUp(void){ fake_nor_init(&be); } void tearDown(void){}

static void fill(uint8_t *p, uint8_t base){ for (unsigned i=0;i<NVM_PARAM_SIZE;i++) p[i]=(uint8_t)(base+i); }

static void test_roundtrip(void) {
    uint8_t in[NVM_PARAM_SIZE], out[NVM_PARAM_SIZE]; fill(in, 7);
    TEST_ASSERT_EQUAL_INT(0, nvm_record_write(&be, 0, 42u, in));
    uint32_t seq = 0;
    TEST_ASSERT_TRUE(nvm_record_read(&be, 0, &seq, out));
    TEST_ASSERT_EQUAL_UINT32(42u, seq);
    TEST_ASSERT_EQUAL_HEX8_ARRAY(in, out, NVM_PARAM_SIZE);
}
static void test_blank_is_invalid(void) {
    uint32_t seq; uint8_t out[NVM_PARAM_SIZE];
    TEST_ASSERT_FALSE(nvm_record_read(&be, 0, &seq, out));   /* erased 0xFF → no magic */
}
static void test_corrupt_payload_fails_crc(void) {
    uint8_t in[NVM_PARAM_SIZE]; fill(in, 1);
    nvm_record_write(&be, 0, 5u, in);
    fake_nor_raw()[NVM_HEADER_SIZE + 128] &= 0x7F;          /* clear bit7 of payload[128]=0x81 — a genuine change (payload[3]=0x04 has no bit7, so +3 would be a no-op) */
    uint32_t seq; uint8_t out[NVM_PARAM_SIZE];
    TEST_ASSERT_FALSE(nvm_record_read(&be, 0, &seq, out));
}
int main(void){
    UNITY_BEGIN();
    RUN_TEST(test_roundtrip); RUN_TEST(test_blank_is_invalid); RUN_TEST(test_corrupt_payload_fails_crc);
    return UNITY_END();
}
```

- [ ] **Step 2: Register + run to verify it fails**

Add `add_unity_test(test_nvm_record test_nvm_record.c ../App/services/nvm_record.c ../App/services/modbus_crc.c fakes/fake_nor.c)`.
Build; expected FAIL — `nvm_record.h` missing.

- [ ] **Step 3: Write `App/services/nvm_record.h`**

```c
#ifndef NVM_RECORD_H
#define NVM_RECORD_H
#include <stdint.h>
#include <stdbool.h>
#include "nvm_backend.h"
#include "nvm_map.h"
#define NVM_MAGIC        0x4E56u
#define NVM_HEADER_SIZE  8u
#define NVM_RECORD_SIZE  (NVM_HEADER_SIZE + NVM_PARAM_SIZE)
int  nvm_record_write(const nvm_backend_t *be, uint32_t addr, uint32_t seq, const uint8_t *payload);
bool nvm_record_read(const nvm_backend_t *be, uint32_t addr, uint32_t *seq_out, uint8_t *payload_out);
#endif
```

- [ ] **Step 4: Write `App/services/nvm_record.c`**

```c
#include "nvm_record.h"
#include "modbus_crc.h"

int nvm_record_write(const nvm_backend_t *be, uint32_t addr, uint32_t seq, const uint8_t *payload) {
    uint8_t rec[NVM_RECORD_SIZE];
    uint16_t crc = modbus_crc16(payload, NVM_PARAM_SIZE);
    rec[0] = (uint8_t)(NVM_MAGIC & 0xFF);
    rec[1] = (uint8_t)(NVM_MAGIC >> 8);
    rec[2] = (uint8_t)(seq & 0xFF);
    rec[3] = (uint8_t)((seq >> 8) & 0xFF);
    rec[4] = (uint8_t)((seq >> 16) & 0xFF);
    rec[5] = (uint8_t)((seq >> 24) & 0xFF);
    rec[6] = (uint8_t)(crc & 0xFF);
    rec[7] = (uint8_t)(crc >> 8);
    for (uint32_t i = 0; i < NVM_PARAM_SIZE; i++) rec[NVM_HEADER_SIZE + i] = payload[i];
    return be->program(be->ctx, addr, rec, NVM_RECORD_SIZE);
}

bool nvm_record_read(const nvm_backend_t *be, uint32_t addr, uint32_t *seq_out, uint8_t *payload_out) {
    uint8_t rec[NVM_RECORD_SIZE];
    if (be->read(be->ctx, addr, rec, NVM_RECORD_SIZE) != 0) return false;
    uint16_t magic = (uint16_t)(rec[0] | (rec[1] << 8));
    if (magic != NVM_MAGIC) return false;
    uint16_t crc_stored = (uint16_t)(rec[6] | (rec[7] << 8));
    uint16_t crc_calc   = modbus_crc16(&rec[NVM_HEADER_SIZE], NVM_PARAM_SIZE);
    if (crc_stored != crc_calc) return false;
    *seq_out = (uint32_t)rec[2] | ((uint32_t)rec[3] << 8)
             | ((uint32_t)rec[4] << 16) | ((uint32_t)rec[5] << 24);
    for (uint32_t i = 0; i < NVM_PARAM_SIZE; i++) payload_out[i] = rec[NVM_HEADER_SIZE + i];
    return true;
}
```

- [ ] **Step 5: Build + run to verify it passes**

Run: `cmake -S firmware/g0b1-apu/Tests -B firmware/g0b1-apu/Tests/build && cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_nvm_record --output-on-failure`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add firmware/g0b1-apu/App/services/nvm_record.* firmware/g0b1-apu/Tests/test_nvm_record.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): NVM journal record codec (magic+seq+CRC+payload)"
```

---

### Task 4: Public NVM service (init, read/write, dirty, commit, ring rollover, torn-write recovery)

**Files:**
- Create: `firmware/g0b1-apu/App/services/nvm.h`, `firmware/g0b1-apu/App/services/nvm.c`
- Create: `firmware/g0b1-apu/Tests/test_nvm.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `nvm_backend_t`, `nvm_record_*`, `nvm_apply_factory_defaults`, `nvm_map.h`.
- Produces (in `nvm.h`):
  ```c
  void     nvm_init(const nvm_backend_t *be); /* scan ring → load latest valid, else factory-init + commit */
  uint8_t  nvm_read_byte(uint16_t addr);
  uint16_t nvm_read_word(uint16_t addr);      /* little-endian, low byte @ addr */
  void     nvm_write_byte(uint16_t addr, uint8_t v);   /* shadow; marks dirty if changed */
  void     nvm_write_word(uint16_t addr, uint16_t v);
  bool     nvm_dirty(void);
  int      nvm_commit(void);                  /* if dirty, append a new record; 0 on success */
  ```

- [ ] **Step 1: Write the failing test `Tests/test_nvm.c`**

```c
#include "unity.h"
#include "fake_nor.h"
#include "nvm.h"
#include "nvm_map.h"
#include "nvm_record.h"   /* NVM_RECORD_SIZE, NVM_HEADER_SIZE for the torn-write test */
static nvm_backend_t be;
void setUp(void){ fake_nor_init(&be); } void tearDown(void){}

static void test_blank_device_factory_inits(void) {
    nvm_init(&be);
    TEST_ASSERT_EQUAL_HEX8(0x55, nvm_read_byte(EEPROM_WRITTEN_FLAG));
    TEST_ASSERT_EQUAL_UINT16(1200, nvm_read_word(EE_MONITOR_BATT_SETTING));
    TEST_ASSERT_EQUAL_UINT16(250,  nvm_read_word(EE_VREF_CALIBRATION));
}
static void test_write_persists_across_reinit(void) {
    nvm_init(&be);
    nvm_write_word(EE_CLIMATE_TEMP_SETTING, 64u);
    nvm_write_byte(EE_TEMP_UNIT, 1u);
    TEST_ASSERT_TRUE(nvm_dirty());
    TEST_ASSERT_EQUAL_INT(0, nvm_commit());
    TEST_ASSERT_FALSE(nvm_dirty());
    nvm_init(&be);                                   /* reload from flash */
    TEST_ASSERT_EQUAL_UINT16(64u, nvm_read_word(EE_CLIMATE_TEMP_SETTING));
    TEST_ASSERT_EQUAL_HEX8(1u,    nvm_read_byte(EE_TEMP_UNIT));
}
static void test_no_write_no_dirty(void) {
    nvm_init(&be);
    nvm_write_word(EE_CLIMATE_TEMP_SETTING, 70u);    /* 70 is already the default → unchanged */
    TEST_ASSERT_FALSE(nvm_dirty());
}
static void test_ring_rollover(void) {
    nvm_init(&be);                                   /* seq 1 at slot 0 */
    for (uint16_t i = 0; i < 200; i++) {             /* far more than slots_total (60) */
        nvm_write_word(MACHINE_RUNTIME_START, i);
        TEST_ASSERT_EQUAL_INT(0, nvm_commit());
    }
    nvm_init(&be);
    TEST_ASSERT_EQUAL_UINT16(199u, nvm_read_word(MACHINE_RUNTIME_START));
}
static void test_torn_last_record_recovers_previous(void) {
    nvm_init(&be);                                              /* seq1 @ slot0 (defaults) */
    nvm_write_word(EE_CLIMATE_TEMP_SETTING, 60u); nvm_commit(); /* seq2 @ slot1 */
    nvm_write_word(EE_CLIMATE_TEMP_SETTING, 61u); nvm_commit(); /* seq3 @ slot2 (recovery target) */
    nvm_write_word(EE_CLIMATE_TEMP_SETTING, 62u); nvm_commit(); /* seq4 @ slot3 (newest) */
    /* Simulate a torn write of the newest record: clear a payload bit at slot 3 so its
       CRC no longer matches. slot3 = 3*NVM_RECORD_SIZE, still within sector 0 (15 slots/sector). */
    fake_nor_raw()[3u * NVM_RECORD_SIZE + NVM_HEADER_SIZE + 10u] &= 0x7F;
    nvm_init(&be);                                              /* slot3 invalid → falls back to slot2 (61) */
    TEST_ASSERT_EQUAL_UINT16(61u, nvm_read_word(EE_CLIMATE_TEMP_SETTING));
}
int main(void){
    UNITY_BEGIN();
    RUN_TEST(test_blank_device_factory_inits);
    RUN_TEST(test_write_persists_across_reinit);
    RUN_TEST(test_no_write_no_dirty);
    RUN_TEST(test_ring_rollover);
    RUN_TEST(test_torn_last_record_recovers_previous);
    return UNITY_END();
}
```

- [ ] **Step 2: Register + run to verify it fails**

Add `add_unity_test(test_nvm test_nvm.c ../App/services/nvm.c ../App/services/nvm_record.c ../App/services/nvm_defaults.c ../App/services/modbus_crc.c fakes/fake_nor.c)`.
Build; expected FAIL — `nvm.h` missing.

- [ ] **Step 3: Write `App/services/nvm.h`**

```c
#ifndef NVM_H
#define NVM_H
#include <stdint.h>
#include <stdbool.h>
#include "nvm_backend.h"
void     nvm_init(const nvm_backend_t *be);
uint8_t  nvm_read_byte(uint16_t addr);
uint16_t nvm_read_word(uint16_t addr);
void     nvm_write_byte(uint16_t addr, uint8_t v);
void     nvm_write_word(uint16_t addr, uint16_t v);
bool     nvm_dirty(void);
int      nvm_commit(void);
#endif
```

- [ ] **Step 4: Write `App/services/nvm.c`**

```c
#include "nvm.h"
#include "nvm_map.h"
#include "nvm_record.h"
#include "nvm_defaults.h"

static const nvm_backend_t *s_be;
static uint8_t  s_shadow[NVM_PARAM_SIZE];
static bool     s_dirty;
static uint32_t s_seq;         /* sequence of the latest committed record */
static uint32_t s_next_slot;   /* slot index to write the next record into */
static uint32_t s_slots_per_sector;
static uint32_t s_slots_total;

static uint32_t slot_addr(uint32_t slot) {
    uint32_t sec = slot / s_slots_per_sector;
    uint32_t off = (slot % s_slots_per_sector) * NVM_RECORD_SIZE;
    return sec * s_be->sector_size + off;
}

void nvm_init(const nvm_backend_t *be) {
    s_be = be;
    s_slots_per_sector = be->sector_size / NVM_RECORD_SIZE;
    s_slots_total      = be->sector_count * s_slots_per_sector;

    uint32_t best_seq = 0, tmp_seq;
    bool found = false;
    uint32_t best_slot = 0;
    uint8_t payload[NVM_PARAM_SIZE];
    uint8_t best_payload[NVM_PARAM_SIZE];

    for (uint32_t slot = 0; slot < s_slots_total; slot++) {
        if (nvm_record_read(be, slot_addr(slot), &tmp_seq, payload)) {
            if (!found || tmp_seq > best_seq) {
                found = true; best_seq = tmp_seq; best_slot = slot;
                for (uint32_t i = 0; i < NVM_PARAM_SIZE; i++) best_payload[i] = payload[i];
            }
        }
    }

    if (found) {
        for (uint32_t i = 0; i < NVM_PARAM_SIZE; i++) s_shadow[i] = best_payload[i];
        s_seq = best_seq;
        s_next_slot = (best_slot + 1u) % s_slots_total;
        s_dirty = false;
    } else {
        nvm_apply_factory_defaults(s_shadow);
        s_seq = 0; s_next_slot = 0; s_dirty = true;
        (void)nvm_commit();     /* write the first record (seq 1) */
    }
}

uint8_t nvm_read_byte(uint16_t addr) {
    return (addr < NVM_PARAM_SIZE) ? s_shadow[addr] : 0xFF;
}
uint16_t nvm_read_word(uint16_t addr) {
    return (uint16_t)(nvm_read_byte(addr) | ((uint16_t)nvm_read_byte((uint16_t)(addr + 1)) << 8));
}
void nvm_write_byte(uint16_t addr, uint8_t v) {
    if (addr < NVM_PARAM_SIZE && s_shadow[addr] != v) { s_shadow[addr] = v; s_dirty = true; }
}
void nvm_write_word(uint16_t addr, uint16_t v) {
    nvm_write_byte(addr, (uint8_t)(v & 0xFF));
    nvm_write_byte((uint16_t)(addr + 1), (uint8_t)(v >> 8));
}
bool nvm_dirty(void) { return s_dirty; }

int nvm_commit(void) {
    if (!s_dirty) return 0;
    uint32_t target = s_next_slot;
    /* At the first slot of a sector, erase that sector before reusing it. The latest
       record lives in the previous sector, so this never erases live data (region >= 2 sectors). */
    if ((target % s_slots_per_sector) == 0u) {
        int e = s_be->erase(s_be->ctx, target / s_slots_per_sector);
        if (e != 0) return e;
    }
    uint32_t new_seq = s_seq + 1u;
    int r = nvm_record_write(s_be, slot_addr(target), new_seq, s_shadow);
    if (r != 0) return r;
    s_seq = new_seq;
    s_next_slot = (target + 1u) % s_slots_total;
    s_dirty = false;
    return 0;
}
```

- [ ] **Step 5: Build + run to verify it passes**

Run: `cmake -S firmware/g0b1-apu/Tests -B firmware/g0b1-apu/Tests/build && cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_nvm --output-on-failure`
Expected: PASS (5 tests).

- [ ] **Step 6: Run the full suite**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build --output-on-failure`
Expected: all tests pass (M1 suite + fake_nor, nvm_defaults, nvm_record, nvm).

- [ ] **Step 7: Commit**

```bash
git add firmware/g0b1-apu/App/services/nvm.* firmware/g0b1-apu/Tests/test_nvm.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): NVM service — journaled emulated-EEPROM with rollover + torn-write recovery"
```

---

## Deferred to on-target bring-up (not in this plan)

- **`drv_s25fl064`** — the SPI2 driver implementing `nvm_backend_t` against the real S25FL064 NOR (JEDEC-ID probe, read `0x03`, page-program `0x02`, sector-erase `0x20`, RDSR busy-poll, WREN). Dedicate a NOR region of **≥ 2 sectors** (recommend ≥ 16 for wear spread) to the parameter ring. Wire it in the same milestone that lands the CubeMX SPI2 config (with Task 1 of Milestone 1). Its correctness is validated on hardware (read/write/erase round-trip); the journal logic above is already proven on the fake.
- **Batched-commit policy** for the runtime-hour counters (commit periodically + before controlled shutdown) is a control-layer concern — wired in Milestone 5/6 where the scheduler and shutdown path exist.

## Milestone Exit Criteria

- Host: `ctest` green for `test_fake_nor`, `test_nvm_defaults`, `test_nvm_record`, `test_nvm` (+ all M1 tests).
- The NVM service preserves the PIC EE address map and factory defaults, survives power-loss (torn-write) via journaling, and wear-levels across the sector ring — all proven on the in-memory fake, ready for `drv_s25fl064` to drop in behind `nvm_backend_t` on hardware.

## Self-Review Notes (coverage vs spec §7.1)

- In-RAM shadow + journaled backing store → Task 4 (`s_shadow` + record ring). ✓
- Same EE addresses, accessors change only backing call → Task 2 (`nvm_map.h`) + Task 4 (`nvm_read/write_*`). ✓
- Versioned records (seq + CRC), latest-valid wins, power-safe fallback → Tasks 3–4. ✓
- Wear-leveling across sectors → Task 4 (`nvm_commit` ring + rollover test). ✓
- Factory defaults + `0x55` sentinel on blank → Tasks 2, 4. ✓
- Endurance/batched-counter policy + real SPI driver → deferred (documented). ✓
