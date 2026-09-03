# cortex gobi-agent STM32 Flash + Delivery Implementation Plan (Sub-project #2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the cortex `gobi-agent` the ability to flash the STM32 (gobi/APU controller) firmware over the existing RS-485/Modbus link, and deliver the STM32 image inside the cortex OTA — so an STM32 firmware update ships in a normal signed `.swu` and the agent auto-applies it when the APU is idle, with A/B trial/revert protecting against a bad image.

**Architecture:** A **pure, host-testable transfer core** (its own Modbus-RTU framing + CRC16, zlib-compatible CRC32, and the full enter-bootloader → INFO → ERASE → stream DATA → VERIFY → COMMIT → confirm state machine) driven through an **injected transport** — the exact host side of the frozen `bl_proto.h` wire contract, mirroring the reference `tools/bl_flash.py`. A thin **on-target transport** does raw-fd serial I/O on the same port libmodbus uses (FC 0x41/0x42 bypasses libmodbus). A poll-loop **orchestrator** compares the running reg-2 version against a bundled manifest and, when the APU is off/engine-off and auto-flash is enabled, runs the transfer and reports `stm32_update_status` in telemetry. Delivery is **blob-in-repo**: a Yocto recipe installs the two per-slot `.bin` + a manifest into `/lib/firmware/g0b1-apu/`, riding inside the rootfs → inside the RSA-4096-signed `.swu` automatically.

**Tech Stack:** C11, the existing `gobi-agent` (libmodbus + mosquitto + sqlite3 + cjson + curl, systemd, `/dev/ttyUSB0` 9600 8N1 slave 1), its hand-rolled host-test harness (`tests/run.sh`: `cc -std=c11 -fsanitize=address,undefined` + local `CHECK` macros, no Unity/CMake), Yocto/kas (`meta-ecofleet`, `imx-image-core`-based `ecofleet-image`, `scripts/make-swu.sh`).

**Spec:** `docs/superpowers/specs/2026-09-03-stm32-remote-firmware-update-design.md` (Component D — gobi-agent flash; Component E — delivery). **This plan is Sub-project #2.** Sub-project #1 (the STM32 bootloader + app) is implemented on the `g0b1-firmware` branch `feat/stm32-bootloader-ab-update` and **froze the wire contract** this plan consumes:
- `App/services/bl_proto.h` (byte-exact FC 0x41/0x42 layout) — the authority for the bytes.
- `docs/remote-update.md` (flash map, CRC32 rule, two-`.bin` release shape, §4 "how the agent picks the inactive-slot `.bin`", §9 "how this flows into a cortex OTA").
- `tools/bl_flash.py` (the reference host flasher — this plan re-implements its flow in C).

**Target repo for ALL file paths below:** `ecofleet-firmware` (= the `cortex-yocto` repo — the repo this plan lives in). The gobi-agent is at `meta-ecofleet/recipes-ecofleet/gobi-agent/`. Ignore the untracked `cortex-yocto/` subdirectory (stale nested clone).

## Global Constraints

- **Wire contract is FROZEN** (`bl_proto.h` in g0b1-firmware). Match it byte-for-byte. RTU framing `[addr=1][fc][data...][crc16_lo][crc16_hi]`, CRC-16/Modbus (reflected poly `0xA001`, init `0xFFFF`, no final xor, appended low-byte-first). App-side registers use the **N-1 wire convention** (firmware reg N → Modbus start address N-1), matching `main.c`'s existing `modbus_read_reg_besteffort(ctx, wire_addr, …)` / `mb_write_reg(reg1based, …)`.
- **FC 0x41 control** (sub in first data byte): INFO=0x01 / ERASE=0x02 / VERIFY=0x03 / COMMIT=0x04 / ABORT=0x05 / STATUS=0x06. **FC 0x42 data:** `[1][0x42][offset:4 BE][len:1][data:len]`. INFO reply body (12 B): `[1][0x41][0x01][ver][inactive_slot][slot_size:4 BE][chunk_max:2 BE][crc_algo]`. VERIFY req: `[1][0x41][0x03][length:4 BE][crc32:4 BE]`. ACK `[1][fc][sub][0x00]`; NAK `[1][fc|0x80][err]` with err ∈ {STATE=1, RANGE=2, CRC=3, FLASH=4}. `BL_CHUNK_MAX = 240`.
- **CRC32 = CRC-32/IEEE-802.3** (zlib crc32: reflected poly `0xEDB88320`, init/xorout `0xFFFFFFFF`) over exactly `length` bytes of the raw `.bin` (the real file size, not padded). Known-answer: `crc32("123456789") == 0xCBF43926`.
- **Enter-bootloader:** write holding **reg 35** = `0x00A5`; the app refuses with Modbus exception `0x04` (`MB_EXC_SLAVE_DEVICE_FAILURE`) while the engine could be energized.
- **Version encoding (reg 2):** `major*10000 + minor*100 + patch` as a uint16. The agent reads it raw (no decode exists in C today). Compare encoded values.
- **Safety gate:** the agent flashes ONLY when `mode` (reg 10) == 0 (off) AND `engine_status` (reg 22) == 0 (off), AND auto-flash is enabled. Belt-and-suspenders with the firmware's own reg-35 refusal.
- **Two `.bin` per release, pick by INFO:** the agent must send **both** `g0b1-apu-<ver>-slotA.bin` and `-slotB.bin` availability, but stream only the one matching `inactive_slot` from the INFO reply (authoritative — never guessed). Roles swap every successful update, so re-query INFO each time.
- **Serial ownership:** the flash runs on the single agent thread, synchronously within a poll-loop iteration, using the **raw fd** (`modbus_get_socket(g_modbus)`) — never concurrently with libmodbus polling. During a flash the poll loop pauses (~1 min at 9600); the APU is off, so this is acceptable.
- **Pure vs on-target split (host-testability):** all framing / CRC / session / decision logic lives in **pure modules with NO libmodbus/mosquitto/sqlite deps** (like the existing `weather.c`), so they compile + host-test under `tests/run.sh`. Only the raw-fd transport and the poll-loop glue touch libmodbus / files / `g_modbus`.
- **Host test workflow** (run after every pure-module step): from `meta-ecofleet/recipes-ecofleet/gobi-agent/`, `bash tests/run.sh` (compiles + runs every `test_*` with `-fsanitize=address,undefined`, exit non-zero on any failure). New tests are added to `tests/run.sh` following the `test_weather` pattern.
- **Agent code style:** C11, `-Wall -Wextra -Wpedantic -Wformat=2 -Wstrict-prototypes -fstack-protector-strong` (from `files/CMakeLists.txt`). Match it; keep pure modules warning-clean.

