# STM32G0 APU Port — Milestone 1: Foundations & Portable Modbus Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the STM32CubeIDE project (fail-safe boot + 64 MHz clock + heartbeat), a host-side unit-test harness with CI, and the first fully-portable, host-tested pieces of the Modbus stack (CRC-16, RTU frame validation, FC-0x03 response builder).

**Architecture:** Layered firmware (`App/bsp` → `App/services` → `App/control`) per the design spec. Portable Layer-2 code (no HAL) compiles on the host for TDD; hardware layers are validated on-target. This milestone delivers the toolchain skeleton plus the portable Modbus core that later milestones build on.

**Tech Stack:** STM32G0B1RET3, STM32CubeIDE + HAL, arm-none-eabi-gcc (target); C11, CMake + Unity, GitHub Actions (host tests).

**Design spec:** `docs/superpowers/specs/2026-08-12-pic18-to-stm32g0-apu-port-design.md`

## Global Constraints

- MCU: **STM32G0B1RET3** (Cortex-M0+, LQFP64). SYSCLK **64 MHz** from HSE 8.000 MHz crystal (PLL M=1, N=16, R=2).
- Fixed-width integer types come from **`<stdint.h>`** only — never `#define` them to native `int` (the PIC bug). Modbus wire format is **big-endian 16-bit**; NVM/wire packing is always explicit byte-by-byte, never struct-layout/endianness-dependent.
- Modbus: **RTU**, CRC-16 poly **0xA001** (reflected), init **0xFFFF**, xorout **0x0000**; slave **address 1**; broadcast address 0.
- Firmware project root: **`firmware/g0b1-apu/`**. Portable code under `App/services/` and `App/control/`; only `App/bsp/` and `App/drivers/` may include HAL.
- **Fail-safe:** firmware must drive all relay/PWM outputs OFF before any other init, on every boot.
- Every task ends green (target builds/flashes, or host `ctest` passes) and is committed.

---

### Task 1: STM32CubeIDE project skeleton — fail-safe boot, 64 MHz clock, heartbeat

**Files:**
- Create: `firmware/g0b1-apu/EF_G0B1_APU.ioc` (CubeMX)
- Create (generated): `firmware/g0b1-apu/Core/Src/main.c`, `firmware/g0b1-apu/Core/Inc/main.h`
- Create: `firmware/g0b1-apu/App/bsp/outputs_safe.c`, `firmware/g0b1-apu/App/bsp/outputs_safe.h`
- Create: `firmware/g0b1-apu/.gitignore`

**Interfaces:**
- Produces: `void outputs_all_off(void);` — drives every relay GPIO low and holds PWM pins low. Called first in `main()` before clock/peripheral bring-up completes.

- [ ] **Step 1: Create the CubeMX project**

In STM32CubeIDE: `File → New → STM32 Project`, select part **STM32G0B1RET3**, name it `EF_G0B1_APU`, location `firmware/g0b1-apu/`. Choose the **STM32Cube** targeted project, C, generate `.ioc`.

- [ ] **Step 2: Configure clock source**

In the `.ioc` `System Core → RCC`: set **High Speed Clock (HSE)** = *Crystal/Ceramic Resonator*, **LSE** = *Crystal/Ceramic Resonator*. In `Clock Configuration`: HSE 8 MHz → PLLSource = HSE, **PLLM = /1, PLLN = ×16, PLLR = /2**, System Clock Mux = PLLRCLK → **HCLK = 64 MHz**. Confirm no clock errors.

- [ ] **Step 3: Configure the fail-safe output pins as GPIO_Output, default LOW**

In `.ioc` Pinout, set these pins to **GPIO_Output**, User Label as noted, initial level **LOW**, push-pull, no pull:
`PC12` FL_PMP · `PC11` STARTER · `PB8` GLOW_PLUG · `PB5` CMPRSSR_CLUTCH · `PB4` HEAT_REVERSER · `PC10` EVAP_FAN · `PB9` CONDENSER_FAN · `PC4` EVAPFAN_PWM · `PC5` CPRSSRFAN_PWM.
Also set `PD5` (GPIOX0 / TP45) to GPIO_Output LOW, User Label `HEARTBEAT`. Configure **IWDG** (System Core → IWDG) enabled, prescaler/reload for ~4 s.

