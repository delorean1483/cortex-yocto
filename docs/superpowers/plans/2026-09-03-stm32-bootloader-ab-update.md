# STM32 Bootloader + A/B App Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small, SWD-only custom bootloader to the STM32G0B1 APU controller that boots one of two A/B application slots, and change the app so a new image can be received over the existing RS-485 Modbus link, written to the inactive slot, verified, and committed — with automatic rollback to the last-good slot if the new app never confirms healthy.

**Architecture:** A 32 KB bootloader at flash base runs first at every reset, reads a boot-config record from internal flash, decides which slot to boot (honoring a "trial" slot with a bounded revert counter), sets `VTOR` and jumps. When the app sets a `.noinit` RAM magic and resets, the bootloader instead enters an **update mode** that speaks a minimal Modbus dialect (function codes `0x41`/`0x42`) to erase the inactive slot, receive the image in chunks, CRC32-verify it, mark it TRIAL-active, and reset. The app is built **per-slot** (two link configs → two `.bin`), sets `VTOR` to its own base, refuses the enter-bootloader command while the engine runs, and self-confirms its slot COMMITTED once it has booted healthy. All boot-decision, boot-config, protocol, and CRC logic is portable C behind backend interfaces and host-tested with Unity + fakes; only the internal-flash driver, clock/UART init, linker scripts, and the jump are on-target and bench-verified.

**Tech Stack:** C11, STM32G0B1RET3 (Cortex-M0+, 512 KB flash / 2 KB pages, 144 KB RAM), STM32 HAL (flash/UART/RCC/IWDG), STM32CubeIDE 1.19.0 (app project) + a hand-written GNU-arm Makefile (bootloader project), Unity + CMake host tests, arm-none-eabi-gcc 13.3, STLINK-V3SET via header HDR1, Python bench harness over an FT232 RS-485 converter.

**Spec:** `cortex-yocto` repo (this repo you are reading the plan in), `docs/superpowers/specs/2026-09-03-stm32-remote-firmware-update-design.md`. This plan implements **Sub-project #1** only (STM32 bootloader + app A/B). Sub-project #2 (gobi-agent transfer module + cortex delivery recipe) is a separate plan that consumes the wire protocol frozen here.

**Target repo for ALL file paths below:** `g0b1-firmware` (local clone at `~/Documents/github/g0b1-firmware`, branch off `main`). Every `Create`/`Modify`/`Test` path in this plan is relative to that repo, **not** the repo the plan file lives in.

## Global Constraints

- **Toolchain / target:** arm-none-eabi-gcc `-mcpu=cortex-m0plus -mfloat-abi=soft -mthumb`, `--specs=nano.specs --specs=nosys.specs`, `-Wl,--gc-sections`. Host tests build with C11 and `-Wall -Wextra -Werror -funsigned-char` (copied verbatim from `Tests/CMakeLists.txt`). New portable code MUST compile clean under `-Werror`.
- **Flash geometry (fixed):** base `0x08000000`, length `512 KB`, page size `2048 B`, pages `0..255`. RAM base `0x20000000`, length `144 KB` (`0x24000`).
- **Flash layout (fixed by this plan):**
  | Region | Address range | Pages | Size |
  |--------|---------------|-------|------|
  | Bootloader | `0x08000000`–`0x08007FFF` | 0–15 | 32 KB |
  | Slot A app | `0x08008000`–`0x0803FFFF` | 16–127 | 224 KB |
  | Slot B app | `0x08040000`–`0x08077FFF` | 128–239 | 224 KB |
  | Boot-config | `0x08078000`–`0x0807FFFF` | 240–255 | 32 KB (only pages 240, 241 used) |
- **Program granularity:** STM32G0 internal flash programs **64-bit double-words**; every programmed length is a multiple of 8 bytes, tail-padded with `0xFF`. Erased state is `0xFF`. Program may only clear bits and only on erased space.
- **Device flash config (fixed):** **single-bank** (option byte `DUAL_BANK=0`) so page indices are linear `0..255`; set once at the SWD provisioning step (Task 16). Flash program/erase inner loops are **RAM-resident** (`.RamFunc`), so a single-bank read-while-write stall cannot wedge the CPU.
- **Reset-magic:** a single `uint32_t` in a fixed `.noinit` RAM region at the **top 32 bytes of RAM** (`0x20023FE0`), placed identically in the bootloader linker script AND both app link configs. Value `0xB00710AD` = "enter update mode". Startup must NOT zero this region.
- **Boot-config CRC + image CRC:** **CRC-32/IEEE-802.3** (zlib `crc32`: poly `0xEDB88320` reflected, init `0xFFFFFFFF`, xorout `0xFFFFFFFF`). The cortex agent (sub-project #2) MUST compute the identical CRC over each `.bin`; this is the interop contract.
- **Modbus wire:** RTU, slave address `1`, 9600 8N1, DE on `PB3`. Frame = `[addr][fc][data...][crc16_lo][crc16_hi]`, `crc16` = existing `modbus_crc16()` (poly `0xA001`, init `0xFFFF`). Max frame 256 B. The bootloader reuses this exact framing.
- **Bootloader is never remotely writable.** Update mode only ever erases/programs the **inactive** slot (and, on commit, the boot-config pages). It never touches pages 0–15 or the active slot.
- **Version register:** the app already exposes reg 2 = `G0B1_FW_VERSION_ENC` (`major*10000+minor*100+patch`). The agent compares against this; do not change its encoding.
- **Host test workflow (run after every impl step that touches portable code):**
  ```bash
  cmake -S Tests -B Tests/build >/dev/null && cmake --build Tests/build -j >/dev/null && ctest --test-dir Tests/build --output-on-failure
  ```

---

## File Structure

**New portable modules (in `App/services/`, host-tested, shared by bootloader + app):**
- `crc32.c` / `crc32.h` — CRC-32/IEEE-802.3 (image + boot-config integrity).
- `iflash_backend.h` — abstract internal-flash interface (struct of fn pointers), the on-target/host seam.
- `bootcfg.c` / `bootcfg.h` — boot-config record + ping-pong load/save codec over `iflash_backend_t`.
- `boot_decision.c` / `boot_decision.h` — pure "what to boot" state machine (trial/revert/recovery).
- `bl_proto.c` / `bl_proto.h` — parse/build helpers for FC `0x41`/`0x42` PDUs + constants (the wire contract).
- `bl_session.c` / `bl_session.h` — update-mode session state machine (INFO/ERASE/DATA/VERIFY/COMMIT/ABORT) driving `iflash_backend_t` + `bootcfg`.
- `mbp_boot.c` / `mbp_boot.h` — app-side Modbus provider: reg-35 enter-bootloader (refuse-if-engine) via injected fn pointers.
- `app_confirm.c` / `app_confirm.h` — app-side "self-confirm when healthy" trigger logic (pure; drives `bootcfg`).

**New host fakes (in `Tests/fakes/`):**
- `fake_iflash.c` / `fake_iflash.h` — in-RAM 512 KB flash model implementing `iflash_backend_t` (erased 0xFF, program AND-only-on-erased, page erase), for `bootcfg`/`boot_decision`/`bl_session` tests.

**New host tests (in `Tests/`, registered in `Tests/CMakeLists.txt`):**
- `test_crc32.c`, `test_fake_iflash.c`, `test_bootcfg.c`, `test_boot_decision.c`, `test_bl_proto.c`, `test_bl_session.c`, `test_mbp_boot.c`, `test_app_confirm.c`.

**New on-target bootloader project (new top-level `boot/` dir, hand-written Makefile):**
- `boot/Makefile` — builds `boot/build/g0b1-boot.elf` + `.bin`.
- `boot/g0b1-boot.ld` — linker script (32 KB region + `.RamFunc` + `.noinit`).
- `boot/src/startup_g0b1_boot.s` — vector table + Reset_Handler (trimmed from the app startup).
- `boot/src/system_boot.c` — `SystemInit` (no VTOR write; boot clocks).
- `boot/src/boot_clock.c` — minimal RCC init (HSI or HSE→PLL to match app UART timing).
- `boot/src/drv_iflash.c` — on-target `iflash_backend_t` (RAM-resident program/erase; IWDG refresh).
- `boot/src/boot_uart.c` — USART1 RS-485 (DE=PB3) blocking RX-frame assembler + TX.
- `boot/src/boot_main.c` — arms IWDG, loads bootcfg, `boot_decide()`, jump-or-update-mode loop.
- `boot/src/stm32g0xx_hal_conf.h` + a curated subset of the HAL `.c` compiled from `cube/Drivers/…`.

**Modified app files (`cube/` project, per-slot builds):**
- `cube/STM32G0B1RETX_SLOTA.ld`, `cube/STM32G0B1RETX_SLOTB.ld` — new per-slot linker scripts (copies of the FLASH script with slot origin/length + `.noinit`).
- `cube/Core/Src/system_stm32g0xx.c` — set `SCB->VTOR = (uint32_t)&g_pfnVectors`.
- `cube/Core/Src/app_main.c` — wire `mbp_boot`, the enter-bootloader reset path, and `app_confirm` into the superloop.
- `cube/Core/Src/drv_iflash.c` — same on-target flash backend as `boot/` (shared source or a copy) so the app can write boot-config on confirm.
- `App/services/fw_version.h` — bump to the first bootloader-capable release.
- `cube/Core/Inc/g0b1_slots.h` — shared slot/geometry constants used by both linker-fed defines and C.

**New bench tool:**
- `tools/bl_flash.py` — host-side reference flasher (drives the full round-trip over the FT232 RS-485 link); the executable spec for sub-project #2's agent.

---

## Phase 0 — Shared host-testable foundations

### Task 1: CRC-32 module

**Files:**
- Create: `App/services/crc32.h`, `App/services/crc32.c`
- Test: `Tests/test_crc32.c`
- Modify: `Tests/CMakeLists.txt`

**Interfaces:**
- Produces: `uint32_t crc32_update(uint32_t crc, const uint8_t *data, uint32_t len);` (seed with `CRC32_INIT`, do NOT xorout between calls), `uint32_t crc32_compute(const uint8_t *data, uint32_t len);` (one-shot, includes final xorout), `#define CRC32_INIT 0xFFFFFFFFu`. Used by `bootcfg`, `bl_session`, `boot_decision`'s slot oracle, and the app confirm path.

- [ ] **Step 1: Write the failing test**

Create `Tests/test_crc32.c`:
```c
#include "unity.h"
#include "crc32.h"
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

/* Known-answer vectors for CRC-32/IEEE-802.3 (zlib crc32). */
void test_crc32_empty(void)  { TEST_ASSERT_EQUAL_HEX32(0x00000000u, crc32_compute((const uint8_t*)"", 0)); }
void test_crc32_check(void)  { /* "123456789" -> 0xCBF43926 (the standard check value) */
    TEST_ASSERT_EQUAL_HEX32(0xCBF43926u, crc32_compute((const uint8_t*)"123456789", 9)); }
void test_crc32_ascii(void)  { TEST_ASSERT_EQUAL_HEX32(0x414FA339u, crc32_compute((const uint8_t*)"The quick brown fox jumps over the lazy dog", 43)); }
void test_crc32_incremental_matches_oneshot(void) {
    const uint8_t buf[8] = {0,1,2,3,4,5,6,7};
    uint32_t c = CRC32_INIT;
    c = crc32_update(c, buf, 3);
    c = crc32_update(c, buf + 3, 5);
    TEST_ASSERT_EQUAL_HEX32(crc32_compute(buf, 8) ^ 0xFFFFFFFFu, c); /* update() leaves pre-xorout state */
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_crc32_empty);
    RUN_TEST(test_crc32_check);
    RUN_TEST(test_crc32_ascii);
    RUN_TEST(test_crc32_incremental_matches_oneshot);
    return UNITY_END();
}
```

Add to `Tests/CMakeLists.txt` (after the `test_modbus_crc` line):
```cmake
add_unity_test(test_crc32 test_crc32.c ../App/services/crc32.c)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cmake -S Tests -B Tests/build && cmake --build Tests/build -j && ctest --test-dir Tests/build -R test_crc32 --output-on-failure`
Expected: FAIL — build error, `crc32.h`/`crc32.c` do not exist.

- [ ] **Step 3: Write minimal implementation**

Create `App/services/crc32.h`:
```c
#ifndef CRC32_H
#define CRC32_H
#include <stdint.h>
/* CRC-32/IEEE-802.3 (zlib crc32): reflected poly 0xEDB88320, init/xorout 0xFFFFFFFF.
   This is the interop contract with the cortex agent's per-.bin CRC. */
#define CRC32_INIT 0xFFFFFFFFu
uint32_t crc32_update(uint32_t crc, const uint8_t *data, uint32_t len); /* NO xorout; chainable */
uint32_t crc32_compute(const uint8_t *data, uint32_t len);              /* seeds + xorout */
#endif
```

Create `App/services/crc32.c` (bitwise, no 1 KiB table — the bootloader is size-constrained and this runs at 9600-baud pace):
```c
#include "crc32.h"

uint32_t crc32_update(uint32_t crc, const uint8_t *data, uint32_t len) {
    for (uint32_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (int b = 0; b < 8; b++) {
            uint32_t mask = (uint32_t)-(int32_t)(crc & 1u);
            crc = (crc >> 1) ^ (0xEDB88320u & mask);
        }
    }
    return crc;
}

uint32_t crc32_compute(const uint8_t *data, uint32_t len) {
    return crc32_update(CRC32_INIT, data, len) ^ 0xFFFFFFFFu;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ctest --test-dir Tests/build -R test_crc32 --output-on-failure`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add App/services/crc32.h App/services/crc32.c Tests/test_crc32.c Tests/CMakeLists.txt
git commit -m "feat(crc32): CRC-32/IEEE-802.3 for image + boot-config integrity"
```

---

### Task 2: Internal-flash backend interface + host fake

**Files:**
- Create: `App/services/iflash_backend.h`
- Create: `Tests/fakes/fake_iflash.h`, `Tests/fakes/fake_iflash.c`
- Test: `Tests/test_fake_iflash.c`
- Modify: `Tests/CMakeLists.txt`

**Interfaces:**
- Produces: `iflash_backend_t` (below); `const iflash_backend_t *fake_iflash_backend(void);`, `void fake_iflash_reset(void);` (all pages → 0xFF), `uint8_t *fake_iflash_ptr(uint32_t addr);` (test peek), `void fake_iflash_fail_next_program(void);` / `void fake_iflash_fail_next_erase(void);` (inject one error). Consumed by `bootcfg`, `boot_decision`, `bl_session` tests.

- [ ] **Step 1: Write the failing test**

Create `Tests/test_fake_iflash.c`:
```c
#include "unity.h"
#include "iflash_backend.h"
#include "fake_iflash.h"
#include <string.h>

void setUp(void) { fake_iflash_reset(); }
void tearDown(void) {}

void test_erased_is_ff(void) {
    const iflash_backend_t *fl = fake_iflash_backend();
    uint8_t b[8]; TEST_ASSERT_EQUAL_INT(0, fl->read(fl->ctx, 0x08008000u, b, 8));
    for (int i = 0; i < 8; i++) TEST_ASSERT_EQUAL_HEX8(0xFF, b[i]);
}
void test_program_then_read(void) {
    const iflash_backend_t *fl = fake_iflash_backend();
    uint8_t w[8] = {0xDE,0xAD,0xBE,0xEF,0x01,0x02,0x03,0x04};
    TEST_ASSERT_EQUAL_INT(0, fl->program(fl->ctx, 0x08008000u, w, 8));
    uint8_t r[8]; fl->read(fl->ctx, 0x08008000u, r, 8);
    TEST_ASSERT_EQUAL_HEX8_ARRAY(w, r, 8);
}
void test_program_only_on_erased(void) { /* second program to same dword must fail (bits already set) */
    const iflash_backend_t *fl = fake_iflash_backend();
    uint8_t w[8] = {0,0,0,0,0,0,0,0};
    TEST_ASSERT_EQUAL_INT(0, fl->program(fl->ctx, 0x08008000u, w, 8));
    TEST_ASSERT_NOT_EQUAL(0, fl->program(fl->ctx, 0x08008000u, w, 8));
}
void test_erase_restores_ff(void) {
    const iflash_backend_t *fl = fake_iflash_backend();
    uint8_t w[8] = {0}; fl->program(fl->ctx, 0x08008000u, w, 8);
    TEST_ASSERT_EQUAL_INT(0, fl->erase_page(fl->ctx, 16u)); /* page 16 = 0x08008000 */
    uint8_t r[8]; fl->read(fl->ctx, 0x08008000u, r, 8);
    for (int i = 0; i < 8; i++) TEST_ASSERT_EQUAL_HEX8(0xFF, r[i]);
}
void test_program_rejects_unaligned_len(void) {
    const iflash_backend_t *fl = fake_iflash_backend();
    uint8_t w[7] = {0};
    TEST_ASSERT_NOT_EQUAL(0, fl->program(fl->ctx, 0x08008000u, w, 7)); /* not multiple of 8 */
}
void test_fault_injection(void) {
    const iflash_backend_t *fl = fake_iflash_backend();
    uint8_t w[8] = {0};
    fake_iflash_fail_next_program();
    TEST_ASSERT_NOT_EQUAL(0, fl->program(fl->ctx, 0x08008000u, w, 8));
    TEST_ASSERT_EQUAL_INT(0, fl->program(fl->ctx, 0x08008000u, w, 8)); /* only the next one failed */
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_erased_is_ff); RUN_TEST(test_program_then_read);
    RUN_TEST(test_program_only_on_erased); RUN_TEST(test_erase_restores_ff);
    RUN_TEST(test_program_rejects_unaligned_len); RUN_TEST(test_fault_injection);
    return UNITY_END();
}
```

Add to `Tests/CMakeLists.txt`:
```cmake
add_unity_test(test_fake_iflash test_fake_iflash.c fakes/fake_iflash.c)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cmake -S Tests -B Tests/build && cmake --build Tests/build -j && ctest --test-dir Tests/build -R test_fake_iflash --output-on-failure`
Expected: FAIL — `iflash_backend.h` / `fake_iflash.*` do not exist.

- [ ] **Step 3: Write minimal implementation**

Create `App/services/iflash_backend.h`:
```c
#ifndef IFLASH_BACKEND_H
#define IFLASH_BACKEND_H
#include <stdint.h>
/* Abstract STM32 INTERNAL flash. Erased = 0xFF. program() writes an 8-byte
   double-word aligned region (len a multiple of 8), AND-semantics, erased
   space only. erase_page() erases one 2 KB page by absolute index (0..255).
   read() abstracts the memory-mapped flash so host tests can fake it.
   All ops return 0 on success, non-zero on error. */
