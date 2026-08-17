# STM32G0 APU — Hardware Bench Bring-Up Plan

> **NOT an agentic/TDD plan.** This is a **human-executed bench runbook**: it requires the physical EF-G0B1R board, an ST-LINK, a bench PSU, a scope/meter, and an RS-485 Modbus master. A subagent cannot flash a board or scope a pin, so `subagent-driven-development` / `executing-plans` do **not** apply here. Steps use `- [ ]` for tracking. Where a step's logic *is* host-testable (only the NOR page-split, Task 6), that step keeps a real Unity RED→GREEN cycle.

**Goal:** Bring the completed, host-tested portable APU firmware core up on the real STM32G0B1RET3 silicon — write the concrete HAL/driver layer that fills the five abstraction seams, add the `.ioc`/clock/boot scaffolding and `main()` superloop, then validate the full control loop on real actuators.

**Architecture:** The application core (control state machines, Modbus engine, NVM journal, sensor conversions, RTC service, cooperative scheduler) is complete and behind clean backend interfaces (`nvm_backend_t`, `i2c_backend_t`, `bsp_io_backend_t`, `bsp_pwm_backend_t`, plus the `rpm_source_t` and a direct ADC-feed). Bring-up writes exactly one concrete implementation per seam plus the CubeMX-generated HAL, wires them in `main()`, and validates each in isolation against known-good logic. Because every driver plugs into an already-proven core, a misbehaving relay is the driver's fault, not the state machine's — that isolation is the payoff of the approach-C re-architecture.

**Tech Stack:** STM32CubeIDE + CubeMX (HAL), STM32G0B1RET3 (Cortex-M0+, 64 MHz), C11. Board: EF-G0B1R "G0B1 APU Manager". Existing host suite: CMake + Unity (60 executables, `-Werror`).

**Spec:** `docs/superpowers/specs/2026-08-12-pic18-to-stm32g0-apu-port-design.md` (§4 pin map, §5 clock/peripherals, §6 outputs, §7 RTC, §10 open items OI-1..OI-8). The schematic `G0B1 APU Manager R1.pdf` is the **final authority** on pin/net/population; where this plan and the schematic disagree, the schematic wins and this plan is corrected.

## Global Constraints

- **The portable core and its interfaces are FROZEN.** Bring-up adds `drv_*`/`bsp_*` implementations and `main()`; it does **not** change the backend struct shapes, service APIs, or control logic. If a driver cannot satisfy an interface, that is a finding to raise, not a reason to edit the core.
- **Backend contracts (exact, from the headers):**
  - `nvm_backend_t`: `{uint32_t sector_size; uint32_t sector_count; int (*read)(ctx,addr,buf,len); int (*program)(ctx,addr,buf,len); int (*erase)(ctx,sector_index); void*ctx;}` — erased = 0xFF, `program` may only clear bits, all ops return 0 on success.
  - `i2c_backend_t`: `{int (*read)(ctx,uint8_t reg,buf,uint16_t len); int (*write)(ctx,uint8_t reg,const buf,uint16_t len); void*ctx;}` — register-addressed, 0 = success.
  - `bsp_io_backend_t`: `{void (*out_set)(ctx,uint8_t out,bool on); bool (*out_get)(ctx,uint8_t out); bool (*in_read)(ctx,uint8_t in); void*ctx;}` — `out`/`in` are the `board_pins.h` enums.
  - `bsp_pwm_backend_t`: `{void (*set)(ctx,uint8_t ch,uint16_t permille); uint16_t (*get)(ctx,uint8_t ch); void*ctx;}` — duty in permille 0..1000.
  - `rpm_source_t`: `{uint16_t (*get_rpm)(void*ctx); void*ctx;}`.
