# VEVOR Diesel Heater — STM32 Firmware Implementation Plan (Sub-project #1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the STM32G0B1 (gobi/APU controller) the ability to run a VEVOR XMZ-F-D5 diesel air heater over a DFRobot DFR0627 / WK2132 I2C-to-UART bridge — forwarding start/stop/level to the heater's own ECU and exposing its state + telemetry over new Modbus holding registers — with the heater's verified one-wire protocol preserved and host-tested.

**Architecture:** Robb's **verified** `vevor_heater.c` (frame build/parse/checksum + nonblocking FSM) is preserved intact; its only hardware touch is `WK2132_Read/Write`. The **provisional** `wk2132.c` is decoupled from HAL through a new 4-op I2C backend seam (`mem_read/mem_write/tx/rx`) so both compile into the project's Unity host-test harness (against a fake WK2132 + the two captured logs) while a thin on-target `drv_wk2132_i2c2.c` binds the seam to HAL I2C2. A `heater.c` service maps new Modbus command registers onto the FSM and snapshots telemetry into read-only registers. The STM32 is a **relay + reporter**; the heater ECU keeps combustion and safety.

**Tech Stack:** C11 (STM32 firmware), STM32CubeIDE project at `cube/` with portable logic in `App/services/*` linked via Eclipse linked-resources, Unity + CMake host tests (`Tests/`) with backend `fakes/`, HAL I2C2 on the target.

**Spec:** `docs/superpowers/specs/2026-09-03-vevor-heater-control-design.md` (Component F1). **This plan is Sub-project #1.** Sub-project #2 (gobi-agent + gobi-ui) is a separate plan and consumes the register map frozen here.

