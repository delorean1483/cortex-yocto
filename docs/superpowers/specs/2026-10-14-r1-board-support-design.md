# EF-MX8MM R1 board support (one image for the dev kit and R1) — design

**Date:** 2026-10-14 · **Status:** approved in chat, awaiting spec review
**Scope:** part A of the move from the Variscite dev kit to our own carrier: device tree,
boot-script board detection, U-Boot keyed autoboot, RS-485 link, CI artifacts, R1 bring-up.
**Source:** schematic `EF-MX8MM` "EcoFleet MX8MM Cortex Controller" R1.00.00 (5 sheets, RJS).

## Goal

R1 boards are built and on the bench, fitted with new R1-spec Variscite DART-MX8M-MINI SoMs
(no on-SoM Ethernet PHY, LVDS bridge, WiFi/BT), still carrying Variscite's factory image.
The same EcoFleet image must boot on both the DT8MCustomBoard dev kit (.86, the APU bench rig)
and R1, from one build, one `.wic`, one `.swu` and one OTA stream.

R1 uses the same SoM as the dev kit, so DDR, PMIC (BD71847), SoM eMMC, kernel and U-Boot are
unchanged. What changes is the carrier: which parts sit on which pins. That is the device tree.

### Parts of the overall move (only A is in this spec)

| Part | Content |
|---|---|
| **A (this spec)** | R1 device tree, boot-script board detection, keyed autoboot, RS-485 on `ttymxc1`, CI artifacts, R1 bring-up and bench checklist |
| B | Factory flashing over USB-C (UUU), recovery image on the carrier eMMC, eMMC `RST_n` provisioning, carrier-EEPROM board ID |
| C | Cab temperature (TMP05) in agent + UI, Ezurio module (firmware + host), buzzer (needs R2 pin fix), NVMe use |
| D | R2 follow-ups from the hardware findings below |

## Decisions (made in chat 2026-10-14)

1. **One image for both boards.** Both DTBs ship in every slot; the boot script picks one.
2. **The R1 device tree is a full `.dts` in `meta-ecofleet`**, added to Variscite's kernel by a
   bbappend. It includes Variscite's SoM `imx8mm-var-dart.dtsi` and describes only R1's carrier.
   Not an overlay on the dev-kit DTB (too many dev-kit nodes to delete), not a kernel fork.
3. **Board detection = probe an R1-only chip from U-Boot:** the MCP7940N RTC at `0x6f` on I2C3.
   No factory step. A failed probe boots the dev-kit DTB, which still boots and keeps WiFi.
   A carrier-EEPROM board ID (part B) can replace or refine this when R2 differs from R1.
4. **Bring-up path:** flash each R1 SoM with our image on the dev kit, move it to R1, SSH over
   WiFi (WiFi is on the SoM). New DTBs reach R1 as A/B trial installs; a slot that never comes
   up healthy rolls back by itself.

## R1 carrier — SoM connector map (from the schematic)