- **`board_pins.h` logical IDs (physical mapping lives in the driver):** outputs `OUT_FUEL_PUMP, OUT_STARTER, OUT_GLOW_PLUG, OUT_COMPRESSOR_CLUTCH, OUT_HEAT_REVERSER, OUT_EVAP_FAN, OUT_CONDENSER_FAN`; PWM `PWM_EVAP_FAN, PWM_CONDENSER_FAN`; inputs `IN_OIL_PRESSURE, IN_TRUCK_IGNITION`.
- **Peripheral/pin map (spec §5.2/§5.3 — CONFIRM each against the schematic + generated `.ioc` before trusting):** Clock HSE 8.000 MHz (Y1, PF0/PF1) → PLL M=1/N=16/R=2 → **SYSCLK 64 MHz**, SysTick 1 ms. ADC ref = external **3.000 V** on VREF+ (12-bit → 4096 = 3.000 V). Fan PWM **TIM2** CH1=PC4 (evap), CH2=PC5 (condenser), ~1 kHz. RPM **TIM3_CH1 = PA6 (AF1)** input-capture. Modbus **USART1 PA9/PA10 + DE PB3** (HW driver-enable), DMA RX/TX, frame gap via USART **RTO**. SPI NOR **SPI2** (PD1 SCK / PD3 MISO / PD4 MOSI) + **PC2 CS** (GPIO), S25FL064. RTC **I2C1** (PB6 SCL / PB7 SDA), MCP7940N. Relays: Heat_Reverser PB4, Condenser_Fan enable PB9 (+PC5 PWM). Watchdog IWDG. **Two known traps: (1) the SYSCFG PA9↔PA11 / PA10↔PA12 remap MUST be set or USART1 collides with I²C2; (2) IRQ priority — USART RX above SysTick (M0+, 2 priority bits).**
- **Safe-default-off boot:** before the scheduler starts, every relay/PWM must be de-energized. The engine, starter, glow-plug, and compressor must never be driven by power-on glitch or an uninitialised GPIO.
- **Host suite stays green throughout.** Any host-testable change (Task 6 page-split, Task 8 guard, Task 10 exception) keeps `ctest` at 60+ executables, `-Wall -Wextra -Werror -funsigned-char` pristine. On-target code lives under a new `firmware/g0b1-apu/Core/` (or CubeIDE default tree); the portable `App/services/` stays host-buildable.
- **Commit per task.** Each task ends with a working, independently demonstrable deliverable and a commit on `feat/stm32g0-apu-port` (or a `feat/bench-bringup` child branch).

---

### Task 1: CubeMX project, clock tree, and heartbeat boot

**Deliverable:** the board boots from a CubeIDE project, runs at 64 MHz, and blinks a heartbeat GPIO — proving toolchain, clock, and flash/debug path.

**Files:**
- Create: the CubeIDE `.ioc` at the firmware root (generates `Core/Src/main.c`, `Core/Src/system_stm32g0xx.c`, `startup_stm32g0b1retx.s`, HAL config).
- Create: `Core/Src/app_main.c` — a thin `app_main(void)` called from generated `main()` after `MX_*_Init()`, so generated code and our code stay separated across CubeMX regens.

**Interfaces:**
- Produces: `void app_main(void);` (never returns) — the entry point every later task's wiring hangs off.

- [ ] **Step 1:** In CubeMX: select STM32G0B1RET3. Configure HSE = 8 MHz crystal (PF0/PF1), PLL M=1 N=16 R=2 → SYSCLK 64 MHz, APB = 64 MHz. Enable SWD (PA13/PA14). Set NRST on PF2.
- [ ] **Step 2:** Enable one spare GPIO as a push-pull output for a heartbeat LED/scope point (pick a free pin, note it — e.g. an unused PB/PC pin per the schematic).
- [ ] **Step 3:** Generate code. Add `Core/Src/app_main.c` with `app_main()` toggling the heartbeat pin in a `while(1)` with a crude `HAL_Delay(500)`. Call `app_main()` at the end of generated `main()` (inside the `USER CODE BEGIN WHILE` guard so regen preserves it).
- [ ] **Step 4 (bench acceptance):** Flash via ST-LINK. Scope the heartbeat pin → **1 Hz square wave, 3.3 V**. Scope HSE or a clock-out (MCO) if available → confirm 64 MHz-derived. If the LED blinks at the wrong rate, the clock tree is misconfigured — fix before proceeding.
- [ ] **Step 5:** Commit: `feat(g0b1-apu): CubeMX .ioc + 64MHz clock + heartbeat boot skeleton`.

---

### Task 2: SysTick → cooperative scheduler tick

**Deliverable:** the real `sched_service`/`sched_run` loop runs off the 1 ms SysTick; a registered slot proves cadence.

