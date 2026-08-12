# PIC18 → STM32G0B1RET3 APU Controller Port — Design Spec

**Date:** 2026-08-12
**Status:** Approved design, pending implementation plan
**Source firmware:** `PIC18/application-main.zip` (HP2000 APU controller, PIC18F46K22) — GitLab `ecofleet/hp2000apu/pic18f46k22/application`
**Target board:** `EF-G0B1R` "EcoFleet G0B1 APU Manager" R1.00.00 (schematic `G0B1 APU Manager R1.pdf`), MCU **STM32G0B1RET3** (Cortex-M0+, 512 KB flash, 144 KB RAM, LQFP64)
**Scope of this spec:** the **application** firmware only (bootloader is a separate future effort).

---

## 1. Summary & Goal

Re-target the field-proven PIC18F46K22 APU (Auxiliary Power Unit) controller onto the new STM32G0B1RET3-based `EF-G0B1R` board. This is a **board redesign, not a chip swap** — the PIC firmware implements a *subset* of what the new board supports. The goal is a clean, full **re-architecture** of the control application that **preserves the observable behavior and the RS-485 Modbus register map** (so existing displays/host tools keep working), while replacing all hardware-coupled code with a layered, testable driver model.

### 1.1 Decisions (locked)

| Decision | Choice |
|---|---|
| Toolchain | STM32CubeIDE + HAL (CubeMX-generated init) |
| Target board | Custom `EF-G0B1R` (pin map from schematic, §4) |
| Feature scope | Application only; **core control only** (new subsystems init-but-not-driven) |
| Porting approach | **C — full re-architecture** |
| Runtime | **Bare-metal + cooperative time-triggered scheduler**, HAL, DMA (no RTOS) |
| Behavior/protocol | **Preserve observable behavior + Modbus register map** |
| Parameter storage | External **SPI NOR flash** (S25FL064, 8 MB) — "emulated EEPROM" |
| Clock / RTC | External **MCP7940N** RTC over I²C1 (prototype-populated) |
| RPM sensing | Pluggable read (**timer input-capture** default), electrical behavior to be confirmed from hardware |

### 1.2 Out of scope (this port)

Bootloader; RS-232/second Modbus server (addr 2); FDCAN; Bluetooth/multiprotocol (nRF) module; RGBW status LED (LP5816); fan overcurrent protection (`EvapOC`/`CndnsrOC`); I²C2 bus; spare `ANX0-2`/`GPIOX0-7`/`PWMX0-1`; hardware low-power standby + `SYS_WKUP` wake; Cold-Storage operating mode. These are either initialized to a safe state or left dormant; hooks/notes are left where relevant.

---

## 2. Source Firmware Analysis (what we are porting from)

The PIC application is ~7,400 LOC across `main.c` (2,832), `parameters.c`, `modbus_server*.c`, `analog.c`, `eeprom.c`.

**Functional blocks**
- **Control state machine** (`op_type`): `POWER_UP → OFF → ENGINE_START → {CLIMATE_CONTROL | BATTERY_MONITOR} → ERROR_SHUTDOWN`, each with sub-state enums. Drives a diesel APU: glow-plug → fuel → starter → run, plus climate (heat/cool) and battery-monitor charging cycles. Runs off a 1 ms tick with 10 ms/50 ms/100 ms/1 s/5 s/1 min software time-bases.
- **Sensors** (`analog.c`): 10-bit ADC, sensor→engineering-unit conversions (coolant NTC table, enclosure-temp piecewise-linear, external NTC with disconnect/short detection, A/C pressures as raw counts, battery voltage).
- **Persistence** (`eeprom.c` + on-chip data EEPROM): calibration, user settings, runtime-hour counters, calendar-start schedule, sentinel + bootloader flag. Byte-addressable map in `eeprom.h`.
- **RTC/calendar:** register map already references an **MCP794x-family** RTC (reg 52 "read MCP79410 EEPROM") — RTC is *not* new; it maps directly to the new board's MCP7940N.
- **Comms** (`modbus_server*.c` + `parameters.c`): two Modbus RTU servers (RS-485 display addr 1; RS-232 addr 2), sharing one protocol engine. Register map regs 1–52.