- [ ] **Step 4: Write `outputs_safe.h`**

```c
#ifndef OUTPUTS_SAFE_H
#define OUTPUTS_SAFE_H
/* Drive every actuator output to its de-energized state.
   Safe to call before full peripheral init; must be called first in main(). */
void outputs_all_off(void);
#endif
```

- [ ] **Step 5: Write `outputs_safe.c`**

```c
#include "outputs_safe.h"
#include "main.h"   /* CubeMX pin macros: FL_PMP_GPIO_Port / FL_PMP_Pin, etc. */

void outputs_all_off(void)
{
    /* All relay drivers (ULN2003) and PWM FETs are de-energized when driven LOW. */
    HAL_GPIO_WritePin(FL_PMP_GPIO_Port,          FL_PMP_Pin,          GPIO_PIN_RESET);
    HAL_GPIO_WritePin(STARTER_GPIO_Port,         STARTER_Pin,         GPIO_PIN_RESET);
    HAL_GPIO_WritePin(GLOW_PLUG_GPIO_Port,       GLOW_PLUG_Pin,       GPIO_PIN_RESET);
    HAL_GPIO_WritePin(CMPRSSR_CLUTCH_GPIO_Port,  CMPRSSR_CLUTCH_Pin,  GPIO_PIN_RESET);
    HAL_GPIO_WritePin(HEAT_REVERSER_GPIO_Port,   HEAT_REVERSER_Pin,   GPIO_PIN_RESET);
    HAL_GPIO_WritePin(EVAP_FAN_GPIO_Port,        EVAP_FAN_Pin,        GPIO_PIN_RESET);
    HAL_GPIO_WritePin(CONDENSER_FAN_GPIO_Port,   CONDENSER_FAN_Pin,   GPIO_PIN_RESET);
    HAL_GPIO_WritePin(EVAPFAN_PWM_GPIO_Port,     EVAPFAN_PWM_Pin,     GPIO_PIN_RESET);
    HAL_GPIO_WritePin(CPRSSRFAN_PWM_GPIO_Port,   CPRSSRFAN_PWM_Pin,   GPIO_PIN_RESET);
}
```

- [ ] **Step 6: Wire fail-safe + heartbeat into `main.c`**

In the CubeMX `USER CODE` guards only (so re-generation is safe): call `outputs_all_off();` in `/* USER CODE BEGIN 2 */` (immediately after `MX_GPIO_Init()`), and in the main `while(1)` `/* USER CODE BEGIN 3 */` add a 1 Hz heartbeat + watchdog kick:

```c
/* USER CODE BEGIN 2 */
outputs_all_off();
/* USER CODE END 2 */

/* inside while(1): USER CODE BEGIN 3 */
HAL_GPIO_TogglePin(HEARTBEAT_GPIO_Port, HEARTBEAT_Pin);
HAL_IWDG_Refresh(&hiwdg);
HAL_Delay(500);
/* USER CODE END 3 */
```
Add `#include "outputs_safe.h"` in `/* USER CODE BEGIN Includes */`. Add `firmware/g0b1-apu/App/bsp` to the project include paths and add `App/bsp` as a source location (Project → Properties → C/C++ General → Paths and Symbols).

- [ ] **Step 7: Build, flash, verify on target**

Build in CubeIDE (should be 0 errors). Flash via ST-Link (SWD, PA13/PA14). On a scope/logic analyzer on **TP45 (PD5)**: confirm a **1 Hz square wave** (500 ms toggle). Confirm with a meter that all relay-output pins sit at 0 V at boot.
Expected: heartbeat toggles; no relay pin goes high.

- [ ] **Step 8: Add `.gitignore` and commit**

```
# firmware/g0b1-apu/.gitignore
/Debug/
/Release/
*.launch
```
```bash
git add firmware/g0b1-apu/
git commit -m "feat(g0b1-apu): CubeIDE skeleton with fail-safe boot, 64MHz clock, heartbeat"
```