**Files:**
- Modify: `Core/Src/app_main.c` (drive the scheduler), the generated `stm32g0xx_it.c` (`SysTick_Handler`).
- Consumes: `sched.h` (`sched_init`, `sched_service`, `sched_register`, `sched_run`, `SLOT_*`), `app_timers.h`.

**Interfaces:**
- Consumes: `void sched_init(void); void sched_service(uint16_t elapsed_ms); void sched_run(void); void sched_register(sched_slot_t, sched_handler_fn);`

- [ ] **Step 1:** Add a `volatile uint32_t s_tick_ms` incremented in `SysTick_Handler` (SysTick already fires every 1 ms from HAL init). In `app_main`: `sched_init();` then register a temporary heartbeat handler on `SLOT_1S` that toggles the Task-1 pin.
- [ ] **Step 2:** Superloop: snapshot elapsed ms since last pass (`now - last`), `sched_service(elapsed); sched_run();`. Keep `elapsed` within `uint16_t`; service in the main loop, never in the ISR.
- [ ] **Step 3 (bench acceptance):** Heartbeat now driven by `SLOT_1S` → pin toggles every 1.000 s (period 2 s). Verify against the scope's timebase. This confirms the M5 scheduler drives correctly off real time — and that the just-fixed `s_ms` re-phase (bounded to 60000) behaves on continuous uptime (leave running several minutes; cadence must not glitch at minute boundaries).
- [ ] **Step 4:** Remove the temporary heartbeat handler. Commit: `feat(g0b1-apu): SysTick 1ms → cooperative scheduler superloop`.

---

### Task 3: `bsp_io` GPIO driver (relays + discrete inputs) + safe-off

**Deliverable:** every relay energizes/de-energizes on command; oil-pressure and ignition inputs read and debounce; power-on state is all-off.

**Files:**
- Create: `Core/Src/drv_bsp_io.c` — implements `bsp_io_backend_t`, maps `board_pins.h` enums → physical GPIO per the schematic (relay-driver polarity: most relays are active-high through a ULN-style driver — CONFIRM per net).

**Interfaces:**
- Produces: `const bsp_io_backend_t *drv_bsp_io_backend(void);` — passed to `bsp_io_init(be)`.
- Implements: `out_set(ctx, bsp_out_t, bool)`, `out_get(...)`, `in_read(ctx, bsp_in_t) → bool`.

- [ ] **Step 1:** In CubeMX add the 7 relay outputs (incl. Heat_Reverser PB4, Condenser_Fan enable PB9) as push-pull, **initial level = de-energized**, and the 2 inputs (oil pressure, ignition) with the correct pull per the schematic. Regenerate.
- [ ] **Step 2:** Implement `drv_bsp_io.c`: a static `out`→`{GPIO_TypeDef*, pin, active_level}` table and an `in`→`{port,pin,active_level}` table; `out_set` writes `HAL_GPIO_WritePin` honoring active level; `in_read` returns the logical (active-level-corrected) state.
- [ ] **Step 3:** In `app_main`, BEFORE `sched`/`control` start: `bsp_io_init(drv_bsp_io_backend());` then drive all outputs off explicitly (safe-default-off).
- [ ] **Step 4 (bench acceptance):** With a temporary test routine (or via Modbus once Task 5 lands), toggle each relay one at a time → hear/meter the click, verify **only** the intended relay changes and idle state is all-off. Assert oil-pressure and ignition inputs read both states (jumper the input). **Confirm oil-pressure switch polarity** (closed = pressure-good?) — this is a carry-forward the bench must settle; record the finding.
- [ ] **Step 5:** Commit: `feat(g0b1-apu): drv_bsp_io — GPIO relay + discrete-input backend + safe-off`.

---

### Task 4: `bsp_pwm` TIM2 fan-PWM driver

**Deliverable:** evap and condenser fan PWM outputs drive at the correct duty from a permille command.

**Files:**
- Create: `Core/Src/drv_bsp_pwm.c` — implements `bsp_pwm_backend_t` over TIM2 CH1 (PC4) / CH2 (PC5).

**Interfaces:**
- Produces: `const bsp_pwm_backend_t *drv_bsp_pwm_backend(void);` → `bsp_pwm_init(be)`.
- Implements: `set(ctx, bsp_pwm_ch_t, uint16_t permille)`, `get(...)`.