---

## File Structure

**New pure modules (host-tested via `tests/run.sh`), in `meta-ecofleet/recipes-ecofleet/gobi-agent/files/`:**
- `bl_proto.h` — frozen FC 0x41/0x42 constants (copied from g0b1-firmware `bl_proto.h`) + `bl_info_t`.
- `bl_crc32.c` / `bl_crc32.h` — zlib-compatible CRC-32 over the image.
- `bl_frame.c` / `bl_frame.h` — Modbus-RTU CRC16 wrap/check + request builders (FC 0x03/0x06 + FC 0x41/0x42) + response parsers.
- `bl_session.c` / `bl_session.h` — the transfer state machine + the injected `bl_transport_t` interface.
- `stm32_update.c` / `stm32_update.h` — pure decision logic (version compare, idle gate, manifest parse) + the `stm32_update_status` enum/strings. (The pure parts here; the file-I/O + transport glue is in a separate on-target function — see below.)

**New host fakes / tests, in `.../gobi-agent/tests/`:**
- `fake_bootloader.c` / `fake_bootloader.h` — an in-memory `bl_transport_t` that simulates the STM32 (enter-bl → reset → INFO → ERASE → DATA acks → VERIFY(crc) → COMMIT → reset → reg-2 flips), with fault-injection hooks.
- `test_bl_crc32.c`, `test_bl_frame.c`, `test_bl_session.c`, `test_stm32_update.c`.
- `run.sh` — extended to compile + run the four new tests.