---

### Task 2: Host unit-test harness (CMake + Unity) + CI

**Files:**
- Create: `firmware/g0b1-apu/Tests/unity/unity.c`, `unity.h`, `unity_internals.h` (vendored from ThrowTheSwitch/Unity)
- Create: `firmware/g0b1-apu/Tests/CMakeLists.txt`
- Create: `firmware/g0b1-apu/Tests/test_smoke.c`
- Create: `.github/workflows/g0b1-apu-tests.yml`

**Interfaces:**
- Produces: a host build where `cmake -S Tests -B build && cmake --build build && ctest --test-dir build` runs Unity tests. Later tasks add `test_*.c` files and portable sources to `Tests/CMakeLists.txt`.

- [ ] **Step 1: Vendor Unity**

Download these three files from `https://github.com/ThrowTheSwitch/Unity` (`src/unity.c`, `src/unity.h`, `src/unity_internals.h`) into `firmware/g0b1-apu/Tests/unity/`.

- [ ] **Step 2: Write `Tests/CMakeLists.txt`**

```cmake
cmake_minimum_required(VERSION 3.16)
project(g0b1_apu_tests C)
set(CMAKE_C_STANDARD 11)
enable_testing()

add_library(unity STATIC unity/unity.c)
target_include_directories(unity PUBLIC unity)

# Include dirs for portable App code under test.
set(APP_INCLUDE ${CMAKE_CURRENT_SOURCE_DIR}/../App/include
                ${CMAKE_CURRENT_SOURCE_DIR}/../App/services)

# Helper to register a test executable.
function(add_unity_test name)
  add_executable(${name} ${ARGN})
  target_link_libraries(${name} unity)
  target_include_directories(${name} PRIVATE ${APP_INCLUDE})
  target_compile_options(${name} PRIVATE -Wall -Wextra -Werror -funsigned-char)
  add_test(NAME ${name} COMMAND ${name})
endfunction()

add_unity_test(test_smoke test_smoke.c)
```

- [ ] **Step 3: Write `Tests/test_smoke.c`**

```c
#include "unity.h"
void setUp(void) {}
void tearDown(void) {}
static void test_harness_runs(void) { TEST_ASSERT_EQUAL_INT(2, 1 + 1); }
int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_harness_runs);
    return UNITY_END();
}
```

- [ ] **Step 4: Run it locally to verify it passes**

Run: `cmake -S firmware/g0b1-apu/Tests -B firmware/g0b1-apu/Tests/build && cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build --output-on-failure`
Expected: `1/1 Test #1: test_smoke ... Passed`.

- [ ] **Step 5: Write the CI workflow**

```yaml
# .github/workflows/g0b1-apu-tests.yml
name: g0b1-apu host tests
on:
  push: { paths: ["firmware/g0b1-apu/**", ".github/workflows/g0b1-apu-tests.yml"] }
  pull_request: { paths: ["firmware/g0b1-apu/**"] }
jobs:
  host-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Configure
        run: cmake -S firmware/g0b1-apu/Tests -B firmware/g0b1-apu/Tests/build
      - name: Build
        run: cmake --build firmware/g0b1-apu/Tests/build
      - name: Test
        run: ctest --test-dir firmware/g0b1-apu/Tests/build --output-on-failure
```

- [ ] **Step 6: Add build dir to gitignore and commit**

Append `/Tests/build/` to `firmware/g0b1-apu/.gitignore`.
```bash
git add firmware/g0b1-apu/Tests .github/workflows/g0b1-apu-tests.yml firmware/g0b1-apu/.gitignore
git commit -m "test(g0b1-apu): add Unity+CMake host harness and CI"
```

---

### Task 3: `types.h` — real fixed-width types

**Files:**
- Create: `firmware/g0b1-apu/App/include/types.h`
- Create: `firmware/g0b1-apu/Tests/test_types.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt` (register `test_types`)