**Key hazards identified**
1. **`types.h` int-width bug (latent):** fixed-width types are `#define`d to native `int`. PIC `int` = 16-bit; STM32 `int` = 32-bit → every `UINT16`/`WORD`/`INT16` silently becomes 32-bit, breaking CRC, Modbus frame packing, 16-bit rollover. **Must** switch to real `<stdint.h>`.
2. **`char` signedness:** XC8 defaults unsigned; ARM-GCC defaults signed. Bare `char` used for data/counters.
3. **enum width:** PIC 8-bit vs ARM 32-bit — affects packed/stored enums.
4. **PIC-only constructs:** `#pragma config`, SFR access (`LATx`/`PORTx`/`ADCONx`/`EECON*`/timer SFRs), `interrupt` ISR syntax, `__delay`, XC8 builtins — none compile on GCC.
5. **Sensor scaling is PIC-hardware-specific** (10-bit, ~2.5 V ref, PIC dividers) — invalid on the new front-end (see §6).

---

## 3. System Architecture

Strict downward-dependency layering — each layer calls only the layer below:

```
Layer 3  APPLICATION   apu_control (state machines) · scheduler · outputs · io_debounce · app_timers · main
Layer 2  SERVICES      sensors · nvm · rtc · modbus (RTU engine) · params (register model)   ← portable, NO HAL
Layer 1  BSP/DRIVERS   bsp_io · bsp_adc · bsp_pwm · bsp_rpm · bsp_tick ·
                       drv_s25fl064 · drv_mcp7940n · drv_modbus_uart                          ← only HAL users
Layer 0  HAL / CubeMX  SystemClock · GPIO · ADC+DMA · TIM · USART1+DMA · SPI2 · I2C1 · IWDG   ← generated
```

**Invariant:** Layers 2–3 never touch HAL/SFRs — they use plain-C headers from Layer 1. This makes the control logic host-testable and portable across MCUs.

**Cooperative time-triggered scheduler.** A 1 ms SysTick raises `due` flags for 1/10/100/1000 ms + 1 min slots — mirroring the PIC's `Do_10ms…Do_1minute` cadence so timing behavior is preserved. `main()` is a lean superloop dispatching due tasks and kicking the watchdog. No preemption. Long NOR erase/writes are chunked to stay within the tick budget.

**Data flow**
- ADC scans all channels via **circular DMA** → `sensors` averages/converts on 10/100 ms tasks (no busy-wait).
- `apu_control` runs on the 10 ms task: reads sensors + debounced inputs → advances state machine → writes desired outputs into `apu_ctx_t` → `outputs_apply()` drives `bsp_io`/`bsp_pwm`.
- Modbus: USART1 RX IRQ → RTU engine → complete frame dispatches into `params` → response via IRQ/DMA TX with hardware DE.
- NVM writes set a dirty flag; a background task batches the commit to SPI NOR to bound wear.

**Project structure (CubeIDE)**
```
ecofleet-g0b1-apu/
├─ EF_G0B1_APU.ioc              # CubeMX config (pins, clocks, peripherals)
├─ Core/{Inc,Src}/              # generated HAL init + main entry
├─ Drivers/                     # STM32 HAL + CMSIS (generated)
├─ App/
│  ├─ bsp/        # Layer 1: bsp_io, bsp_adc, bsp_pwm, bsp_rpm, bsp_tick
│  ├─ drivers/    # Layer 1: drv_s25fl064, drv_mcp7940n, drv_modbus_uart
│  ├─ services/   # Layer 2: sensors, nvm, rtc, modbus, params
│  ├─ control/    # Layer 3: apu_control, scheduler, outputs, io_debounce, app_timers
│  └─ include/    # types.h (<stdint.h>), board_pins.h, app_config.h
├─ Tests/         # host-compiled unit tests vs mock BSP
└─ docs/
```
Generated `Core/`/`Drivers/` stay regenerable from the `.ioc`; all hand-written code lives under `App/` so CubeMX re-generation never clobbers it.

---

## 4. Hardware: Pin Map, Clock, CubeMX Config

**Clock tree:** HSE 8.000 MHz crystal (Y1, PF0/PF1) → PLL (M=1, N=16, R=2) → **SYSCLK 64 MHz**. LSE 32.768 kHz (Y2, PC14/PC15) available for the internal RTC (secondary to the external MCP7940N). SysTick = 1 ms. **ADC reference = external 3.000 V precision reference on VREF+** (via L3), 12-bit → 4096 counts = 3.000 V.

**Peripheral assignment (`.ioc`)**