**New on-target module (compiled into `gobi-agent`, NOT host-unit-tested — Yocto/bench-verified):**
- `bl_transport_serial.c` / `bl_transport_serial.h` — implements `bl_transport_t` over the raw serial fd (idle-gap frame assembly, DE handled by the RS-485 transceiver's auto-direction or the same path libmodbus uses).
- `stm32_flash_task.c` / `stm32_flash_task.h` — the poll-loop glue: reads the manifest + `.bin`s from `/lib/firmware/g0b1-apu/`, builds the serial transport, calls `bl_session_flash`, owns the `stm32_update_status` state, exposes a `stm32_flash_tick(const telemetry_t*)`.

**Modified agent files:**
- `files/CMakeLists.txt` — add the new `.c` to `target_sources(gobi-agent …)`.
- `gobi-agent_1.0.bb` — add the new `file://…` sources to `SRC_URI`.
- `files/main.c` — call `stm32_flash_tick(&t)` in the poll loop; add `stm32_update_status` to `telemetry_t` + `build_telemetry_json`.
- `files/config.h` — add `G0B1_FW_DIR`, `G0B1_ENTER_BL_REG`/`_VALUE`, `G0B1_ERASE_TIMEOUT_MS`, `G0B1_AUTO_FLASH_DEFAULT`.

**New delivery recipe (blob-in-repo):**
- `meta-ecofleet/recipes-ecofleet/g0b1-apu-firmware/g0b1-apu-firmware.bb` + `files/g0b1-apu-<ver>-slotA.bin`, `-slotB.bin`, `manifest.json`.
- `meta-ecofleet/recipes-core/images/ecofleet-image.bb` — add `g0b1-apu-firmware` to `IMAGE_INSTALL:append`.

**Docs:**
- `docs/stm32-ota.md` — how an STM32 firmware bump flows through: drop new `.bin` + manifest, bump, tag → CI `.swu` → agent auto-flash.

---

## Phase 0 — Frozen-contract framing + CRC (host-TDD)

### Task 1: zlib-compatible CRC-32

**Files:** Create `files/bl_crc32.h`, `files/bl_crc32.c`; Test `tests/test_bl_crc32.c`; Modify `tests/run.sh`.

**Interfaces:**
- Produces: `uint32_t bl_crc32(const uint8_t *data, uint32_t len);` — CRC-32/IEEE-802.3, one-shot (seed `0xFFFFFFFF`, xorout `0xFFFFFFFF`). Must equal Python `zlib.crc32(data) & 0xFFFFFFFF` and the STM32 `crc32_compute`. Consumed by `bl_session` (VERIFY) and `stm32_flash_task`.

- [ ] **Step 1: Write the failing test** — `tests/test_bl_crc32.c`:
```c
#include "bl_crc32.h"
#include <string.h>
#include <stdio.h>
static int fails;
#define CHECK_EQ_HEX(a,b) do{ if((a)!=(b)){ printf("FAIL %s:%d %08x != %08x\n",__FILE__,__LINE__,(unsigned)(a),(unsigned)(b)); fails++; } }while(0)
int main(void){
    CHECK_EQ_HEX(bl_crc32((const uint8_t*)"",0), 0x00000000u);
    CHECK_EQ_HEX(bl_crc32((const uint8_t*)"123456789",9), 0xCBF43926u); /* standard check value */
    CHECK_EQ_HEX(bl_crc32((const uint8_t*)"The quick brown fox jumps over the lazy dog",43), 0x414FA339u);
    printf(fails? "test_bl_crc32 FAILED (%d)\n":"test_bl_crc32 ok\n", fails);
    return fails?1:0;
}
```
Add to `tests/run.sh` (mirror the `test_weather` compile block, but this test needs no cJSON):
```sh
cc -std=c11 -Wall -Wextra -Wpedantic -g -fsanitize=address,undefined \
   -I"$files" "$here/test_bl_crc32.c" "$files/bl_crc32.c" -o "$here/test_bl_crc32" && "$here/test_bl_crc32"
```

- [ ] **Step 2: Run to verify it fails** — `bash tests/run.sh` → FAIL (bl_crc32.* missing → compile error).

- [ ] **Step 3: Implement** — `files/bl_crc32.h`:
```c
#ifndef BL_CRC32_H
#define BL_CRC32_H
#include <stdint.h>
/* CRC-32/IEEE-802.3 (zlib crc32). Matches the STM32 crc32_compute and the
   frozen VERIFY contract in g0b1-firmware bl_proto.h / docs/remote-update.md §2. */
uint32_t bl_crc32(const uint8_t *data, uint32_t len);
#endif
```
`files/bl_crc32.c` (bitwise, no table — small + matches the device):
```c
#include "bl_crc32.h"
uint32_t bl_crc32(const uint8_t *data, uint32_t len){
    uint32_t crc = 0xFFFFFFFFu;
    for(uint32_t i=0;i<len;i++){
        crc ^= data[i];
        for(int b=0;b<8;b++){ uint32_t m = (uint32_t)-(int32_t)(crc & 1u); crc = (crc>>1) ^ (0xEDB88320u & m); }
    }
    return crc ^ 0xFFFFFFFFu;
}
```

- [ ] **Step 4: Run to verify it passes** — `bash tests/run.sh` → `test_bl_crc32 ok`.

- [ ] **Step 5: Commit** — `git add files/bl_crc32.* tests/test_bl_crc32.c tests/run.sh && git commit -m "feat(agent): zlib-compatible CRC-32 for STM32 image verify"`

---

### Task 2: Modbus-RTU framing + FC 0x03/0x06/0x41/0x42 request builders + response parsers

**Files:** Create `files/bl_proto.h`, `files/bl_frame.h`, `files/bl_frame.c`; Test `tests/test_bl_frame.c`; Modify `tests/run.sh`.

**Interfaces:**
- `files/bl_proto.h` — **copy verbatim** the constants + `bl_info_t` from g0b1-firmware `App/services/bl_proto.h` (BL_FC_CONTROL/DATA, `bl_sub_t`, BL_ERR_*, BL_CHUNK_MAX, `bl_info_t`), minus the on-device `bl_build_*`/`bl_parse_*` prototypes. Add a header comment naming the frozen source.
- Produces (in `bl_frame.h`):
  - `uint16_t bl_crc16(const uint8_t *data, uint16_t len);` — CRC-16/Modbus.
  - `uint16_t bl_frame_finalize(uint8_t *frame, uint16_t body_len);` — append CRC16 (lo,hi) after `body_len` bytes; return `body_len+2`. (Body = `[addr][fc][data…]`.)
  - `int bl_frame_check(const uint8_t *frame, uint16_t len);` — 0 if `len>=4`, `frame[0]==1`, CRC ok; else non-zero.
  - Request builders (write the body `[addr=1][fc][data…]`, return body length; caller then `bl_frame_finalize`):
    - `uint16_t mb_req_read_reg(uint8_t *out, uint16_t reg1based);` (FC 0x03, qty 1, start = reg-1)
    - `uint16_t mb_req_write_reg(uint8_t *out, uint16_t reg1based, uint16_t val);` (FC 0x06)
    - `uint16_t bl_req_ctrl(uint8_t *out, bl_sub_t sub);` (INFO/ERASE/COMMIT/ABORT/STATUS)
    - `uint16_t bl_req_verify(uint8_t *out, uint32_t length, uint32_t crc32);`
    - `uint16_t bl_req_data(uint8_t *out, uint32_t off, const uint8_t *data, uint8_t len);`
  - Response parsers (operate on the full frame WITHOUT assuming CRC already stripped — take `len` incl CRC, they ignore the trailing 2 CRC bytes; caller validated CRC via `bl_frame_check`):
    - `int mb_resp_read_reg(const uint8_t *f, uint16_t len, uint16_t *val);` — FC 0x03 reply, 1 reg → `*val`. Returns 0 ok, -1 malformed, +1 if it's a Modbus exception reply (`fc|0x80`) with the exception code in `*val`'s low byte.
    - `int bl_resp_info(const uint8_t *f, uint16_t len, bl_info_t *info);`
    - `int bl_resp_ack(const uint8_t *f, uint16_t len, uint8_t expect_fc, uint8_t *nak_err);` — returns 0 = ACK, 1 = NAK (`nak_err` set), -1 = malformed. (For FC 0x41 sub-ACKs the body is `[1][0x41][sub][0x00]`; for FC 0x42 data-ACK the body is `[1][0x42][offset:4 BE]` — accept either shape for `expect_fc`.)

- [ ] **Step 1: Write the failing test** — `tests/test_bl_frame.c` (byte-exact against the frozen layout):
```c
#include "bl_frame.h"
#include <string.h>
#include <stdio.h>
static int fails;
#define CHECK(c) do{ if(!(c)){ printf("FAIL %s:%d %s\n",__FILE__,__LINE__,#c); fails++; } }while(0)
int main(void){
    uint8_t f[300];
    /* CRC16/Modbus known vector: 01 03 00 00 00 0A -> CRC 0xC5CD (lo C5, hi CD)... use libmodbus-standard 01 04 02 FF FF -> B880? use the textbook 01 03 00 00 00 0A -> CDC5 */
    { uint8_t m[]={0x01,0x03,0x00,0x00,0x00,0x0A}; uint16_t c=bl_crc16(m,6); CHECK(c==0xCDC5u); }
    /* read reg 2 -> FC 0x03 start=1 qty=1 */
    { uint16_t n=mb_req_read_reg(f,2); n=bl_frame_finalize(f,n);
      CHECK(f[0]==1&&f[1]==0x03&&f[2]==0x00&&f[3]==0x01&&f[4]==0x00&&f[5]==0x01&&n==8); }
    /* write reg 35 = 0x00A5 -> FC 0x06 addr=34 val=0x00A5 */
    { uint16_t n=mb_req_write_reg(f,35,0x00A5); (void)bl_frame_finalize(f,n);
      CHECK(f[1]==0x06&&f[2]==0x00&&f[3]==0x22&&f[4]==0x00&&f[5]==0xA5); }
    /* INFO req */
    { uint16_t n=bl_req_ctrl(f,BL_SUB_INFO); CHECK(n==3&&f[1]==0x41&&f[2]==0x01); }
    /* VERIFY req: length + crc32 big-endian */
    { uint16_t n=bl_req_verify(f,0x00000100u,0xDEADBEEFu);
      CHECK(n==11&&f[2]==0x03&&f[3]==0&&f[4]==0&&f[5]==1&&f[6]==0&&f[7]==0xDE&&f[8]==0xAD&&f[9]==0xBE&&f[10]==0xEF); }
    /* DATA req: offset BE + len + data */
    { uint8_t d[4]={0xA,0xB,0xC,0xD}; uint16_t n=bl_req_data(f,0x1000u,d,4);
      CHECK(n==11&&f[1]==0x42&&f[2]==0&&f[3]==0&&f[4]==0x10&&f[5]==0&&f[6]==4&&f[7]==0xA&&f[10]==0xD); }
    /* parse INFO reply (12-byte body + crc) */
    { uint8_t r[]={1,0x41,0x01, 1, 1, 0x00,0x03,0x80,0x00, 0x00,0xF0, 1, 0,0}; /* slot B, size 0x38000, chunk 0x00F0=240 */
      uint16_t rl=bl_frame_finalize(r,12); bl_info_t info;
      CHECK(bl_resp_info(r,rl,&info)==0 && info.inactive_slot==1 && info.slot_size==0x38000u && info.chunk_max==240 && info.crc_algo==1); }
    /* parse ACK vs NAK */
    { uint8_t a[]={1,0x41,0x02,0x00,0,0}; uint16_t al=bl_frame_finalize(a,4); uint8_t e=0;
      CHECK(bl_resp_ack(a,al,0x41,&e)==0); }
    { uint8_t nk[]={1,0xC1,BL_ERR_CRC,0,0}; uint16_t nl=bl_frame_finalize(nk,3); uint8_t e=0;
      CHECK(bl_resp_ack(nk,nl,0x41,&e)==1 && e==BL_ERR_CRC); }
    /* read-reg reply parse: reg 2 = 10100 */
    { uint8_t rr[]={1,0x03,0x02,0x27,0x74,0,0}; uint16_t rl=bl_frame_finalize(rr,5); uint16_t v=0;
      CHECK(mb_resp_read_reg(rr,rl,&v)==0 && v==10100); }
    printf(fails?"test_bl_frame FAILED (%d)\n":"test_bl_frame ok\n",fails);
    return fails?1:0;
}
```
Add the `cc` block to `tests/run.sh` compiling `test_bl_frame.c` + `bl_frame.c`.

- [ ] **Step 2: Run to verify it fails** — `bash tests/run.sh` → FAIL (bl_frame.* missing). (First confirm the `0xCDC5` CRC-16 vector is right for CRC-16/Modbus over `01 03 00 00 00 0A`; if the implementer computes a different standard value, fix the literal to the correct CRC-16/Modbus of those bytes — the point is a real known vector, not a self-referential one.)

- [ ] **Step 3: Implement** `bl_proto.h` (copied constants) + `bl_frame.h` (interfaces above) + `bl_frame.c`. Big-endian helpers for 4-byte offset/length/crc and slot_size; little-endian is used ONLY for the CRC16 append (lo, hi) and standard Modbus reg values are big-endian on the wire. `bl_crc16` = standard reflected 0xA001/0xFFFF. Keep it warning-clean under `-Wall -Wextra -Wpedantic`.

- [ ] **Step 4: Run to verify it passes** — `bash tests/run.sh` → `test_bl_frame ok`.

- [ ] **Step 5: Commit** — `git add files/bl_proto.h files/bl_frame.* tests/test_bl_frame.c tests/run.sh && git commit -m "feat(agent): RTU framing + FC 0x03/0x06/0x41/0x42 codec (host side of frozen bl_proto)"`

---

## Phase 1 — Transfer session state machine (host-TDD)

### Task 3: `bl_session_flash` + injected transport + fake bootloader

**Files:** Create `files/bl_session.h`, `files/bl_session.c`, `tests/fake_bootloader.h`, `tests/fake_bootloader.c`, `tests/test_bl_session.c`; Modify `tests/run.sh`.

**Interfaces:**
- Consumes: `bl_frame`, `bl_crc32`, `bl_proto.h`.
- Produces:
  - `typedef struct bl_transport { int (*xfer)(void *ctx, const uint8_t *req, uint16_t req_len, uint8_t *resp, uint16_t resp_cap, uint32_t timeout_ms); int (*wait_reset)(void *ctx, uint32_t timeout_ms); void *ctx; } bl_transport_t;` — `xfer` sends a full framed request and returns the framed response length (≥0), or <0 on timeout/bus error. `wait_reset` blocks until the device has reset and is answering again (0 ok, <0 timeout).
  - `typedef enum { BLR_OK=0, BLR_ENTER_REFUSED, BLR_NO_DEVICE, BLR_INFO_BAD, BLR_ERASE_FAIL, BLR_WRITE_FAIL, BLR_VERIFY_CRC, BLR_COMMIT_FAIL, BLR_VERSION_MISMATCH, BLR_ABORTED } bl_result_t;`
  - `typedef void (*bl_progress_fn)(void *ud, const char *phase, int pct);`
  - `typedef struct { const uint8_t *img_slotA; uint32_t len_slotA; const uint8_t *img_slotB; uint32_t len_slotB; uint16_t expected_ver_enc; bl_progress_fn progress; void *progress_ud; } bl_flash_params_t;`
  - `bl_result_t bl_session_flash(const bl_transport_t *t, const bl_flash_params_t *p);`
  - `const char *bl_result_str(bl_result_t r);`

Sequence (implement exactly; mirrors `tools/bl_flash.py` + `docs/remote-update.md` §4):
1. **Enter bootloader:** `xfer(mb_req_write_reg(reg=35,0x00A5))`. A normal echo reply → proceed. A Modbus exception `0x04` reply → `BLR_ENTER_REFUSED`. (No reply is also acceptable — the app resets before replying — treat a timeout here as "probably entered".) `progress("enter",0)`.
2. `wait_reset(t, ~3000ms)`. Then **INFO** (`bl_req_ctrl(INFO)`) with a few retries (device just booted); parse `bl_info_t`. Bad/no reply → `BLR_NO_DEVICE`/`BLR_INFO_BAD`.
3. Pick the image: `inactive_slot==0` → slotA, `==1` → slotB. `chunk = min(info.chunk_max, BL_CHUNK_MAX)`. `progress("info",5)`.
4. **ERASE** (`bl_req_ctrl(ERASE)`) with a LONG timeout (`G0B1_ERASE_TIMEOUT_MS`, ≥ 8000 — the device erases 112 pages before ACKing). ACK → continue; NAK/timeout → `BLR_ERASE_FAIL`. `progress("erase",10)`.
5. **Stream DATA:** for `off = 0; off < len; off += chunk`: `n = min(chunk, len-off)`; `bl_req_data(off, img+off, n)`; expect data-ACK echoing `off`; retry the chunk up to 3× on timeout/NAK, else `BLR_WRITE_FAIL`. `progress("write", 10 + 80*off/len)`.
6. **VERIFY** (`bl_req_verify(len, bl_crc32(img,len))`) with the long timeout. NAK `BL_ERR_CRC` → `BLR_VERIFY_CRC`; other NAK/timeout → `BLR_ERASE_FAIL`/`BLR_WRITE_FAIL` as appropriate. `progress("verify",92)`.
7. **COMMIT** (`bl_req_ctrl(COMMIT)`): expect ACK (the device drains TX then resets). `progress("commit",95)`.
8. `wait_reset(t, ~5000ms)`. **Read reg 2** with retries; if it equals `expected_ver_enc` → `BLR_OK` else `BLR_VERSION_MISMATCH`. `progress("done",100)`.

On any hard failure after ERASE, best-effort send `bl_req_ctrl(ABORT)` before returning (leaves the device on its old slot). All buffers sized for a 256-byte max frame.

- [ ] **Step 1: Write `fake_bootloader` + the failing test.** `tests/fake_bootloader.c` implements `bl_transport_t` with an internal model: a `state` (APP / BL_IDLE / BL_ERASED / BL_VERIFIED), an `inactive_slot`, a 224 KB slot buffer, a settable "current reg-2 version", and fault hooks (`fake_bl_fail_verify_crc()`, `fake_bl_fail_nth_data(int)`, `fake_bl_refuse_enter()`). Its `xfer` parses the request frame and returns the correct framed reply per the frozen contract; `wait_reset` flips APP↔BL and is a no-op delay. `tests/test_bl_session.c` drives:
  - **happy path:** a 300-byte image, expected version set; assert `BLR_OK`, the fake's slot buffer equals the image, and the fake committed the target slot (active flipped).
  - **enter refused:** `fake_bl_refuse_enter()` → `BLR_ENTER_REFUSED`, no slot written.
  - **bad VERIFY crc:** `fake_bl_fail_verify_crc()` → `BLR_VERIFY_CRC`, fake did NOT commit (old slot intact).
  - **data retry:** `fake_bl_fail_nth_data(3)` (one transient NAK) → still `BLR_OK` (retry succeeds).
  - **slot pick:** fake reports `inactive_slot=1` → assert the slotB image bytes were streamed (not slotA).
  - **version mismatch:** fake keeps reg-2 old after commit → `BLR_VERSION_MISMATCH`.
  Add the `cc` block to `run.sh` compiling `test_bl_session.c bl_session.c bl_frame.c bl_crc32.c fake_bootloader.c`.

- [ ] **Step 2: Run to verify it fails** — `bash tests/run.sh` → FAIL (bl_session.* missing).

- [ ] **Step 3: Implement** `bl_session.h` + `bl_session.c` per the sequence above.

- [ ] **Step 4: Run to verify it passes** — `bash tests/run.sh` → `test_bl_session ok` (all 6 cases). Then run the whole `run.sh` (crc32 + frame + session all green).

- [ ] **Step 5: Commit** — `git add files/bl_session.* tests/fake_bootloader.* tests/test_bl_session.c tests/run.sh && git commit -m "feat(agent): STM32 A/B transfer session state machine (enter->info->erase->stream->verify->commit->confirm)"`

---

## Phase 2 — Update orchestration decision logic (host-TDD)

### Task 4: version compare, idle gate, manifest parse

**Files:** Create `files/stm32_update.h`, `files/stm32_update.c`, `tests/test_stm32_update.c`; Modify `tests/run.sh`.

**Interfaces:**
- Consumes: `cjson` (already a dep; `weather.c` uses it — host tests link `-lcjson`).
- Produces:
  - `typedef enum { STU_IDLE=0, STU_AVAILABLE, STU_FLASHING, STU_OK, STU_FAILED, STU_DISABLED } stu_status_t;`
  - `const char *stu_status_str(stu_status_t s);` (idle/available/flashing/ok/failed/disabled)
  - `uint16_t stu_encode_version(unsigned major, unsigned minor, unsigned patch);` (`major*10000+minor*100+patch`)
  - `int stu_is_newer(uint16_t running_enc, uint16_t bundled_enc);` (1 iff bundled > running AND running != 0)
  - `int stu_should_flash(uint16_t running_enc, uint16_t bundled_enc, uint8_t mode, uint8_t engine, int auto_enabled);` (1 iff `stu_is_newer` AND mode==0 AND engine==0 AND auto_enabled)
  - `int stu_parse_manifest(const char *json, uint16_t *ver_enc, char *slotA, char *slotB, size_t name_cap);` — parse `{ "version":"1.1.0", "slotA":"g0b1-apu-1.1.0-slotA.bin", "slotB":"..." }` → `*ver_enc` (via `stu_encode_version` of the parsed M.m.p), filenames into the caller buffers. Return 0 ok, -1 on malformed/missing/oversized-name.

- [ ] **Step 1: Write the failing test** — `tests/test_stm32_update.c`:
```c
#include "stm32_update.h"
#include <string.h>
#include <stdio.h>
static int fails;
#define CHECK(c) do{ if(!(c)){ printf("FAIL %s:%d %s\n",__FILE__,__LINE__,#c); fails++; } }while(0)
int main(void){
    CHECK(stu_encode_version(1,1,0)==10100);
    CHECK(stu_encode_version(1,0,0)==10000);
    CHECK(stu_is_newer(10000,10100)==1);
    CHECK(stu_is_newer(10100,10100)==0);
    CHECK(stu_is_newer(0,10100)==0);            /* running unknown (reg read failed) -> don't flash */
    CHECK(stu_should_flash(10000,10100,0,0,1)==1);
    CHECK(stu_should_flash(10000,10100,1,0,1)==0); /* mode on */
    CHECK(stu_should_flash(10000,10100,0,1,1)==0); /* engine running */
    CHECK(stu_should_flash(10000,10100,0,0,0)==0); /* auto disabled */
    { uint16_t v=0; char a[64]={0},b[64]={0};
      const char *j="{\"version\":\"1.1.0\",\"slotA\":\"g0b1-apu-1.1.0-slotA.bin\",\"slotB\":\"g0b1-apu-1.1.0-slotB.bin\"}";
      CHECK(stu_parse_manifest(j,&v,a,b,sizeof a)==0 && v==10100 && strcmp(a,"g0b1-apu-1.1.0-slotA.bin")==0 && strstr(b,"slotB")); }
    { uint16_t v=0; char a[64],b[64]; CHECK(stu_parse_manifest("{}",&v,a,b,sizeof a)==-1); }
    printf(fails?"test_stm32_update FAILED (%d)\n":"test_stm32_update ok\n",fails);
    return fails?1:0;
}
```
Add the `cc` block to `run.sh` compiling `test_stm32_update.c stm32_update.c` + `-lcjson` (mirror the `test_weather` cJSON include/lib flags).

- [ ] **Step 2: Run to verify it fails** — `bash tests/run.sh` → FAIL (stm32_update.* missing).

- [ ] **Step 3: Implement** `stm32_update.h` + `stm32_update.c` (pure decision + cJSON manifest parse). No libmodbus/file I/O here.

- [ ] **Step 4: Run to verify it passes** — `bash tests/run.sh` → `test_stm32_update ok`.

- [ ] **Step 5: Commit** — `git add files/stm32_update.* tests/test_stm32_update.c tests/run.sh && git commit -m "feat(agent): STM32 update decision logic (version compare, idle gate, manifest parse)"`

---

## Phase 3 — On-target transport + agent integration (code-review + Yocto/bench)

### Task 5: raw-fd serial transport

**Files:** Create `files/bl_transport_serial.h`, `files/bl_transport_serial.c`.

**Interfaces:**
- Consumes: `bl_session.h` (`bl_transport_t`), libmodbus (`modbus_get_socket`), `<termios.h>`, `<poll.h>`.
- Produces: `int bl_transport_serial_init(bl_transport_t *out, modbus_t *ctx);` — fills `out` with an `xfer`/`wait_reset` implementation bound to the libmodbus context's raw fd. `xfer`: `tcflush(fd, TCIOFLUSH)`; `write(fd, req, req_len)`; then read bytes with a `poll()`-based inter-byte idle-gap (≥ 3.5 char times at 9600 ≈ 4 ms) to delimit the RTU frame, honoring the overall `timeout_ms`; validate via `bl_frame_check`; return length or −1. `wait_reset`: `usleep` a bounded settle (~300 ms) + `tcflush` (the session's own retries cover the rest). No DE toggling in software — the RS-485 transceiver on `/dev/ttyUSB0` is auto-direction (same path libmodbus drives today).

