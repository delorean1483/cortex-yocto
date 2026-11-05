# External RGB Light — Plan 1: G0B1 Firmware Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The G0B1 drives the external lamp's IS31FL3293 (I2C2, 0x6C) from Modbus registers 76-79.

**Architecture:** A portable register driver over the existing `i2c_backend_t` seam, an `rgb` service with one transport-independent entry point (`rgb_set_logical`) that the superloop applies in one PWM update, a Modbus provider for registers 76-79, and a HAL I2C2 backend wired into `app_main.c`. A stdlib bench script exercises it over RS-485.

**Tech Stack:** C11, STM32 HAL (I2C2), Unity 2.7.1 + CMake/ctest host tests (`Tests/`), Python 3 stdlib.

**Spec:** `cortex-yocto/docs/superpowers/specs/2026-11-04-external-rgb-light-design.md` (G0B1 items 1-4, Hardware facts, Decisions 5-6, Restore behavior).

**Repo:** `g0b1-firmware`. Plan 2 (`2026-11-04-external-rgb-2-cortex.md`) consumes the register contract below and can be built in parallel.

## Global Constraints

- IS31FL3293 7-bit address `0x6C` on `hi2c2` (PB14 SDA / PA11 SCL, 100 kHz); HAL address `0x6C << 1`; every transfer times out at 10 ms.
- Init sequence, exactly and in order: `0x3F←C5`, `0x01←70`, `0x02←00`, `0x03←3F`, `0x10..0x12←FF FF FF`, `0x27←C5`, `0x19..0x1E←00×6`, `0x28←C5`, `0x01←75`.
- PWM: 12-bit per channel, low byte then high nibble; one 6-byte write from `0x19`, then one `0x28←C5`. Never latch per channel.
- Channel map: OUT1 = green, OUT2 = red, OUT3 = blue. No PWM inversion.
- 8-bit to 12-bit: `(v * 4095u + 127u) / 255u`.
- Registers (firmware numbering; wire = reg − 1): 76 `led_red`, 77 `led_green`, 78 `led_blue` (RW; write = requested 0-255, >255 → `MB_EXC_ILLEGAL_VALUE`; read = applied); 79 `led_status` (RO; bit 0 present, bit 1 last apply OK, bit 2 pending). `MB_REG_MAX` 79, `MB_REG_LIMIT` 80.
- After boot the applied color is 0,0,0. The firmware never lights the lamp on its own.
- No blocking waits; the superloop and its ~2 s IWDG stay as they are.
- Board specifics live only in `drv_rgb_i2c2.c` and `app_main.c`. RGB code never touches PC3; the R1 build must still compile.
- Never `git add -A cube/`: `cube/g0b1-apu-slot*.{bin,elf,map}` are untracked build outputs.

## Review Focus

1. Breakout absent or unpowered at boot: bit 0 stays clear, the superloop never stalls, init retries back off to at most 8 s with no I2C storm. Test `test_absent_chip_backs_off` (Task 2).
2. Lamp unplugged after init: the apply fails, bit 1 clears, bit 0 stays until a re-init fails; when the chip answers again the last requested color comes back. Test `test_apply_failure_reinit_reapplies` (Task 2).
3. One FC16 write of 76-78 produces exactly one PWM update (no intermediate colors). Test `test_three_writes_one_update` (Task 3).
4. A value above 255 is rejected without changing that channel's request. Test `test_out_of_range_rejected` (Task 3).
5. An idle RGB service does no I2C, so the heater client's traffic on the same bus is untouched. Test `test_idle_does_no_i2c` (Task 2).

Test command used below (`<t>` = test name), run from the repo root:
`cmake -S Tests -B Tests/build >/dev/null && cmake --build Tests/build --target <t> && (cd Tests/build && ctest -R '^<t>$' --output-on-failure)`

---

### Task 0: Branch

- [ ] **Step 1:** `cd ~/dev/g0b1-firmware && git fetch origin && git log --oneline HEAD..origin/main | head` → empty (main is current).
- [ ] **Step 2:** `git worktree add ~/dev/g0b1-firmware.worktrees/external-rgb -b feat/external-rgb origin/main` and work there for all tasks.

### Task 1: IS31FL3293 register driver

**Files:**
- Create: `App/services/is31fl3293.h`, `App/services/is31fl3293.c`
- Create: `Tests/fakes/fake_is31.h`, `Tests/fakes/fake_is31.c`
- Create: `Tests/test_is31fl3293.c`
- Modify: `Tests/CMakeLists.txt` (append after the last line, `test_heater_e2e`)