typedef struct iflash_backend {
    uint32_t page_size;    /* 2048 */
    uint32_t page_count;   /* 256 */
    uint32_t base_addr;    /* 0x08000000 */
    int (*read)(void *ctx, uint32_t addr, uint8_t *buf, uint32_t len);
    int (*program)(void *ctx, uint32_t addr, const uint8_t *data, uint32_t len);
    int (*erase_page)(void *ctx, uint32_t page_index);
    void *ctx;
} iflash_backend_t;
#endif
```

Create `Tests/fakes/fake_iflash.h`:
```c
#ifndef FAKE_IFLASH_H
#define FAKE_IFLASH_H
#include "iflash_backend.h"
const iflash_backend_t *fake_iflash_backend(void);
void     fake_iflash_reset(void);
uint8_t *fake_iflash_ptr(uint32_t addr);
void     fake_iflash_fail_next_program(void);
void     fake_iflash_fail_next_erase(void);
#endif
```

Create `Tests/fakes/fake_iflash.c`:
```c
#include "fake_iflash.h"
#include <string.h>

#define FL_BASE  0x08000000u
#define FL_SIZE  (512u*1024u)
#define FL_PAGE  2048u

static uint8_t s_mem[FL_SIZE];
static int s_fail_prog, s_fail_erase;

void fake_iflash_reset(void) { memset(s_mem, 0xFF, sizeof s_mem); s_fail_prog = s_fail_erase = 0; }
uint8_t *fake_iflash_ptr(uint32_t addr) { return &s_mem[addr - FL_BASE]; }
void fake_iflash_fail_next_program(void) { s_fail_prog = 1; }
void fake_iflash_fail_next_erase(void)   { s_fail_erase = 1; }