- [ ] **Step 1: Implement** the two functions per the interface. Match `-Wall -Wextra -Wpedantic -Wstrict-prototypes`. Guard all `read`/`write`/`poll` returns.

- [ ] **Step 2: Verify (host compile check)** — this file `#include`s `<modbus/modbus.h>` and `<termios.h>`; on the dev host, if libmodbus is available (`brew install libmodbus`), confirm it compiles: `cc -std=c11 -Wall -Wextra -Wpedantic -c files/bl_transport_serial.c -I files $(pkg-config --cflags libmodbus) -o /tmp/bt.o`. If libmodbus isn't installable on the host, this is compile-verified in the Yocto build (Task 9) instead — note which in the report. It is NOT host-unit-tested (it's the hardware seam); it is exercised by the bench round-trip (Phase 5).

- [ ] **Step 3: Commit** — `git add files/bl_transport_serial.* && git commit -m "feat(agent): raw-fd RS-485 transport for STM32 flash (idle-gap RTU framing)"`

---

### Task 6: flash-task glue (manifest + `.bin` load, orchestration, status)

**Files:** Create `files/stm32_flash_task.h`, `files/stm32_flash_task.c`.

**Interfaces:**
- Consumes: `stm32_update.h`, `bl_session.h`, `bl_transport_serial.h`, `config.h`, the agent's `telemetry_t` (via a small accessor — do NOT include `main.c`; pass the three values in).
- Produces:
  - `void stm32_flash_task_init(modbus_t *ctx);`
  - `stu_status_t stm32_flash_status(void);`
  - `int stm32_flash_status_pct(void);`
  - `void stm32_flash_tick(uint16_t running_ver_enc, uint8_t mode, uint8_t engine);` — called once per poll iteration. Reads `G0B1_FW_DIR "/manifest.json"` (cached; re-read on change), sets status `AVAILABLE` when `stu_is_newer`. If `stu_should_flash(...)` and not already flashing: set `FLASHING`, `mmap`/read both `.bin` from `G0B1_FW_DIR`, build the serial transport, call `bl_session_flash`, set `OK`/`FAILED` from the result, `syslog` the outcome. If auto-flash disabled: status `DISABLED` when an update is available.