**Interfaces:**
- Consumes: `i2c_backend_t` (`App/services/i2c_backend.h`: `read/write(void *ctx, uint8_t reg, buf, uint16_t len)` → 0 ok, non-zero error).
- Produces:
  ```c
  #define IS31_ADDR7 0x6Cu
  int is31_init(const i2c_backend_t *bus);     /* 0 ok; -1 at the first failed transfer (stops there) */
  int is31_set_pwm(const i2c_backend_t *bus, uint16_t out1, uint16_t out2, uint16_t out3); /* clamps each to 4095 */
  int is31_shutdown(const i2c_backend_t *bus); /* 0x01 <- 0x70 */
  ```
  Fake, modeled on `Tests/fakes/fake_coproc_bus.{h,c}` (struct embedding `i2c_backend_t api`, `ctx = f`):
  ```c
  typedef struct { uint8_t reg; uint8_t len; uint8_t data[8]; } fake_is31_xfer_t;
  typedef struct {
      i2c_backend_t api;
      uint8_t  regs[0x40];
      bool     fail;            /* every transfer returns -1, nothing logged */
      unsigned attempts;        /* every read/write call, failed or not */
      fake_is31_xfer_t log[32]; unsigned nlog;   /* successful writes, in order */
      unsigned pwm_latches;     /* successful writes of 0xC5 to 0x28 */
  } fake_is31_t;
  void fake_is31_init(fake_is31_t *f);
  ```

- [ ] **Step 1: Write the failing tests** in `Tests/test_is31fl3293.c` (Unity, `setUp` calls `fake_is31_init`):
  - `test_init_sequence`: `is31_init(&f.api) == 0`, `f.nlog == 9`, and each `log[i]` equals, in order: `{0x3F,1,{0xC5}}`, `{0x01,1,{0x70}}`, `{0x02,1,{0x00}}`, `{0x03,1,{0x3F}}`, `{0x10,3,{0xFF,0xFF,0xFF}}`, `{0x27,1,{0xC5}}`, `{0x19,6,{0,0,0,0,0,0}}`, `{0x28,1,{0xC5}}`, `{0x01,1,{0x75}}`.
  - `test_set_pwm_packs_and_latches_once`: `is31_set_pwm(&f.api, 0x0ABC, 4095, 0) == 0`; `log[0]` = `{0x19,6,{0xBC,0x0A,0xFF,0x0F,0x00,0x00}}`; `log[1]` = `{0x28,1,{0xC5}}`; `f.pwm_latches == 1`; `f.nlog == 2`.
  - `test_set_pwm_clamps`: `is31_set_pwm(&f.api, 5000, 0, 0)` → `log[0].data[0..1] == {0xFF,0x0F}`.
  - `test_failure_propagates`: `f.fail = true` → `is31_init(...) == -1`, `f.nlog == 0`, `f.attempts == 1`; `is31_set_pwm(...) == -1`.
  - `test_shutdown`: `is31_shutdown(&f.api) == 0`, `log[0] == {0x01,1,{0x70}}`.