**Interfaces:**
- Produces: `types.h` defining the legacy aliases (`UINT8/UINT16/INT16/UINT32/BYTE/WORD`) as thin typedefs over `<stdint.h>`, plus `TRUE/FALSE/ON/OFF`. Every later portable source includes this instead of the PIC `types.h`.

- [ ] **Step 1: Write the failing test `Tests/test_types.c`**

```c
#include "unity.h"
#include "types.h"
void setUp(void) {} void tearDown(void) {}
static void test_widths(void) {
    TEST_ASSERT_EQUAL_UINT(1, sizeof(UINT8));
    TEST_ASSERT_EQUAL_UINT(2, sizeof(UINT16));
    TEST_ASSERT_EQUAL_UINT(2, sizeof(INT16));
    TEST_ASSERT_EQUAL_UINT(4, sizeof(UINT32));
}
static void test_u16_wraps_at_16_bits(void) {
    UINT16 v = 0xFFFF; v = (UINT16)(v + 1);
    TEST_ASSERT_EQUAL_HEX16(0x0000, v);   /* would fail if UINT16 were 32-bit */
}
int main(void){ UNITY_BEGIN(); RUN_TEST(test_widths); RUN_TEST(test_u16_wraps_at_16_bits); return UNITY_END(); }
```

- [ ] **Step 2: Register the test and run to verify it fails**

Add to `Tests/CMakeLists.txt`: `add_unity_test(test_types test_types.c)`.
Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_types`
Expected: build FAILS — `types.h` not found.

- [ ] **Step 3: Write `App/include/types.h`**

```c
#ifndef APP_TYPES_H
#define APP_TYPES_H
#include <stdint.h>
#include <stdbool.h>

typedef uint8_t  UINT8;
typedef uint8_t  BYTE;
typedef uint16_t UINT16;
typedef uint16_t WORD;
typedef int16_t  INT16;
typedef uint32_t UINT32;
typedef int32_t  INT32;

#ifndef TRUE
#define TRUE  1
#define FALSE 0
#endif
#ifndef ON
#define ON  1
#define OFF 0
#endif
#endif /* APP_TYPES_H */
```

- [ ] **Step 4: Reconfigure (new file) and run to verify it passes**

Run: `cmake -S firmware/g0b1-apu/Tests -B firmware/g0b1-apu/Tests/build && cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_types --output-on-failure`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add firmware/g0b1-apu/App/include/types.h firmware/g0b1-apu/Tests/test_types.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): add stdint-based types.h with width tests"
```

---

### Task 4: Modbus CRC-16

**Files:**
- Create: `firmware/g0b1-apu/App/services/modbus_crc.h`, `firmware/g0b1-apu/App/services/modbus_crc.c`
- Create: `firmware/g0b1-apu/Tests/test_modbus_crc.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Produces: `uint16_t modbus_crc16(const uint8_t *data, uint16_t len);` — standard Modbus RTU CRC (poly 0xA001, init 0xFFFF).

- [ ] **Step 1: Write the failing test `Tests/test_modbus_crc.c`**

```c
#include "unity.h"
#include <string.h>
#include "modbus_crc.h"
void setUp(void){} void tearDown(void){}