- Behavior notes: the whole flash is synchronous inside `stm32_flash_tick` (blocks the poll loop ~1 min — acceptable, APU is off). Before starting, write a `latest.json` snapshot with `stm32_update_status="flashing"` so the UI reflects it immediately (call the same `write_latest_snapshot` path, or set the status var that `build_telemetry_json` reads and let the next snapshot carry it — simplest: set the status var; `main.c` writes the snapshot each loop; for the long blocking flash, additionally call a provided progress callback that updates the status var — a full push mid-flash is optional). Missing/malformed manifest or missing `.bin` → status stays `IDLE`, `syslog` a warning, never crash.

- [ ] **Step 1: Implement** `stm32_flash_task.h` + `stm32_flash_task.c`. File reads use `fopen`/`fread` (or `mmap`) on `/lib/firmware/g0b1-apu/…` (read-only rootfs — no `ReadWritePaths` change needed for reads). Bound the read to `APP_SLOT_SIZE` (0x38000). Warning-clean.

- [ ] **Step 2: Verify (compile)** — same as Task 5 Step 2 (host compile if libmodbus available, else Yocto build in Task 9). Not host-unit-tested (the pure decision logic it calls is already tested in Task 4; this file is file-I/O + glue). Note in report.

- [ ] **Step 3: Commit** — `git add files/stm32_flash_task.* && git commit -m "feat(agent): STM32 flash task — manifest/.bin load + orchestration + status"`