static int f_read(void *c, uint32_t a, uint8_t *b, uint32_t n) {
    (void)c; if (a < FL_BASE || a + n > FL_BASE + FL_SIZE) return -1;
    memcpy(b, &s_mem[a - FL_BASE], n); return 0;
}
static int f_program(void *c, uint32_t a, const uint8_t *b, uint32_t n) {
    (void)c;
    if (s_fail_prog) { s_fail_prog = 0; return -1; }
    if ((n & 7u) != 0u) return -1;                       /* dword granularity */
    if ((a & 7u) != 0u) return -1;                       /* dword aligned */
    if (a < FL_BASE || a + n > FL_BASE + FL_SIZE) return -1;
    uint8_t *p = &s_mem[a - FL_BASE];
    for (uint32_t i = 0; i < n; i++) if ((p[i] & b[i]) != b[i]) return -2; /* can't set 0->1 */
    for (uint32_t i = 0; i < n; i++) p[i] &= b[i];
    return 0;
}
static int f_erase(void *c, uint32_t page) {
    (void)c;
    if (s_fail_erase) { s_fail_erase = 0; return -1; }
    if (page >= FL_SIZE / FL_PAGE) return -1;
    memset(&s_mem[page * FL_PAGE], 0xFF, FL_PAGE);
    return 0;
}
static const iflash_backend_t s_be = {
    FL_PAGE, FL_SIZE / FL_PAGE, FL_BASE, f_read, f_program, f_erase, 0
};
const iflash_backend_t *fake_iflash_backend(void) { return &s_be; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ctest --test-dir Tests/build -R test_fake_iflash --output-on-failure`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add App/services/iflash_backend.h Tests/fakes/fake_iflash.h Tests/fakes/fake_iflash.c Tests/test_fake_iflash.c Tests/CMakeLists.txt
git commit -m "feat(iflash): internal-flash backend interface + host fake"
```

---

### Task 3: Boot-config record + ping-pong codec

**Files:**
- Create: `App/services/bootcfg.h`, `App/services/bootcfg.c`
- Test: `Tests/test_bootcfg.c`
- Modify: `Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `iflash_backend_t` (Task 2), `crc32_compute` (Task 1).
- Produces:
  - `slot_state_t` = `{SLOT_STATE_BAD=0, SLOT_STATE_TRIAL=1, SLOT_STATE_COMMITTED=2}`
  - `slot_id_t` = `{SLOT_A=0, SLOT_B=1}`
  - `slot_meta_t { uint8_t state; uint8_t _pad[3]; uint32_t length; uint32_t crc32; }`
  - `bootcfg_t { uint32_t magic; uint16_t version; uint16_t active_slot; uint32_t seq; slot_meta_t slot[2]; uint16_t trial_count; uint16_t _pad; uint32_t crc32; }`
  - `#define BOOTCFG_MAGIC 0x42434647u`, `#define BOOTCFG_VERSION 1u`, `#define BOOTCFG_PAGE_0 240u`, `#define BOOTCFG_PAGE_1 241u`
  - `#define SLOT_A_BASE 0x08008000u`, `#define SLOT_B_BASE 0x08040000u`, `#define SLOT_SIZE 0x38000u` (224 KB), `uint32_t bootcfg_slot_base(slot_id_t s);`
  - `int bootcfg_load(const iflash_backend_t *fl, bootcfg_t *out);` → 0 if a valid record was found (newest by `seq`), non-zero if neither page is valid (fresh device; `*out` zeroed).
  - `int bootcfg_save(const iflash_backend_t *fl, bootcfg_t *cfg);` → bumps `cfg->seq`, recomputes `cfg->crc32`, erases + writes the *other* page, returns 0 on success.
  - `int bootcfg_slot_crc_ok(const iflash_backend_t *fl, const bootcfg_t *cfg, slot_id_t s);` → 1 if `cfg->slot[s].state != BAD` AND CRC32 over `[base(s) .. base(s)+length)` equals `cfg->slot[s].crc32`.

- [ ] **Step 1: Write the failing test**

Create `Tests/test_bootcfg.c`:
```c
#include "unity.h"
#include "bootcfg.h"
#include "crc32.h"
#include "fake_iflash.h"
#include <string.h>

static const iflash_backend_t *FL;
void setUp(void) { fake_iflash_reset(); FL = fake_iflash_backend(); }
void tearDown(void) {}

void test_load_fresh_device_fails(void) {
    bootcfg_t c; TEST_ASSERT_NOT_EQUAL(0, bootcfg_load(FL, &c));
}
void test_save_then_load_roundtrip(void) {
    bootcfg_t c; memset(&c, 0, sizeof c);
    c.magic = BOOTCFG_MAGIC; c.version = BOOTCFG_VERSION; c.active_slot = SLOT_A; c.seq = 0;
    c.slot[SLOT_A].state = SLOT_STATE_COMMITTED; c.slot[SLOT_A].length = 8; c.slot[SLOT_A].crc32 = 0x1234;
    TEST_ASSERT_EQUAL_INT(0, bootcfg_save(FL, &c));
    bootcfg_t r; TEST_ASSERT_EQUAL_INT(0, bootcfg_load(FL, &r));
    TEST_ASSERT_EQUAL_UINT16(SLOT_A, r.active_slot);
    TEST_ASSERT_EQUAL_UINT32(c.seq, r.seq);           /* seq was bumped to 1 by save */
    TEST_ASSERT_EQUAL_UINT32(1u, r.seq);
    TEST_ASSERT_EQUAL_UINT8(SLOT_STATE_COMMITTED, r.slot[SLOT_A].state);
}
void test_newest_seq_wins_pingpong(void) {
    bootcfg_t c; memset(&c, 0, sizeof c); c.magic = BOOTCFG_MAGIC; c.version = BOOTCFG_VERSION;
    c.active_slot = SLOT_A; c.seq = 0; bootcfg_save(FL, &c);   /* -> page0, seq 1 */
    c.active_slot = SLOT_B;            bootcfg_save(FL, &c);   /* -> page1, seq 2 */
    c.active_slot = SLOT_A;            bootcfg_save(FL, &c);   /* -> page0, seq 3 */
    bootcfg_t r; bootcfg_load(FL, &r);
    TEST_ASSERT_EQUAL_UINT32(3u, r.seq);
    TEST_ASSERT_EQUAL_UINT16(SLOT_A, r.active_slot);
}
void test_corrupt_record_ignored(void) {
    bootcfg_t c; memset(&c, 0, sizeof c); c.magic = BOOTCFG_MAGIC; c.version = BOOTCFG_VERSION;
    bootcfg_save(FL, &c);                                     /* good record on page0, seq1 */
    /* Corrupt page0's magic by erasing it; load must fail (only page has bad magic). */
    FL->erase_page(FL->ctx, BOOTCFG_PAGE_0);
    bootcfg_t r; TEST_ASSERT_NOT_EQUAL(0, bootcfg_load(FL, &r));
}
void test_slot_crc_ok(void) {
    /* program 16 bytes into slot A, compute its crc, store in cfg, expect OK. */
    uint8_t img[16]; for (int i=0;i<16;i++) img[i]=(uint8_t)(i*7+1);
    FL->program(FL->ctx, SLOT_A_BASE, img, 16);
    bootcfg_t c; memset(&c,0,sizeof c); c.magic=BOOTCFG_MAGIC; c.version=BOOTCFG_VERSION;
    c.slot[SLOT_A].state = SLOT_STATE_COMMITTED; c.slot[SLOT_A].length = 16;
    c.slot[SLOT_A].crc32 = crc32_compute(fake_iflash_ptr(SLOT_A_BASE), 16);
    TEST_ASSERT_EQUAL_INT(1, bootcfg_slot_crc_ok(FL, &c, SLOT_A));
    c.slot[SLOT_A].crc32 ^= 1u;                              /* wrong crc */
    TEST_ASSERT_EQUAL_INT(0, bootcfg_slot_crc_ok(FL, &c, SLOT_A));
    c.slot[SLOT_A].crc32 ^= 1u; c.slot[SLOT_A].state = SLOT_STATE_BAD; /* BAD short-circuits */
    TEST_ASSERT_EQUAL_INT(0, bootcfg_slot_crc_ok(FL, &c, SLOT_A));
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_load_fresh_device_fails); RUN_TEST(test_save_then_load_roundtrip);
    RUN_TEST(test_newest_seq_wins_pingpong); RUN_TEST(test_corrupt_record_ignored);
    RUN_TEST(test_slot_crc_ok);
    return UNITY_END();
}
```

Add to `Tests/CMakeLists.txt`:
```cmake
add_unity_test(test_bootcfg test_bootcfg.c ../App/services/bootcfg.c ../App/services/crc32.c fakes/fake_iflash.c)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cmake -S Tests -B Tests/build && cmake --build Tests/build -j && ctest --test-dir Tests/build -R test_bootcfg --output-on-failure`
Expected: FAIL — `bootcfg.*` do not exist.

- [ ] **Step 3: Write minimal implementation**

Create `App/services/bootcfg.h`:
```c
#ifndef BOOTCFG_H
#define BOOTCFG_H
#include <stdint.h>
#include "iflash_backend.h"

#define BOOTCFG_MAGIC    0x42434647u  /* 'GFCB' little-endian == "BCFG" */
#define BOOTCFG_VERSION  1u
#define BOOTCFG_PAGE_0   240u
#define BOOTCFG_PAGE_1   241u

#define SLOT_A_BASE      0x08008000u
#define SLOT_B_BASE      0x08040000u
#define SLOT_SIZE        0x38000u      /* 224 KB */

typedef enum { SLOT_STATE_BAD = 0, SLOT_STATE_TRIAL = 1, SLOT_STATE_COMMITTED = 2 } slot_state_t;
typedef enum { SLOT_A = 0, SLOT_B = 1 } slot_id_t;

typedef struct { uint8_t state; uint8_t _pad[3]; uint32_t length; uint32_t crc32; } slot_meta_t;

typedef struct {
    uint32_t    magic;
    uint16_t    version;
    uint16_t    active_slot;
    uint32_t    seq;
    slot_meta_t slot[2];
    uint16_t    trial_count;
    uint16_t    _pad;
    uint32_t    crc32;        /* over all preceding bytes */
} bootcfg_t;

uint32_t bootcfg_slot_base(slot_id_t s);
int bootcfg_load(const iflash_backend_t *fl, bootcfg_t *out);
int bootcfg_save(const iflash_backend_t *fl, bootcfg_t *cfg);
int bootcfg_slot_crc_ok(const iflash_backend_t *fl, const bootcfg_t *cfg, slot_id_t s);
#endif
```

Create `App/services/bootcfg.c`:
```c
#include "bootcfg.h"
#include "crc32.h"
#include <string.h>

#define CFG_BASE       0x08000000u
#define PAGE_SIZE      2048u
#define CRC_OFF        (offsetof(bootcfg_t, crc32))

uint32_t bootcfg_slot_base(slot_id_t s) { return (s == SLOT_A) ? SLOT_A_BASE : SLOT_B_BASE; }

static uint32_t page_addr(uint32_t page) { return CFG_BASE + page * PAGE_SIZE; }

static int record_valid(const bootcfg_t *r) {
    if (r->magic != BOOTCFG_MAGIC || r->version != BOOTCFG_VERSION) return 0;
    uint32_t want = crc32_compute((const uint8_t *)r, CRC_OFF);
    return (want == r->crc32);
}

static int read_page(const iflash_backend_t *fl, uint32_t page, bootcfg_t *out) {
    return fl->read(fl->ctx, page_addr(page), (uint8_t *)out, sizeof *out);
}

int bootcfg_load(const iflash_backend_t *fl, bootcfg_t *out) {
    bootcfg_t a, b; int va = 0, vb = 0;
    if (read_page(fl, BOOTCFG_PAGE_0, &a) == 0) va = record_valid(&a);
    if (read_page(fl, BOOTCFG_PAGE_1, &b) == 0) vb = record_valid(&b);
    if (va && vb) { *out = (a.seq >= b.seq) ? a : b; return 0; }
    if (va) { *out = a; return 0; }
    if (vb) { *out = b; return 0; }
    memset(out, 0, sizeof *out);
    return -1;
}

int bootcfg_save(const iflash_backend_t *fl, bootcfg_t *cfg) {
    /* Write to the page NOT holding the current newest record (ping-pong). */
    bootcfg_t a, b; int va = 0, vb = 0;
    if (read_page(fl, BOOTCFG_PAGE_0, &a) == 0) va = record_valid(&a);
    if (read_page(fl, BOOTCFG_PAGE_1, &b) == 0) vb = record_valid(&b);
    uint32_t newest_page = BOOTCFG_PAGE_0;
    if (va && vb)      newest_page = (a.seq >= b.seq) ? BOOTCFG_PAGE_0 : BOOTCFG_PAGE_1;
    else if (va)       newest_page = BOOTCFG_PAGE_0;
    else if (vb)       newest_page = BOOTCFG_PAGE_1;
    uint32_t target = (newest_page == BOOTCFG_PAGE_0) ? BOOTCFG_PAGE_1 : BOOTCFG_PAGE_0;

    cfg->magic = BOOTCFG_MAGIC; cfg->version = BOOTCFG_VERSION; cfg->_pad = 0;
    cfg->seq += 1u;
    cfg->crc32 = crc32_compute((const uint8_t *)cfg, CRC_OFF);

    if (fl->erase_page(fl->ctx, target) != 0) return -1;
    /* program in 8-byte dwords; sizeof(bootcfg_t) is a multiple of 8 by design. */
    return fl->program(fl->ctx, page_addr(target), (const uint8_t *)cfg, sizeof *cfg);
}

int bootcfg_slot_crc_ok(const iflash_backend_t *fl, const bootcfg_t *cfg, slot_id_t s) {
    if (cfg->slot[s].state == SLOT_STATE_BAD) return 0;
    uint32_t len = cfg->slot[s].length;
    if (len == 0u || len > SLOT_SIZE) return 0;
    uint32_t base = bootcfg_slot_base(s);
    uint32_t crc = CRC32_INIT;
    uint8_t buf[64];
    for (uint32_t off = 0; off < len; off += sizeof buf) {
        uint32_t n = (len - off < sizeof buf) ? (len - off) : sizeof buf;
        if (fl->read(fl->ctx, base + off, buf, n) != 0) return 0;
        crc = crc32_update(crc, buf, n);
    }
    return ((crc ^ 0xFFFFFFFFu) == cfg->slot[s].crc32) ? 1 : 0;
}
```

Verify `sizeof(bootcfg_t)` is a multiple of 8 (magic4+ver2+active2+seq4 = 12; slot[2] = 2×12 = 24 → 36; trial2+pad2 = 4 → 40; crc4 → 44). 44 is NOT a multiple of 8. **Add a second reserved word** so the whole struct is dword-aligned: change `uint16_t _pad;` to `uint16_t _pad; uint32_t _pad2;` giving 48 bytes. Update the header struct accordingly and re-run.

- [ ] **Step 4: Run test to verify it passes**

Run: `ctest --test-dir Tests/build -R test_bootcfg --output-on-failure`
Expected: PASS (5 tests). If a program() call fails on size, confirm `sizeof(bootcfg_t) % 8 == 0` (add `_Static_assert(sizeof(bootcfg_t) % 8u == 0u, "dword");` to `bootcfg.c`).

- [ ] **Step 5: Commit**

```bash
git add App/services/bootcfg.h App/services/bootcfg.c Tests/test_bootcfg.c Tests/CMakeLists.txt
git commit -m "feat(bootcfg): A/B boot-config record + ping-pong load/save + slot CRC check"
```

---

## Phase 1 — Boot-decision state machine (the risky logic; host-tested exhaustively)

### Task 4: `boot_decide` — trial / revert / recovery

**Files:**
- Create: `App/services/boot_decision.h`, `App/services/boot_decision.c`
- Test: `Tests/test_boot_decision.c`
- Modify: `Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `bootcfg_t`, `slot_id_t` (Task 3).
- Produces:
  - `#define BOOT_MAGIC_ENTER 0xB00710ADu`, `#define TRIAL_BOOT_LIMIT 3u`
  - `boot_action_t { BOOT_ACTION_ENTER_UPDATE = 0, BOOT_ACTION_JUMP_SLOT = 1 }`
  - `boot_decision_t { boot_action_t action; slot_id_t slot; int cfg_dirty; }`
  - `boot_decision_t boot_decide(bootcfg_t *cfg, int cfg_valid, uint32_t reset_magic, int (*slot_ok)(void *v, slot_id_t s), void *v);` — pure; mutates `*cfg` (active_slot / trial_count / slot state); sets `cfg_dirty=1` when it changed `*cfg`. The `slot_ok` oracle wraps `bootcfg_slot_crc_ok(fl, cfg, s)` on-target and is faked in tests. The caller (bootloader) must `bootcfg_save()` when `cfg_dirty` before jumping/entering.

Decision algorithm (implement exactly):
1. `reset_magic == BOOT_MAGIC_ENTER` → `{ENTER_UPDATE, _, dirty=0}` (host-requested; the caller clears the magic word regardless).
2. `!cfg_valid` → `{ENTER_UPDATE, _, 0}` (fresh/corrupt config = safe recovery).
3. `active = cfg->active_slot`. If `cfg->slot[active].state == TRIAL`: `cfg->trial_count++`, `dirty=1`; if `cfg->trial_count > TRIAL_BOOT_LIMIT` then revert: `cfg->slot[active].state = BAD`; if the other slot is `COMMITTED` and `slot_ok(other)` → `cfg->active_slot = other`, `active = other`; else return `{ENTER_UPDATE, _, dirty=1}`.
4. If `cfg->slot[active].state != BAD` and `slot_ok(active)` → `{JUMP_SLOT, active, dirty}`.
5. Else try `other = 1-active`: if `cfg->slot[other].state != BAD` and `slot_ok(other)` → `cfg->active_slot = other`, `dirty=1`, `{JUMP_SLOT, other, dirty}`.
6. Else `{ENTER_UPDATE, _, dirty}` (both invalid).

- [ ] **Step 1: Write the failing test**

Create `Tests/test_boot_decision.c`:
```c
#include "unity.h"
#include "boot_decision.h"
#include <string.h>

/* Fake slot oracle: bit0 = slot A ok, bit1 = slot B ok. */
static int g_ok_mask;
static int fake_ok(void *v, slot_id_t s) { (void)v; return (g_ok_mask >> (int)s) & 1; }

static bootcfg_t base_cfg(void) {
    bootcfg_t c; memset(&c, 0, sizeof c);
    c.magic = BOOTCFG_MAGIC; c.version = BOOTCFG_VERSION; c.active_slot = SLOT_A;
    c.slot[SLOT_A].state = SLOT_STATE_COMMITTED; c.slot[SLOT_A].length = 100; c.slot[SLOT_A].crc32 = 1;
    c.slot[SLOT_B].state = SLOT_STATE_BAD;
    return c;
}
void setUp(void) { g_ok_mask = 0x1; }
void tearDown(void) {}

void test_enter_magic_wins(void) {
    bootcfg_t c = base_cfg();
    boot_decision_t d = boot_decide(&c, 1, BOOT_MAGIC_ENTER, fake_ok, 0);
    TEST_ASSERT_EQUAL_INT(BOOT_ACTION_ENTER_UPDATE, d.action);
    TEST_ASSERT_EQUAL_INT(0, d.cfg_dirty);
}
void test_invalid_cfg_recovers(void) {
    bootcfg_t c = base_cfg();
    boot_decision_t d = boot_decide(&c, 0, 0, fake_ok, 0);
    TEST_ASSERT_EQUAL_INT(BOOT_ACTION_ENTER_UPDATE, d.action);
}
void test_normal_boot_active(void) {
    bootcfg_t c = base_cfg();
    boot_decision_t d = boot_decide(&c, 1, 0, fake_ok, 0);
    TEST_ASSERT_EQUAL_INT(BOOT_ACTION_JUMP_SLOT, d.action);
    TEST_ASSERT_EQUAL_INT(SLOT_A, d.slot);
}
void test_active_bad_falls_to_other(void) {
    bootcfg_t c = base_cfg();
    c.slot[SLOT_B].state = SLOT_STATE_COMMITTED; c.slot[SLOT_B].length = 100; c.slot[SLOT_B].crc32 = 2;
    g_ok_mask = 0x2;                              /* only B ok */
    boot_decision_t d = boot_decide(&c, 1, 0, fake_ok, 0);
    TEST_ASSERT_EQUAL_INT(BOOT_ACTION_JUMP_SLOT, d.action);
    TEST_ASSERT_EQUAL_INT(SLOT_B, d.slot);
    TEST_ASSERT_EQUAL_INT(1, d.cfg_dirty);
    TEST_ASSERT_EQUAL_UINT16(SLOT_B, c.active_slot);
}
void test_trial_increments_and_boots(void) {
    bootcfg_t c = base_cfg();
    c.slot[SLOT_A].state = SLOT_STATE_TRIAL; c.trial_count = 0;
    boot_decision_t d = boot_decide(&c, 1, 0, fake_ok, 0);
    TEST_ASSERT_EQUAL_INT(BOOT_ACTION_JUMP_SLOT, d.action);
    TEST_ASSERT_EQUAL_UINT16(1, c.trial_count);
    TEST_ASSERT_EQUAL_INT(1, d.cfg_dirty);
}
void test_trial_exceeds_limit_reverts_to_committed_other(void) {
    bootcfg_t c = base_cfg();
    c.slot[SLOT_A].state = SLOT_STATE_TRIAL; c.trial_count = TRIAL_BOOT_LIMIT; /* this boot pushes it over */
    c.slot[SLOT_B].state = SLOT_STATE_COMMITTED; c.slot[SLOT_B].length = 100; c.slot[SLOT_B].crc32 = 2;
    g_ok_mask = 0x3;
    boot_decision_t d = boot_decide(&c, 1, 0, fake_ok, 0);
    TEST_ASSERT_EQUAL_INT(BOOT_ACTION_JUMP_SLOT, d.action);
    TEST_ASSERT_EQUAL_INT(SLOT_B, d.slot);
    TEST_ASSERT_EQUAL_UINT8(SLOT_STATE_BAD, c.slot[SLOT_A].state);
}
void test_trial_exceeds_no_fallback_recovers(void) {
    bootcfg_t c = base_cfg();
    c.slot[SLOT_A].state = SLOT_STATE_TRIAL; c.trial_count = TRIAL_BOOT_LIMIT;
    c.slot[SLOT_B].state = SLOT_STATE_BAD;
    boot_decision_t d = boot_decide(&c, 1, 0, fake_ok, 0);
    TEST_ASSERT_EQUAL_INT(BOOT_ACTION_ENTER_UPDATE, d.action);
    TEST_ASSERT_EQUAL_UINT8(SLOT_STATE_BAD, c.slot[SLOT_A].state);
}
void test_both_invalid_recovers(void) {
    bootcfg_t c = base_cfg(); g_ok_mask = 0x0;
    boot_decision_t d = boot_decide(&c, 1, 0, fake_ok, 0);
    TEST_ASSERT_EQUAL_INT(BOOT_ACTION_ENTER_UPDATE, d.action);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_enter_magic_wins); RUN_TEST(test_invalid_cfg_recovers);
    RUN_TEST(test_normal_boot_active); RUN_TEST(test_active_bad_falls_to_other);
    RUN_TEST(test_trial_increments_and_boots); RUN_TEST(test_trial_exceeds_limit_reverts_to_committed_other);
    RUN_TEST(test_trial_exceeds_no_fallback_recovers); RUN_TEST(test_both_invalid_recovers);
    return UNITY_END();
}
```

Add to `Tests/CMakeLists.txt`:
```cmake
add_unity_test(test_boot_decision test_boot_decision.c ../App/services/boot_decision.c)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cmake -S Tests -B Tests/build && cmake --build Tests/build -j && ctest --test-dir Tests/build -R test_boot_decision --output-on-failure`
Expected: FAIL — `boot_decision.*` do not exist.

- [ ] **Step 3: Write minimal implementation**

Create `App/services/boot_decision.h`:
```c
#ifndef BOOT_DECISION_H
#define BOOT_DECISION_H
#include <stdint.h>
#include "bootcfg.h"

#define BOOT_MAGIC_ENTER  0xB00710ADu
#define TRIAL_BOOT_LIMIT  3u

typedef enum { BOOT_ACTION_ENTER_UPDATE = 0, BOOT_ACTION_JUMP_SLOT = 1 } boot_action_t;
typedef struct { boot_action_t action; slot_id_t slot; int cfg_dirty; } boot_decision_t;

boot_decision_t boot_decide(bootcfg_t *cfg, int cfg_valid, uint32_t reset_magic,
                            int (*slot_ok)(void *v, slot_id_t s), void *v);
#endif
```

Create `App/services/boot_decision.c`:
```c
#include "boot_decision.h"

static boot_decision_t jump(slot_id_t s, int dirty) {
    boot_decision_t d = { BOOT_ACTION_JUMP_SLOT, s, dirty }; return d;
}
static boot_decision_t update(int dirty) {
    boot_decision_t d = { BOOT_ACTION_ENTER_UPDATE, SLOT_A, dirty }; return d;
}

boot_decision_t boot_decide(bootcfg_t *cfg, int cfg_valid, uint32_t reset_magic,
                            int (*slot_ok)(void *v, slot_id_t s), void *v) {
    if (reset_magic == BOOT_MAGIC_ENTER) return update(0);
    if (!cfg_valid) return update(0);

    int dirty = 0;
    slot_id_t active = (slot_id_t)cfg->active_slot;
    slot_id_t other  = (active == SLOT_A) ? SLOT_B : SLOT_A;

    if (cfg->slot[active].state == SLOT_STATE_TRIAL) {
        cfg->trial_count++; dirty = 1;
        if (cfg->trial_count > TRIAL_BOOT_LIMIT) {
            cfg->slot[active].state = SLOT_STATE_BAD;
            if (cfg->slot[other].state == SLOT_STATE_COMMITTED && slot_ok(v, other)) {
                cfg->active_slot = (uint16_t)other; active = other;
                other = (active == SLOT_A) ? SLOT_B : SLOT_A;
            } else {
                return update(1);
            }
        }
    }

    if (cfg->slot[active].state != SLOT_STATE_BAD && slot_ok(v, active))
        return jump(active, dirty);

    if (cfg->slot[other].state != SLOT_STATE_BAD && slot_ok(v, other)) {
        cfg->active_slot = (uint16_t)other; dirty = 1;
        return jump(other, dirty);
    }
    return update(dirty);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ctest --test-dir Tests/build -R test_boot_decision --output-on-failure`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add App/services/boot_decision.h App/services/boot_decision.c Tests/test_boot_decision.c Tests/CMakeLists.txt
git commit -m "feat(boot): A/B boot-decision state machine (trial/revert/recovery)"
```

---

## Phase 2 — Update-mode transfer protocol (the wire contract with the agent)

### Task 5: FC 0x41 / 0x42 parse + build helpers

**Files:**
- Create: `App/services/bl_proto.h`, `App/services/bl_proto.c`
- Test: `Tests/test_bl_proto.c`
- Modify: `Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `modbus_crc16` (existing), `modbus_defs.h` field offsets (existing).
- Produces (the frozen wire constants + pure codec):
  - `#define BL_FC_CONTROL 0x41u`, `#define BL_FC_DATA 0x42u`
  - `bl_sub_t { BL_SUB_INFO=0x01, BL_SUB_ERASE=0x02, BL_SUB_VERIFY=0x03, BL_SUB_COMMIT=0x04, BL_SUB_ABORT=0x05, BL_SUB_STATUS=0x06 }`
  - `#define BL_CHUNK_MAX 240u` (data bytes per 0x42; multiple of 8)
  - `bl_info_t { uint8_t bl_version; uint8_t inactive_slot; uint32_t slot_size; uint16_t chunk_max; uint8_t crc_algo; }` (`crc_algo` = 1 for CRC32)
  - Parsers over the *PDU without CRC* (caller validated CRC via `mb_check_frame`): `int bl_parse_control(const uint8_t*req,uint16_t len,bl_sub_t*sub,uint32_t*a,uint32_t*b);` (for VERIFY, `a=length,b=crc32`), `int bl_parse_data(const uint8_t*req,uint16_t len,uint32_t*off,const uint8_t**data,uint16_t*dlen);`
  - Builders that write the response body (no CRC; caller appends CRC16 exactly like `mb_engine`'s `finalize`): `uint16_t bl_build_info(uint8_t*resp,const bl_info_t*i);`, `uint16_t bl_build_ack(uint8_t*resp,uint8_t fc,bl_sub_t sub);`, `uint16_t bl_build_nak(uint8_t*resp,uint8_t fc,uint8_t err);`, `uint16_t bl_build_data_ack(uint8_t*resp,uint32_t off);`
  - `#define BL_ERR_STATE 1`, `BL_ERR_RANGE 2`, `BL_ERR_CRC 3`, `BL_ERR_FLASH 4`

Wire framing (freeze this — sub-project #2 depends on it):
- `0x41 INFO` req: `[1][0x41][0x01][crc16]`. resp: `[1][0x41][0x01][bl_version][inactive_slot][slot_size:4 BE][chunk_max:2 BE][crc_algo][crc16]`.
- `0x41 ERASE` req: `[1][0x41][0x02][crc16]`. resp ACK: `[1][0x41][0x02][0x00][crc16]` (0x00 = OK). NAK: `[1][0xC1][err][crc16]` (0xC1 = 0x41|0x80).
- `0x41 VERIFY` req: `[1][0x41][0x03][length:4 BE][crc32:4 BE][crc16]`. resp ACK/NAK as ERASE.
- `0x41 COMMIT` req: `[1][0x41][0x04][crc16]`. resp ACK first, THEN reset (bootloader replies, drains TX, then `NVIC_SystemReset`).
- `0x41 ABORT` req: `[1][0x41][0x05][crc16]`. resp ACK.
- `0x41 STATUS` req: `[1][0x41][0x06][crc16]`. resp: `[1][0x41][0x06][state:1][high_water:4 BE][crc16]`.
- `0x42 DATA` req: `[1][0x42][offset:4 BE][len:1][data:len][crc16]`. resp ACK: `[1][0x42][offset:4 BE][crc16]`. NAK: `[1][0xC2][err][crc16]`.

- [ ] **Step 1: Write the failing test**

Create `Tests/test_bl_proto.c`:
```c
#include "unity.h"
#include "bl_proto.h"
#include <string.h>

void setUp(void) {} void tearDown(void) {}

void test_parse_control_info(void) {
    uint8_t req[] = {1, BL_FC_CONTROL, BL_SUB_INFO};   /* CRC stripped by caller */
    bl_sub_t sub; uint32_t a, b;
    TEST_ASSERT_EQUAL_INT(0, bl_parse_control(req, sizeof req, &sub, &a, &b));
    TEST_ASSERT_EQUAL_INT(BL_SUB_INFO, sub);
}
void test_parse_control_verify_fields(void) {
    uint8_t req[] = {1, BL_FC_CONTROL, BL_SUB_VERIFY, 0,0,0x01,0x00, 0xDE,0xAD,0xBE,0xEF};
    bl_sub_t sub; uint32_t len, crc;
    TEST_ASSERT_EQUAL_INT(0, bl_parse_control(req, sizeof req, &sub, &len, &crc));
    TEST_ASSERT_EQUAL_INT(BL_SUB_VERIFY, sub);
    TEST_ASSERT_EQUAL_UINT32(0x00000100u, len);
    TEST_ASSERT_EQUAL_HEX32(0xDEADBEEFu, crc);
}
void test_parse_data(void) {
    uint8_t req[3 + 4 + 1 + 4];
    req[0]=1; req[1]=BL_FC_DATA;
    req[2]=0;req[3]=0;req[4]=0x10;req[5]=0x00;   /* offset 0x1000 BE */
    req[6]=4;                                    /* len */
    req[7]=0xA;req[8]=0xB;req[9]=0xC;req[10]=0xD;
    uint32_t off; const uint8_t *d; uint16_t dl;
    TEST_ASSERT_EQUAL_INT(0, bl_parse_data(req, sizeof req, &off, &d, &dl));
    TEST_ASSERT_EQUAL_UINT32(0x1000u, off);
    TEST_ASSERT_EQUAL_UINT16(4, dl);
    TEST_ASSERT_EQUAL_HEX8(0xA, d[0]); TEST_ASSERT_EQUAL_HEX8(0xD, d[3]);
}
void test_parse_data_len_overflow_rejected(void) {
    uint8_t req[3+4+1+2]; req[0]=1; req[1]=BL_FC_DATA;
    req[2]=req[3]=req[4]=req[5]=0; req[6]=10;    /* claims 10 but only 2 present */
    uint32_t off; const uint8_t *d; uint16_t dl;
    TEST_ASSERT_NOT_EQUAL(0, bl_parse_data(req, sizeof req, &off, &d, &dl));
}
void test_build_info(void) {
    bl_info_t i = { 1, SLOT_B_INACTIVE_EXAMPLE, 0x38000u, BL_CHUNK_MAX, 1 };
    uint8_t resp[32];
    uint16_t n = bl_build_info(resp, &i);
    TEST_ASSERT_EQUAL_UINT16(11, n);             /* addr,fc,sub, ver, slot, size4, chunk2, algo */
    TEST_ASSERT_EQUAL_HEX8(1, resp[0]); TEST_ASSERT_EQUAL_HEX8(BL_FC_CONTROL, resp[1]);
    TEST_ASSERT_EQUAL_HEX8(BL_SUB_INFO, resp[2]);
    TEST_ASSERT_EQUAL_HEX8(0x00, resp[5]); TEST_ASSERT_EQUAL_HEX8(0x03, resp[6]);
    TEST_ASSERT_EQUAL_HEX8(0x80, resp[7]); TEST_ASSERT_EQUAL_HEX8(0x00, resp[8]); /* 0x38000 BE */
}
void test_build_data_ack(void) {
    uint8_t resp[16];
    uint16_t n = bl_build_data_ack(resp, 0x1234u);
    TEST_ASSERT_EQUAL_UINT16(6, n);
    TEST_ASSERT_EQUAL_HEX8(BL_FC_DATA, resp[1]);
    TEST_ASSERT_EQUAL_HEX8(0x12, resp[4]); TEST_ASSERT_EQUAL_HEX8(0x34, resp[5]);
}
void test_build_nak(void) {
    uint8_t resp[8]; uint16_t n = bl_build_nak(resp, BL_FC_DATA, BL_ERR_CRC);
    TEST_ASSERT_EQUAL_UINT16(3, n);
    TEST_ASSERT_EQUAL_HEX8(0xC2, resp[1]); TEST_ASSERT_EQUAL_HEX8(BL_ERR_CRC, resp[2]);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_parse_control_info); RUN_TEST(test_parse_control_verify_fields);
    RUN_TEST(test_parse_data); RUN_TEST(test_parse_data_len_overflow_rejected);
    RUN_TEST(test_build_info); RUN_TEST(test_build_data_ack); RUN_TEST(test_build_nak);
    return UNITY_END();
}
```

(Replace `SLOT_B_INACTIVE_EXAMPLE` with the literal `1` — it is just the `inactive_slot` byte value in the info struct.)

Add to `Tests/CMakeLists.txt`:
```cmake
add_unity_test(test_bl_proto test_bl_proto.c ../App/services/bl_proto.c)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cmake -S Tests -B Tests/build && cmake --build Tests/build -j && ctest --test-dir Tests/build -R test_bl_proto --output-on-failure`
Expected: FAIL — `bl_proto.*` do not exist.

- [ ] **Step 3: Write minimal implementation**

Create `App/services/bl_proto.h`:
```c
#ifndef BL_PROTO_H
#define BL_PROTO_H
#include <stdint.h>

#define BL_FC_CONTROL 0x41u
#define BL_FC_DATA    0x42u
#define BL_CHUNK_MAX  240u   /* data bytes per 0x42 chunk (multiple of 8) */

typedef enum {
    BL_SUB_INFO = 0x01u, BL_SUB_ERASE = 0x02u, BL_SUB_VERIFY = 0x03u,
    BL_SUB_COMMIT = 0x04u, BL_SUB_ABORT = 0x05u, BL_SUB_STATUS = 0x06u
} bl_sub_t;

#define BL_ERR_STATE 1u
#define BL_ERR_RANGE 2u
#define BL_ERR_CRC   3u
#define BL_ERR_FLASH 4u

typedef struct {
    uint8_t  bl_version;
    uint8_t  inactive_slot;
    uint32_t slot_size;
    uint16_t chunk_max;
    uint8_t  crc_algo;      /* 1 = CRC32/IEEE */
} bl_info_t;

int bl_parse_control(const uint8_t *req, uint16_t len, bl_sub_t *sub, uint32_t *a, uint32_t *b);
int bl_parse_data(const uint8_t *req, uint16_t len, uint32_t *off, const uint8_t **data, uint16_t *dlen);

uint16_t bl_build_info(uint8_t *resp, const bl_info_t *i);
uint16_t bl_build_ack(uint8_t *resp, uint8_t fc, bl_sub_t sub);
uint16_t bl_build_status(uint8_t *resp, uint8_t state, uint32_t high_water);
uint16_t bl_build_data_ack(uint8_t *resp, uint32_t off);
uint16_t bl_build_nak(uint8_t *resp, uint8_t fc, uint8_t err);
#endif
```

Create `App/services/bl_proto.c`:
```c
#include "bl_proto.h"

#define ADDR 1u
static void be32(uint8_t *p, uint32_t v){ p[0]=(uint8_t)(v>>24);p[1]=(uint8_t)(v>>16);p[2]=(uint8_t)(v>>8);p[3]=(uint8_t)v; }
static uint32_t rd32(const uint8_t *p){ return ((uint32_t)p[0]<<24)|((uint32_t)p[1]<<16)|((uint32_t)p[2]<<8)|p[3]; }

int bl_parse_control(const uint8_t *req, uint16_t len, bl_sub_t *sub, uint32_t *a, uint32_t *b) {
    if (len < 3u || req[1] != BL_FC_CONTROL) return -1;
    *sub = (bl_sub_t)req[2]; *a = 0; *b = 0;
    if (*sub == BL_SUB_VERIFY) {
        if (len < 3u + 8u) return -1;
        *a = rd32(&req[3]); *b = rd32(&req[7]);
    }
    return 0;
}

int bl_parse_data(const uint8_t *req, uint16_t len, uint32_t *off, const uint8_t **data, uint16_t *dlen) {
    if (len < 7u || req[1] != BL_FC_DATA) return -1;
    *off = rd32(&req[2]);
    uint16_t n = req[6];
    if (n == 0u || n > BL_CHUNK_MAX) return -1;
    if ((uint32_t)7u + n > len) return -1;           /* claimed len must fit */
    *data = &req[7]; *dlen = n;
    return 0;
}

uint16_t bl_build_info(uint8_t *r, const bl_info_t *i) {
    r[0]=ADDR; r[1]=BL_FC_CONTROL; r[2]=BL_SUB_INFO;
    r[3]=i->bl_version; r[4]=i->inactive_slot;
    be32(&r[5], i->slot_size);
    r[9]=(uint8_t)(i->chunk_max>>8); r[10]=(uint8_t)i->chunk_max;
    r[11]=i->crc_algo;
    return 12u; /* NOTE: 12 bytes body; test expects addr..algo — see step 4 reconcile */
}
uint16_t bl_build_ack(uint8_t *r, uint8_t fc, bl_sub_t sub) {
    r[0]=ADDR; r[1]=fc; r[2]=(uint8_t)sub; r[3]=0x00u; return 4u;
}
uint16_t bl_build_status(uint8_t *r, uint8_t state, uint32_t hw) {
    r[0]=ADDR; r[1]=BL_FC_CONTROL; r[2]=BL_SUB_STATUS; r[3]=state; be32(&r[4], hw); return 8u;
}
uint16_t bl_build_data_ack(uint8_t *r, uint32_t off) {
    r[0]=ADDR; r[1]=BL_FC_DATA; be32(&r[2], off); return 6u;
}
uint16_t bl_build_nak(uint8_t *r, uint8_t fc, uint8_t err) {
    r[0]=ADDR; r[1]=(uint8_t)(fc | 0x80u); r[2]=err; return 3u;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ctest --test-dir Tests/build -R test_bl_proto --output-on-failure`
Expected: PASS. **Reconcile the info-body length:** the test asserts `n == 11` with `crc_algo` at `resp[10]` (0-based bytes 0..10), i.e. an 11-byte body. Adjust `bl_build_info` to lay out `[addr][fc][sub][ver][slot][size:4][chunk:2][algo]` = 3 header + 1 + 1 + 4 + ... that is 12 bytes if chunk is 2 bytes. Choose ONE and make test + impl agree: use an 11-byte body by dropping the separate `sub` echo is not desirable. **Resolution:** keep `sub` echo; make the info body `[addr][fc][sub][ver][slot][size:4][chunk:2][algo]` = 12 bytes and set the test's expected `n` to `12`, with `algo` at `resp[11]` and the `0x38000` size bytes at `resp[5..8]` (`0x00,0x03,0x80,0x00`). Update `test_build_info` accordingly, re-run, expect PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add App/services/bl_proto.h App/services/bl_proto.c Tests/test_bl_proto.c Tests/CMakeLists.txt
git commit -m "feat(bl-proto): freeze FC 0x41/0x42 firmware-transfer wire format + codec"
```

---

### Task 6: Update-mode session state machine

**Files:**
- Create: `App/services/bl_session.h`, `App/services/bl_session.c`
- Test: `Tests/test_bl_session.c`
- Modify: `Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `bl_proto`, `iflash_backend_t`, `bootcfg` (`bootcfg_slot_base`, `bootcfg_save`, states), `crc32`.
- Produces:
  - `bl_state_t { BL_ST_IDLE, BL_ST_ERASED, BL_ST_VERIFIED, BL_ST_COMMITTING, BL_ST_ERROR }`
  - `bl_session_t { const iflash_backend_t *fl; bootcfg_t *cfg; slot_id_t target; uint32_t target_base; uint32_t slot_size; uint32_t expected_len; uint32_t expected_crc; uint32_t high_water; bl_state_t state; int want_reset; }`
  - `void bl_session_init(bl_session_t *s, const iflash_backend_t *fl, bootcfg_t *cfg);` — picks `target` = the slot that is NOT `cfg->active_slot` (or SLOT_A if cfg invalid), sets `target_base`, `slot_size=SLOT_SIZE`, `state=BL_ST_IDLE`.
  - `uint16_t bl_session_process(bl_session_t *s, const uint8_t *req, uint16_t req_len, uint8_t *resp);` — dispatches one PDU (CRC already validated by the UART layer), performs flash side effects, returns response **body** length (caller appends CRC16). Sets `s->want_reset=1` after a COMMIT response is built.

Behavior (implement exactly):
- `INFO` (any state) → `bl_build_info` with `{bl_version=1, inactive_slot=target, slot_size, chunk_max=BL_CHUNK_MAX, crc_algo=1}`.
- `ERASE` → erase all pages of `target` (16..127 for A, 128..239 for B) via `fl->erase_page`; on any failure → NAK `BL_ERR_FLASH`, state `ERROR`; else `high_water=0`, state `ERASED`, ACK.
- `DATA` → require state `ERASED` (else NAK `BL_ERR_STATE`); require `offset+dlen <= slot_size` and `offset` 8-aligned (else NAK `BL_ERR_RANGE`); program a dword-padded copy (`0xFF` tail) at `target_base+offset`; on failure NAK `BL_ERR_FLASH`; update `high_water=max(high_water,offset+dlen)`; ACK with `offset`.
- `VERIFY {len,crc}` → require state `ERASED` and `len<=slot_size` (else NAK); CRC32 over `[target_base..+len)`; if match set `expected_len=len`, `expected_crc=crc`, state `VERIFIED`, ACK; else NAK `BL_ERR_CRC`.
- `COMMIT` → require state `VERIFIED` (else NAK `BL_ERR_STATE`); set `cfg->slot[target] = {TRIAL, expected_len, expected_crc}`, `cfg->active_slot=target`, `cfg->trial_count=0`; `bootcfg_save(fl,cfg)`; on save failure NAK `BL_ERR_FLASH`; else ACK, `state=COMMITTING`, `want_reset=1`.
- `ABORT` → state `IDLE` (leave cfg untouched); ACK.
- `STATUS` → `bl_build_status(state, high_water)`.

- [ ] **Step 1: Write the failing test**

Create `Tests/test_bl_session.c` (drives a full happy path + the failure branches against `fake_iflash`):
```c
#include "unity.h"
#include "bl_session.h"
#include "bl_proto.h"
#include "bootcfg.h"
#include "crc32.h"
#include "fake_iflash.h"
#include <string.h>

static const iflash_backend_t *FL;
static bootcfg_t CFG;
static bl_session_t S;

static void seed_cfg_active_A(void) {
    memset(&CFG,0,sizeof CFG); CFG.magic=BOOTCFG_MAGIC; CFG.version=BOOTCFG_VERSION;
    CFG.active_slot=SLOT_A; CFG.slot[SLOT_A].state=SLOT_STATE_COMMITTED;
    CFG.slot[SLOT_A].length=8; CFG.slot[SLOT_A].crc32=crc32_compute(fake_iflash_ptr(SLOT_A_BASE),8);
}
void setUp(void){ fake_iflash_reset(); FL=fake_iflash_backend(); seed_cfg_active_A();
                  bl_session_init(&S, FL, &CFG); }
void tearDown(void){}

static uint16_t call(const uint8_t *req, uint16_t n, uint8_t *resp){ return bl_session_process(&S,req,n,resp); }

void test_target_is_inactive_slot(void){ TEST_ASSERT_EQUAL_INT(SLOT_B, S.target);
    TEST_ASSERT_EQUAL_UINT32(SLOT_B_BASE, S.target_base); }

void test_info(void){
    uint8_t req[]={1,BL_FC_CONTROL,BL_SUB_INFO}; uint8_t r[32];
    uint16_t n=call(req,sizeof req,r);
    TEST_ASSERT_EQUAL_HEX8(BL_SUB_INFO,r[2]); TEST_ASSERT_EQUAL_HEX8(SLOT_B,r[4]);
    TEST_ASSERT_GREATER_THAN_UINT16(0,n);
}
void test_data_before_erase_naks(void){
    uint8_t req[7+8]={1,BL_FC_DATA,0,0,0,0,8}; uint8_t r[16];
    call((uint8_t[]){1,BL_FC_DATA,0,0,0,0,8, 1,2,3,4,5,6,7,8}, 15, r);
    /* simpler: build inline */
    uint8_t d[15]={1,BL_FC_DATA,0,0,0,0,8, 1,2,3,4,5,6,7,8};
    uint16_t n=call(d,sizeof d,r);
    TEST_ASSERT_EQUAL_HEX8(0xC2,r[1]); TEST_ASSERT_EQUAL_HEX8(BL_ERR_STATE,r[2]); (void)n;(void)req;
}
void test_happy_path_erase_write_verify_commit(void){
    uint8_t r[64];
    /* ERASE */
    uint8_t er[]={1,BL_FC_CONTROL,BL_SUB_ERASE}; call(er,sizeof er,r);
    TEST_ASSERT_EQUAL_HEX8(0x00,r[3]);  /* ACK */
    TEST_ASSERT_EQUAL_INT(BL_ST_ERASED,S.state);
    /* WRITE 16 bytes at offset 0 */
    uint8_t payload[16]; for(int i=0;i<16;i++) payload[i]=(uint8_t)(i+1);
    uint8_t d[7+16]; d[0]=1;d[1]=BL_FC_DATA;d[2]=d[3]=d[4]=d[5]=0;d[6]=16; memcpy(&d[7],payload,16);
    call(d,sizeof d,r);
    TEST_ASSERT_EQUAL_HEX8(BL_FC_DATA,r[1]); /* data-ack echoes offset 0 */
    TEST_ASSERT_EQUAL_MEMORY(payload, fake_iflash_ptr(SLOT_B_BASE), 16);
    /* VERIFY */
    uint32_t crc=crc32_compute(payload,16);
    uint8_t v[3+8]={1,BL_FC_CONTROL,BL_SUB_VERIFY, 0,0,0,16, (uint8_t)(crc>>24),(uint8_t)(crc>>16),(uint8_t)(crc>>8),(uint8_t)crc};
    call(v,sizeof v,r);
    TEST_ASSERT_EQUAL_HEX8(0x00,r[3]); TEST_ASSERT_EQUAL_INT(BL_ST_VERIFIED,S.state);
    /* COMMIT */
    uint8_t c[]={1,BL_FC_CONTROL,BL_SUB_COMMIT}; call(c,sizeof c,r);
    TEST_ASSERT_EQUAL_HEX8(0x00,r[3]);
    TEST_ASSERT_EQUAL_INT(1,S.want_reset);
    bootcfg_t after; bootcfg_load(FL,&after);
    TEST_ASSERT_EQUAL_UINT16(SLOT_B, after.active_slot);
    TEST_ASSERT_EQUAL_UINT8(SLOT_STATE_TRIAL, after.slot[SLOT_B].state);
    TEST_ASSERT_EQUAL_UINT32(16u, after.slot[SLOT_B].length);
}
void test_verify_bad_crc_naks(void){
    uint8_t r[64];
    uint8_t er[]={1,BL_FC_CONTROL,BL_SUB_ERASE}; call(er,sizeof er,r);
    uint8_t v[3+8]={1,BL_FC_CONTROL,BL_SUB_VERIFY, 0,0,0,8, 0,0,0,0}; /* wrong crc for 8 x 0xFF */
    call(v,sizeof v,r);
    TEST_ASSERT_EQUAL_HEX8(0xC1,r[1]); TEST_ASSERT_EQUAL_HEX8(BL_ERR_CRC,r[2]);
}
void test_erase_flash_fault_naks(void){
    uint8_t r[16]; fake_iflash_fail_next_erase();
    uint8_t er[]={1,BL_FC_CONTROL,BL_SUB_ERASE}; call(er,sizeof er,r);
    TEST_ASSERT_EQUAL_HEX8(0xC1,r[1]); TEST_ASSERT_EQUAL_HEX8(BL_ERR_FLASH,r[2]);
}

int main(void){
    UNITY_BEGIN();
    RUN_TEST(test_target_is_inactive_slot); RUN_TEST(test_info);
    RUN_TEST(test_data_before_erase_naks); RUN_TEST(test_happy_path_erase_write_verify_commit);
    RUN_TEST(test_verify_bad_crc_naks); RUN_TEST(test_erase_flash_fault_naks);
    return UNITY_END();
}
```

(Clean up `test_data_before_erase_naks` to only build the inline 15-byte frame; remove the stray first `call`.)

Add to `Tests/CMakeLists.txt`:
```cmake
add_unity_test(test_bl_session test_bl_session.c ../App/services/bl_session.c ../App/services/bl_proto.c ../App/services/bootcfg.c ../App/services/crc32.c fakes/fake_iflash.c)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cmake -S Tests -B Tests/build && cmake --build Tests/build -j && ctest --test-dir Tests/build -R test_bl_session --output-on-failure`
Expected: FAIL — `bl_session.*` do not exist.

- [ ] **Step 3: Write minimal implementation**

Create `App/services/bl_session.h`:
```c
#ifndef BL_SESSION_H
#define BL_SESSION_H
#include <stdint.h>
#include "iflash_backend.h"
#include "bootcfg.h"

typedef enum { BL_ST_IDLE, BL_ST_ERASED, BL_ST_VERIFIED, BL_ST_COMMITTING, BL_ST_ERROR } bl_state_t;

typedef struct {
    const iflash_backend_t *fl;
    bootcfg_t *cfg;
    slot_id_t  target;
    uint32_t   target_base;
    uint32_t   slot_size;
    uint32_t   expected_len;
    uint32_t   expected_crc;
    uint32_t   high_water;
    bl_state_t state;
    int        want_reset;
} bl_session_t;

void bl_session_init(bl_session_t *s, const iflash_backend_t *fl, bootcfg_t *cfg);
uint16_t bl_session_process(bl_session_t *s, const uint8_t *req, uint16_t req_len, uint8_t *resp);
#endif
```

Create `App/services/bl_session.c`:
```c
#include "bl_session.h"
#include "bl_proto.h"
#include "crc32.h"

#define PAGE_SIZE 2048u

void bl_session_init(bl_session_t *s, const iflash_backend_t *fl, bootcfg_t *cfg) {
    s->fl = fl; s->cfg = cfg;
    s->target = (cfg->active_slot == SLOT_A) ? SLOT_B : SLOT_A;
    s->target_base = bootcfg_slot_base(s->target);
    s->slot_size = SLOT_SIZE;
    s->expected_len = s->expected_crc = s->high_water = 0;
    s->state = BL_ST_IDLE; s->want_reset = 0;
}

static uint16_t erase_target(bl_session_t *s, uint8_t *resp) {
    uint32_t first = (s->target == SLOT_A) ? 16u : 128u;
    uint32_t pages = SLOT_SIZE / PAGE_SIZE;               /* 112 */
    for (uint32_t p = 0; p < pages; p++) {
        if (s->fl->erase_page(s->fl->ctx, first + p) != 0) {
            s->state = BL_ST_ERROR;
            return bl_build_nak(resp, BL_FC_CONTROL, BL_ERR_FLASH);
        }
        /* on-target: IWDG refresh happens inside the RAM-resident driver per page */
    }
    s->high_water = 0; s->state = BL_ST_ERASED;
    return bl_build_ack(resp, BL_FC_CONTROL, BL_SUB_ERASE);
}

static uint16_t handle_data(bl_session_t *s, const uint8_t *req, uint16_t len, uint8_t *resp) {
    if (s->state != BL_ST_ERASED) return bl_build_nak(resp, BL_FC_DATA, BL_ERR_STATE);
    uint32_t off; const uint8_t *d; uint16_t dl;
    if (bl_parse_data(req, len, &off, &d, &dl) != 0) return bl_build_nak(resp, BL_FC_DATA, BL_ERR_RANGE);
    if ((off & 7u) != 0u || (uint32_t)off + dl > s->slot_size) return bl_build_nak(resp, BL_FC_DATA, BL_ERR_RANGE);
    uint8_t dw[BL_CHUNK_MAX];
    uint16_t padded = (uint16_t)((dl + 7u) & ~7u);
    for (uint16_t i = 0; i < padded; i++) dw[i] = (i < dl) ? d[i] : 0xFFu;
    if (s->fl->program(s->fl->ctx, s->target_base + off, dw, padded) != 0)
        return bl_build_nak(resp, BL_FC_DATA, BL_ERR_FLASH);
    uint32_t end = off + dl; if (end > s->high_water) s->high_water = end;
    return bl_build_data_ack(resp, off);
}

static uint16_t handle_verify(bl_session_t *s, uint32_t len, uint32_t crc, uint8_t *resp) {
    if (s->state != BL_ST_ERASED || len == 0u || len > s->slot_size)
        return bl_build_nak(resp, BL_FC_CONTROL, BL_ERR_STATE);
    uint32_t c = CRC32_INIT; uint8_t buf[64];
    for (uint32_t o = 0; o < len; o += sizeof buf) {
        uint32_t n = (len - o < sizeof buf) ? (len - o) : sizeof buf;
        if (s->fl->read(s->fl->ctx, s->target_base + o, buf, n) != 0)
            return bl_build_nak(resp, BL_FC_CONTROL, BL_ERR_FLASH);
        c = crc32_update(c, buf, n);
    }
    if ((c ^ 0xFFFFFFFFu) != crc) return bl_build_nak(resp, BL_FC_CONTROL, BL_ERR_CRC);
    s->expected_len = len; s->expected_crc = crc; s->state = BL_ST_VERIFIED;
    return bl_build_ack(resp, BL_FC_CONTROL, BL_SUB_VERIFY);
}

static uint16_t handle_commit(bl_session_t *s, uint8_t *resp) {
    if (s->state != BL_ST_VERIFIED) return bl_build_nak(resp, BL_FC_CONTROL, BL_ERR_STATE);
    s->cfg->slot[s->target].state  = SLOT_STATE_TRIAL;
    s->cfg->slot[s->target].length = s->expected_len;
    s->cfg->slot[s->target].crc32  = s->expected_crc;
    s->cfg->active_slot = (uint16_t)s->target;
    s->cfg->trial_count = 0;
    if (bootcfg_save(s->fl, s->cfg) != 0) return bl_build_nak(resp, BL_FC_CONTROL, BL_ERR_FLASH);
    s->state = BL_ST_COMMITTING; s->want_reset = 1;
    return bl_build_ack(resp, BL_FC_CONTROL, BL_SUB_COMMIT);
}

uint16_t bl_session_process(bl_session_t *s, const uint8_t *req, uint16_t req_len, uint8_t *resp) {
    if (req_len < 2u) return 0;
    if (req[1] == BL_FC_DATA) return handle_data(s, req, req_len, resp);
    if (req[1] == BL_FC_CONTROL) {
        bl_sub_t sub; uint32_t a, b;
        if (bl_parse_control(req, req_len, &sub, &a, &b) != 0)
            return bl_build_nak(resp, BL_FC_CONTROL, BL_ERR_RANGE);
        switch (sub) {
            case BL_SUB_INFO: {
                bl_info_t i = { 1u, (uint8_t)s->target, s->slot_size, BL_CHUNK_MAX, 1u };
                return bl_build_info(resp, &i);
            }
            case BL_SUB_ERASE:  return erase_target(s, resp);
            case BL_SUB_VERIFY: return handle_verify(s, a, b, resp);
            case BL_SUB_COMMIT: return handle_commit(s, resp);
            case BL_SUB_ABORT:  s->state = BL_ST_IDLE; return bl_build_ack(resp, BL_FC_CONTROL, BL_SUB_ABORT);
            case BL_SUB_STATUS: return bl_build_status(resp, (uint8_t)s->state, s->high_water);
            default:            return bl_build_nak(resp, BL_FC_CONTROL, BL_ERR_RANGE);
        }
    }
    return bl_build_nak(resp, req[1], BL_ERR_STATE);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ctest --test-dir Tests/build -R test_bl_session --output-on-failure`
Expected: PASS (6 tests). Then run the **whole** suite to confirm nothing regressed: `ctest --test-dir Tests/build --output-on-failure`.

- [ ] **Step 5: Commit**

```bash
git add App/services/bl_session.h App/services/bl_session.c Tests/test_bl_session.c Tests/CMakeLists.txt
git commit -m "feat(bl-session): update-mode transfer session (erase/write/verify/commit)"
```

---

## Phase 3 — On-target internal-flash driver (bench-verified)

### Task 7: `drv_iflash` — RAM-resident HAL program/erase

**Files:**
- Create: `cube/Core/Src/drv_iflash.c`, `cube/Core/Inc/drv_iflash.h`
- Modify: `cube/STM32G0B1RETX_FLASH.ld` (add `.RamFunc` output section)
- (No host unit test — this is hardware; it is exercised by the Phase 6 bench round-trip and a standalone SWD smoke check below.)

**Interfaces:**
- Produces: `const iflash_backend_t *drv_iflash_backend(void);` implementing `iflash_backend_t` for the real MCU. Program/erase inner functions are placed in RAM via `__attribute__((section(".RamFunc")))`. Consumed by the bootloader (`boot/`) and by the app (boot-config write on confirm).
- Depends on: `HAL_FLASH_Unlock/Lock`, `HAL_FLASHEx_Erase` (`FLASH_TYPEERASE_PAGES`, `Page`, `NbPages=1`), `HAL_FLASH_Program(FLASH_TYPEPROGRAM_DOUBLEWORD, addr, u64)`, `HAL_IWDG_Refresh`.

- [ ] **Step 1: Add the `.RamFunc` section to the app linker script**

In `cube/STM32G0B1RETX_FLASH.ld`, immediately after the `.text` output section (before `.rodata`), add:
```ld
  /* Functions that must execute from RAM during flash program/erase. */
  _siramfunc = LOADADDR(.RamFunc);
  .RamFunc :
  {
    . = ALIGN(4);
    _sramfunc = .;
    *(.RamFunc)
    *(.RamFunc*)
    . = ALIGN(4);
    _eramfunc = .;
  } >RAM AT> FLASH
```
Confirm `startup_stm32g0b1retx.s` copies `.RamFunc` from `_siramfunc` to `_sramfunc.._eramfunc` right where it copies `.data`. The CubeIDE default startup already contains a `.RamFunc` copy loop for STM32G0 (`LoopCopyDataInit` handles `.data`; the G0 startup template also copies `.RamFunc`). If it does NOT, add a copy loop mirroring the `.data` copy using `_siramfunc/_sramfunc/_eramfunc`.

- [ ] **Step 2: Write the header**

Create `cube/Core/Inc/drv_iflash.h`:
```c
#ifndef DRV_IFLASH_H
#define DRV_IFLASH_H
#include "iflash_backend.h"
const iflash_backend_t *drv_iflash_backend(void);
#endif
```

- [ ] **Step 3: Write the driver**

Create `cube/Core/Src/drv_iflash.c`:
```c
#include "drv_iflash.h"
#include "stm32g0xx_hal.h"

#define FL_BASE   0x08000000u
#define FL_PAGE   2048u
#define FL_PAGES  256u

extern IWDG_HandleTypeDef hiwdg;   /* armed by the bootloader/app before flash ops */

/* read is a plain memory-mapped copy (safe from flash). */
static int iflash_read(void *c, uint32_t a, uint8_t *b, uint32_t n) {
    (void)c;
    if (a < FL_BASE || a + n > FL_BASE + FL_PAGES * FL_PAGE) return -1;
    const uint8_t *p = (const uint8_t *)a;
    for (uint32_t i = 0; i < n; i++) b[i] = p[i];
    return 0;
}

/* program: MUST run from RAM (single-bank read-while-write stall). */
__attribute__((section(".RamFunc")))
static int iflash_program(void *c, uint32_t a, const uint8_t *b, uint32_t n) {
    (void)c;
    if ((n & 7u) != 0u || (a & 7u) != 0u) return -1;
    if (a < FL_BASE || a + n > FL_BASE + FL_PAGES * FL_PAGE) return -1;
    HAL_FLASH_Unlock();
    for (uint32_t i = 0; i < n; i += 8u) {
        uint64_t dw = 0;
        for (int k = 0; k < 8; k++) dw |= (uint64_t)b[i + k] << (8 * k);
        if (HAL_FLASH_Program(FLASH_TYPEPROGRAM_DOUBLEWORD, a + i, dw) != HAL_OK) {
            HAL_FLASH_Lock(); return -2;
        }
    }
    HAL_FLASH_Lock();
    return 0;
}

/* erase one page: MUST run from RAM; refresh IWDG so a 112-page slot erase
   (~3 s total) does not trip the ~2 s watchdog between pages. */
__attribute__((section(".RamFunc")))
static int iflash_erase(void *c, uint32_t page) {
    (void)c;
    if (page >= FL_PAGES) return -1;
    HAL_IWDG_Refresh(&hiwdg);
    HAL_FLASH_Unlock();
    FLASH_EraseInitTypeDef e = {0};
    e.TypeErase = FLASH_TYPEERASE_PAGES;
    e.Page = page;
    e.NbPages = 1;
    uint32_t err = 0;
    HAL_StatusTypeDef st = HAL_FLASHEx_Erase(&e, &err);
    HAL_FLASH_Lock();
    return (st == HAL_OK && err == 0xFFFFFFFFu) ? 0 : -2;
}

static const iflash_backend_t s_be = {
    FL_PAGE, FL_PAGES, FL_BASE, iflash_read, iflash_program, iflash_erase, 0
};
const iflash_backend_t *drv_iflash_backend(void) { return &s_be; }
```
Note: `HAL_FLASHEx_Erase` sets `*err = 0xFFFFFFFF` on full success on STM32G0; adjust the success predicate if the local HAL version reports differently (verify against `cube/Drivers/STM32G0xx_HAL_Driver/Src/stm32g0xx_hal_flash_ex.c`).

- [ ] **Step 4: SWD smoke check (bench)**

This driver first runs on target as part of the bootloader (Task 11) and the app confirm (Task 14). For an isolated early check, add a temporary DEBUG-only probe in `app_main()` behind `#ifdef IFLASH_SMOKE` that: erases page 240, programs 8 known bytes at `0x08078000`, reads them back, and lights an LED / sets a Modbus counter on match. Flash via STLINK-V3SET (HDR1), confirm the readback matches, then remove the probe. Expected: programmed bytes read back exactly; no hard-fault; no IWDG reset.

- [ ] **Step 5: Commit**

```bash
git add cube/Core/Src/drv_iflash.c cube/Core/Inc/drv_iflash.h cube/STM32G0B1RETX_FLASH.ld
git commit -m "feat(iflash): on-target RAM-resident internal-flash driver (program/erase)"
```

---

## Phase 4 — Bootloader program (on-target; bench-verified via SWD)

### Task 8: Bootloader build skeleton + linker script

**Files:**
- Create: `boot/Makefile`, `boot/g0b1-boot.ld`, `boot/src/startup_g0b1_boot.s`, `boot/src/system_boot.c`, `boot/src/stm32g0xx_hal_conf.h`
- Create: `cube/Core/Inc/g0b1_slots.h` (shared geometry, referenced by both app + boot)

**Interfaces:**
- Produces: a `make -C boot` that yields `boot/build/g0b1-boot.elf` and `boot/build/g0b1-boot.bin`, linked to `0x08000000`, size ≤ 32 KB, with `.RamFunc` and a `.noinit` word at `0x20023FE0`.

- [ ] **Step 1: Write the shared geometry header**

Create `cube/Core/Inc/g0b1_slots.h`:
```c
#ifndef G0B1_SLOTS_H
#define G0B1_SLOTS_H
/* Single source of truth for flash geometry (keep in sync with all linker scripts). */
#define BOOT_BASE     0x08000000u
#define BOOT_SIZE     0x8000u      /* 32 KB */
#define SLOTA_BASE    0x08008000u
#define SLOTB_BASE    0x08040000u
#define APP_SLOT_SIZE 0x38000u     /* 224 KB */
#define BOOTCFG_BASE  0x08078000u
#define NOINIT_ADDR   0x20023FE0u  /* top 32 B of 144 KB RAM; reset-magic lives here */
#endif
```

- [ ] **Step 2: Write the bootloader linker script**

Create `boot/g0b1-boot.ld` (based on the app's FLASH script, with FLASH shrunk to the 32 KB boot region, a `.noinit` region carved from the top of RAM, and `.RamFunc`):
```ld
ENTRY(Reset_Handler)
_estack = 0x20023FE0;              /* below the .noinit word (top 32 B reserved) */
_Min_Heap_Size = 0x0;
_Min_Stack_Size = 0x400;

MEMORY
{
  RAM    (xrw) : ORIGIN = 0x20000000, LENGTH = 143K + 992   /* 0x23FE0 */
  NOINIT (rw)  : ORIGIN = 0x20023FE0, LENGTH = 32
  FLASH  (rx)  : ORIGIN = 0x08000000, LENGTH = 32K
}

SECTIONS
{
  .isr_vector : { . = ALIGN(4); KEEP(*(.isr_vector)) . = ALIGN(4); } >FLASH
  .text : { . = ALIGN(4); *(.text) *(.text*) *(.glue_7) *(.glue_7t) *(.eh_frame)
            KEEP(*(.init)) KEEP(*(.fini)) . = ALIGN(4); _etext = .; } >FLASH
  _siramfunc = LOADADDR(.RamFunc);
  .RamFunc : { . = ALIGN(4); _sramfunc = .; *(.RamFunc) *(.RamFunc*) . = ALIGN(4); _eramfunc = .; } >RAM AT> FLASH
  .rodata : { . = ALIGN(4); *(.rodata) *(.rodata*) . = ALIGN(4); } >FLASH
  .ARM.extab : { *(.ARM.extab* .gnu.linkonce.armextab.*) } >FLASH
  .ARM : { __exidx_start = .; *(.ARM.exidx*) __exidx_end = .; } >FLASH
  .preinit_array : { PROVIDE_HIDDEN(__preinit_array_start = .); KEEP(*(.preinit_array*)) PROVIDE_HIDDEN(__preinit_array_end = .); } >FLASH
  .init_array : { PROVIDE_HIDDEN(__init_array_start = .); KEEP(*(SORT(.init_array.*))) KEEP(*(.init_array*)) PROVIDE_HIDDEN(__init_array_end = .); } >FLASH
  .fini_array : { PROVIDE_HIDDEN(__fini_array_start = .); KEEP(*(SORT(.fini_array.*))) KEEP(*(.fini_array*)) PROVIDE_HIDDEN(__fini_array_end = .); } >FLASH
  _sidata = LOADADDR(.data);
  .data : { . = ALIGN(4); _sdata = .; *(.data) *(.data*) . = ALIGN(4); _edata = .; } >RAM AT> FLASH
  .bss : { . = ALIGN(4); _sbss = .; __bss_start__ = _sbss; *(.bss) *(.bss*) *(COMMON) . = ALIGN(4); _ebss = .; __bss_end__ = _ebss; } >RAM
  .noinit (NOLOAD) : { . = ALIGN(4); *(.noinit) *(.noinit*) . = ALIGN(4); } >NOINIT
  ._user_heap_stack : { . = ALIGN(8); . = . + _Min_Stack_Size; . = ALIGN(8); } >RAM
  /DISCARD/ : { libc.a(*) libm.a(*) libgcc.a(*) }
  .ARM.attributes 0 : { *(.ARM.attributes) }
}
```
(Compute `LENGTH = 143K + 992` = `0x23FE0`. Verify `0x20000000 + 0x23FE0 = 0x20023FE0` = NOINIT origin.)

- [ ] **Step 3: Write startup, SystemInit, and hal_conf**

Create `boot/src/startup_g0b1_boot.s` by copying `cube/Core/Startup/startup_stm32g0b1retx.s` and (a) keeping the full vector table (unused IRQs point to `Default_Handler`), (b) ensuring the `.data` AND `.RamFunc` copy loops and `.bss` zero loop run in `Reset_Handler`, (c) NOT zeroing `.noinit`. Create `boot/src/system_boot.c` as a trimmed `SystemInit` (no `SCB->VTOR` write — the bootloader runs from `0x08000000` where the boot vector table already is). Create `boot/src/stm32g0xx_hal_conf.h` enabling only `HAL_MODULE_ENABLED`, `HAL_FLASH_MODULE_ENABLED`, `HAL_GPIO_MODULE_ENABLED`, `HAL_UART_MODULE_ENABLED`, `HAL_RCC_MODULE_ENABLED`, `HAL_CORTEX_MODULE_ENABLED`, `HAL_IWDG_MODULE_ENABLED`, `HAL_PWR_MODULE_ENABLED`.

- [ ] **Step 4: Write the Makefile**

Create `boot/Makefile` compiling: `boot/src/*.c/.s`, the shared portable modules (`../App/services/{crc32,bootcfg,boot_decision,bl_proto,bl_session}.c`), `../cube/Core/Src/drv_iflash.c`, and the minimal HAL set from `../cube/Drivers/STM32G0xx_HAL_Driver/Src/`: `stm32g0xx_hal.c`, `_rcc.c`, `_rcc_ex.c`, `_gpio.c`, `_flash.c`, `_flash_ex.c`, `_uart.c`, `_uart_ex.c`, `_cortex.c`, `_iwdg.c`, `_pwr.c`, `_pwr_ex.c`, plus `../cube/Core/Src/system_stm32g0xx.c` is replaced by `boot/src/system_boot.c`. Flags per Global Constraints; includes `-I../cube/Core/Inc -I../App/services -I../App/include -I../cube/Drivers/STM32G0xx_HAL_Driver/Inc -I../cube/Drivers/CMSIS/Device/ST/STM32G0xx/Include -I../cube/Drivers/CMSIS/Include -Iboot/src`. Link with `-T boot/g0b1-boot.ld`. Post-link: `arm-none-eabi-objcopy -O binary`, then `arm-none-eabi-size` and assert `.text+.rodata+.data ≤ 32 KB`.

- [ ] **Step 5: Build + commit**

Run: `make -C boot`
Expected: builds clean; `arm-none-eabi-size boot/build/g0b1-boot.elf` shows total flash ≤ 32768. `arm-none-eabi-objdump -h boot/build/g0b1-boot.elf` shows `.isr_vector` at `0x08000000` and `.noinit` at `0x20023FE0`.
```bash
git add boot/ cube/Core/Inc/g0b1_slots.h
git commit -m "feat(boot): bootloader build skeleton (linker/startup/Makefile, 32 KB @ 0x08000000)"
```

---

### Task 9: Bootloader clock + IWDG + RS-485 UART

**Files:**
- Create: `boot/src/boot_clock.c`, `boot/src/boot_uart.c`, `boot/src/boot_uart.h`

**Interfaces:**
- Produces: `void boot_clock_init(void);` (same SYSCLK as the app so 9600 baud divisors match — copy `SystemClock_Config()` from `cube/Core/Src/main.c:143-183`), `void boot_iwdg_init(void);` (PRESCALER_32, Reload 1999 ≈ 2 s, matching the app), `IWDG_HandleTypeDef hiwdg;` (definition; `drv_iflash.c` references it `extern`). UART: `void boot_uart_init(void);`, `uint16_t boot_uart_recv_frame(uint8_t *buf, uint16_t max, uint32_t timeout_ms);` (blocking; assembles one RTU frame using a ~4 ms inter-frame idle gap; returns length or 0 on timeout), `void boot_uart_send(const uint8_t *buf, uint16_t len);` (drives DE=PB3 high, blocking TX, DE low after TC).

- [ ] **Step 1: Copy the app clock config**

Create `boot/src/boot_clock.c` with `SystemClock_Config()` copied verbatim from the app's `main.c` (HSE→PLL, `FLASH_LATENCY_2`), exposed as `boot_clock_init()`. Rationale: identical SYSCLK → identical USART1 BRR → the same 9600 8N1 timing the cortex already talks to.

- [ ] **Step 2: IWDG init**

In `boot/src/boot_clock.c` (or a small `boot_iwdg.c`), define `IWDG_HandleTypeDef hiwdg;` and `boot_iwdg_init()` using the exact values from `app_main.c:172-178` (`IWDG_PRESCALER_32`, `Window=4095`, `Reload=1999`).

- [ ] **Step 3: RS-485 UART, DE-controlled**

Create `boot/src/boot_uart.c` / `.h`. Init USART1 (PA9 TX / PA10 RX) 9600 8N1 and GPIO PB3 as push-pull output for DE (mirror the app's `drv_modbus_uart` init but WITHOUT DMA — the bootloader uses simple blocking HAL UART). `boot_uart_recv_frame`: poll `HAL_UART_Receive(&huart, &byte, 1, gap_ms)`; accumulate bytes; when a `HAL_TIMEOUT` gap (~4 ms at 9600 = 3.5 char times) occurs after ≥4 bytes, return the assembled frame; honor an overall `timeout_ms` budget; refresh IWDG each poll iteration. `boot_uart_send`: set PB3 high, `HAL_UART_Transmit` blocking, wait `UART TC`, set PB3 low.

- [ ] **Step 4: Bench-verify the UART loop (with Task 10/11 present)**

This has no host unit test; it is validated in Task 11's bench step (an `INFO` request over RS-485 must return the info frame). Build check only here: `make -C boot` compiles clean.

- [ ] **Step 5: Commit**

```bash
git add boot/src/boot_clock.c boot/src/boot_uart.c boot/src/boot_uart.h
git commit -m "feat(boot): clock/IWDG + blocking RS-485 (DE=PB3) UART frame layer"
```

---

### Task 10: Bootloader `main()` — boot decision + jump

**Files:**
- Create: `boot/src/boot_main.c`
- Create: `boot/src/boot_jump.h` (declares the magic word + jump helper)

**Interfaces:**
- Consumes: `boot_decide`, `bootcfg_load/save`, `drv_iflash_backend`, `bootcfg_slot_crc_ok`, the `.noinit` magic.
- Produces: `int main(void)` for the bootloader; `void boot_jump_to_slot(uint32_t slot_base);` (set MSP from `slot_base[0]`, `SCB->VTOR = slot_base`, jump to `slot_base[1]`).

- [ ] **Step 1: Define the `.noinit` magic + jump helper**

Create `boot/src/boot_jump.h`:
```c
#ifndef BOOT_JUMP_H
#define BOOT_JUMP_H
#include <stdint.h>
#include "g0b1_slots.h"
extern volatile uint32_t g_boot_magic __attribute__((section(".noinit")));
void boot_jump_to_slot(uint32_t slot_base); /* no return */
#endif
```

- [ ] **Step 2: Write `main()`**

Create `boot/src/boot_main.c`:
```c
#include "stm32g0xx_hal.h"
#include "g0b1_slots.h"
#include "boot_jump.h"
#include "boot_uart.h"
#include "bootcfg.h"
#include "boot_decision.h"
#include "drv_iflash.h"

volatile uint32_t g_boot_magic __attribute__((section(".noinit")));

void boot_iwdg_init(void); void boot_clock_init(void);
extern IWDG_HandleTypeDef hiwdg;
void bl_update_mode(const iflash_backend_t *fl, bootcfg_t *cfg); /* Task 11 */

static const iflash_backend_t *FL;
static bootcfg_t CFG; static int CFG_VALID;
static int slot_ok(void *v, slot_id_t s) { (void)v; return bootcfg_slot_crc_ok(FL, &CFG, s); }

int main(void) {
    HAL_Init();
    boot_clock_init();
    boot_iwdg_init();                 /* covers boot decision + update mode */
    FL = drv_iflash_backend();

    uint32_t magic = g_boot_magic;
    g_boot_magic = 0;                 /* consume the request */

    CFG_VALID = (bootcfg_load(FL, &CFG) == 0);
    boot_decision_t d = boot_decide(&CFG, CFG_VALID, magic, slot_ok, 0);
    if (d.cfg_dirty) (void)bootcfg_save(FL, &CFG);

    if (d.action == BOOT_ACTION_JUMP_SLOT) {
        HAL_IWDG_Refresh(&hiwdg);     /* fresh window for the app's own init */
        boot_jump_to_slot(bootcfg_slot_base(d.slot));
    }

    /* ENTER_UPDATE: bring up the bus and receive an image. */
    boot_uart_init();
    bl_update_mode(FL, &CFG);         /* loops; resets on COMMIT */
    for (;;) HAL_IWDG_Refresh(&hiwdg);/* unreachable safety net */
}
```

- [ ] **Step 3: Write the jump helper**

Create `boot/src/boot_jump.c`:
```c
#include "boot_jump.h"
#include "stm32g0xx_hal.h"

void boot_jump_to_slot(uint32_t slot_base) {
    uint32_t sp  = *(volatile uint32_t *)(slot_base + 0u);
    uint32_t pc  = *(volatile uint32_t *)(slot_base + 4u);
    __disable_irq();
    HAL_RCC_DeInit();                 /* return clocks to reset so the app re-inits cleanly */
    SysTick->CTRL = 0; SysTick->LOAD = 0; SysTick->VAL = 0;
    for (uint32_t i = 0; i < 8; i++) { NVIC->ICER[i] = 0xFFFFFFFFu; NVIC->ICPR[i] = 0xFFFFFFFFu; }
    SCB->VTOR = slot_base;
    __set_MSP(sp);
    __enable_irq();
    ((void (*)(void))pc)();           /* never returns */
}
```
(Include `boot/src/boot_jump.c` in the Makefile source list.)

- [ ] **Step 4: Bench-verify jump (SWD)**

With a known-good app already SWD-flashed to Slot A and a hand-written boot-config marking Slot A COMMITTED/active (write it via the temporary probe from Task 7, or a tiny SWD script), flash the bootloader to `0x08000000`. Power-cycle. Expected: the bootloader jumps to Slot A and the app runs — confirm by reading Modbus reg 2 (version) over RS-485, and by the normal APU boot behavior. If it hard-faults, halt in the debugger at `boot_jump_to_slot` and verify `sp` is in RAM (`0x2000xxxx`) and `pc` is odd (thumb) inside Slot A.

- [ ] **Step 5: Commit**

```bash
git add boot/src/boot_main.c boot/src/boot_jump.c boot/src/boot_jump.h
git commit -m "feat(boot): boot-decision main + VTOR-relocating slot jump"
```

---

### Task 11: Bootloader update-mode loop

**Files:**
- Create: `boot/src/bl_update_mode.c`

**Interfaces:**
- Consumes: `bl_session`, `boot_uart_recv_frame/send`, `mb_check_frame` (existing `modbus_frame.c`), `modbus_crc16`.
- Produces: `void bl_update_mode(const iflash_backend_t *fl, bootcfg_t *cfg);` — receive/dispatch loop.

- [ ] **Step 1: Write the loop**

Create `boot/src/bl_update_mode.c`:
```c
#include "bl_update_mode.h"   /* declares bl_update_mode(); create alongside */
#include "bl_session.h"
#include "boot_uart.h"
#include "modbus_frame.h"
#include "modbus_crc.h"
#include "stm32g0xx_hal.h"

extern IWDG_HandleTypeDef hiwdg;

void bl_update_mode(const iflash_backend_t *fl, bootcfg_t *cfg) {
    bl_session_t s; bl_session_init(&s, fl, cfg);
    static uint8_t req[256]; static uint8_t resp[256];
    for (;;) {
        HAL_IWDG_Refresh(&hiwdg);
        uint16_t n = boot_uart_recv_frame(req, sizeof req, 1000u);   /* 1 s idle budget */
        if (n == 0) continue;                                        /* stay in update mode */
        if (mb_check_frame(req, n, 1u) != MB_FRAME_OK) continue;     /* addr/CRC gate */
        uint16_t blen = bl_session_process(&s, req, (uint16_t)(n - 2u), resp); /* strip CRC16 */
        if (blen == 0) continue;
        uint16_t crc = modbus_crc16(resp, blen);
        resp[blen] = (uint8_t)crc; resp[blen + 1] = (uint8_t)(crc >> 8);
        boot_uart_send(resp, (uint16_t)(blen + 2u));
        if (s.want_reset) {                     /* COMMIT acked; let TX drain, then reset */
            HAL_Delay(20);
            NVIC_SystemReset();
        }
    }
}
```
Create `boot/src/bl_update_mode.h` declaring the function.

- [ ] **Step 2: Bench-verify a full transfer over RS-485 (SWD recovery on hand)**

Use `tools/bl_flash.py` (Task — built in Phase 6, Task 17) or a manual `report_slave_id.py`-style script to: force update mode (write `.noinit` magic + reset via the app's reg-35, OR SWD-set the magic and reset), send `INFO`, `ERASE`, stream a real Slot-B image in 240-byte chunks, `VERIFY`, `COMMIT`. Expected: bootloader resets, then boots Slot B; reg 2 shows the new version. Keep STLINK-V3SET attached to recover if the transfer wedges.

- [ ] **Step 3: Commit**

```bash
git add boot/src/bl_update_mode.c boot/src/bl_update_mode.h
git commit -m "feat(boot): update-mode receive/dispatch loop over RS-485"
```

---

## Phase 5 — App changes (per-slot builds, enter-bootloader, self-confirm)

### Task 12: Per-slot linker scripts + VTOR + `.noinit` magic in the app

**Files:**
- Create: `cube/STM32G0B1RETX_SLOTA.ld`, `cube/STM32G0B1RETX_SLOTB.ld`
- Modify: `cube/Core/Src/system_stm32g0xx.c` (set `SCB->VTOR`)
- Modify: `cube/Core/Startup/startup_stm32g0b1retx.s` (ensure `.noinit` NOT zeroed; add `.RamFunc` copy if missing — done in Task 7)
- Create: `cube/Core/Inc/boot_magic.h` (shared `.noinit` symbol for the app)

**Interfaces:**
- Produces: two link configs building `g0b1-apu-slotA.bin` (@ `0x08008000`) and `g0b1-apu-slotB.bin` (@ `0x08040000`); `SCB->VTOR` set to the running slot's base; `extern volatile uint32_t g_boot_magic` in `.noinit` at `0x20023FE0` (identical address to the bootloader).

- [ ] **Step 1: Create the two slot linker scripts**

Copy `cube/STM32G0B1RETX_FLASH.ld` → `cube/STM32G0B1RETX_SLOTA.ld` and change the MEMORY `FLASH` line to `ORIGIN = 0x08008000, LENGTH = 224K`; add the same `NOINIT` region (`ORIGIN = 0x20023FE0, LENGTH = 32`), reduce `RAM` LENGTH to `0x23FE0`, set `_estack = 0x20023FE0`, and add the `.noinit (NOLOAD) : { *(.noinit*) } >NOINIT` section (mirroring Task 8's script; keep the existing `.RamFunc` from Task 7). Repeat for `cube/STM32G0B1RETX_SLOTB.ld` with `ORIGIN = 0x08040000`.

- [ ] **Step 2: Set VTOR in the app**

In `cube/Core/Src/system_stm32g0xx.c`, replace the guarded VTOR block in `SystemInit()` with an unconditional set to the running vector table (works for either slot since `g_pfnVectors` is at the slot base):
```c
extern uint32_t g_pfnVectors;
void SystemInit(void) { SCB->VTOR = (uint32_t)&g_pfnVectors; }
```
Belt-and-suspenders with the bootloader's VTOR set; correct for both slot builds.

- [ ] **Step 3: Declare the app-side magic**

Create `cube/Core/Inc/boot_magic.h`:
```c
#ifndef BOOT_MAGIC_H
#define BOOT_MAGIC_H
#include <stdint.h>
extern volatile uint32_t g_boot_magic __attribute__((section(".noinit")));
#endif
```
Add its definition once (e.g. in `app_main.c`): `volatile uint32_t g_boot_magic __attribute__((section(".noinit")));`

- [ ] **Step 4: Build both slot images (bench/CI)**

Add a build path that produces both `.bin`. Simplest reproducible route (no CubeIDE GUI): a `cube/build-slots.sh` that invokes the CubeIDE-generated `make` twice with `-T` overridden to each slot `.ld`, then `objcopy -O binary` each ELF to `g0b1-apu-slot{A,B}.bin`. Verify each `.bin` size < 224 KB and that `objdump -h` shows `.isr_vector` at the expected slot base.
Expected: two `.bin` files, correct bases, sizes ~65 KB.

- [ ] **Step 5: Commit**

```bash
git add cube/STM32G0B1RETX_SLOTA.ld cube/STM32G0B1RETX_SLOTB.ld cube/Core/Src/system_stm32g0xx.c cube/Core/Inc/boot_magic.h cube/build-slots.sh
git commit -m "feat(app): per-slot linker configs + VTOR set + .noinit boot magic"
```

---

### Task 13: Enter-bootloader Modbus command (reg 35, refuse-if-engine)

**Files:**
- Create: `App/services/mbp_boot.c`, `App/services/mbp_boot.h`
- Test: `Tests/test_mbp_boot.c`
- Modify: `Tests/CMakeLists.txt`, `cube/Core/Src/app_main.c`
- Modify: `App/services/mbp_sys.c` (remove the stub reg-35 bind so `mbp_boot` owns it)

**Interfaces:**
- Consumes: `mb_reg_bind` (existing), injected fn pointers.
- Produces: `void mbp_boot_register(int (*engine_running)(void), void (*enter_bl)(void));` — binds reg 35; on a write of `0x00A5` (arm value), if `engine_running()` returns non-zero → return `MB_EXC_SLAVE_DEVICE_FAILURE` (refuse); else call `enter_bl()` (which sets `g_boot_magic = BOOT_MAGIC_ENTER` and `NVIC_SystemReset()`). Any other written value → no-op OK. Reg-35 read returns 0.

- [ ] **Step 1: Write the failing test**

Create `Tests/test_mbp_boot.c`:
```c
#include "unity.h"
#include "mbp_boot.h"
#include "mb_regmodel.h"
#include "modbus_defs.h"

static int g_engine; static int g_entered;
static int engine_running(void) { return g_engine; }
static void enter_bl(void) { g_entered = 1; }

void setUp(void) { mb_reg_reset(); g_engine = 0; g_entered = 0; mbp_boot_register(engine_running, enter_bl); }
void tearDown(void) {}

void test_enter_when_off(void) {
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(35, 0x00A5));
    TEST_ASSERT_EQUAL_INT(1, g_entered);
}
void test_refuse_when_engine_running(void) {
    g_engine = 1;
    TEST_ASSERT_EQUAL_INT(MB_EXC_SLAVE_DEVICE_FAILURE, mb_reg_write(35, 0x00A5));
    TEST_ASSERT_EQUAL_INT(0, g_entered);
}
void test_non_arm_value_is_noop(void) {
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(35, 0x0001));
    TEST_ASSERT_EQUAL_INT(0, g_entered);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_enter_when_off); RUN_TEST(test_refuse_when_engine_running);
    RUN_TEST(test_non_arm_value_is_noop);
    return UNITY_END();
}
```
(Confirm `mb_regmodel.h` exposes a `mb_reg_reset()` test helper; the existing `test_mbp_sys.c` pattern shows the reset/bind convention — reuse whatever it uses.)

Add to `Tests/CMakeLists.txt`:
```cmake
add_unity_test(test_mbp_boot test_mbp_boot.c ../App/services/mbp_boot.c ../App/services/mb_regmodel.c)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cmake -S Tests -B Tests/build && cmake --build Tests/build -j && ctest --test-dir Tests/build -R test_mbp_boot --output-on-failure`
Expected: FAIL — `mbp_boot.*` do not exist.

- [ ] **Step 3: Write minimal implementation**

Create `App/services/mbp_boot.h`:
```c
#ifndef MBP_BOOT_H
#define MBP_BOOT_H
#define MBP_BOOT_ARM_VALUE 0x00A5u
void mbp_boot_register(int (*engine_running)(void), void (*enter_bl)(void));
#endif
```

Create `App/services/mbp_boot.c`:
```c
#include "mbp_boot.h"
#include "mb_regmodel.h"
#include "modbus_defs.h"

static int  (*s_engine_running)(void);
static void (*s_enter_bl)(void);

static modbus_exc_t rd_boot(uint16_t r, uint16_t *o) { (void)r; *o = 0; return MB_EXC_NONE; }
static modbus_exc_t wr_boot(uint16_t r, uint16_t v) {
    (void)r;
    if (v != MBP_BOOT_ARM_VALUE) return MB_EXC_NONE;          /* ignore stray writes */
    if (s_engine_running && s_engine_running()) return MB_EXC_SLAVE_DEVICE_FAILURE; /* refuse */
    if (s_enter_bl) s_enter_bl();                             /* sets magic + NVIC_SystemReset */
    return MB_EXC_NONE;
}
void mbp_boot_register(int (*engine_running)(void), void (*enter_bl)(void)) {
    s_engine_running = engine_running; s_enter_bl = enter_bl;
    mb_reg_bind(35, rd_boot, wr_boot);
}
```

- [ ] **Step 4: Run test to verify it passes + wire on-target**

Run: `ctest --test-dir Tests/build -R test_mbp_boot --output-on-failure` → PASS (3 tests).
Then in `cube/Core/Src/app_main.c`: remove/adjust so reg 35 is no longer bound by `mbp_sys` (delete the reg-35 bind in `mbp_sys.c` `mbp_sys_register`), and add:
```c
#include "mbp_boot.h"
#include "boot_magic.h"
#include "boot_decision.h"
static int  app_engine_running(void) { return control_engine_is_running(); } /* use the real predicate */
static void app_enter_bl(void) { g_boot_magic = BOOT_MAGIC_ENTER; NVIC_SystemReset(); }
/* ...after mbp_sys_register(): */
mbp_boot_register(app_engine_running, app_enter_bl);
```
Identify the real engine-running predicate (from `control_*`; the spec cites reg 22 engine status / reg 10 mode). If none is directly callable, add a tiny accessor in the control layer. Rebuild the app (both slots) — compiles clean.

- [ ] **Step 5: Commit**

```bash
git add App/services/mbp_boot.h App/services/mbp_boot.c Tests/test_mbp_boot.c Tests/CMakeLists.txt App/services/mbp_sys.c cube/Core/Src/app_main.c
git commit -m "feat(app): reg-35 enter-bootloader command (refuse while engine running)"
```

---

### Task 14: Self-confirm slot COMMITTED when healthy

**Files:**
- Create: `App/services/app_confirm.c`, `App/services/app_confirm.h`
- Test: `Tests/test_app_confirm.c`
- Modify: `Tests/CMakeLists.txt`, `cube/Core/Src/app_main.c`

**Interfaces:**
- Consumes: `bootcfg` (load/save/states), `iflash_backend_t`.
- Produces:
  - `void app_confirm_init(const iflash_backend_t *fl);` — loads bootcfg; if the active slot is TRIAL, arms confirm; else disarms (nothing to do).
  - `void app_confirm_tick(int healthy);` — call once per 1 s control slot with a health predicate (control loop alive + sensors sane); after `APP_CONFIRM_HEALTHY_SECS` (e.g. 5) consecutive healthy ticks, marks the active slot COMMITTED, `trial_count=0`, `bootcfg_save`, and disarms. `healthy==0` resets the counter.
  - `int app_confirm_is_armed(void);` (test/inspection).

- [ ] **Step 1: Write the failing test**

Create `Tests/test_app_confirm.c`:
```c
#include "unity.h"
#include "app_confirm.h"
#include "bootcfg.h"
#include "crc32.h"
#include "fake_iflash.h"
#include <string.h>

static const iflash_backend_t *FL;

static void seed_trial_B(void) {
    /* program a tiny valid image into slot B, mark it TRIAL-active */
    uint8_t img[16]; for (int i=0;i<16;i++) img[i]=(uint8_t)(i+3);
    FL->program(FL->ctx, SLOT_B_BASE, img, 16);
    bootcfg_t c; memset(&c,0,sizeof c); c.magic=BOOTCFG_MAGIC; c.version=BOOTCFG_VERSION;
    c.active_slot=SLOT_B; c.slot[SLOT_B].state=SLOT_STATE_TRIAL;
    c.slot[SLOT_B].length=16; c.slot[SLOT_B].crc32=crc32_compute(fake_iflash_ptr(SLOT_B_BASE),16);
    c.trial_count=2;
    bootcfg_save(FL,&c);
}
void setUp(void){ fake_iflash_reset(); FL=fake_iflash_backend(); seed_trial_B(); app_confirm_init(FL); }
void tearDown(void){}

void test_armed_when_trial(void){ TEST_ASSERT_EQUAL_INT(1, app_confirm_is_armed()); }
void test_commits_after_healthy_window(void){
    for (int i=0;i<APP_CONFIRM_HEALTHY_SECS;i++) app_confirm_tick(1);
    TEST_ASSERT_EQUAL_INT(0, app_confirm_is_armed());
    bootcfg_t r; bootcfg_load(FL,&r);
    TEST_ASSERT_EQUAL_UINT8(SLOT_STATE_COMMITTED, r.slot[SLOT_B].state);
    TEST_ASSERT_EQUAL_UINT16(0, r.trial_count);
}
void test_unhealthy_resets_counter(void){
    for (int i=0;i<APP_CONFIRM_HEALTHY_SECS-1;i++) app_confirm_tick(1);
    app_confirm_tick(0);                       /* blip resets */
    app_confirm_tick(1);
    TEST_ASSERT_EQUAL_INT(1, app_confirm_is_armed());  /* still not committed */
}
void test_noop_when_already_committed(void){
    bootcfg_t c; bootcfg_load(FL,&c); c.slot[SLOT_B].state=SLOT_STATE_COMMITTED; bootcfg_save(FL,&c);
    app_confirm_init(FL);
    TEST_ASSERT_EQUAL_INT(0, app_confirm_is_armed());
}

int main(void){
    UNITY_BEGIN();
    RUN_TEST(test_armed_when_trial); RUN_TEST(test_commits_after_healthy_window);
    RUN_TEST(test_unhealthy_resets_counter); RUN_TEST(test_noop_when_already_committed);
    return UNITY_END();
}
```

Add to `Tests/CMakeLists.txt`:
```cmake
add_unity_test(test_app_confirm test_app_confirm.c ../App/services/app_confirm.c ../App/services/bootcfg.c ../App/services/crc32.c fakes/fake_iflash.c)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cmake -S Tests -B Tests/build && cmake --build Tests/build -j && ctest --test-dir Tests/build -R test_app_confirm --output-on-failure`
Expected: FAIL — `app_confirm.*` do not exist.

- [ ] **Step 3: Write minimal implementation**

Create `App/services/app_confirm.h`:
```c
#ifndef APP_CONFIRM_H
#define APP_CONFIRM_H
#include "iflash_backend.h"
#define APP_CONFIRM_HEALTHY_SECS 5
void app_confirm_init(const iflash_backend_t *fl);
void app_confirm_tick(int healthy);
int  app_confirm_is_armed(void);
#endif
```

Create `App/services/app_confirm.c`:
```c
#include "app_confirm.h"
#include "bootcfg.h"

static const iflash_backend_t *s_fl;
static bootcfg_t s_cfg;
static int s_armed;
static int s_healthy_secs;

void app_confirm_init(const iflash_backend_t *fl) {
    s_fl = fl; s_armed = 0; s_healthy_secs = 0;
    if (bootcfg_load(fl, &s_cfg) != 0) return;
    slot_id_t a = (slot_id_t)s_cfg.active_slot;
    s_armed = (s_cfg.slot[a].state == SLOT_STATE_TRIAL) ? 1 : 0;
}
int app_confirm_is_armed(void) { return s_armed; }

void app_confirm_tick(int healthy) {
    if (!s_armed) return;
    if (!healthy) { s_healthy_secs = 0; return; }
    if (++s_healthy_secs < APP_CONFIRM_HEALTHY_SECS) return;
    slot_id_t a = (slot_id_t)s_cfg.active_slot;
    s_cfg.slot[a].state = SLOT_STATE_COMMITTED;
    s_cfg.trial_count = 0;
    if (bootcfg_save(s_fl, &s_cfg) == 0) s_armed = 0;   /* retry next tick if save fails */
}
```

- [ ] **Step 4: Run test to verify it passes + wire on-target**

Run: `ctest --test-dir Tests/build -R test_app_confirm --output-on-failure` → PASS (4 tests).
In `cube/Core/Src/app_main.c`: after `drv_iflash`/nvm init, call `app_confirm_init(drv_iflash_backend())`; in the 1 s scheduler slot, call `app_confirm_tick(app_is_healthy())` where `app_is_healthy()` = control state not in ERROR and sensors within range (reuse existing control/sensor predicates). Rebuild both slot images — clean.

- [ ] **Step 5: Commit**

```bash
git add App/services/app_confirm.h App/services/app_confirm.c Tests/test_app_confirm.c Tests/CMakeLists.txt cube/Core/Src/app_main.c
git commit -m "feat(app): self-confirm active slot COMMITTED after healthy uptime window"
```

---

### Task 15: Version bump + release artifacts

**Files:**
- Modify: `App/services/fw_version.h`
- Create: `docs/remote-update.md` (operator + release notes: how to cut a release, the two-`.bin` output, CRC32 contract, SWD provisioning)

- [ ] **Step 1: Bump the version**

In `App/services/fw_version.h`, bump to the first bootloader-capable release (e.g. `MINOR` → 1: `1.1.0`) and update the comment to note "first A/B remote-update-capable app".

- [ ] **Step 2: Write the release/ops doc**

Create `docs/remote-update.md` documenting: the flash map, the CRC32 contract (zlib crc32 over each slot `.bin`), the two-`.bin`-per-release output (`g0b1-apu-<ver>-slotA.bin` / `-slotB.bin`), how the agent picks the inactive-slot `.bin`, the SWD provisioning steps (Task 16), and the recovery procedure (force update mode + re-stream) — the contract sub-project #2 consumes.

- [ ] **Step 3: Build + full host suite**

Run: `cmake -S Tests -B Tests/build && cmake --build Tests/build -j && ctest --test-dir Tests/build --output-on-failure`
Expected: entire suite green (existing 60+ tests plus the 8 new ones).

- [ ] **Step 4: Commit**

```bash
git add App/services/fw_version.h docs/remote-update.md
git commit -m "chore(app): bump to 1.1.0 (A/B remote-update capable) + ops doc"
```

---

## Phase 6 — Bench end-to-end validation (SWD + RS-485; ST-LINK recovery on hand)

### Task 16: SWD provisioning (option bytes + first flash)

**Files:** (procedure; no repo changes beyond a helper script)
- Create: `tools/provision_boot.md` (or a `tools/provision.sh` wrapping `STM32_Programmer_CLI`)

- [ ] **Step 1: Set single-bank option byte**

With STLINK-V3SET on HDR1, set `DUAL_BANK=0` (single-bank 512 KB linear) via `STM32_Programmer_CLI -c port=SWD -ob DUAL_BANK=0`. Confirm read-back. (This is the one-time provisioning that makes page indices `0..255` linear — Global Constraints.)

- [ ] **Step 2: Flash bootloader + both app slots + seed boot-config**

Flash `boot/build/g0b1-boot.bin` @ `0x08000000`, `g0b1-apu-slotA.bin` @ `0x08008000`, `g0b1-apu-slotB.bin` @ `0x08040000`. Seed a boot-config marking Slot A COMMITTED+active (a tiny `STM32_Programmer_CLI` write of a precomputed 48-byte record @ `0x08078000`, or let the bootloader fall into recovery once and stream Slot A). Power-cycle.
Expected: APU boots the Slot A app normally; reg 2 = `1.1.0`.

- [ ] **Step 3: Commit the provisioning helper**

```bash
git add tools/provision_boot.md
git commit -m "docs(tools): SWD provisioning (single-bank option byte + slot flashing)"
```

---

### Task 17: Full remote-update round-trip + failure cases

**Files:**
- Create: `tools/bl_flash.py` (reference host flasher over the FT232 RS-485 link — the executable spec for sub-project #2)

- [ ] **Step 1: Write the reference flasher**

Create `tools/bl_flash.py` (modeled on `tools/report_slave_id.py`): open the FT232 serial port; read reg 2; write reg 35 = `0x00A5` to command enter-bootloader; wait for the reset; send `INFO` (learn inactive slot + chunk size); `ERASE`; stream the inactive-slot `.bin` in 240-byte `0x42` chunks with per-chunk ACK + retry-on-timeout/NAK; `VERIFY {len, crc32}`; `COMMIT`; wait for reset; re-read reg 2 and assert the new version. All frames use the existing `modbus_crc16` (implement inline in Python) and `crc32` = zlib.

- [ ] **Step 2: Happy path**

With the APU OFF (engine off), run `python tools/bl_flash.py --port <ftdi> --image g0b1-apu-<newver>-slot<inactive>.bin`.
Expected: transfer completes (~1 min at 9600); bootloader commits Slot B TRIAL-active + resets; app boots Slot B; within the healthy window it self-confirms → Slot B COMMITTED; reg 2 = new version. Re-run and confirm it now targets Slot A (roles swapped).

- [ ] **Step 3: Failure + recovery cases (each must leave the APU running the old slot)**

Exercise and record each:
1. **Interrupted transfer:** kill `bl_flash.py` mid-stream. Power-cycle. Expected: no valid COMMIT happened → bootloader boots the still-COMMITTED old slot; reg 2 = old version.
2. **Bad CRC at VERIFY:** send a deliberately wrong `crc32`. Expected: NAK `BL_ERR_CRC`; no commit; old slot boots.
3. **Trial never confirms (revert):** flash a Slot-B image whose app is patched to report unhealthy (so `app_confirm` never fires); COMMIT it TRIAL. Power-cycle ≥ `TRIAL_BOOT_LIMIT`+1 times. Expected: bootloader increments `trial_count`, exceeds the limit, marks Slot B BAD, reverts to Slot A; reg 2 = old version.
4. **Both slots invalid → safe recovery:** SWD-corrupt both slot CRCs. Power-cycle. Expected: bootloader stays in update mode (bus alive); `bl_flash.py` can re-stream a slot with NO ST-LINK — the core recoverability claim.
5. **Engine-running refusal:** with the engine running (or the engine-running predicate forced), write reg 35 = `0x00A5`. Expected: Modbus exception `0x04`; no reset; app keeps running.

- [ ] **Step 4: Commit + finish**

```bash
git add tools/bl_flash.py
git commit -m "test(bench): reference RS-485 flasher + end-to-end update/rollback validation"
```
Then use **superpowers:finishing-a-development-branch** to integrate `feat/stm32-bootloader-ab-update` and hand the frozen wire protocol (`docs/remote-update.md` + `bl_proto.h`) to the sub-project #2 plan.

---

## Self-Review

**Spec coverage** (against `2026-09-03-stm32-remote-firmware-update-design.md`):
- Component A — bootloader: flash layout (Global Constraints), boot decision (Task 4/10), update mode (Task 6/11), boot-config internal-flash ping-pong (Task 3), watchdog-safe erase (Task 7), never-writes-bootloader/active-slot (Task 6 targets inactive only). ✓
- Component B — app changes: per-slot linker + VTOR (Task 12), enter-bootloader refuse-if-engine (Task 13), self-confirm (Task 14), version reg unchanged (Global Constraints). ✓
- Component C — FC 0x41/0x42 protocol: frozen (Task 5), session (Task 6), 240-byte chunks, CRC-16 wrapper reused. ✓
- Component D/E (cortex agent + delivery): explicitly **out of scope** here — this plan freezes the protocol (`bl_proto.h`, `docs/remote-update.md`) that sub-project #2 consumes; `tools/bl_flash.py` is the reference implementation. ✓
- Integrity/authenticity: CRC32 at agent/verify/boot (Task 1 + bootcfg slot CRC + session VERIFY); authenticity inherited from the cortex `.swu` (sub-project #2). ✓
- Safety: never-flash-running-engine (Task 13 refuse + agent gate in #2), bootloader never remotely writable, A/B keeps last-good, watchdog during erase (Task 7), power-loss = inactive slot invalid until COMMIT (Task 6 order: verify → commit → save). ✓
- Edge cases + testing plan + risks: all mapped to Phase 6 bench cases (Task 17) and host TDD (Phases 0–2). ✓
- Open items resolved: slot boundaries (Global Constraints), per-slot builds (Task 12), reset-magic = `.noinit` (Task 8/12), Modbus framing (Task 5), confirm = self-confirm (Task 14), refuse-while-running (Task 13). Delivery recipe = deferred to #2. ✓

**Placeholder scan:** on-target tasks (7–12, 16–17) intentionally use bench/SWD verification instead of host unit tests (hardware can't be host-unit-tested); each gives a concrete procedure + expected observation, not "test appropriately". One known reconcile point is flagged inline (Task 5 Step 4: info-body length — resolve to a 12-byte body).

**Type consistency:** `iflash_backend_t`, `bootcfg_t`/`slot_id_t`/`slot_state_t`, `boot_decision_t`, `bl_session_t`, and the `bl_proto` FC/sub constants are defined once (Tasks 2/3/4/5/6) and referenced with the same names/signatures throughout. `g_boot_magic` (`.noinit`) and `BOOT_MAGIC_ENTER` are shared by bootloader (Task 10) and app (Task 12/13). `hiwdg` is `extern`-referenced consistently by `drv_iflash` (Task 7) and defined in the bootloader (Task 9) and app (existing).