/* CRC-16/MODBUS catalog check value for ASCII "123456789" is 0x4B37. */
static void test_known_answer(void) {
    const uint8_t s[] = {'1','2','3','4','5','6','7','8','9'};
    TEST_ASSERT_EQUAL_HEX16(0x4B37, modbus_crc16(s, sizeof(s)));
}
/* Property: CRC over (message + its own CRC appended low-byte-first) == 0. */
static void test_roundtrip_is_zero(void) {
    uint8_t f[8] = {0x01,0x03,0x00,0x00,0x00,0x01,0,0};
    uint16_t c = modbus_crc16(f, 6);
    f[6] = (uint8_t)(c & 0xFF);         /* CRC low byte first on the wire */
    f[7] = (uint8_t)(c >> 8);
    TEST_ASSERT_EQUAL_HEX16(0x0000, modbus_crc16(f, 8));
}
int main(void){ UNITY_BEGIN(); RUN_TEST(test_known_answer); RUN_TEST(test_roundtrip_is_zero); return UNITY_END(); }
```

- [ ] **Step 2: Register + run to verify it fails**

Add `add_unity_test(test_modbus_crc test_modbus_crc.c ../App/services/modbus_crc.c)` to `Tests/CMakeLists.txt`.
Run: `cmake -S firmware/g0b1-apu/Tests -B firmware/g0b1-apu/Tests/build && cmake --build firmware/g0b1-apu/Tests/build`
Expected: build FAILS — `modbus_crc.h`/`modbus_crc16` missing.

- [ ] **Step 3: Write `modbus_crc.h`**

```c
#ifndef MODBUS_CRC_H
#define MODBUS_CRC_H
#include <stdint.h>
/* Modbus RTU CRC-16: poly 0xA001 (reflected), init 0xFFFF, xorout 0x0000. */
uint16_t modbus_crc16(const uint8_t *data, uint16_t len);
#endif
```

- [ ] **Step 4: Write `modbus_crc.c`**

```c
#include "modbus_crc.h"
uint16_t modbus_crc16(const uint8_t *data, uint16_t len)
{
    uint16_t crc = 0xFFFFu;
    for (uint16_t i = 0; i < len; i++) {
        crc ^= (uint16_t)data[i];
        for (uint8_t b = 0; b < 8; b++) {
            if (crc & 0x0001u) { crc = (uint16_t)((crc >> 1) ^ 0xA001u); }
            else               { crc = (uint16_t)(crc >> 1); }
        }
    }
    return crc;
}
```

- [ ] **Step 5: Build + run to verify it passes**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_modbus_crc --output-on-failure`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add firmware/g0b1-apu/App/services/modbus_crc.* firmware/g0b1-apu/Tests/test_modbus_crc.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): Modbus CRC-16 with known-answer + roundtrip tests"
```

---

### Task 5: RTU frame validation

**Files:**
- Create: `firmware/g0b1-apu/App/services/modbus_frame.h`, `firmware/g0b1-apu/App/services/modbus_frame.c`
- Create: `firmware/g0b1-apu/Tests/test_modbus_frame.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `modbus_crc16()` (Task 4).
- Produces:
  ```c
  typedef enum { MB_FRAME_OK, MB_FRAME_TOO_SHORT, MB_FRAME_NOT_FOR_US, MB_FRAME_BAD_CRC } mb_frame_status_t;
  mb_frame_status_t mb_check_frame(const uint8_t *buf, uint16_t len, uint8_t our_addr);
  ```
  A valid frame is `≥4` bytes, `buf[0]==our_addr || buf[0]==0` (broadcast), and the trailing 2 bytes equal `modbus_crc16(buf, len-2)` (low byte first).

- [ ] **Step 1: Write the failing test `Tests/test_modbus_frame.c`**

```c
#include "unity.h"
#include "modbus_crc.h"
#include "modbus_frame.h"
void setUp(void){} void tearDown(void){}

static void append_crc(uint8_t *f, uint16_t core_len) {
    uint16_t c = modbus_crc16(f, core_len);
    f[core_len] = (uint8_t)(c & 0xFF);
    f[core_len+1] = (uint8_t)(c >> 8);
}
static void test_ok(void) {
    uint8_t f[8] = {0x01,0x03,0x00,0x00,0x00,0x01,0,0};
    append_crc(f, 6);
    TEST_ASSERT_EQUAL(MB_FRAME_OK, mb_check_frame(f, 8, 0x01));
}
static void test_broadcast_ok(void) {
    uint8_t f[8] = {0x00,0x06,0x00,0x0A,0x00,0x01,0,0};
    append_crc(f, 6);
    TEST_ASSERT_EQUAL(MB_FRAME_OK, mb_check_frame(f, 8, 0x01));
}
static void test_too_short(void) {
    uint8_t f[3] = {0x01,0x03,0x00};
    TEST_ASSERT_EQUAL(MB_FRAME_TOO_SHORT, mb_check_frame(f, 3, 0x01));
}
static void test_not_for_us(void) {
    uint8_t f[8] = {0x02,0x03,0x00,0x00,0x00,0x01,0,0};
    append_crc(f, 6);
    TEST_ASSERT_EQUAL(MB_FRAME_NOT_FOR_US, mb_check_frame(f, 8, 0x01));
}
static void test_bad_crc(void) {
    uint8_t f[8] = {0x01,0x03,0x00,0x00,0x00,0x01,0xDE,0xAD};
    TEST_ASSERT_EQUAL(MB_FRAME_BAD_CRC, mb_check_frame(f, 8, 0x01));
}
int main(void){
    UNITY_BEGIN();
    RUN_TEST(test_ok); RUN_TEST(test_broadcast_ok); RUN_TEST(test_too_short);
    RUN_TEST(test_not_for_us); RUN_TEST(test_bad_crc);
    return UNITY_END();
}
```