| SoM pad / function | R1 net | Goes to |
|---|---|---|
| UART1 TXD/RXD (`ttymxc0`) | `BT_TX` / `BT_RX` | Ezurio multiprotocol module (nRF54-based, 453-00001R) UART0 |
| GPIO1_IO11 / GPIO1_IO12 | `BT_CTS` / `BT_RTS` | Ezurio UART0 flow control (GPIOs, not UART pads) |
| SAI2_TXFS / GPIO4_IO24 | `BT_nRST` | Ezurio nRESET (ANDed with `POR_B`) |
| SAI2_RXFS / GPIO4_IO21 | `BT_RCVRY_MD` | Ezurio P2.10 |
| SAI3_TXC / GPIO5_IO00 | `EZURIO_WAKE` | Ezurio P2.04 |
| UART2 TXD/RXD (`ttymxc1`) | `RS485_TX` / `RS485_RX` | ISO1450 isolated RS-485 (D/R) → RJ45 main power connector pins 1/2 + HDR1 |
| SAI5_RXD0 / GPIO3_IO21 | `RS485_DE` | ISO1450 DE and /RE tied (100 k pull-down → receive) |
| UART3 TXD/RXD | `FDCAN_TX` / `FDCAN_RX` | TCAN3414 CAN transceiver (optional fit) |
| SAI2_RXC / GPIO4_IO22 | `FD_CAN_EN` | TCAN3414 STB via Q6 |
| UART4 | NC | (used inside the SoM by the IW612 Bluetooth) |
| I2C2 | `I2C_SCL` / `I2C_SDA` | touch controller on the Riverdi panel (SOK5) |
| GPIO1_IO10 | `I2C_IRQ` | touch interrupt |
| I2C3 | `I2C3_SCL` / `I2C3_SDA` | MCP7940N RTC (`0x6f`), BR24G04 4 Kbit EEPROM (`0x50`); SoM WM8904 codec (`0x1a`) |
| SAI3_TXD / GPIO5_IO01 | `RTC_WKUP` | MCP7940N MFP |
| I2C4 | NC | — |
| LVDS1 TX0-3 / CLK | `LVDS_DATA0-3`, `LVDS_CLK` | Riverdi 5" 800×480 LVDS (SM-RVT50HQLNWC00-B, SOK4) |
| GPIO1_IO01 / PWM1 | `LCD_BL_PWM` | MP3302 backlight boost EN (PWM dimming) |
| GPIO1_IO03 | `LCD_dRST` | panel + touch reset (ANDed with `POR_B`) |
| GPIO1_IO05 | `LCD_STB` | panel standby |
| GPIO1_IO06 / GPIO1_IO08 | `LCD_FLIP_L/R` / `LCD_FLIP_U/D` | panel scan direction |
| ENET RGMII + MDIO | `RGMII_*` | KSZ9031RNX gigabit PHY → MagJack |
| SAI3_TXFS / GPIO4_IO31 | `ETH_dReset` | KSZ9031 RESET# (ANDed with `POR_B`) |
| SAI3_MCLK / GPIO5_IO02 | `ETH_INT` | KSZ9031 INT# |
| NVCC_ENET | `1P8_VCC_AO` | (RGMII pad voltage, see finding 3) |
| USB1 | `USB1_D_*`, `USB1_VBUS` | USB-C (Rd 5.1 k on CC1/CC2 → device/sink only) |
| USB2 | `USB2_D_*` | USB2422 2-port hub → 2× USB-A (2A has charging) |
| SAI2_TXD0 / GPIO4_IO26 | `USB_HUB_dRST` | USB2422 RESET (ANDed with `POR_B`) |
| SD2 (4-bit) | `SD2_*` | 4 GB carrier eMMC FEMC004GSTE9 (recovery), VCCQ 3.3 V |
| SD2_RESET_B | `SD2_dRST` | carrier eMMC RST (ANDed with `POR_B`) |
| PCIE1 + ref clock | `PCIE1_*` | M.2 Key-M NVMe; external clock generator (AB-557-03), OE always on |
| GPIO1_IO13 / GPIO1_IO14 | `PCIE1_dRST` / `PCIE1_WAKE` | M.2 reset (ANDed with `POR_B`) / wake |
| SAI2_TXC / GPIO4_IO25 | `NVMe_ACT` | NVMe activity |
| SAI2_MCLK / GPIO4_IO27 | `CAB_TEMP` | TMP05 PWM-output temperature sensor (continuous mode, nominal rate) |
| SPDIF_EXT_CLK (PWM1) | `SPKDRV` | piezo transducer driver (see finding 2) |
| GPIO1_IO02 / WDOG_B | `WDOG_RST` | TPS3808 MR → `MAIN_RST` → `PMIC_ON_REQ` (cold power-cycle) |
| ONOFF | `ONOFF` | on/off push button |
| BOOT_MODE / BOOT_CFG | straps + PB override | normal: SoM eMMC; button held at power-on: carrier eMMC |

## R1 hardware findings (for Robb)

Read from the PDF; each needs Robb's confirmation.

1. **No debug console.** All four UARTs are used (UART1 Ezurio, UART2 RS-485, UART3 CAN, UART4
   SoM Bluetooth). SPL, U-Boot and the kernel print on UART1, into the Ezurio module, and any
   byte the module sends during U-Boot's 1 s delay stops autoboot at a prompt. Part A works
   around it (module held in reset, keyed autoboot). R2: a 3-pin console header or test points.
2. **Buzzer pin conflict.** `SPKDRV` is on `SPDIF_EXT_CLK`, which the SoM uses as `BT_BUF_EN`
   (GPIO5_IO5) when WiFi/BT is fitted, and its PWM function is PWM1, which the backlight already
   uses. The buzzer cannot run on R1 without breaking BT or backlight dimming. R2: move `SPKDRV`
   to `GPIO1_IO15/PWM4_OUT` (SOK3 pin 38, NC on R1).