- [ ] **Step 1:** CubeMX: TIM2 PWM on CH1/CH2 at ~1 kHz (pick prescaler/ARR from 64 MHz → e.g. ARR=999, PSC=63 gives 1 kHz, 0..1000 maps cleanly to CCR). Regenerate; note `htim2`.
- [ ] **Step 2:** Implement `set`: `CCR = (permille * (ARR+1)) / 1000`; map `PWM_EVAP_FAN→CH1`, `PWM_CONDENSER_FAN→CH2`. Start both channels in init. `get` returns the last-set permille.
- [ ] **Step 3 (bench acceptance):** Command LOW/MED/HIGH via `fan_speed` (permille ≈ 318/545/1000 per M5). Scope PC4 → duty ≈ **32 % / 55 % / 100 %** at ~1 kHz; PC5 tracks its command. Confirm the evap fan physically spins at three speeds.
- [ ] **Step 4:** Commit: `feat(g0b1-apu): drv_bsp_pwm — TIM2 CH1/CH2 fan PWM backend`.

---

### Task 5: `drv_modbus_uart` — USART1 + HW DE + DMA + RTO (do this EARLY)

**Deliverable:** the RS-485 Modbus master round-trips holding registers 1–52 through the real register model. This is the single highest-leverage driver — once it works, every later task is debuggable over Modbus instead of a scope.

**Files:**
- Create: `Core/Src/drv_modbus_uart.c` — RX frame assembly (DMA + USART RTO for the 3.5-char gap), calls `mb_engine_process`, DMA TX with hardware DE.
- Consumes: `mb_engine.h` (`mb_engine_init`, `mb_engine_process(req,req_len,resp,resp_len)`), the providers (`mbp_nvm_register`/`mbp_rtc_register`/`mbp_sensors_register`/`mbp_sys_register`) — registered as their backends come online.