- [ ] **Step 2: Register and run, expect FAIL (undefined symbols).** Append `add_heater_test(test_is31fl3293 test_is31fl3293.c ../App/services/is31fl3293.c fakes/fake_is31.c)` (the helper is `add_unity_test` plus ASan/UBSan). Run the test command with `<t>` = `test_is31fl3293`.
- [ ] **Step 3: Implement** `is31fl3293.{h,c}` and `fake_is31.{h,c}` per the interfaces. Register addresses and values as named `#define`s in the header (`IS31_REG_RESET 0x3Fu`, `IS31_KEY 0xC5u`, `IS31_SHUTDOWN_OFF 0x70u`, `IS31_NORMAL_ON 0x75u`, …). Out-of-range fake reads return `0xFF`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git add App/services/is31fl3293.* Tests/fakes/fake_is31.* Tests/test_is31fl3293.c Tests/CMakeLists.txt && git commit -m "feat(rgb): IS31FL3293 register driver"`

### Task 2: RGB service

**Files:**
- Create: `App/services/rgb.h`, `App/services/rgb.c`, `Tests/test_rgb.c`
- Modify: `Tests/CMakeLists.txt`

**Interfaces:**
- Consumes: Task 1 (`is31_init`, `is31_set_pwm`, `fake_is31_t`).
- Produces:
  ```c
  #define RGB_ST_PRESENT   0x0001u  /* chip found and initialized */
  #define RGB_ST_APPLY_OK  0x0002u  /* last apply succeeded */
  #define RGB_ST_PENDING   0x0004u  /* requested color not yet applied */
  #define RGB_RETRY_MIN_MS 500u
  #define RGB_RETRY_MAX_MS 8000u
  void     rgb_init(const i2c_backend_t *bus, uint32_t now); /* stores the bus, resets state; no I2C */
  void     rgb_set_logical(uint8_t r, uint8_t g, uint8_t b); /* THE entry point for every transport */
  void     rgb_get_requested(uint8_t out[3]);                /* r, g, b */
  void     rgb_get_applied(uint8_t out[3]);
  uint16_t rgb_get_status(void);
  void     rgb_process(uint32_t now);                        /* superloop; the only place that does I2C */
  uint16_t rgb_to12(uint8_t v);                              /* (v*4095+127)/255 */
  ```
- Behavior (`rgb_process`; compare times wrap-safely, `(int32_t)(now - t) >= 0`):
  - Not initialized and the retry time has come: `is31_init`. Success → initialized, set PRESENT, reset backoff to `RGB_RETRY_MIN_MS`, mark the requested color pending (this is the "re-apply after re-init"). Failure → clear PRESENT, next try = now + backoff, then backoff doubles up to `RGB_RETRY_MAX_MS`.
  - Initialized and pending: `is31_set_pwm(bus, rgb_to12(g), rgb_to12(r), rgb_to12(b))`. Success → applied = requested, set APPLY_OK, clear pending. Failure → clear APPLY_OK, drop to not-initialized with the retry time = now; PRESENT stays until a re-init fails.
  - The two steps run in that order in the same call, so a successful init applies the pending color in the same pass.
  - Otherwise no I2C at all.
  - `rgb_set_logical` stores the request and marks it pending (last call wins).

- [ ] **Step 1: Write the failing tests** in `Tests/test_rgb.c` (fake from Task 1; a `run_to(t)` helper like `Tests/test_heater.c:10`, stepping 10 ms):
  - `test_boot_inits_and_is_off`: `rgb_init(&f.api,0); rgb_process(0);` → status has PRESENT and APPLY_OK, applied `{0,0,0}`, `f.log[0].reg == 0x3F`.
  - `test_red_maps_to_out2`: after boot, `rgb_set_logical(255,0,0); rgb_process(t);` → last `0x19` write data `{0x00,0x00,0xFF,0x0F,0x00,0x00}`; applied `{255,0,0}`; status not PENDING.
  - `test_green_out1_blue_out3`: `(0,255,0)` → data[0..1] `{0xFF,0x0F}`; `(0,0,255)` → data[4..5] `{0xFF,0x0F}`.
  - `test_to12_values`: `rgb_to12(0)==0`, `(255)==4095`, `(128)==2056`, `(1)==16`.
  - `test_last_request_wins`: `set(1,2,3); set(4,5,6); process` → exactly one new `0x28` latch and applied `{4,5,6}`.
  - `test_idle_does_no_i2c`: after boot and one apply, record `f.attempts`; `run_to(+5000)` → `f.attempts` unchanged.
  - `test_absent_chip_backs_off`: `f.fail = true`, `rgb_init(&f.api,0)`; `process(0)` → PRESENT clear, attempts 1; `process(499)` → still 1; `process(500)` → 2; next attempts exactly at +1000, +2000, +4000, +8000, +8000 after each previous one.
  - `test_apply_failure_reinit_reapplies`: boot OK; `set(10,20,30); process` → applied; `f.fail = true; set(40,50,60); process` → APPLY_OK clear, PRESENT still set; `f.fail = false; process; process` → applied `{40,50,60}`, PRESENT and APPLY_OK set.
- [ ] **Step 2: Register** `add_heater_test(test_rgb test_rgb.c ../App/services/rgb.c ../App/services/is31fl3293.c fakes/fake_is31.c)`; **run, expect FAIL.**
- [ ] **Step 3: Implement** `rgb.{h,c}` per the interfaces and behavior.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(rgb): rgb service, one transport-independent entry, applied in the superloop`

### Task 3: Modbus registers 76-79

**Files:**
- Create: `App/services/mbp_rgb.h`, `App/services/mbp_rgb.c`, `Tests/test_mbp_rgb.c`
- Modify: `App/services/modbus_defs.h:32-34` (`MB_REG_MAX 79u`, `MB_REG_LIMIT 80u`, comment "Registers are 1..79; wire range check is (start+count) <= 80")
- Modify: `Tests/test_mbp_heater.c:45-48` and its `RUN_TEST` at line 75: rename to `test_block_53_to_75_readable_and_past_max_out_of_range`, keep the 53-75 loop, assert `mb_reg_read(MB_REG_MAX + 1u, &v) == MB_EXC_ILLEGAL_ADDRESS` instead of reg 76.
- Modify: `Tests/CMakeLists.txt`; stale comments `mb_regmodel.c:4` ("1..52"), `mbp_heater.h:4` if it states the top register.