**Target repo for ALL file paths below:** `g0b1-firmware` (`~/Documents/github/g0b1-firmware`, branch `main`). The CubeIDE project is `cube/`; portable services are `App/services/`; host tests are `Tests/`. **Source material** (Robb's handoff, verified protocol + provisional driver + captures) is provided separately; the exact supplied files are reproduced inline in the tasks below.

## Global Constraints

- **The VEVOR protocol layer is VERIFIED — do NOT re-derive it or substitute other Chinese-heater protocols.** Preserve `vevor_heater.c`'s frame build/parse/checksum and FSM byte-for-byte; the only permitted change is the transport seam (it calls `WK2132_Read/Write`, which stay same-signature).
- **Wire protocol (frozen):** heater link 4800 8N1. Controller frame 16 bytes `AA 66 … CS@15`; heater frame 56 bytes `AA 77 … CS@55`. Checksum = `sum(frame[2 : csum_index]) & 0xFF`. Start = `CC=06 SS=06 QQ=00` ×4 then run; Run = `CC=02 SS=06 QQ=02`; Stop = `CC=06 SS=05 QQ=00` until heater state 00. Level `LL` 01–0A.
- **Safety (paramount — fuel-fired device):** Never stop by removing power. Comms loss / MCU reset / mode change is a **fault + keep reporting**, never a stop or power-cut. Only a **fresh (≤3 s), checksum-valid state-00** response sets `safe_to_power_down`. On reset, init to stop-request but keep polling; never force-restart a heater found already running. Cooldown is non-blocking (tick-driven) — never `HAL_Delay` in operating sequences.
- **Hardware:** DFR0627/WK2132 on **I2C2 = PA11 (SCL) / PB14 (SDA)** (both currently free). WK2132 base 7-bit address 0x70 (DIP A1=1, A0=1); channel + register/FIFO object encoded in the low address bits (`hal_addr()`). WK2132 UART1, 4800 8N1, divisor register 191 for a 14.7456 MHz crystal. Init the bridge only after the switched 3P3_VCC rail is stable.
- **Register block (frozen for Sub-project #2):** heater registers **53–67** (command 53–54, telemetry 55–67), **68–70 reserved** for a future thermostat mode. Requires `MB_REG_MAX` 52→70 and `MB_REG_LIMIT` 53→71. This does NOT touch the frozen bootloader FC 0x41/0x42 contract or regs 2/34/35.
- **Host-test everything host-testable** via `Tests/` (Unity + CMake + `fakes/`), following the existing `add_unity_test(...)` pattern and the `i2c_backend`-style seam the RTC uses. Keep portable modules free of HAL/CubeMX deps.
- **Code style:** match the existing `App/services` C (C11, `{port,pin}`-table drivers behind backends, `mbp_*` Modbus binding layer). Warning-clean.

---

## File Structure

**New portable modules (`App/services/`, host-tested):**
- `wk2132.h` / `wk2132.c` — WK2132 register + FIFO driver, decoupled from HAL via a `wk2132_i2c_t` backend (adapted from the supplied provisional driver).
- `vevor_heater.h` / `vevor_heater.c` — verified protocol generator/parser/telemetry-decoder + nonblocking FSM (supplied, preserved; compiles against the ported `wk2132.h`).
- `heater.h` / `heater.c` — the service: owns the `VEVOR_t` + `WK2132_t`, maps Modbus command regs onto `VEVOR_Start/SetLevel/Stop`, and snapshots telemetry (`heater_telemetry_t`) for the register providers. Computes the flags word (fresh/cooldown/safe/comms-fault/transport-fault) and saturating `age_ms`.
- `mbp_heater.h` / `mbp_heater.c` — Modbus register providers: binds regs 53–67 (`mb_reg_bind`), RO where write-fn is NULL.

**New on-target driver (`cube/Core/`, compiled into firmware, NOT host-unit-tested — bench-verified):**
- `cube/Core/Inc/drv_wk2132_i2c2.h` / `cube/Core/Src/drv_wk2132_i2c2.c` — implements `wk2132_i2c_t` over HAL I2C2, exposes `drv_wk2132_i2c2_backend()`.

**New host tests / fakes (`Tests/`):**
- `Tests/fakes/fake_wk2132_i2c.h` / `.c` — in-memory WK2132 (register file + TX capture + injectable RX), implements `wk2132_i2c_t`.
- `Tests/test_wk2132.c`, `Tests/test_vevor.c`, `Tests/test_heater.c`, `Tests/test_mbp_heater.c`.
- `Tests/fixtures/capture1.hex`, `Tests/fixtures/capture2.hex` — the two raw HTerm logs (continuous hex).
- `Tests/CMakeLists.txt` — add the four new `add_unity_test(...)` entries.

**Modified firmware files:**
- `App/services/modbus_defs.h` — `MB_REG_MAX` 52→70, `MB_REG_LIMIT` 53→71.
- `cube/g0b1-apu.ioc` — enable I2C2 (PA11 SCL / PB14 SDA), generate `MX_I2C2_Init`/`hi2c2`.
- `cube/Core/Src/main.c` — generated I2C2 init (CubeMX output).
- `cube/Core/Src/app_main.c` — heater init after I2C2 + rail stable; `heater_process(HAL_GetTick())` in the superloop; register `mbp_heater`.
- `cube/.project` — Eclipse `<link>` entries for `wk2132.c`, `vevor_heater.c`, `heater.c`, `mbp_heater.c`.
- Any fixed-size `Tests/` array keyed off `MB_REG_MAX` (grep and bump).

**Docs:** `docs/vevor-heater.md` — bring-up + register map + safety.

---

## Phase 0 — WK2132 host-testable port (host-TDD)

### Task 1: WK2132 driver decoupled from HAL via a backend seam + fake + tests

**Files:** Create `App/services/wk2132.h`, `App/services/wk2132.c`, `Tests/fakes/fake_wk2132_i2c.h`, `Tests/fakes/fake_wk2132_i2c.c`, `Tests/test_wk2132.c`; Modify `Tests/CMakeLists.txt`.

**Interfaces:**
- Produces `wk2132_i2c_t` (the backend seam) and the ported WK2132 API:
```c
/* wk2132.h — backend seam: the four I2C ops the WK2132 needs. Each returns
   0 on success, non-zero on I2C error. addr7 is the 7-bit device address
   the driver computes (channel/object encoded); the on-target backend shifts
   it for HAL, the fake decodes it. */
typedef struct wk2132_i2c {
    int (*mem_read) (void *ctx, uint8_t addr7, uint8_t reg, uint8_t *buf, uint16_t len);
    int (*mem_write)(void *ctx, uint8_t addr7, uint8_t reg, const uint8_t *buf, uint16_t len);
    int (*tx)(void *ctx, uint8_t addr7, const uint8_t *buf, uint16_t len);
    int (*rx)(void *ctx, uint8_t addr7, uint8_t *buf, uint16_t len);
    void *ctx;
} wk2132_i2c_t;

typedef enum { WK2132_OK=0, WK2132_BAD_ARG, WK2132_I2C_ERROR,
               WK2132_NOT_DETECTED, WK2132_FIFO_FULL } WK2132_Result_t;

typedef struct {
    const wk2132_i2c_t *bus;
    uint8_t  base_addr_7bit;
    uint8_t  channel;
    uint32_t i2c_errors;
} WK2132_t;

WK2132_Result_t WK2132_Init(WK2132_t *dev, const wk2132_i2c_t *bus,
                            uint8_t channel, bool ia1, bool ia0);
WK2132_Result_t WK2132_Begin4800_8N1(WK2132_t *dev);
WK2132_Result_t WK2132_Write(WK2132_t *dev, const uint8_t *data, size_t length);
WK2132_Result_t WK2132_RxAvailable(WK2132_t *dev, uint16_t *count);
WK2132_Result_t WK2132_Read(WK2132_t *dev, uint8_t *data, size_t capacity, size_t *read_count);
WK2132_Result_t WK2132_FlushRx(WK2132_t *dev);
```
- Consumed by: `vevor_heater.c` (Task 2, unchanged calls), `drv_wk2132_i2c2.c` (Task 5), the fake (this task).

**Key adaptation vs. the supplied `wk2132.c`:** replace `I2C_HandleTypeDef *hi2c` with `const wk2132_i2c_t *bus`; `reg_read/reg_write` call `bus->mem_read/mem_write(ctx, hal_addr(dev,REGISTER), reg, buf, len)`; `WK2132_Write` calls `bus->tx(ctx, hal_addr(dev,FIFO), data, len)`; `WK2132_Read` calls `bus->rx(ctx, hal_addr(dev,FIFO), data, len)`. **`hal_addr()` returns the 7-bit address** (drop the `<<1` — the on-target backend does the HAL shift; the supplied code shifted here). Preserve ALL register constants, the GENA presence check, channel enable/reset, `set_page`, the divisor math (`14745600/(16*4800)-1 = 191`), and the FCR/LCR/SCR/SIER sequence exactly. No HAL include in `wk2132.h`/`.c`.

- [ ] **Step 1: Write `fake_wk2132_i2c` + `test_wk2132.c` (failing).** The fake models one WK2132: a 256-byte register file per page (SPAGE latch selects page-0 vs page-1 register banks for the BAUD regs), `GENA` preset to `0x80` (presence bit set) so `Begin4800_8N1` passes detection; `FSR` returns TX-not-full + a settable RX-data bit; `RFCNT` returns the injected RX depth; `mem_write` stores register values (tracking the divisor bytes written to BAUD1/BAUD0 on page 1); `tx` appends to a TX-capture buffer; `rx` returns up to `len` bytes from an injectable RX buffer. Expose helpers: `fake_wk2132_reset()`, `fake_wk2132_set_gena_present(bool)`, `fake_wk2132_inject_rx(const uint8_t*, size_t)`, `fake_wk2132_tx_len()`, `fake_wk2132_tx_data()`, `fake_wk2132_divisor()`, and `fake_wk2132_i2c()` returning a `const wk2132_i2c_t*`. `test_wk2132.c`:
```c
#include "wk2132.h"
#include "fake_wk2132_i2c.h"
#include "unity.h"
static WK2132_t dev;
void setUp(void){ fake_wk2132_reset(); TEST_ASSERT_EQUAL(WK2132_OK,
    WK2132_Init(&dev, fake_wk2132_i2c(), 0U, true, true)); }
void tearDown(void){}

void test_base_address_from_dip(void){ /* A1=1,A0=1 -> 0x70 base */
    TEST_ASSERT_EQUAL_HEX8(0x70U, dev.base_addr_7bit); }

void test_begin_sets_4800_divisor(void){
    TEST_ASSERT_EQUAL(WK2132_OK, WK2132_Begin4800_8N1(&dev));
    TEST_ASSERT_EQUAL_UINT16(191U, fake_wk2132_divisor()); }

void test_begin_not_detected_when_gena_clear(void){
    fake_wk2132_set_gena_present(false);
    TEST_ASSERT_EQUAL(WK2132_NOT_DETECTED, WK2132_Begin4800_8N1(&dev)); }

void test_write_pushes_frame_to_fifo(void){
    (void)WK2132_Begin4800_8N1(&dev);
    uint8_t f[16]={0xAA,0x66,0x02,0x0B,0,0,0,0,1,0x06,0x02,0,0,0,0,0x16};
    TEST_ASSERT_EQUAL(WK2132_OK, WK2132_Write(&dev, f, sizeof f));
    TEST_ASSERT_EQUAL_UINT(16U, fake_wk2132_tx_len());
    TEST_ASSERT_EQUAL_HEX8_ARRAY(f, fake_wk2132_tx_data(), 16); }

void test_read_returns_injected_rx(void){
    (void)WK2132_Begin4800_8N1(&dev);
    uint8_t inj[3]={0xAA,0x77,0x02}; fake_wk2132_inject_rx(inj, 3);
    uint8_t buf[8]; size_t n=0;
    TEST_ASSERT_EQUAL(WK2132_OK, WK2132_Read(&dev, buf, sizeof buf, &n));
    TEST_ASSERT_EQUAL_UINT(3U, n);
    TEST_ASSERT_EQUAL_HEX8_ARRAY(inj, buf, 3); }
int main(void){ UNITY_BEGIN();
    RUN_TEST(test_base_address_from_dip); RUN_TEST(test_begin_sets_4800_divisor);
    RUN_TEST(test_begin_not_detected_when_gena_clear);
    RUN_TEST(test_write_pushes_frame_to_fifo); RUN_TEST(test_read_returns_injected_rx);
    return UNITY_END(); }
```
Add to `Tests/CMakeLists.txt`: `add_unity_test(test_wk2132 test_wk2132.c ../App/services/wk2132.c fakes/fake_wk2132_i2c.c)`.

- [ ] **Step 2: Run to verify it fails** — build `Tests/` (the existing CMake host build); `test_wk2132` fails to compile/link (wk2132.c not yet ported to the backend).

- [ ] **Step 3: Port `wk2132.c` + write `wk2132.h`** per the adaptation above.

- [ ] **Step 4: Run to verify it passes** — `test_wk2132` green (5/5), and the whole `Tests/` suite still builds + passes.

- [ ] **Step 5: Commit** — `git add App/services/wk2132.* Tests/fakes/fake_wk2132_i2c.* Tests/test_wk2132.c Tests/CMakeLists.txt && git commit -m "feat(heater): WK2132 I2C-UART driver decoupled from HAL via backend seam (host-tested)"`

---

## Phase 1 — Verified VEVOR protocol into the project (host-TDD)

### Task 2: VEVOR protocol layer + frame-builder + captured-frame regression

**Files:** Create `App/services/vevor_heater.h`, `App/services/vevor_heater.c`, `Tests/test_vevor.c`, `Tests/fixtures/capture1.hex`, `Tests/fixtures/capture2.hex`; Modify `Tests/CMakeLists.txt`.

**Interfaces:**
- `vevor_heater.h`/`.c` are the **supplied verified files, preserved** (see the handoff `stm32/Core/{Inc,Src}/vevor_heater.{h,c}`). They already depend only on `wk2132.h` (`WK2132_t`, `WK2132_Read/Write`) and `<stdint.h>`/`<stdbool.h>`/`<string.h>` — after Task 1 they compile with no HAL. Do not change their logic. Produces (consumed by Task 3): `VEVOR_t`, `VEVOR_Status_t`, `VEVOR_Init/Process/Start/SetLevel/Stop`, `VEVOR_IsResponseFresh/IsSafeToPowerDown`, `VEVOR_Build{Start,Run,Stop}Frame`, `VEVOR_Checksum`, and the reported/request enums.

- [ ] **Step 1: Add the two capture logs as fixtures.** Copy the handoff's `output_2026-09-03_17-06-34.log` → `Tests/fixtures/capture1.hex` and `output_2026-09-03_17-23-50.log` → `Tests/fixtures/capture2.hex` verbatim (each is one continuous hex string of interleaved `AA66…`(16B) and `AA77…`(56B) frames).

- [ ] **Step 2: Write `test_vevor.c` (failing).** Two groups — byte-exact builders, and a checksum regression over every heater frame in both fixtures:
```c
#include "vevor_heater.h"
#include "unity.h"
#include <stdio.h>
#include <string.h>
void setUp(void){} void tearDown(void){}

void test_build_frames_byte_exact(void){
    uint8_t f[16];
    const uint8_t start1[16]={0xAA,0x66,0x06,0x0B,0,0,0,0,1,0x06,0,0,0,0,0,0x18};
    const uint8_t run10[16] ={0xAA,0x66,0x02,0x0B,0,0,0,0,10,0x06,0x02,0,0,0,0,0x1F};
    const uint8_t stop1[16] ={0xAA,0x66,0x06,0x0B,0,0,0,0,1,0x05,0,0,0,0,0,0x17};
    VEVOR_BuildStartFrame(1U,f);  TEST_ASSERT_EQUAL_HEX8_ARRAY(start1,f,16);
    VEVOR_BuildRunFrame(10U,f);   TEST_ASSERT_EQUAL_HEX8_ARRAY(run10,f,16);
    VEVOR_BuildStopFrame(1U,f);   TEST_ASSERT_EQUAL_HEX8_ARRAY(stop1,f,16);
}

/* Read a .hex fixture, strip non-hex, decode to bytes. */
static size_t load_hex(const char *path, uint8_t *out, size_t cap){
    FILE *fp=fopen(path,"rb"); TEST_ASSERT_NOT_NULL(fp);
    size_t n=0; int hi=-1, c;
    while((c=fgetc(fp))!=EOF){
        int v; if(c>='0'&&c<='9')v=c-'0'; else if(c>='A'&&c<='F')v=c-'A'+10;
        else if(c>='a'&&c<='f')v=c-'a'+10; else continue;
        if(hi<0)hi=v; else { TEST_ASSERT_LESS_THAN(cap,n); out[n++]=(uint8_t)((hi<<4)|v); hi=-1; }
    }
    fclose(fp); return n;
}
/* Resync on AA 77, verify every 56-byte heater frame's checksum. */
static void check_capture(const char *path, int *frames, int *bad){
    static uint8_t buf[200000]; size_t n=load_hex(path,buf,sizeof buf);
    *frames=0; *bad=0;
    for(size_t i=0;i+56<=n;){
        if(buf[i]==0xAA && buf[i+1]==0x77){
            if(VEVOR_Checksum(&buf[i],55U)!=buf[i+55]) (*bad)++;
            (*frames)++; i+=56;
        } else i++;
    }
}
void test_capture_checksums_all_pass(void){
    int f1,b1,f2,b2;
    check_capture("fixtures/capture1.hex",&f1,&b1);
    check_capture("fixtures/capture2.hex",&f2,&b2);
    TEST_ASSERT_GREATER_THAN(0,f1+f2);
    TEST_ASSERT_EQUAL_INT(0,b1+b2);      /* handoff: all ~1752 responses valid */
}
int main(void){ UNITY_BEGIN();
    RUN_TEST(test_build_frames_byte_exact);
    RUN_TEST(test_capture_checksums_all_pass); return UNITY_END(); }
```
Add to `Tests/CMakeLists.txt`: `add_unity_test(test_vevor test_vevor.c ../App/services/vevor_heater.c ../App/services/wk2132.c fakes/fake_wk2132_i2c.c)` (vevor links wk2132 for `WK2132_t` size + `WK2132_Read/Write`; the fake satisfies the seam). **Note:** the test runs from the `Tests/` build dir — the fixture paths above are relative to the test's working directory; if the CMake harness runs elsewhere, pass the fixture dir via a `-D`efine or `add_test(... WORKING_DIRECTORY ...)` and adjust the paths. Confirm which and make the paths resolve.

- [ ] **Step 3: Run to verify it fails** — `vevor_heater.*` missing → compile/link error.

- [ ] **Step 4: Add the verified `vevor_heater.h`/`.c`** (supplied files, unchanged logic).

- [ ] **Step 5: Run to verify it passes** — `test_vevor` green: builders byte-exact and **0 checksum failures across both captures**. Whole suite still green.

- [ ] **Step 6: Commit** — `git add App/services/vevor_heater.* Tests/test_vevor.c Tests/fixtures/ Tests/CMakeLists.txt && git commit -m "feat(heater): verified VEVOR protocol layer + captured-frame checksum regression"`

---

## Phase 2 — Heater service (host-TDD, safety-critical)

### Task 3: `heater.c` — command mapping, telemetry snapshot, safety flags

**Files:** Create `App/services/heater.h`, `App/services/heater.c`, `Tests/test_heater.c`; Modify `Tests/CMakeLists.txt`.

**Interfaces:**
- Consumes: `vevor_heater.h`, `wk2132.h`.
- Produces (consumed by `mbp_heater.c` Task 4 and `app_main.c` Task 6):
```c
typedef struct {
    uint8_t  state;            /* 0 off,1 preheat,2 ignition,3 running,4 cooldown */
    uint8_t  active_level;     /* heater-reported */
    uint8_t  target_level;     /* commanded 1..10 */
    uint8_t  error;
    uint16_t supply_mv;
    uint16_t fan_rpm;
    uint16_t pump_hz_x10;
    uint16_t exchanger_raw;
    uint16_t state_seconds;
    uint16_t age_ms;           /* since last valid frame, saturating 65535 */
    uint16_t flags;            /* bit0 fresh, bit1 cooldown, bit2 safe_to_power_down,
                                  bit3 comms_fault, bit4 transport_fault */
    uint16_t valid_frames;     /* low 16 bits */
    uint16_t checksum_failures;/* saturating */
    uint16_t transport_errors; /* saturating */
} heater_telemetry_t;

#define HEATER_FLAG_FRESH      (1U<<0)
#define HEATER_FLAG_COOLDOWN   (1U<<1)
#define HEATER_FLAG_SAFE_OFF   (1U<<2)
#define HEATER_FLAG_COMMS_FAULT (1U<<3)
#define HEATER_FLAG_XPORT_FAULT (1U<<4)

void    heater_init(const wk2132_i2c_t *bus, uint32_t now); /* WK2132_Init+Begin+Flush+VEVOR_Init */
void    heater_process(uint32_t now);                       /* VEVOR_Process + snapshot */
void    heater_set_request(uint8_t on);   /* 1 -> VEVOR_Start(target_level); 0 -> VEVOR_Stop */
uint8_t heater_get_request(void);
void    heater_set_level(uint8_t level);  /* 1..10; VEVOR_SetLevel if running */
uint8_t heater_get_level(void);
void    heater_get_telemetry(heater_telemetry_t *out);
```
- Semantics: module-static `WK2132_t` + `VEVOR_t` + `target_level` (default 1) + `request` (default 0=stop). `heater_process` runs `VEVOR_Process(now)` then recomputes the snapshot: `age_ms = min(now - status.received_tick, 65535)`; `FRESH` from `VEVOR_IsResponseFresh`; `SAFE_OFF` from `VEVOR_IsSafeToPowerDown`; `COOLDOWN` from `status.cooldown_flag`; `COMMS_FAULT` set when `request==1` (on) AND not FRESH; `XPORT_FAULT` set when `transport_errors` increased since the last snapshot. `heater_set_request(0)` is a stop **request** — the FSM keeps sending stop frames through cooldown; status keeps updating.

- [ ] **Step 1: Write `test_heater.c` (failing)** — drive the FSM through the fake, asserting command → TX frames and injected responses → telemetry + safety flags:
```c
#include "heater.h"
#include "fake_wk2132_i2c.h"
#include "unity.h"
#include <string.h>
/* Build a 56-byte heater frame with a given state/level and valid checksum. */
static void make_resp(uint8_t st, uint8_t lvl, uint8_t err, uint8_t out[56]);
void setUp(void){ fake_wk2132_reset(); heater_init(fake_wk2132_i2c(), 0U); }
void tearDown(void){}

void test_start_emits_four_start_then_run(void){
    heater_set_level(3U); heater_set_request(1U);
    /* 1 s TX cadence: advance time and process 5 times, capturing each TX. */
    uint8_t seen_cmd[5]; uint32_t t=0;
    for(int i=0;i<5;i++){ fake_wk2132_reset_tx(); heater_process(t);
        seen_cmd[i]= fake_wk2132_tx_len()>=3 ? fake_wk2132_tx_data()[2] : 0xFF; t+=1000; }
    /* first four are START (cmd 0x06), then RUN (cmd 0x02) */
    TEST_ASSERT_EQUAL_HEX8(0x06,seen_cmd[0]); TEST_ASSERT_EQUAL_HEX8(0x06,seen_cmd[3]);
    TEST_ASSERT_EQUAL_HEX8(0x02,seen_cmd[4]);
    /* level byte is 3 */
    TEST_ASSERT_EQUAL_HEX8(3U, fake_wk2132_tx_data()[8]);
}
void test_running_response_decodes_and_is_not_safe_off(void){
    heater_set_request(1U); uint8_t r[56]; make_resp(3U,3U,0U,r);
    fake_wk2132_inject_rx(r,56); heater_process(0U); heater_process(20U);
    heater_telemetry_t t; heater_get_telemetry(&t);
    TEST_ASSERT_EQUAL_UINT8(3U,t.state);
    TEST_ASSERT_TRUE(t.flags & HEATER_FLAG_FRESH);
    TEST_ASSERT_FALSE(t.flags & HEATER_FLAG_SAFE_OFF); /* running != safe */
}
void test_stop_then_state00_sets_safe_off(void){
    heater_set_request(0U); uint8_t r[56]; make_resp(0U,0U,0U,r);
    fake_wk2132_inject_rx(r,56); heater_process(0U); heater_process(20U);
    heater_telemetry_t t; heater_get_telemetry(&t);
    TEST_ASSERT_TRUE(t.flags & HEATER_FLAG_SAFE_OFF);
    /* TX should be STOP frames (cmd 0x06, state byte 0x05) */
    TEST_ASSERT_EQUAL_HEX8(0x06, fake_wk2132_tx_data()[2]);
    TEST_ASSERT_EQUAL_HEX8(0x05, fake_wk2132_tx_data()[9]);
}
void test_comms_loss_while_on_is_fault_never_safe(void){
    heater_set_request(1U); uint8_t r[56]; make_resp(3U,3U,0U,r);
    fake_wk2132_inject_rx(r,56); heater_process(0U); heater_process(20U);
    /* no more responses; advance past freshness (3 s) */
    for(uint32_t t=1000;t<=6000;t+=1000) heater_process(t);
    heater_telemetry_t tel; heater_get_telemetry(&tel);
    TEST_ASSERT_FALSE(tel.flags & HEATER_FLAG_FRESH);
    TEST_ASSERT_TRUE (tel.flags & HEATER_FLAG_COMMS_FAULT);
    TEST_ASSERT_FALSE(tel.flags & HEATER_FLAG_SAFE_OFF); /* loss is never safe-off */
}
int main(void){ UNITY_BEGIN();
    RUN_TEST(test_start_emits_four_start_then_run);
    RUN_TEST(test_running_response_decodes_and_is_not_safe_off);
    RUN_TEST(test_stop_then_state00_sets_safe_off);
    RUN_TEST(test_comms_loss_while_on_is_fault_never_safe); return UNITY_END(); }
```
`make_resp` builds `AA 77` + the fields at their byte offsets ([5]=state,[6]=level,[7]=err, others 0) and sets `out[55]=VEVOR_Checksum(out,55)`. Add `fake_wk2132_reset_tx()` to the fake if not present. Add to `Tests/CMakeLists.txt`: `add_unity_test(test_heater test_heater.c ../App/services/heater.c ../App/services/vevor_heater.c ../App/services/wk2132.c fakes/fake_wk2132_i2c.c)`.

- [ ] **Step 2: Run to verify it fails** — `heater.*` missing.

- [ ] **Step 3: Implement `heater.h` + `heater.c`** per the interface + semantics.

- [ ] **Step 4: Run to verify it passes** — `test_heater` green (4/4, incl. the comms-loss safety case). Whole suite green.

- [ ] **Step 5: Commit** — `git add App/services/heater.* Tests/test_heater.c Tests/CMakeLists.txt && git commit -m "feat(heater): heater service — command mapping + telemetry snapshot + safety flags (host-tested)"`

---

## Phase 3 — Modbus register block (host-TDD)

### Task 4: expand the register map + `mbp_heater` providers (regs 53–67)

**Files:** Modify `App/services/modbus_defs.h`; Create `App/services/mbp_heater.h`, `App/services/mbp_heater.c`, `Tests/test_mbp_heater.c`; Modify `Tests/CMakeLists.txt` and any fixed-size `Tests/` array keyed off `MB_REG_MAX`.

**Interfaces:**
- Consumes: `heater.h` (command setters + `heater_get_telemetry`), the existing `mb_reg_bind(reg, rd_fn, wr_fn)` register-model API, `modbus_defs.h` exception codes.
- Produces: `void mbp_heater_register(void);` — binds regs 53–67. Command regs 53 (`heater_request`, rd+wr) and 54 (`heater_level`, rd+wr) validate on write (request ∈ {0,1}; level ∈ 1..10, else `MB_EXC_ILLEGAL_DATA_VALUE`) and call `heater_set_request`/`heater_set_level`. Telemetry regs 55–67 bind read-only (wr = NULL) reading fields from a `heater_get_telemetry` snapshot per the spec's register table. Register numbers are the frozen contract for Sub-project #2.

- [ ] **Step 1: Expand the register cap.** `modbus_defs.h`: `MB_REG_MAX` 52→70, `MB_REG_LIMIT` 53→71. Grep `Tests/` and `App/services/` for any array sized `[MB_REG_MAX ...]` or literal `52`/`53` bound and bump consistently. Run the existing register-model/engine tests → still green (nothing else changed yet).

- [ ] **Step 2: Write `test_mbp_heater.c` (failing).** Use the register model the way the existing `mbp_*` tests do (bind, then read/write through `mb_regmodel`), with a fake or real `heater` module providing the snapshot:
```c
#include "mbp_heater.h"
#include "heater.h"
#include "mb_regmodel.h"      /* mb_reg_read / mb_reg_write / MB_EXC_* */
#include "fake_wk2132_i2c.h"
#include "unity.h"
void setUp(void){ fake_wk2132_reset(); heater_init(fake_wk2132_i2c(),0U);
                  mb_regmodel_reset(); mbp_heater_register(); }
void tearDown(void){}
void test_write_request_and_level(void){
    TEST_ASSERT_EQUAL(0, mb_reg_write(53U, 1U));   /* heater_request on */
    TEST_ASSERT_EQUAL(1U, heater_get_request());
    TEST_ASSERT_EQUAL(0, mb_reg_write(54U, 7U));   /* level 7 */
    TEST_ASSERT_EQUAL(7U, heater_get_level());
}
void test_level_out_of_range_rejected(void){
    TEST_ASSERT_EQUAL(MB_EXC_ILLEGAL_DATA_VALUE, mb_reg_write(54U, 11U));
    TEST_ASSERT_EQUAL(MB_EXC_ILLEGAL_DATA_VALUE, mb_reg_write(54U, 0U));
}
void test_telemetry_regs_are_readonly(void){
    uint16_t v;
    TEST_ASSERT_EQUAL(0, mb_reg_read(55U,&v));            /* state readable */
    TEST_ASSERT_EQUAL(MB_EXC_ILLEGAL_ADDRESS, mb_reg_write(55U, 1U)); /* RO */
}
void test_reg67_addressable_reg71_out_of_range(void){
    uint16_t v;
    TEST_ASSERT_EQUAL(0, mb_reg_read(67U,&v));
    TEST_ASSERT_EQUAL(MB_EXC_ILLEGAL_ADDRESS, mb_reg_read(71U,&v));
}
int main(void){ UNITY_BEGIN();
    RUN_TEST(test_write_request_and_level);
    RUN_TEST(test_level_out_of_range_rejected);
    RUN_TEST(test_telemetry_regs_are_readonly);
    RUN_TEST(test_reg67_addressable_reg71_out_of_range); return UNITY_END(); }
```
(Match the actual `mb_regmodel` read/write signatures + exception-return convention the existing `mbp_*` tests use — read one and mirror it. If the model has no `mb_regmodel_reset`, use whatever setup the existing tests use.) Add `add_unity_test(test_mbp_heater test_mbp_heater.c ../App/services/mbp_heater.c ../App/services/heater.c ../App/services/vevor_heater.c ../App/services/wk2132.c ../App/services/mb_regmodel.c fakes/fake_wk2132_i2c.c)`.

- [ ] **Step 3: Run to verify it fails** — `mbp_heater.*` missing.

- [ ] **Step 4: Implement `mbp_heater.h` + `mbp_heater.c`** — the register accessors + `mbp_heater_register()` binding regs 53–67 per the spec table.

- [ ] **Step 5: Run to verify it passes** — `test_mbp_heater` green; whole suite green.

- [ ] **Step 6: Commit** — `git add App/services/modbus_defs.h App/services/mbp_heater.* Tests/test_mbp_heater.c Tests/CMakeLists.txt && git commit -m "feat(heater): Modbus heater register block 53-67 + map expansion to 70"`

---

## Phase 4 — On-target driver + integration (code-review + host-compile; bench-pending)

### Task 5: on-target WK2132 I2C2 backend + `.ioc` I2C2 enable

**Files:** Create `cube/Core/Inc/drv_wk2132_i2c2.h`, `cube/Core/Src/drv_wk2132_i2c2.c`; Modify `cube/g0b1-apu.ioc`, `cube/Core/Src/main.c`.

**Interfaces:**
- Consumes: `wk2132.h` (`wk2132_i2c_t`), HAL I2C (`hi2c2`), `<stm32g0xx_hal.h>`.
- Produces: `const wk2132_i2c_t *drv_wk2132_i2c2_backend(void);` — a static `wk2132_i2c_t` whose ops call HAL on `hi2c2`, passing `(uint8_t)(addr7 << 1)` as the HAL 8-bit address: `mem_read/mem_write` → `HAL_I2C_Mem_Read/Write(&hi2c2, addr7<<1, reg, I2C_MEMADD_SIZE_8BIT, buf, len, timeout)`; `tx`/`rx` → `HAL_I2C_Master_Transmit/Receive(&hi2c2, addr7<<1, buf, len, timeout)`. Each returns 0 on `HAL_OK`, non-zero otherwise. Match `-Wall -Wextra -Wpedantic -Wstrict-prototypes`; guard every HAL return.

- [ ] **Step 1: Enable I2C2 in `.ioc`** — PA11 = `I2C2_SCL`, PB14 = `I2C2_SDA` (correct AF), open-drain, 100 kHz. Because I2C peripheral bring-up is interdependent (like the RTC's I2C1 and the ADC in prior work), **use the CubeMX GUI** to add I2C2 and regenerate, rather than hand-editing the `.ioc` (watch for macOS spurious `* 2.c/.h` duplicate files — delete before commit). Confirm `hi2c2` + `MX_I2C2_Init()` appear in `main.c` and that PA11/PB14 aren't stolen from anything (they were free).

- [ ] **Step 2: Implement `drv_wk2132_i2c2.c` + `.h`** per the interface.

- [ ] **Step 3: Host-compile check** — the file `#include`s `<stm32g0xx_hal.h>`; compile-only against the CubeIDE HAL include paths (or confirm in the CubeIDE build). It is NOT host-unit-tested (hardware seam) — note this in the report; real verification is the bench (see Task 7 doc + the deferred bench plan).

- [ ] **Step 4: Commit** — `git add cube/Core/Inc/drv_wk2132_i2c2.h cube/Core/Src/drv_wk2132_i2c2.c cube/g0b1-apu.ioc cube/Core/Src/main.c && git commit -m "feat(heater): on-target WK2132 I2C2 backend + enable I2C2 (PA11/PB14)"`

---

### Task 6: wire the heater into the superloop + register providers

**Files:** Modify `cube/Core/Src/app_main.c`, `cube/.project`; wherever the `mbp_*` providers are registered (grep `mbp_sys_register`/`mbp_sensors_register` call sites — likely `app_main.c` or `control_app_init`).

- [ ] **Step 1: Link the portable modules into the CubeIDE build** — add Eclipse `<link>` entries in `cube/.project` for `App/services/wk2132.c`, `vevor_heater.c`, `heater.c`, `mbp_heater.c` (mirror the existing `control_diag.c` link; CubeIDE must Close→Open the project to pick up `.project` link changes, not just Build).

- [ ] **Step 2: Init the heater** in `app_main` after I2C2 init AND after the switched 3P3_VCC rail is confirmed stable (follow the existing numbered "Task N" init-comment convention; the RTC's `rtc_init(drv_mcp7940n_backend())` is the pattern): `heater_init(drv_wk2132_i2c2_backend(), HAL_GetTick());`. If the bridge isn't detected (`WK2132_NOT_DETECTED`), log/flag but do NOT block boot — the heater is optional; the APU must still run.

- [ ] **Step 3: Tick the heater** — in the superloop `for(;;)` (next to `drv_modbus_uart_poll()` / `HAL_IWDG_Refresh`), add `heater_process(HAL_GetTick());` so it runs every pass (well faster than the 10 ms RX-poll cadence), keeping the portable `control_app.c` uncoupled from the heater module.

- [ ] **Step 4: Register the providers** — call `mbp_heater_register();` alongside the other `mbp_*_register()` calls at init.

- [ ] **Step 5: Verify** — `Tests/` suite still green (portable modules unaffected). The full firmware link is the CubeIDE build (bench/next); if it builds on the dev CubeIDE, confirm no unresolved symbols. Note in the report which was done.

- [ ] **Step 6: Commit** — `git add cube/Core/Src/app_main.c cube/.project && git commit -m "feat(heater): init + superloop tick + register providers"`

---

## Phase 5 — Docs

### Task 7: heater bring-up + register map + safety doc

**Files:** Create `docs/vevor-heater.md`.

- [ ] **Step 1: Write `docs/vevor-heater.md`** — the DFR0627/WK2132 wiring assumptions (I2C2 PA11/PB14, base 0x70, open-drain level-shift + power on the switched 3P3_VCC rail, factory-panel-disconnect), the **staged bench bring-up** from the handoff `INTEGRATION.md` (power bridge → I2C scan → confirm WK2132 address → UART loopback FIFO → scope 4800 framing → open-drain levels → heater with panel off, prove valid state-00 → only then a fueled level-1 start + full cooldown), the **register map** (53–67 + the 68–70 reserve), and the **safety invariants** (never power-cut; comms-loss=fault; only fresh state-00 = safe-to-power-down; ≈3 min start / ≈5 min cooldown). Flag the open items: board-rev PC3 (VCC_EN vs LEDS_OFF) power-rail reconciliation; confirmed A1/A0 DIP; exchanger-temp raw→°F conversion (unset); the 85 °C DFR0627 rating vs. a 125 °C final requirement; and that the open-drain level-shift + power wiring is the hardware owner's task.

- [ ] **Step 2: Commit** — `git add docs/vevor-heater.md && git commit -m "docs(heater): VEVOR bring-up, register map, and safety invariants"`

---

## Self-Review

**Spec coverage (Component F1):**
- F1.a protocol host-testability → Tasks 1 (WK2132 backend seam + fake) + 2 (verified VEVOR preserved + captured-frame regression) + 3 (heater FSM/safety tests). ✓
- F1.b on-target driver + `.ioc` → Task 5. ✓
- F1.c scheduler + init wiring → Task 6. ✓
- F1.d Modbus register block + `MB_REG_MAX` expansion → Task 4 (regs 53–67, cap→70). ✓
- F1.e safety semantics → Task 3 flags (comms-fault, safe-off only on fresh state-00) + Task 6 non-blocking superloop tick + boot-doesn't-block + Task 7 doc. ✓

**Verification split:** the verified/risky logic (WK2132 register sequences, VEVOR frames/checksum against real captures, the command/telemetry/safety FSM, the register providers + map expansion) is host-unit-tested via `Tests/` (Unity). The on-target I2C2 backend (Task 5), superloop/init wiring (Task 6), and `.ioc` are code-reviewed + host-compiled + CubeIDE-built, with real validation on the documented bench (Task 7 / deferred), exactly as the spec's "no hardware yet → build bench-ready" decision requires.

**Placeholder scan:** the one genuinely deferred item is the fueled-heater bench (hardware not in hand) — flagged, with a concrete staged procedure in Task 7. The exchanger-temp conversion is intentionally exposed raw (spec Open Items). No "test appropriately" placeholders — each host task carries real test code.

**Type consistency:** `wk2132_i2c_t` (Task 1) is the single backend type used by the fake (1), the on-target driver (5), and indirectly `vevor_heater`/`heater`. `WK2132_t`/`VEVOR_t`/`heater_telemetry_t` and the `HEATER_FLAG_*` bits are defined once and referenced identically by `mbp_heater` (4) and the wiring (6). The register numbers 53–67 in Task 4 match the spec table and are the frozen interface Sub-project #2 consumes.