| Peripheral | Instance / mode | Notes |
|---|---|---|
| ADC | ADC1, scan + circular DMA, HW oversampling | IN0–IN5 (+IN6 if RPM-via-ADC) |
| Fan PWM | TIM2 CH1 (PC4), CH2 (PC5) | evap + condenser fan; ~1 kHz, duty = speed level |
| RPM capture | TIM3 CH1 (PA6, AF1) input capture | pluggable: TIM3 IC (default) or ADC IN6 |
| Display Modbus | USART1 (PA9/PA10) + **DE PB3** (HW), DMA RX/TX | RTU frame gap via USART **RTO** |
| SPI NOR | SPI2 (PD1 SCK, PD3 MISO, PD4 MOSI) + PC2 CS (GPIO) | S25FL064 |
| RTC/cal | I2C1 (PB6 SCL, PB7 SDA) | MCP7940N + battery-backed SRAM |
| Tick | SysTick 1 ms | scheduler |
| Watchdog | IWDG | ~4 s, kicked in superloop |
| Debug | SWD (PA13/PA14) | PA14 also BOOT0 |

**Full pin map** (Ⓞ = out-of-core-scope; init to safe state only)

*Analog (ADC1, op-amp conditioned 0–3.3 V vs 3.0 V ref):*
`PA0` enclosure temp · `PA1` A/C high-side P · `PA2` A/C low-side P · `PA3` battery V · `PA4` external temp · `PA5` engine coolant temp · `PA6` tach (capture or IN6) · ⒪`PA7`/`PB0`/`PB1` spare ANX0–2 · ⒪`PB2` CndnsrOC · ⒪`PB10` EvapOC

*Digital outputs → ULN2003 Darlington → socketed relay:*
`PC12` fuel pump · `PC11` starter · `PB8` glow plug · `PB5` compressor clutch · `PB4` heat reverser · `PC10` evap fan · `PB9` condenser fan

*PWM outputs:* `PC4` evap-fan PWM · `PC5` condenser-fan PWM · ⒪`PC6`/`PB11` PWMX0/1

*Digital inputs:* `PD6` low oil pressure (RC-filtered) · `PD2` truck ignition (BJT-buffered)

*Comms / storage / system:* `PA9/PA10` USART1 · `PB3` RS-485 DE · `PD1/PD3/PD4` SPI2 · `PC2` NOR CS · `PB6/PB7` I²C1 · `PC13` SYS_WKUP (HW volt-alarm wake, unused this port) · `PF2` NRST · `PA13/PA14` SWD

*⒪Out of core scope:* FDCAN (PA12/PD0) · Bluetooth LPUART1 (PC0/PC1) + I²C2 (PA11/PB14) + GPIOX0–7 · RGBW LED (I²C1) · PC3 `LEDS_OFF`.

**CubeMX gotchas to bake in**
1. `PA11[PA9]` / `PA12[PA10]` labels require the SYSCFG **PA9↔PA11 / PA10↔PA12 remap** set so USART1 (PA9/PA10) and I²C2 (PA11) don't collide.
2. RS-485 **DE on PB3** uses USART1's hardware Driver-Enable — no manual GPIO toggle (unlike the PIC `XMIT_485()`).

**PIC → STM32 output mapping (relay/on-off)**

| Function | PIC pin | STM32 pin / net |
|---|---|---|
| Fuel pump | RD0 | PC12 `Fl_Pmp_Snoid` |
| Starter | RD2 | PC11 `Sttr_Snoid` |
| Glow plug | RD5 | PB8 `Glow_Plug` |
| Compressor clutch | RD3 | PB5 `Cmprssr_Clutch` |
| Heat mode | RD4 | PB4 `Heat_Reverser` (see Open Item OI-1) |
| Cool mode | RC4 | *(no direct net — see OI-1)* |
| Evap fan (on/off) | RC3 | PC10 `Evap_Fan` |
| Condenser fan | (RD1, unused) | PB9 `Condenser_Fan` (see OI-2) |
| Evap fan speed (was bit-banged PWM) | RC2 | PC4/TIM2_CH1 `EvapFan_PWM` |
| Spare out | RB3 | *(no equivalent — see OI-3)* |

**PIC → STM32 input mapping**

| Function | PIC | STM32 |
|---|---|---|
| Oil pressure (digital) | RB5 | PD6 `Low_OilPress` |
| Truck ignition/engine (digital) | RB1 | PD2 `Trck_Ignition` |
| Engine RPM | RC1 (CCP2 capture) | PA6 `AN_Tach_RPM` (timer capture / ADC — see OI-4) |