- [ ] **Step 2: Register + run to verify it fails**

Add `add_unity_test(test_modbus_frame test_modbus_frame.c ../App/services/modbus_frame.c ../App/services/modbus_crc.c)`.
Run: `cmake -S firmware/g0b1-apu/Tests -B firmware/g0b1-apu/Tests/build && cmake --build firmware/g0b1-apu/Tests/build`
Expected: build FAILS — `modbus_frame.h` missing.

- [ ] **Step 3: Write `modbus_frame.h`**

```c
#ifndef MODBUS_FRAME_H
#define MODBUS_FRAME_H
#include <stdint.h>
typedef enum { MB_FRAME_OK, MB_FRAME_TOO_SHORT, MB_FRAME_NOT_FOR_US, MB_FRAME_BAD_CRC } mb_frame_status_t;
/* Validate an RTU frame: length >=4, address match/broadcast, trailing CRC (lo,hi). */
mb_frame_status_t mb_check_frame(const uint8_t *buf, uint16_t len, uint8_t our_addr);
#endif
```

- [ ] **Step 4: Write `modbus_frame.c`**

```c
#include "modbus_frame.h"
#include "modbus_crc.h"

mb_frame_status_t mb_check_frame(const uint8_t *buf, uint16_t len, uint8_t our_addr)
{
    if (len < 4u) return MB_FRAME_TOO_SHORT;
    if (buf[0] != our_addr && buf[0] != 0x00u) return MB_FRAME_NOT_FOR_US;
    uint16_t calc = modbus_crc16(buf, (uint16_t)(len - 2u));
    uint16_t recv = (uint16_t)(buf[len - 2u] | ((uint16_t)buf[len - 1u] << 8));
    if (calc != recv) return MB_FRAME_BAD_CRC;
    return MB_FRAME_OK;
}
```

- [ ] **Step 5: Build + run to verify it passes**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_modbus_frame --output-on-failure`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add firmware/g0b1-apu/App/services/modbus_frame.* firmware/g0b1-apu/Tests/test_modbus_frame.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): RTU frame validation (len/addr/CRC)"
```

---

### Task 6: FC-0x03 read-holding response builder (with exception path)

**Files:**
- Create: `firmware/g0b1-apu/App/services/modbus_read.h`, `firmware/g0b1-apu/App/services/modbus_read.c`
- Create: `firmware/g0b1-apu/Tests/test_modbus_read.c`
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `modbus_crc16()` (Task 4).
- Produces:
  ```c
  /* Read one register into *out; return false => illegal data address (exception 0x02). */
  typedef bool (*mb_reg_read_fn)(uint16_t reg, uint16_t *out);
  /* Build an FC-0x03 response for [start .. start+count-1] into resp (must hold >= 5 + 2*count).
     On any unreadable register, builds an exception response instead.
     Returns total response length including the trailing CRC. */
  uint16_t mb_build_read_holding(uint8_t addr, uint16_t start, uint16_t count,
                                 mb_reg_read_fn reader, uint8_t *resp);
  ```
  Response layout: `addr, 0x03, byte_count(=2*count), hi,lo per reg (big-endian), crc_lo, crc_hi`. Exception: `addr, 0x83, 0x02, crc_lo, crc_hi`.