- [ ] **Step 1:** CubeMX: USART1 PA9/PA10, enable **Driver Enable** (DE on PB3, hardware), DMA RX (circular) + TX, and Receiver Timeout (RTO) for the inter-frame gap. **Set the SYSCFG PA9↔PA11/PA10↔PA12 remap.** Set USART RX IRQ priority above SysTick. Baud/parity per the display (match the PIC's RS-485 config). Regenerate.
- [ ] **Step 2:** Implement RX: accumulate DMA bytes; on RTO idle, treat the buffer as one RTU frame → `mb_engine_process(buf, len, resp, &resp_len)` → DMA-TX `resp` (HW DE asserts automatically). Handle the broadcast (address 0) enact-but-suppress path already in the engine.
- [ ] **Step 3:** In `app_main`: `mb_engine_init();` and, for now, register only the providers whose backends exist (bind order doesn't matter — the register model is a table). Slave ID "EF-G0B1R".
- [ ] **Step 4 (bench acceptance):** From an RS-485 master (e.g. a USB-485 dongle + modpoll): read regs 39/40 (fw rev) and the sensor/RTC regs; write a settable reg (e.g. reg 14 climate setpoint) and read it back. Scope PB3 → DE asserts only during TX. Confirm no framing errors at the target baud over a few hundred transactions.
- [ ] **Step 5:** Commit: `feat(g0b1-apu): drv_modbus_uart — USART1 + HW DE + DMA + RTO`.

---

### Task 6: `drv_s25fl064` — SPI2 NOR driver (with host-tested page-split)

**Deliverable:** parameters persist across power cycles; the append-only journal survives torn writes. **The 256-byte program-page split is the biggest silent-corruption hazard in the whole port** and is host-testable — so its logic gets a real Unity RED→GREEN before the on-target step.

**Files:**
- Create: `Core/Src/drv_s25fl064.c` — implements `nvm_backend_t` over SPI2 + PC2 CS.
- Create: `firmware/g0b1-apu/Tests/test_drv_s25fl064_pagesplit.c` — host test of the page-split arithmetic against a 256-byte-page fake.
- Modify: `firmware/g0b1-apu/Tests/CMakeLists.txt`.

**Hazard (why this task is special):** `NVM_RECORD_SIZE = NVM_HEADER_SIZE(8) + NVM_PARAM_SIZE(256) = 264 bytes`. The journal writes a 264-byte record in one `program()` call, but the S25FL064 **page-program wraps within a 256-byte page** — a write that crosses a page boundary silently corrupts. The driver's `program()` MUST split every write at 256-byte page boundaries.

- [ ] **Step 1 (host RED):** In `test_drv_s25fl064_pagesplit.c`, extract the split loop into a pure helper `nor_page_split(addr, len, cb)` (or test the driver's split directly against a fake that records each SPI page-program and asserts none crosses a 256-byte boundary). Write a program of 264 bytes at addr 0 and at addr 200; assert the fake sees writes chunked at page boundaries and the read-back equals the input. Run: expect FAIL (helper missing / unsplit write crosses a page).
- [ ] **Step 2 (host GREEN):** Implement the split helper: for each chunk, `chunk = min(len, 256 - (addr % 256))`, issue WREN → PAGE_PROGRAM(addr, chunk) → poll WIP, advance. Re-run host test → PASS. Full host suite stays green.
- [ ] **Step 3:** CubeMX: SPI2 (PD1/PD3/PD4) master, PC2 as GPIO CS. Implement the rest of `drv_s25fl064.c`: `read` (READ 0x03), `erase` (SECTOR_ERASE + WIP poll), `program` (the split helper), `sector_size`/`sector_count` from the S25FL064 (4 KB sectors × geometry). Chunk erase/program to stay within the scheduler tick budget (long WIP polls must not stall the 1 ms loop — poll cooperatively or bound the busy-wait).
- [ ] **Step 4:** In `app_main`: `nvm_init(drv_s25fl064_backend()); mbp_nvm_register();` — before control, so settings load at boot.
- [ ] **Step 5 (bench acceptance):** Read JEDEC ID (0x9F) → matches S25FL064. Over Modbus write a persisted setting (e.g. reg 13 batt-monitor threshold), power-cycle, read it back → unchanged. Force a torn write (cut power mid-commit) and confirm the journal recovers the last good record (M2 torn-write recovery). **Watch the ~780 B `nvm_init` stack** on the M0+ — check the stack high-water mark.
- [ ] **Step 6:** Commit: `feat(g0b1-apu): drv_s25fl064 — SPI2 NOR backend with 256B page-split (host-tested)`.

---

### Task 7: `drv_mcp7940n` — I2C1 RTC driver

**Deliverable:** the RTC keeps wall-clock time, starts its oscillator, and survives power loss on the backup cell/supercap.

**Files:**
- Create: `Core/Src/drv_mcp7940n.c` — implements `i2c_backend_t` over I2C1 (PB6/PB7).

**Interfaces:**
- Produces: `const i2c_backend_t *drv_mcp7940n_backend(void);` → `rtc_init(be)`.
- Implements: register-addressed `read(reg,buf,len)` / `write(reg,buf,len)` (0 = success). The RTC service (`rtc.c`) already handles BCD, ST/VBATEN, OSCRUN, SRAM reg 52, RTCC regs 42–48.

- [ ] **Step 1:** CubeMX: I2C1 on PB6 (SCL) / PB7 (SDA), 100 kHz (or 400 kHz if the bus is clean). MCP7940N slave address 0x6F. Regenerate; note `hi2c1`.
- [ ] **Step 2:** Implement `read`/`write` via `HAL_I2C_Mem_Read`/`HAL_I2C_Mem_Write` (8-bit register address). Return non-zero on HAL error/timeout.
- [ ] **Step 3:** In `app_main`: `rtc_init(drv_mcp7940n_backend()); mbp_rtc_register();`. On first boot the service starts the oscillator (ST bit) and enables battery backup (VBATEN).
- [ ] **Step 4 (bench acceptance):** Over Modbus set the clock (regs 24–31 / RTCC path), read it back a minute later → advanced by ~60 s. Confirm OSCRUN is set. Power-cycle the main rail (keeping the backup cell) → time is retained. Write/read SRAM reg 52 → round-trips.
- [ ] **Step 5:** Commit: `feat(g0b1-apu): drv_mcp7940n — I2C1 RTC backend`.

---

### Task 8: `bsp_adc` → sensors feed (+ the deferred OOB/div-zero guard) + calibration

**Deliverable:** battery voltage, external NTC °F, and enclosure °F read correctly from ADC1 and match a reference; the sensor input is hardened.

**Files:**
- Create: `Core/Src/drv_bsp_adc.c` — ADC1 + circular DMA over the channel list, feeds `sensors_add_sample(ch, raw)` each conversion set.
- Modify: `firmware/g0b1-apu/App/services/sensors.c` — add the deferred bounds/div-zero guard (host-testable).
- Modify: `firmware/g0b1-apu/Tests/test_sensors.c` (or add one) for the guard.

**Interfaces:**
- Consumes: `sensors.h` — `void sensors_init(uint16_t vref_cal, int16_t temp_cal); void sensors_add_sample(sensor_ch_t ch, uint16_t raw);` channels `SENS_ENCL, SENS_EXT, SENS_BATT`.

- [ ] **Step 1 (host RED):** Add a test driving `sensors_add_sample` with an out-of-range channel and (pre-init) a zero window; expect the current code to index OOB / divide by zero. Write: expect FAIL/UB flagged.
- [ ] **Step 2 (host GREEN):** In `sensors_add_sample`, add `if ((unsigned)ch >= SENS_CH_COUNT || s_chan[ch].window == 0u) return;` at the top. Re-run → PASS; full host suite green.
- [ ] **Step 3:** CubeMX: ADC1 scan mode, circular DMA, hardware oversampling, external VREF+ (3.000 V), channel list IN0–IN5 for battery/external/enclosure (map per schematic §5.4). Regenerate.
- [ ] **Step 4:** Implement `drv_bsp_adc.c`: on DMA complete, call `sensors_add_sample(SENS_BATT, raw_batt)` etc. from the main loop (not the ISR — set a flag, drain in a slot). `sensors_init(VREF_CAL_DEFAULT, cab_temp_offset)` in `app_main`; `mbp_sensors_register(rpm_src)`.
- [ ] **Step 5 (bench acceptance + calibration):** Feed known inputs: a bench PSU on the battery sense → reg 6 matches within tolerance (0.505517 cV/count); a resistor decade / reference thermistor on the external + enclosure channels → regs 1/3 match a reference thermometer. **Record the M3 findings against hardware:** external-NTC open-sensor detection (3.3 V excite vs 3.000 V ref saturates at 4095 — is open-circuit distinguishable?), TMP6131 curve vs TI SNIS183, bottom ~2 °F clipping. Adjust `sensors_cal.h` coefficients if the bench disagrees.
- [ ] **Step 6:** Commit: `feat(g0b1-apu): drv_bsp_adc — ADC1+DMA sensor feed + sensors_add_sample guard`.

---

### Task 9: `rpm` capture — TIM3_CH1 input capture (OI-4)

**Deliverable:** engine RPM reads correctly from the tach pulse; `rpm_classify` reports NONE/LOW/RUNNING at the right thresholds.

**Files:**
- Create: `Core/Src/drv_rpm_tim3.c` — implements `rpm_source_t` via TIM3_CH1 (PA6, AF1) input-capture period → RPM.

**Interfaces:**
- Produces: `const rpm_source_t *drv_rpm_source(void);` → passed to `mbp_sensors_register(rpm_src)` and any control RPM consumer.
- Implements: `uint16_t get_rpm(void*ctx)`.

- [ ] **Step 1:** CubeMX: TIM3 CH1 input-capture on PA6 (AF1), capture on the tach edge, prescaler chosen so the period counter resolves the expected RPM band around `ENGINE_RPM_LOW_LIMIT` (1000). Regenerate.
- [ ] **Step 2:** Implement capture: on each CC IRQ, compute period between edges → RPM = 60·f_capture / period (account for pulses-per-rev). `get_rpm` returns the latest smoothed value; return 0 on capture-timeout (engine stopped).
- [ ] **Step 3 (bench acceptance — OI-4):** Inject a known-frequency square wave on PA6 (function gen) simulating tach pulses → `get_rpm` (readable via a debug reg or the engine-start path) matches expected RPM. **Confirm the real tach electrical behavior** (BJT-buffered pulse level/shape) and that PA6 AF1 is correct — the carry-forward OI-4. Verify `rpm_classify` flips NONE→LOW→RUNNING at 1000.
- [ ] **Step 4:** Commit: `feat(g0b1-apu): drv_rpm_tim3 — TIM3_CH1 tach input-capture (OI-4)`.

---

### Task 10: System services — reg-34 reset, IWDG watchdog, NVM-commit failure surfacing

**Deliverable:** a reg-34 write reboots the board; the watchdog recovers a hang; a failed NOR persist is reported to the Modbus master instead of silently swallowed.

**Files:**
- Create/modify: `Core/Src/app_main.c` (IWDG kick in the superloop), a small reset callback.
- Modify: `firmware/g0b1-apu/App/services/mbp_nvm.c` + `modbus_defs.h`/`mb_engine.h` — surface commit failure as `MB_EXC_SLAVE_DEVICE_FAILURE (0x04)` (host-testable with a failing fake).
- Modify: `firmware/g0b1-apu/Tests/test_mbp_nvm.c` (or add) + a fake NOR that can fail.

**Interfaces:**
- Consumes: `mbp_sys.h` — `typedef void (*mb_reset_fn)(void); void mbp_sys_register(mb_reset_fn on_reset);`

- [ ] **Step 1 (host RED):** Add a `nvm_commit`/backend failure path and a test asserting `wr_nvm` returns `MB_EXC_SLAVE_DEVICE_FAILURE` when the backend `program`/`erase` fails. Add `MB_EXC_SLAVE_DEVICE_FAILURE = 0x04` to `modbus_exc_t` if absent. Run: expect FAIL (currently returns `MB_EXC_NONE`).
- [ ] **Step 2 (host GREEN):** Thread the commit status up through `nvm_commit()` → `wr_nvm` → exception. Re-run → PASS; full host suite green.
- [ ] **Step 3:** Implement `on_reset` = `NVIC_SystemReset()`; `mbp_sys_register(on_reset)` in `app_main`. Enable IWDG in CubeMX (timeout comfortably above the worst-case slot, e.g. 1–2 s); `HAL_IWDG_Refresh` once per superloop pass.
- [ ] **Step 4 (bench acceptance):** Write reg 34 → board reboots (heartbeat restarts, Modbus link re-establishes). Force a hang (debug stub) → IWDG resets within the timeout. Force a NOR write failure (pull CS / write-protect) → the master receives exception 0x04 on the write.
- [ ] **Step 5:** Commit: `feat(g0b1-apu): system — reg-34 NVIC reset + IWDG + NVM-commit failure surfacing`.

---

### Task 11: Full `main()` integration + on-target control-loop validation

**Deliverable:** the complete APU control loop runs on real hardware — all slots and mode handlers registered, all drivers wired, and each op-state validated against real actuators.

**Files:**
- Modify: `Core/Src/app_main.c` — the final init + registration sequence and superloop.

**Init/registration sequence (order matters — backends before the services that use them):**
```c
void app_main(void) {
    /* 1. backends up first */
    bsp_io_init(drv_bsp_io_backend());     /* + drive all outputs OFF (safe-default) */
    bsp_pwm_init(drv_bsp_pwm_backend());
    nvm_init(drv_s25fl064_backend());
    rtc_init(drv_mcp7940n_backend());
    sensors_init(VREF_CAL_DEFAULT, /*cab_temp_offset*/ 0);

    /* 2. Modbus engine + providers */
    mb_engine_init();
    mbp_nvm_register();
    mbp_rtc_register();
    mbp_sensors_register(drv_rpm_source());
    mbp_sys_register(sys_reset);           /* NVIC_SystemReset */

    /* 3. control app + its register binds */
    control_app_init();                    /* registers OP_* mode handlers + binds control regs */

    /* 4. scheduler slots */
    sched_init();
    sched_register(SLOT_10MS, control_10ms_slot);   /* sample sensors → tick → outputs */
    sched_register(SLOT_1S,   control_1s_slot);     /* NVM settings sample + compressor timers */
    sched_register(SLOT_1MIN, control_1min_slot);   /* runtime hours + oil-change */

    /* 5. superloop */
    uint32_t last = now_ms();
    for (;;) {
        uint32_t n = now_ms();
        uint16_t dt = (uint16_t)(n - last); last = n;
        sched_service(dt);
        sched_run();
        drv_modbus_uart_poll();            /* drain any assembled RTU frame */
        drv_bsp_adc_drain();               /* push completed conversions to sensors */
        HAL_IWDG_Refresh(&hiwdg);
    }
}
```

- [ ] **Step 1:** Assemble the sequence above; confirm the safe-default-off runs before any slot registration. Build for target, flash.
- [ ] **Step 2 (bench acceptance — POWER_UP/OFF):** Board settles POWER_UP → OFF with all outputs de-energized; Modbus reports op-state/status regs correctly.
- [ ] **Step 3 (ENGINE_START):** Request start (mode reg). Verify the sequence on the actuators/scope: glow-plug duration keys off external temp, fuel-hold → starter → oil-pressure detection → RUNNING; a no-oil retry backs off and 5 failures → ERR_STARTING_FAILURE + de-energize. Confirm the standby (`in_truck_ignition`) tail shuts down.
- [ ] **Step 4 (CLIMATE):** Request cool. Compressor + evap engage with the 15 s compressor-off guard, EVAP_FORCED_ON 10 s, defrost 30 min; hysteresis (setpoint ±3) cycles cooling; A/C low/high-pressure faults shut compressor. Condenser PWM ramps with head pressure — **tune the OI-2 ramp curve here.**
- [ ] **Step 5 (BATTERY):** Request battery mode. Below-threshold voltage arms the 10 s start delay → engine start → 30 min charge → 2 min stable → recheck; >3 failed charges → ERR_LOW_BATTERY shutdown.
- [ ] **Step 6 (ERROR_SHUTDOWN + runtime):** Confirm each fault de-energizes per its class (latching vs compressor-only vs standby-recover). Let the engine run and confirm the machine/engine/oil runtime-hour NVM words increment (Modbus regs 11/20/21) and the oil-change warning (reg 18) raises at the 500/580/700-hr bands (accelerate by pre-seeding the oil-hours word).
- [ ] **Step 7:** Confirm **OI-5** (what the display does with the raw A/C-pressure register encoding) and **OI-6** (cold-storage genuinely unreachable). Record outcomes.
- [ ] **Step 8:** Commit: `feat(g0b1-apu): main() integration + on-target control-loop validation`.

---

## Deferred / to confirm on the bench (carry-forwards this plan closes or records)

- **OI-2** condenser head-pressure PWM ramp curve — tuned in Task 11 Step 4.
- **OI-4** tach electrical behavior + PA6 AF — confirmed in Task 9.
- **OI-5** A/C-pressure register encoding vs the display — confirmed in Task 11 Step 7.
- **OI-6** cold-storage genuinely unused — confirmed in Task 11 Step 7 (stays descoped otherwise).
- **OI-7 / OI-8** bench-tuned thresholds + final board population — recorded as they surface.
- Engine-coolant temp (reg 2) and A/C pressures (regs 4/5) full ADC channels + encoding — add channels in Task 8 if the display requires them (currently `SENS_CH_COUNT` = enclosure/external/battery only).
- Oil-pressure switch polarity — settled in Task 3 Step 4.
- Debounce reconciliation vs the original PIC `ServiceSwitch` — verify if input behavior surprises.

## Self-Review

**Spec coverage:** §5 clock/peripherals → Tasks 1,2,4,5,6,7,8,9; §4/§6 pin map + outputs → Task 3; §7 RTC → Task 7; the five interface seams each get exactly one driver (io=T3, pwm=T4, i2c=T7, nvm=T6, rpm=T9, adc-feed=T8); system services (reset/wdg/exception) → T10; integration + all op-states → T11. Open items OI-2/4/5/6 each have an explicit confirming step.

**Placeholder scan:** no TBD/TODO. Physical acceptance criteria are concrete (duty %, voltages, reg round-trips). Pin values are cited from the spec but every task says CONFIRM against the schematic/`.ioc` — the schematic is the named authority, not a placeholder.

**Type consistency:** driver factory names (`drv_bsp_io_backend`, `drv_bsp_pwm_backend`, `drv_s25fl064_backend`, `drv_mcp7940n_backend`, `drv_rpm_source`) feed the exact `*_init`/`*_register` signatures verified from the headers (`bsp_io_init(const bsp_io_backend_t*)`, `nvm_init(const nvm_backend_t*)`, `rtc_init(const i2c_backend_t*)`, `mbp_sensors_register(const rpm_source_t*)`, `mbp_sys_register(mb_reset_fn)`). `mb_engine_process(req,req_len,resp,resp_len)` is the RX entry in Task 5. Host-testable steps (T6 page-split, T8 guard, T10 exception) keep the Unity RED→GREEN discipline; all other steps are bench-physical by necessity.