---

## 5. Driver / BSP Layer (Layer 1)

Each module wraps HAL and exposes a logical, hardware-free API:

| Module | API (representative) | Implementation notes |
|---|---|---|
| `bsp_io` | `bsp_out_set(OUT_FUEL_PUMP, on)`, `bsp_out_get()`, `bsp_in_read(IN_OIL_PRESSURE)` | table-driven pin map in `board_pins.h`; active-level normalized here (relays active-high via ULN2003; inputs per their buffering) |
| `bsp_adc` | `bsp_adc_raw(CH_BATTERY)` | ADC1 + circular DMA over channel list, HW oversampling; free-running, non-blocking |
| `bsp_pwm` | `bsp_pwm_set(FAN_EVAP, duty)` | TIM2 CH1/CH2; fan speed level → duty % |
| `bsp_rpm` | `bsp_rpm_get()` → RPM | pluggable TIM3_CH1 input-capture (default) or ADC IN6, via `RPM_SOURCE_*` config |
| `bsp_tick` | `bsp_now_ms()` | SysTick 1 ms → scheduler |
| `drv_s25fl064` | `read/program/erase/status` | SPI2 + PC2 CS; JEDEC-ID probe at init |
| `drv_mcp7940n` | `rtc_get/set`, `sram_read/write` | I²C1; oscillator start; battery-backed SRAM |
| `drv_modbus_uart` | byte-stream in / frame out | USART1 + HW DE (PB3) + DMA + RTO for frame gap |

---

## 6. Sensor Re-Scaling (critical rework)

The PIC's `analog.c` constants/tables assume **10-bit ADC, ~2.5 V ref, PIC-board dividers** — **all invalid** on the new **12-bit / 3.000 V-ref / op-amp-conditioned** front-end. The `sensors` service re-derives conversions to produce the **same engineering-unit encoding** the PIC emitted (preserving the Modbus/display contract):

| Sensor | PIC math (invalid) | New derivation | Output encoding (preserved) |
|---|---|---|---|
| Battery V | `avg × vref_cal / 78` | linear from schematic legend: 11 V→1.59 V (2171 cnt), 14.5 V→2.10 V (2867 cnt) | centivolts (1170 = 11.7 V) |
| Engine coolant | Kohler count→°F table (10-bit) | new NTC divider + op-amp gain → new count→°F table | °F |
| External NTC | table + interpolation, disconnect/short | re-derived table; **keep disconnect (>max)/short (=0) detection** | °F + `ext_temp_sensor_state` |
| Enclosure temp | cabin piecewise-linear (slope/offset zones) | on-board PTC thermistor + op-amp U9B → new curve | °F |
| A/C hi/lo pressure | raw 10-bit counts | 0.5–4.5 V sensor → op-amp to 0–3.3 V, 12-bit | see OI-5 |

- Averaging behavior preserved (8-sample enclosure, N-sample others) via ADC HW oversampling + DMA.
- Calibration trims (`vref_calibration`, `temperature_calibration`; Modbus regs 36/37) retained, re-based for the 3.0 V ref. Final temperature accuracy requires a **bench-calibration pass** against a reference.

---

## 7. Services (Layer 2)

### 7.1 NVM — SPI NOR "emulated EEPROM"

Preserves the `eeprom.h` byte-address map (`EE_VREF_CALIBRATION=0` … `EE_BOOTLOADER_FLAG=200`).