- [ ] **Step 1: Write the failing test `Tests/test_modbus_read.c`**

```c
#include "unity.h"
#include "modbus_crc.h"
#include "modbus_read.h"
void setUp(void){} void tearDown(void){}

/* Mock register model: reg 1 -> 0x1234, reg 2 -> 0xABCD, others illegal. */
static bool mock_reader(uint16_t reg, uint16_t *out) {
    if (reg == 1) { *out = 0x1234; return true; }
    if (reg == 2) { *out = 0xABCD; return true; }
    return false;
}
static void test_reads_two_registers(void) {
    uint8_t r[16];
    uint16_t n = mb_build_read_holding(0x01, 1, 2, mock_reader, r);
    TEST_ASSERT_EQUAL_UINT16(9, n);           /* 3 hdr + 4 data + 2 crc */
    TEST_ASSERT_EQUAL_HEX8(0x01, r[0]);
    TEST_ASSERT_EQUAL_HEX8(0x03, r[1]);
    TEST_ASSERT_EQUAL_HEX8(0x04, r[2]);       /* byte count */
    TEST_ASSERT_EQUAL_HEX8(0x12, r[3]);       /* reg1 hi (big-endian) */
    TEST_ASSERT_EQUAL_HEX8(0x34, r[4]);
    TEST_ASSERT_EQUAL_HEX8(0xAB, r[5]);       /* reg2 hi */
    TEST_ASSERT_EQUAL_HEX8(0xCD, r[6]);
    TEST_ASSERT_EQUAL_HEX16(0x0000, modbus_crc16(r, n)); /* valid trailing CRC */
}
static void test_illegal_address_exception(void) {
    uint8_t r[16];
    uint16_t n = mb_build_read_holding(0x01, 1, 5, mock_reader, r); /* reg 3 illegal */
    TEST_ASSERT_EQUAL_UINT16(5, n);
    TEST_ASSERT_EQUAL_HEX8(0x83, r[1]);       /* func | 0x80 */
    TEST_ASSERT_EQUAL_HEX8(0x02, r[2]);       /* illegal data address */
    TEST_ASSERT_EQUAL_HEX16(0x0000, modbus_crc16(r, n));
}
int main(void){ UNITY_BEGIN(); RUN_TEST(test_reads_two_registers); RUN_TEST(test_illegal_address_exception); return UNITY_END(); }
```

- [ ] **Step 2: Register + run to verify it fails**

Add `add_unity_test(test_modbus_read test_modbus_read.c ../App/services/modbus_read.c ../App/services/modbus_crc.c)`.
Run: `cmake -S firmware/g0b1-apu/Tests -B firmware/g0b1-apu/Tests/build && cmake --build firmware/g0b1-apu/Tests/build`
Expected: build FAILS — `modbus_read.h` missing.

- [ ] **Step 3: Write `modbus_read.h`**

```c
#ifndef MODBUS_READ_H
#define MODBUS_READ_H
#include <stdint.h>
#include <stdbool.h>
typedef bool (*mb_reg_read_fn)(uint16_t reg, uint16_t *out);
uint16_t mb_build_read_holding(uint8_t addr, uint16_t start, uint16_t count,
                               mb_reg_read_fn reader, uint8_t *resp);
#endif
```

- [ ] **Step 4: Write `modbus_read.c`**