**Interfaces:**
- Consumes: Task 2 (`rgb_set_logical`, `rgb_get_requested`, `rgb_get_applied`, `rgb_get_status`, `rgb_process`); `mb_reg_bind(reg, rd, wr)` (`wr` NULL = read-only).
- Produces: `void mbp_rgb_register(void);` A write to 76/77/78 takes the current *requested* triple, replaces that one channel, and calls `rgb_set_logical` (so all three transports share one entry). Reads of 76-78 return the *applied* value; 79 returns `rgb_get_status()`.

- [ ] **Step 1: Write the failing tests** in `Tests/test_mbp_rgb.c` (`setUp`: `fake_is31_init`, `rgb_init(&f.api,0)`, `rgb_process(0)`, `mb_reg_reset()`, `mbp_rgb_register()`):
  - `test_write_channels_set_requested`: writes 76←10, 77←20, 78←30 all `MB_EXC_NONE`; `rgb_get_requested` → `{10,20,30}`.
  - `test_read_returns_applied`: after those writes and before `rgb_process`, reads of 76-78 return 0; after one `rgb_process(10)` they return 10, 20, 30.
  - `test_three_writes_one_update`: record `f.pwm_latches`; three writes then one `rgb_process` → latches + 1 exactly.
  - `test_out_of_range_rejected`: `mb_reg_write(77, 256) == MB_EXC_ILLEGAL_VALUE`; requested green unchanged.
  - `test_status_read_only`: `mb_reg_write(79, 1) == MB_EXC_ILLEGAL_ADDRESS`; `mb_reg_read(79)` equals `rgb_get_status()`.
  - `test_past_max_unbound`: `mb_reg_read(MB_REG_MAX + 1u, &v) == MB_EXC_ILLEGAL_ADDRESS` and `MB_REG_MAX == 79u`.
- [ ] **Step 2: Register** `add_heater_test(test_mbp_rgb test_mbp_rgb.c ../App/services/mbp_rgb.c ../App/services/rgb.c ../App/services/is31fl3293.c ../App/services/mb_regmodel.c fakes/fake_is31.c)`; **run, expect FAIL.**
- [ ] **Step 3: Implement** `mbp_rgb.{h,c}` (header comment lists each register like `mbp_heater.h:4-31`), the limit change, the renamed heater test.
- [ ] **Step 4: Run the full suite, expect all PASS** (the `test_mb_engine_*` and `test_mb_regmodel` tests follow the macros): `(cd Tests/build && cmake --build . && ctest --output-on-failure)`.
- [ ] **Step 5: Commit** — `feat(rgb): Modbus regs 76-79 (led red/green/blue/status); MB_REG_MAX 79`

### Task 4: HAL backend and superloop wiring

**Files:**
- Create: `cube/Core/Inc/drv_rgb_i2c2.h`, `cube/Core/Src/drv_rgb_i2c2.c`
- Modify: `cube/Core/Src/app_main.c` — include `drv_rgb_i2c2.h`, `rgb.h`, `mbp_rgb.h` near lines 16/29-30; `rgb_init(drv_rgb_i2c2_backend(), HAL_GetTick());` right after `heater_init(...)` (line 252, i.e. after the R0 rail is up); `mbp_rgb_register();` after `mbp_heater_register();` (line 280); `rgb_process(now);` right after `heater_process(now);` (line 329); fix the stale "regs 53-74" comments at lines 30 and 280.
- Modify: `cube/.project` — three `<link>` entries (type 1, `Core/Src/<file>` → `PARENT-1-PROJECT_LOC/App/services/<file>`) for `is31fl3293.c`, `rgb.c`, `mbp_rgb.c`, after the `mbp_heater.c` link (lines 238-242).

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: `const i2c_backend_t *drv_rgb_i2c2_backend(void);` — a copy of `drv_heater_i2c2.c`'s shape: `HAL_I2C_Mem_Read/Write(&hi2c2, IS31_ADDR7 << 1, reg, I2C_MEMADD_SIZE_8BIT, buf, len, RGB_I2C_TIMEOUT_MS)` with `RGB_I2C_TIMEOUT_MS 10u`, returning 0 / -1; `ctx` NULL.