---

### Task 7: wire into the poll loop + telemetry + config + build

**Files:** Modify `files/config.h`, `files/main.c`, `files/CMakeLists.txt`, `gobi-agent_1.0.bb`.

- [ ] **Step 1: config.h** — add:
```c
#define G0B1_FW_DIR            "/lib/firmware/g0b1-apu"
#define G0B1_ENTER_BL_REG      35
#define G0B1_ENTER_BL_VALUE    0x00A5
#define G0B1_ERASE_TIMEOUT_MS  10000   /* 112-page slot erase before ACK */
#define G0B1_AUTO_FLASH_DEFAULT 1      /* auto-flash STM32 when APU idle */
```

- [ ] **Step 2: main.c wiring** — (a) add `uint8_t stm32_update_status;`/`int stm32_update_pct;` to `telemetry_t` OR read them from `stm32_flash_status()` in `build_telemetry_json`; (b) in `build_telemetry_json` add `cJSON_AddStringToObject(root, "stm32_update_status", stu_status_str(stm32_flash_status()));` and `cJSON_AddNumberToObject(root, "stm32_update_pct", stm32_flash_status_pct());`; (c) after `modbus_read_telemetry`/`modbus_read_besteffort` succeed in the poll loop, call `stm32_flash_tick(t.fw_version, t.mode, t.engine_status);`; (d) `stm32_flash_task_init(g_modbus)` once after `modbus_connect`. Include `stm32_flash_task.h`. Ensure the flash-tick runs only after a successful Modbus read (so `t.fw_version`/mode/engine are fresh), and that a flash's serial takeover happens when libmodbus is otherwise idle.