```c
#include "modbus_read.h"
#include "modbus_crc.h"

static uint16_t append_crc(uint8_t *resp, uint16_t len) {
    uint16_t c = modbus_crc16(resp, len);
    resp[len]     = (uint8_t)(c & 0xFF);
    resp[len + 1] = (uint8_t)(c >> 8);
    return (uint16_t)(len + 2u);
}
static uint16_t build_exception(uint8_t *resp, uint8_t addr, uint8_t func, uint8_t code) {
    resp[0] = addr;
    resp[1] = (uint8_t)(func | 0x80u);
    resp[2] = code;
    return append_crc(resp, 3u);
}

uint16_t mb_build_read_holding(uint8_t addr, uint16_t start, uint16_t count,
                               mb_reg_read_fn reader, uint8_t *resp)
{
    uint8_t data[256];
    uint16_t di = 0;
    for (uint16_t i = 0; i < count; i++) {
        uint16_t v;
        if (!reader((uint16_t)(start + i), &v)) {
            return build_exception(resp, addr, 0x03u, 0x02u); /* illegal data address */
        }
        data[di++] = (uint8_t)(v >> 8);   /* big-endian */
        data[di++] = (uint8_t)(v & 0xFF);
    }
    resp[0] = addr;
    resp[1] = 0x03u;
    resp[2] = (uint8_t)(2u * count);
    for (uint16_t i = 0; i < di; i++) resp[3 + i] = data[i];
    return append_crc(resp, (uint16_t)(3u + di));
}
```

- [ ] **Step 5: Build + run to verify it passes**

Run: `cmake --build firmware/g0b1-apu/Tests/build && ctest --test-dir firmware/g0b1-apu/Tests/build -R test_modbus_read --output-on-failure`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the full suite**

Run: `ctest --test-dir firmware/g0b1-apu/Tests/build --output-on-failure`
Expected: all tests pass (smoke, types, crc, frame, read).

- [ ] **Step 7: Commit**

```bash
git add firmware/g0b1-apu/App/services/modbus_read.* firmware/g0b1-apu/Tests/test_modbus_read.c firmware/g0b1-apu/Tests/CMakeLists.txt
git commit -m "feat(g0b1-apu): FC-0x03 read-holding response builder with exception path"
```

---

### Task 6 — Amendment (2026-08-12, applied)

During review, `mb_build_read_holding` as written above was found to overflow its local `data[256]` when `count > 128` (buffer sized independently of `count`; ASan-confirmed). Hardened in commit `6367da1`:
1. Reject out-of-range quantity — `if (count < 1u || count > 125u) return build_exception(resp, addr, 0x03u, 0x03u);` (exception `0x03` ILLEGAL DATA VALUE) before the loop.
2. Drop the `data[256]` staging buffer; write register bytes directly into `resp[3 + 2*i]` (hi) / `resp[3 + 2*i + 1]` (lo), so the only size ceiling is the caller's `resp` buffer.
3. Document the caller contract in `modbus_read.h`: `resp` must hold `≥ 5 + 2*count` bytes (≤ 255 for the max valid count of 125).
4. Add tests `test_count_over_max_exception` (count=200 → 0x83/0x03) and `test_count_zero_exception` (count=0 → 0x83/0x03).

Full suite 5/5 green after the fix. Future re-runs of this plan should apply the hardened version, not the `data[256]` version shown in Step 4.

## Milestone Exit Criteria

- Target: CubeIDE project builds and flashes; TP45 heartbeat at 1 Hz; all relay outputs low at boot; IWDG refreshed.
- Host: `ctest` green for smoke, types (width/wrap), CRC (known-answer + roundtrip), frame validation, FC-0x03 builder (+exception); CI workflow passes on push.
- The portable Modbus core (CRC, frame check, read builder) is ready for Milestone 4 to wire to the USART driver and full register model.

## Self-Review Notes (coverage vs spec)

- Spec §3 (layering, project structure) → Tasks 1–2 establish `App/` + host harness. ✓
- Spec §9.1 (`types.h` stdint fix) → Task 3. ✓
- Spec §7.4 (RTU engine: CRC 0xA001, framing, FC dispatch) → Tasks 4–6 (CRC, frame, FC03). Remaining FCs (0x06/0x10/0x08/etc.) + USART wiring deferred to Milestone 4 (documented). ✓
- Spec §9.3 (fail-safe outputs at boot) → Task 1 `outputs_all_off()`. ✓
- Spec §4 (64 MHz clock, IWDG) → Task 1. ✓
- Deferred to later milestones by design: NVM (M2), sensors (M3), RTC/params/USART (M4), BSP/scheduler (M5), control (M6).