3. **Ethernet I/O voltage mismatch (likely).** `NVCC_ENET` (the SoC's RGMII pad supply) is fed
   1.8 V (`1P8_VCC_AO`), but the KSZ9031 DVDDH (its RGMII I/O supply) and the RXD/MODE strap
   pull-ups are on `3P3_VCC`. That puts 3.3 V RGMII signals on 1.8 V SoC pads. Either run DVDDH
   and the straps at 1.8 V or feed `NVCC_ENET` 3.3 V.
4. **CAN cannot work.** The TCAN3414 is wired to UART3; the i.MX8M Mini has no CAN controller
   (FlexCAN is i.MX8M Plus only). CAN needs an SPI CAN controller (the dev kit uses an MCP2518FD
   on ECSPI1; ECSPI1/2 are free on R1).
5. **USB-C is device-only.** CC1/CC2 have 5.1 kΩ pull-downs and nothing sources VBUS, though the
   sheet calls it a host port. Good for factory flashing over USB (part B); it will not power a
   USB-C stick. Confirm the intent.

Good as drawn: WDOG_B → TPS3808 MR → `PMIC_ON_REQ` low is a true cold power-cycle (the reset
the dev kit lacks; R25 to `POR_B` DNP). TMP05 `FUNC`/`CONV` floating = continuous conversion at
the nominal rate.

## Design

### 1. R1 device tree — `imx8mm-ecofleet-ef-mx8mm.dts`

Includes `imx8mm-var-dart.dtsi` (Variscite kernel `6.6-2.2.x-imx_var01`), so the SoM's DDR,
PMIC, SoM eMMC (`usdhc3`), WiFi (`usdhc1`), Bluetooth (`uart4`), SN65DSI84 LVDS bridge and
watchdog come along unchanged. Root `model = "EcoFleet EF-MX8MM Cortex Controller R1"`,
`compatible = "ecofleet,ef-mx8mm", "variscite,imx8mm-var-dart", "fsl,imx8mm"`.

| Block | Device tree on R1 |
|---|---|
| `uart1` | enabled, `stdout-path`; kernel console stays `ttymxc0` in part A |
| Ezurio | `BT_nRST` held low by a GPIO hog (module in reset for all of part A); CTS/RTS/wake/recovery lines named, unused |
| `uart2` | RS-485 mode enabled at boot: `rts-gpios` = GPIO3_IO21, DE high only while sending (kernel waits for TX complete before dropping DE); `/RE` tied to DE, so no echo |
| `uart3` | disabled (no CAN controller) |
| `i2c2` | touch controller node; compatible + address from a bench I2C scan (kernel has ILITEK, Goodix, FocalTech built); IRQ GPIO1_IO10; no reset GPIO (shared with the panel, see LCD lines) |
| LCD lines | `LCD_dRST` and `LCD_STB` hogged inactive; `LCD_FLIP_L/R`, `LCD_FLIP_U/D` hogged to the orientation found on the bench |
| `i2c3` | add MCP7940N (`microchip,mcp7940x`, rtc-ds1307 driver) and BR24G04 (`atmel,24c04`, at24) |
| `snvs_rtc` | disabled, so the MCP7940N is `rtc0` (as the dev kit does with its DS1337) |
| `sai3`, WM8904 sound card | **disabled**: R1 uses the SAI3 pads as GPIOs (`ETH_dReset`, `ETH_INT`, `RTC_WKUP`, `EZURIO_WAKE`); left on, SAI3 would own the Ethernet PHY's reset pin |
| `panel_lvds` | Riverdi 800×480 timings and data mapping from its datasheet; until then the dev kit's 800×480 timings; `backlight` = `pwm-backlight` on PWM1 (GPIO1_IO01), 1 kHz to start |
| `fec1` | `rgmii-id`, the SoM's `ethphy0` node and `phy-supply` removed, PHY reset GPIO4_IO31, MDIO scan. **Off on R1** (decided 2026-10-14) until finding 3 is fixed: `status = "disabled"` and the KSZ9031 held in reset by a GPIO hog, so it never drives 3.3 V RGMII into the 1.8 V SoC pads |
| `usbotg1` | `dr_mode = "peripheral"` (USB-C is a device port) |
| `usbotg2` | host; USB2422 reset (GPIO4_IO26) hogged released |
| `usdhc2` | carrier eMMC: 4-bit, `non-removable`, `no-1-8-v` (VCCQ is 3.3 V), no card-detect, no VSD regulator; reset on `SD2_RESET_B` |
| `pcie_phy`, `pcie0` | external 100 MHz ref clock (input pad mode), reset GPIO1_IO13 |
| `snvs_pwrkey` | enabled (on/off button) |
| `CAB_TEMP` | GPIO4_IO27 input, named; reading it is part C |
| buzzer, CAN | not described (finding 2, finding 4) |
| marker | `aliases { ecofleet-rs485-uart = &uart2; }`, used by the udev rule below |
| GPIO names | `gpio-line-names` on the carrier GPIOs, so `gpioinfo` shows R1 net names during bring-up |

Block-device numbering stays: SoM eMMC = `mmcblk2` (`usdhc3`), carrier eMMC = `mmcblk1`
(`usdhc2`). So `fw_env.config` (`/dev/mmcblk2` @ `0x700000`), the slot automount ignore list
(`mmcblk2p1`/`p2`) and the swupdate pre-install checks are untouched.

The kernel config needs no change: `imx8_var_defconfig` and the running .86 kernel already
build KSZ9031 (`MICREL_PHY`), MCP7940N (`RTC_DRV_DS1307=m`), AT24, ILITEK/Goodix/EDT touch,
`DRM_PANEL_LVDS`, `BACKLIGHT_PWM`, NVMe and PCIe.

### 2. Kernel recipe

`meta-ecofleet/recipes-kernel/linux/linux-variscite-fslc-imx_%.bbappend`: adds the `.dts`
to `SRC_URI`, copies it into `arch/arm64/boot/dts/freescale/` before compile, and appends
`freescale/imx8mm-ecofleet-ef-mx8mm.dtb` to `KERNEL_DEVICETREE`. A DTS error fails the CI build.
Both DTBs end up in every slot's `/boot` via the kernel-devicetree package.

### 3. Boot script (`ecofleet-boot.cmd` → `boot.scr` on p1)

Before the slot loop:

```
setenv ecofleet_board devkit
if i2c dev 2; then
    if i2c probe 0x6f; then setenv ecofleet_board r1; fi
fi
```

(`i2c dev 2` is I2C3 by the U-Boot `i2c2 = &i2c3` alias; `i2c probe <addr>` returns success
only if a chip answers — `cmd/i2c.c` `return (0 == found)`. Both are confirmed on .86's serial
console before relying on them.)

Per slot, after the kernel loads: if `ecofleet_board` is `r1`, try
`/boot/imx8mm-ecofleet-ef-mx8mm.dtb` first; if that is missing (an older release in that slot)
or not R1, load `/boot/imx8mm-var-dart-dt8mcustomboard.dtb`. Only if neither DTB loads does the
existing same-pass fallback to the other slot run. Kernel arguments are unchanged on both boards
(`console=ttymxc0,115200 … ${ecofleet_extra_args}`) except for one diagnostic addition,
`ecofleet_board=${ecofleet_board}`: it shows from Linux whether R1 was detected, including when
an R1 slot fell back to the dev-kit DTB.

The existing rules hold: hush for-loop variables start with a letter, no `reset`, rollback
trial and `ecofleet-bootargs.env` whitelist unchanged.

### 4. U-Boot keyed autoboot

A config fragment through the existing `u-boot-variscite_%.bbappend`:
`CONFIG_AUTOBOOT_KEYED=y`, `CONFIG_AUTOBOOT_STOP_STR="ecofleet"`, a prompt that names the
string; `CONFIG_BOOTDELAY=1` stays. Random bytes on UART1 can then never stop autoboot; a
person on a console types `ecofleet` (the dev-kit bench habit of sending spaces changes).

### 5. What reaches which unit

p1 (`boot.scr`) and U-Boot (`imx-boot`) are written only by a `.wic` flash; OTA writes only
slots. R1 SoMs get both on their first flash. .86 keeps its current `boot.scr` and U-Boot:
they hard-code the dev-kit DTB, which stays correct for it, so .86 needs no reflash and takes
the new `.swu` like any release. `hwrevision` stays `imx8mm-var-dart 2.0` (same eMMC layout),
so either board accepts either bundle.

### 6. CI

`build.yml` "Stage release files" also copies `imx8mm-ecofleet-ef-mx8mm.dtb`. One `.wic`, one
`.swu`, one `latest.json`.

### 7. Userspace

`99-ecofleet-rs485.rules` gains an R1 rule: `KERNEL=="ttymxc1"` with
`TEST=="/proc/device-tree/aliases/ecofleet-rs485-uart"` → `SYMLINK+="ecofleet-rs485"`. The FTDI rule
stays for the dev kit. gobi-agent and the STM32 bootloader flasher open the same link and need
no code change; the kernel drives DE. Nothing else in userspace changes for part A: WiFi/BT and
the PMIC restart module are SoM-level, the UI finds the backlight under `/sys/class/backlight`,
and `eth0`/`wlan0` keep their names.

## Testing

**Host (static, CI-runnable):** extend `scripts/tests/test-boot-script.sh`:
- the board probe is present (`i2c probe 0x6f`);
- both DTB names are present;
- the R1 DTB is tried before the dev-kit DTB, and the dev-kit DTB before the slot fallback;
- existing checks (for-loop variable names, no `reset`) still pass.

New `scripts/tests/test-rs485-rule.sh` (there is no udev rule test today): the rule file
carries both the FTDI rule and the R1 rule, the R1 rule's `TEST` path matches the alias name
in the R1 `.dts`, and that alias name does not end in a digit (the kernel would otherwise parse
it as a numbered alias).

**Before R1:** on .86's serial console, confirm `i2c dev 2` / `i2c probe 0x6f` (fails) and
`i2c probe 0x1a` (WM8904, succeeds); install the branch `.swu` on .86 and confirm it still boots
the dev-kit DTB and works (regression).

## R1 bring-up

**Flashing an R1 SoM (once per SoM, on the dev kit):** swap the R1 SoM into the dev kit (pauses
.86 as the APU rig for a few minutes; the dev kit's Ethernet will not work with a no-PHY SoM),
boot from the SD card and stream the `.wic` to `mmcblk2` with the existing procedure, boot from
eMMC, join WiFi from the on-screen WiFi setup (saved on the SoM's `/data`), power off, move the
SoM to R1. On R1 it detects R1, boots the R1 DTB and rejoins WiFi.

**R1 bench checklist** (results to `docs/bench/`):

| # | Check | Pass |
|---|---|---|
| 1 | Boot | `/proc/device-tree/model` is R1; SSH over WiFi; gobi-ui on the panel |
| 2 | Display | correct picture, colours, orientation; brightness slider dims |
| 3 | Touch | taps land where touched |
| 4 | RS-485 | G0B1 on the RJ45 harness: telemetry in `latest.json`, a write command works |
| 5 | RTC | time kept across a power-off on the coin cell |
| 6 | EEPROM | read/write through the at24 nvmem file |
| 7 | Ethernet | off on R1 until finding 3 is fixed: `gpioinfo` shows ETH_dReset held low, no `eth0` |
| 8 | USB | both USB-A ports through the hub; a USB-C UDC is listed |
| 9 | Storage | carrier eMMC as `mmcblk1`; NVMe if fitted |
| 10 | On/off | press: power off / on; hold 5 s: force off |
| 11 | Reboots | `reboot` returns; an expired watchdog cold-resets through WDOG_B → PMIC |
| 12 | Cab temp | `CAB_TEMP` toggles at about 40 ms / 76 ms (TMP05 alive) |
| 13 | Ezurio | stays in reset |
| 14 | OTA | `.swu` install on R1: trial, then confirmed |
| 15 | Dev kit | .86 on the same build still works |

**Recovery during bring-up:** (1) automatic rollback: a slot that never comes up healthy reverts
after 3 boots; (2) U-Boot console, if Robb tacks wires to UART1 at the Ezurio module: type the
stop string and set `slot_active`; (3) move the SoM back to the dev kit and reflash from SD.

## Deliverables

- `imx8mm-ecofleet-ef-mx8mm.dts` + kernel bbappend
- boot script detection + DTB fallback, host tests
- U-Boot keyed-autoboot fragment
- R1 udev rule
- CI staging of the R1 DTB
- `docs/hardware/EF-MX8MM-R1-findings.md` for Robb (findings above + bench results)
- `docs/bench/` R1 bring-up runbook and checklist results

## Needed during bring-up

- Riverdi SM-RVT50HQLNWC00-B datasheet: panel timings, LVDS data mapping, touch controller.
- KSZ9031 MDIO address (bench: MDIO scan), touch I2C address (bench: I2C scan), flip-pin levels.

## Out of scope (parts B–D)

Factory flashing over USB-C and the recovery eMMC image; carrier-EEPROM board ID; eMMC
`RST_n` programming; cab temperature readout; Ezurio module firmware and the move of the R1
kernel console off UART1 when the module comes alive; buzzer; CAN; NVMe use; any R2 change.