- **In-RAM shadow + journaled backing store.** Parameter content (~45 bytes) lives in a RAM shadow struct; reads hit RAM. Accessors keep the *same addresses* so `parameters.c` changes only its backing call (`read_eeprom_word(EE_…)` → `nvm_read_word(EE_…)`).
- **Writes** update RAM + set dirty flag; a background commit task flushes a new versioned record (sequence # + CRC) into a multi-sector ring in NOR. Latest-valid-record wins on boot; sectors erased ahead of the ring. Power-safe (torn write falls back to previous record).
- **Endurance:** runtime-hour counters (tick each minute) are committed **batched** (periodically + before controlled shutdown); journaling across the chip's 2,048 sectors → effectively unlimited life.
- **Factory defaults:** preserve `EEPROM_WRITTEN_FLAG = 0x55` sentinel; blank/invalid NOR triggers factory-init from `main.h` default constants (`BATT_MONITOR_V_INIT`, `CLMT_TEMP_INIT`, etc.).

### 7.2 RTC — MCP7940N (I²C1)

Get/set date-time (struct ↔ BCD), oscillator start, backup-supply enable, SRAM/EEPROM access (reg 52). Calendar-*start* scheduling (`EE_CLND_*`: auto-start on/off, mode, scheduled datetime) stored in NVM and compared against live RTC time by the control layer. RTCC set/get accessors (regs 42–48) rebind to this service. Same MCP794x family as the PIC used → near drop-in.

### 7.3 Modbus register model (`params`) — the preserved contract

Register enum (regs **1–52**, `MAX_HOLDING_REG_PARAMETER_DISP`) kept **byte-for-byte**. The `MB_Display_HoldingReg(reg, &data, write)` dispatch + `get_/set_` accessor pattern is ported, re-bound per source:

- **sensors:** 1–6, 51 (temps/pressures/battery); 38 (RPM)
- **bsp_io:** 7–9 (input states); 41 (production test)
- **control:** 10 (op-mode), 17 (error), 22–23 (statuses), 33 (temp-display)
- **nvm:** 12–16 (settings), 20–21 (counters), 19 (unit), 32/49/50 (overrides), 36–37 (calibration)
- **rtc:** 24–31 (calendar), 42–48 (RTCC), 52

Production-test mode (reg 41; 111=enter/222=exit; `Process_MB_TestCmd`) ported — drives outputs via `bsp_io`/`bsp_pwm`. FW-rev regs: 39 (relay FW) = new STM32 version; 40 (display FW) as reported. Reg 34 (reset-to-boot) → `NVIC_SystemReset()` + boot flag stashed in RTC-SRAM/backup for a future bootloader; reg 35 reserved.

### 7.4 Modbus RTU engine (`modbus`)

Port `modbus_server.c` largely intact (already portable): CRC-16 (`0xA001`), 3.5-char frame gap via USART **RTO**, FCs 0x03/0x04/0x06/0x10/0x07/0x08/0x11 (+0x41/0x42 file reserved for future bootloader). **Single instance:** RS-485 display, slave **addr 1**. RS-232/addr-2 server dropped. Real `<stdint.h>` types fix the latent 16-bit frame/CRC bug.

---

## 8. Control Application (Layer 3)

### 8.1 Scheduler & main loop

`main()`: init (HAL → BSP → services → load NVM params / factory-init → start ADC-DMA, RTC, Modbus) → superloop (`scheduler_run()` + `iwdg_kick()`). Task cadence mirrors the PIC:

| Slot | Work |
|---|---|
| 10 ms | control state-machine tick, input debounce, `outputs_apply()` |
| 50/100 ms | ADC sampling/averaging, RPM read |
| 1 s | battery/analog processing, power-up timer, RPM→engine-status |
| 5 s | enclosure-temp rolling average |
| 1 min | runtime-hour counters (+NVM dirty), oil-change checks, defrost timer |

PIC `flag0` bits → scheduler due-flags. The `one_ms_timer[]…one_minute_timer[]` arrays → structured `app_timers` module keeping the **same enum indices and semantics**.

### 8.2 State machines (preserved behavior)

Top-level `op_type`: `POWER_UP → OFF → ENGINE_START → {CLIMATE_CONTROL | BATTERY_MONITOR} → ERROR_SHUTDOWN`, each ported with its existing sub-state enums (`engine_start_state_list`, `clmt_ctrl_state_list`, `battery_monitor_state_list`) — **same states, transitions, timings**. Each mode becomes its own module (`engine_start.c`, `climate.c`, `battery.c`, `off.c`) sharing a single `apu_ctx_t` context that replaces the PIC's global `flag0/1/2` + scattered globals. Modes *request* outputs into the context; one `outputs_apply()` maps requests → `bsp_io`/`bsp_pwm`.

### 8.3 I/O model

Debounced discrete inputs (oil pressure, truck ignition) via `io_debounce` with the same `DEBOUNCE_TIME` / `discrete_input_t` semantics. Evap-fan speed Low/Med/High: PIC 7/12/22 ms duty of 22 ms → TIM2 PWM at the **same duty ratios** (~32 % / 55 % / 100 %).

---

## 9. Cross-Cutting Concerns

### 9.1 Types & portability (`types.h` rewrite)

- Replace `#define`-to-native-`int` with real `<stdint.h>` (`UINT16/WORD → uint16_t`, `INT16 → int16_t`, `BYTE → uint8_t`, `UINT32 → uint32_t`). **Mandatory** correctness fix.
- `char` signedness: audit bare `char` for data/counters → explicit `uint8_t`/`int8_t`.
- enum width: use explicit-width fields anywhere an enum is stored/packed.
- Explicit big-endian byte packing for Modbus wire format + NOR records; never rely on struct layout/endianness. Re-audit `bittype`/`bitfield16_t` unions under real `uint16_t`.

### 9.2 Interrupts

Discrete minimal handlers (set flag / move byte; heavy work in tasks): `SysTick` → 1 ms tick; `USART1_IRQ` (RXNE/RTO) → RTU engine, DMA TX; `TIM3` capture → RPM period (capture mode). NVIC (M0+, 2 priority bits): USART RX above SysTick.

### 9.3 Safety & error handling

- **IWDG** replaces PIC WDT; kicked in superloop (~few-second timeout).
- **BOR** brownout via option bytes (PIC used BORV≈1.9 V).
- **Fail-safe outputs:** `outputs_all_off()` (all relays off, PWM 0 %) at init, in `ERROR_SHUTDOWN`, and in `Error_Handler`/HardFault.
- Preserve ext-temp disconnect/short detection; NOR commit power-loss-safe via journaling; Modbus exception responses + diagnostic bus counters (FC 0x08) preserved.

### 9.4 Testing (TDD)

Layers 2–3 compile on host against a **mock BSP**:
- Modbus CRC-16 (known vectors), frame check, FC 0x03/0x06/0x10 round-trips, exception paths.
- NVM journal: write/readback, wear-ring rollover, torn-write recovery, factory-init on blank.
- Sensor conversions vs expected engineering values (battery legend points, NTC interpolation, disconnect/short).
- State machines: drive `apu_ctx_t` through engine-start / climate cool-heat / error-shutdown scenarios; assert transitions + output requests match documented PIC behavior.
- `app_timers`, debounce.

**On-target bring-up checklist:** clock/UART echo → ADC vs meter → relay click-test via production-test mode (reg 41) → Modbus exchange with display → RPM via signal-gen → NOR R/W → RTC keep-time.

**CI:** host unit tests in GitHub Actions; optional target build via arm-none-eabi-gcc.

### 9.5 Config & versioning

`app_config.h` holds feature flags (`RPM_SOURCE_*`, out-of-scope stubs) and version constants (reg 39 relay FW rev).

---

## 10. Open Items (to resolve during implementation)

| ID | Item | Proposed default | Needs |
|---|---|---|---|
| **OI-1** | Cool/Heat mapping: PIC has independent `COOL_MODE` (RC4) + `HEAT_MODE` (RD4); board has one `Heat_Reverser` (PB4) | `Heat_Reverser` energized = heat; cooling = reverser de-energized + compressor + evap | confirm reversing-valve plumbing |
| **OI-2** | Condenser fan (PB9 relay + PC5 PWM): new; PIC never drove it | condenser fan follows compressor-clutch engagement | confirm on/off vs PWM ramp vs always-on-while-cooling |
| **OI-3** | `Spare_Out` (PIC RB3, "spare/LED"): no board equivalent | leave unmapped (no-op); status later via RGBW LED | confirm, or assign a `GPIOX` pin |
| **OI-4** | RPM sensing: BJT-buffered pulse on PA6 (ADC- & timer-capable) | timer input-capture (TIM3_CH1); verify PA6 AF | confirm tach electrical behavior from hardware |
| **OI-5** | A/C pressure register encoding: PIC emitted raw 10-bit counts | emulate old count encoding, OR move firmware+display to PSI | confirm what the display does with pressure regs |
| **OI-6** | Cold-Storage mode: commented out of PIC's active enum | exclude from port | confirm genuinely unused |
| **OI-7** | Temperature table accuracy | first-cut tables from schematic values | bench-calibration pass against reference |
| **OI-8** | Board population target (RTC/CAN/supercap depopulated in later rev; prototype has them) | target prototype (external RTC populated) | confirm production population; keep drivers modular |

---

## 11. Non-Goals / Future Work

Bootloader (Intel-HEX-over-Modbus, or STM32-native dual-bank/VTOR); RS-232 or Modbus-over-BLE second channel; FDCAN telemetry; Bluetooth/Matter/Thread/Zigbee (nRF module); RGBW status-LED UI; fan overcurrent protection & fault handling; low-power standby with `SYS_WKUP` hardware wake; spare ANX/GPIOX/PWMX expansion.