- [ ] **Step 3: build files** — add `bl_crc32.c bl_frame.c bl_session.c stm32_update.c bl_transport_serial.c stm32_flash_task.c` to `target_sources(gobi-agent …)` in `files/CMakeLists.txt`, and the corresponding `file://…` lines to `SRC_URI` in `gobi-agent_1.0.bb`. (Pure-module headers too.)

- [ ] **Step 4: Verify** — `bash tests/run.sh` still green (host tests unaffected). Full agent link is the Yocto build (Task 9). If libmodbus/mosquitto/cjson are host-installable, optionally attempt a host link of `gobi-agent` to catch integration errors early; otherwise rely on Task 9. Note which in the report.

- [ ] **Step 5: Commit** — `git add files/config.h files/main.c files/CMakeLists.txt gobi-agent_1.0.bb && git commit -m "feat(agent): wire STM32 auto-flash into poll loop + stm32_update_status telemetry"`

---

## Phase 4 — Delivery (blob-in-repo) + docs

### Task 8: `g0b1-apu-firmware` recipe + image install + manifest

**Files:** Create `meta-ecofleet/recipes-ecofleet/g0b1-apu-firmware/g0b1-apu-firmware.bb`, `.../files/manifest.json`, and place the two `.bin` (from sub-project #1's release build) at `.../files/g0b1-apu-<ver>-slotA.bin` / `-slotB.bin`; Modify `meta-ecofleet/recipes-core/images/ecofleet-image.bb`; Create `docs/stm32-ota.md`.

**Interfaces:** installs `/lib/firmware/g0b1-apu/{g0b1-apu-<ver>-slotA.bin, -slotB.bin, manifest.json}` into the rootfs.

- [ ] **Step 1: Manifest** — `files/manifest.json` (the agent reads `version` + the two filenames; it computes CRC/length from the `.bin` itself at VERIFY time):
```json
{ "version": "1.1.0",
  "slotA": "g0b1-apu-1.1.0-slotA.bin",
  "slotB": "g0b1-apu-1.1.0-slotB.bin" }
```

- [ ] **Step 2: Recipe** — `g0b1-apu-firmware.bb` (modeled on `startup-banner_1.0.bb`):
```bitbake
SUMMARY = "EcoFleet g0b1/APU STM32 firmware images (A/B slots) for RS-485 remote update"
LICENSE = "CLOSED"

SRC_URI = " \
    file://g0b1-apu-1.1.0-slotA.bin \
    file://g0b1-apu-1.1.0-slotB.bin \
    file://manifest.json \
"
S = "${WORKDIR}"

do_install() {
    install -d ${D}/lib/firmware/g0b1-apu
    install -m 0644 ${WORKDIR}/g0b1-apu-1.1.0-slotA.bin ${D}/lib/firmware/g0b1-apu/
    install -m 0644 ${WORKDIR}/g0b1-apu-1.1.0-slotB.bin ${D}/lib/firmware/g0b1-apu/
    install -m 0644 ${WORKDIR}/manifest.json            ${D}/lib/firmware/g0b1-apu/
}

FILES:${PN} = "/lib/firmware/g0b1-apu"
```
(On a version bump, update the three filenames in `SRC_URI`/`do_install` and `manifest.json`, and drop the new `.bin` into `files/`. Consider a `PV`-driven variable to reduce edits — a plan-time nicety, not required.)

- [ ] **Step 3: Image install** — in `meta-ecofleet/recipes-core/images/ecofleet-image.bb`, add `g0b1-apu-firmware` to the `IMAGE_INSTALL:append` block (the one starting at line ~37).

- [ ] **Step 4: Place real binaries** — copy `g0b1-apu-1.1.0-slotA.bin` / `-slotB.bin` from the g0b1-firmware release (sub-project #1's `cube/build-slots.sh` output) into `files/`. Until those exist from a real release build, commit a README placeholder in `files/` documenting the source, and mark this step BENCH/RELEASE-pending. Assert each `.bin` ≤ `0x38000` (224 KB).

- [ ] **Step 5: Docs + verify** — write `docs/stm32-ota.md`: the end-to-end flow (bump `fw_version.h` in g0b1-firmware → `build-slots.sh` → drop the two `.bin` + bump `manifest.json` here → git tag `vX.Y.Z` → CI `make-swu.sh` bundles the rootfs-resident blobs into the signed `.swu` → device OTA lands the blobs → agent auto-flashes the STM32 when idle). Note there is NO CI change (blobs ride in the rootfs). Recipe syntax can't be bitbake-parsed on the dev host — it's verified by the Yocto CI build (Task 9). Commit:
`git add meta-ecofleet/recipes-ecofleet/g0b1-apu-firmware/ meta-ecofleet/recipes-core/images/ecofleet-image.bb docs/stm32-ota.md && git commit -m "feat(delivery): bundle g0b1-apu A/B firmware in rootfs + STM32 OTA docs"`

---

## Phase 5 — Build + bench validation

### Task 9: Yocto build + host-suite gate

- [ ] **Step 1: Host suite** — `cd meta-ecofleet/recipes-ecofleet/gobi-agent && bash tests/run.sh` → all pure-module tests green (crc32, frame, session, stm32_update).

- [ ] **Step 2: Yocto image build (CI / self-hosted runner — user)** — trigger `.github/workflows/build.yml` (or `scripts/kas-build.sh` on the runner) and confirm: `gobi-agent` compiles + links with the six new sources; `g0b1-apu-firmware` recipe parses + installs; `ecofleet-image` builds with `/lib/firmware/g0b1-apu/` populated. This is the first full compile of the on-target transport + glue (Tasks 5-7) — fix any link/compile errors surfaced here. (Cannot run on the dev host; it's the self-hosted Yocto runner.)

- [ ] **Step 3: Commit any build fixes** — `git commit -m "fix(agent): Yocto build integration for STM32 flash module"` (if needed).

---

### Task 10: bench end-to-end (user, on real hardware — the two halves of sub-project #1 + #2 meet here)

- [ ] **Step 1: Provision** — a unit running the STM32 bootloader + a Slot-A app at version `1.0.0` (per sub-project #1's `provision_boot.md`), and a cortex image built from this branch with `/lib/firmware/g0b1-apu/` carrying the `1.1.0` `.bin`s.

- [ ] **Step 2: Auto-flash happy path** — with the APU off (mode 0, engine off), start `gobi-agent`; it should detect `1.1.0 > 1.0.0`, enter the bootloader, INFO→ERASE→stream→VERIFY→COMMIT, the STM32 reboots into Slot B, reg 2 reads `10100`, and `stm32_update_status` transitions `available → flashing → ok` in `latest.json`/telemetry. Confirm a second bump role-swaps back to Slot A.

- [ ] **Step 3: Safety + failure cases** — (a) with the engine running, confirm the agent does NOT flash (`stu_should_flash` false) and, if reg 35 is forced, the app refuses with exception 0x04; (b) pull power mid-stream → the old slot stays active, agent retries later; (c) a deliberately-corrupt `.bin` → VERIFY NAK, no commit, status `failed`; (d) auto-flash disabled (`G0B1_AUTO_FLASH_DEFAULT 0`) → status `disabled`/`available`, no flash. These correspond 1:1 to sub-project #1's `docs/remote-update.md` §8 bench list.

- [ ] **Step 4: Full OTA loop** — cut a cortex `.swu` (git tag) carrying the new STM32 blob, OTA it to a device the normal way, and confirm the STM32 auto-flashes after the cortex reboots into the new rootfs. This closes the "STM32 update ships inside a normal signed cortex OTA" goal.

---

## Self-Review

**Spec coverage** (Component D + E of `2026-09-03-stm32-remote-firmware-update-design.md`):
- **D — version compare** (Task 4 `stu_is_newer`, reg 2), **safety gate** (Task 4 `stu_should_flash`, reg 10/22 + firmware refusal), **flash sequence** (Task 3 `bl_session_flash` = enter→info→erase→stream+ACK/retry→verify→commit→re-read reg 2), **progress/telemetry** (`stm32_update_status` in `build_telemetry_json` → latest.json + MQTT), **new bounded testable module against a host fake bootloader** (Task 3 `fake_bootloader`). ✓
- **E — delivery** (Task 8): STM32 image ships in the rootfs at `/lib/firmware/g0b1-apu/`; **blob-in-repo** recipe (user decision, over the spec's tentative fetch-by-release — justified by the exploration: zero fetch precedent in-layer, blobs inherit the `.swu` signature). ✓
- **Integrity/authenticity:** CRC32 checked host-side pre-send (Task 3 step 6 uses `bl_crc32` for VERIFY) + by the bootloader; authenticity inherited from the signed `.swu` (no agent change — blobs ride in the signed rootfs). ✓
- **Trigger:** auto-when-idle, config-gated (`G0B1_AUTO_FLASH_DEFAULT`) — user decision; telemetry always reports status. ✓
- **Frozen-contract fidelity:** Tasks 1-3 mirror `bl_proto.h` + `bl_flash.py` byte-for-byte, with a byte-exact `test_bl_frame` + a fake-bootloader round-trip. ✓

**Verification split (like sub-project #1):** the risky logic (framing, CRC, session, decision) is host-unit-tested via the agent's `run.sh`; the on-target raw-fd transport (Task 5), file-I/O glue (Task 6), poll-loop wiring (Task 7), and Yocto recipe (Task 8) are code-reviewed + compiled in the Yocto CI build (Task 9) + validated on the bench (Task 10) — the agent can't be fully cross-compiled on the dev host (needs libmodbus/mosquitto/sqlite/cjson/curl), and bitbake recipes need the Yocto env. This is called out per task.

**Placeholder scan:** on-target/Yocto tasks give concrete file contents + a specific verification (host compile if libmodbus present, else the named Yocto build step) — not "test appropriately". The one genuinely deferred item is placing the real release `.bin` (Task 8 Step 4), which depends on a g0b1-firmware release build and is flagged RELEASE-pending.

**Type consistency:** `bl_transport_t`, `bl_result_t`, `bl_flash_params_t`, `bl_info_t`, `stu_status_t`, and the FC/sub/err constants are defined once (Tasks 2-4) and referenced consistently by the on-target glue (Tasks 5-7). The reg N-1 wire convention matches `main.c`'s existing `mb_write_reg`/`modbus_read_reg_besteffort`. `stm32_update_status` strings from `stu_status_str` are the single source for the telemetry field.