- [ ] **Step 1: Implement** the backend and the wiring above. Both I2C2 users now run one after the other in the same superloop, so their transfers never overlap.
- [ ] **Step 2: Check board isolation** — `grep -n "GPIOC\|GPIO_PIN_3\|BOARD_REV" App/services/rgb.c App/services/is31fl3293.c App/services/mbp_rgb.c cube/Core/Src/drv_rgb_i2c2.c` → no output.
- [ ] **Step 3: Host suite still green** — `(cd Tests/build && cmake --build . && ctest)` → 0 failures.
- [ ] **Step 4: ARM build.**
  - Delete macOS duplicate files first: `find cube -name "* 2.*" -delete`.
  - Headless: `stm32cubeide --launcher.suppressErrors -nosplash -application org.eclipse.cdt.managedbuilder.core.headlessbuild -data /tmp/cubews-rgb -import cube -cleanBuild g0b1-apu/Release` → 0 errors.
  - If headless isn't available, the user opens CubeIDE, does Close → Open Project (needed for `.project` link changes), then Project ▸ Clean and Build Release → 0 errors.
  - Then `cd cube && ./build-slots.sh` → both `.bin` files under 224 KB.
- [ ] **Step 5: Commit** — `git add cube/Core/Inc/drv_rgb_i2c2.h cube/Core/Src/drv_rgb_i2c2.c cube/Core/Src/app_main.c cube/.project && git commit -m "feat(rgb): I2C2 backend for the IS31FL3293 and superloop wiring"`

### Task 5: Bench script and doc

**Files:**
- Create: `tools/rgb_bench.py`, `tools/test_rgb_bench.py`, `docs/external-rgb.md`

**Interfaces:**
- Consumes: `tools/bl_flash.py` (`modbus_crc16`, `SerialPort`; stdlib only, runs on the Variscite), registers 76-79 (wire 75-78).
- Produces:
  ```python
  def fc16_frame(slave: int, wire_start: int, values: list[int]) -> bytes  # CRC low byte first
  def fc03_frame(slave: int, wire_start: int, count: int) -> bytes
  DIAG_STEPS: list[tuple[str, tuple[int, int, int]]]
  ```
  CLI: `rgb_bench.py [--port /dev/ttyUSB0] set R G B | read | diag [--step-s 1.5] | ramp red|green|blue`. Each step prints the applied color and status bits read back from 76-79. It prints "stop gobi-agent first" at start, since the agent owns the port and its restore would undo test colors.

- [ ] **Step 1: Write the failing tests** in `tools/test_rgb_bench.py` (stdlib `unittest`):
  - `test_fc16_frame_red`: `fc16_frame(1, 75, [255, 0, 0])[:-2] == bytes([0x01,0x10,0x00,0x4B,0x00,0x03,0x06,0x00,0xFF,0x00,0x00,0x00,0x00])` and the last two bytes are `modbus_crc16` of the rest, low byte first.
  - `test_fc03_frame_status_block`: `fc03_frame(1, 75, 4)[:-2] == bytes([0x01,0x03,0x00,0x4B,0x00,0x04])`.
  - `test_diag_steps`: names `["off","red","green","blue","yellow","cyan","magenta","white","off"]` with colors `(0,0,0)`, `(255,0,0)`, `(0,255,0)`, `(0,0,255)`, `(255,255,0)`, `(0,255,255)`, `(255,0,255)`, `(255,255,255)`, `(0,0,0)`.
- [ ] **Step 2: Run, expect FAIL** — `python3 tools/test_rgb_bench.py`.
- [ ] **Step 3: Implement** `tools/rgb_bench.py`. `ramp` steps one channel 0→255 in 16 steps, then back to off.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Write `docs/external-rgb.md`:**
  - the register table
  - wiring: R0 ST1 to HDR2, lamp black wire to +12 V
  - the bench procedure from the spec's Verification: diag sequence, mapping and polarity, 0 = off, ramps, gate waveforms and MOSFET temperature, G0B1 reset / power cycle / RS-485 unplug, rapid writes while the heater client polls
  - the limitations: no hardware off line; the lamp keeps its last color if the G0B1 hangs
  - board notes: R1's LEDS_OFF is unrelated to the lamp; R2 puts the breakout circuit on board, so only the backend and board init change
- [ ] **Step 6: Commit** — `feat(rgb): bench script and external RGB doc`

### Task 6: Version bump

- [ ] **Step 1:** In `App/services/fw_version.h:25-27` set PATCH `7u` and append to the changelog comment: `v1.1.7: external RGB light (IS31FL3293 @0x6C on I2C2) + Modbus regs 76-79`.
- [ ] **Step 2:** Full host suite → 0 failures (`test_control_io` checks the version against the macros).
- [ ] **Step 3: Commit** — `release: v1.1.7 (external RGB light, Modbus regs 76-79)`. Pushing, PR and flashing wait for the user.
