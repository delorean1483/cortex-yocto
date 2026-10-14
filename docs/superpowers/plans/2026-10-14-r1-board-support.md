# EF-MX8MM R1 Board Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One EcoFleet image that boots both the Variscite dev kit and the EF-MX8MM R1 carrier, picking the right device tree at boot, and an R1 brought up on the bench against a 15-point checklist.

**Architecture:** A full R1 `.dts` in `meta-ecofleet` (including Variscite's SoM `.dtsi`) is built next to Variscite's DTBs by a kernel bbappend. The stable boot script on p1 probes the R1-only MCP7940N RTC over I2C and loads the R1 DTB, falling back to the dev-kit DTB in the same slot. U-Boot gets keyed autoboot, so stray bytes from R1's Ezurio module can't stop a boot. RS-485 on R1 is UART2 in kernel RS-485 mode, behind the existing `/dev/ecofleet-rs485` link.

**Tech Stack:** Yocto scarthgap (kas), Variscite `linux-variscite-fslc-imx` 6.6, U-Boot `lf_v2024.04`, device tree (dtc), U-Boot hush, udev, POSIX sh tests, Python 3 stdlib bench tools, GitHub Actions on the self-hosted runner.

**Spec:** `docs/superpowers/specs/2026-10-14-r1-board-support-design.md`

## Global Constraints

- R1 DTS: `meta-ecofleet/recipes-kernel/linux/files/imx8mm-ecofleet-ef-mx8mm.dts` → DTB `imx8mm-ecofleet-ef-mx8mm.dtb` (kernel `freescale/imx8mm-ecofleet-ef-mx8mm.dtb`). Same name in the bbappend, the boot script and `build.yml`.
- Dev-kit DTB: `imx8mm-var-dart-dt8mcustomboard.dtb` (unchanged).
- Model `"EcoFleet EF-MX8MM Cortex Controller R1"`; compatible `"ecofleet,ef-mx8mm", "variscite,imx8mm-var-dart", "fsl,imx8mm"`.
- Board detection: `i2c dev 2` then `i2c probe 0x6f` (MCP7940N on I2C3). `ecofleet_board` = `r1` | `devkit`, also passed on the kernel command line as `ecofleet_board=${ecofleet_board}`.
- Kernel arguments otherwise unchanged: `console=ttymxc0,115200 root=/dev/mmcblk${devnum}p${_part} rootwait rw quiet … ${ecofleet_extra_args}`.
- Hush rules: for-loop variables start with a letter; no `reset` command.
- U-Boot: `CONFIG_AUTOBOOT_KEYED=y`, stop string `ecofleet`, `CONFIG_BOOTDELAY=1` unchanged.
- RS-485: alias `ecofleet-rs485-uart = &uart2;` (name must not end in a digit); link `/dev/ecofleet-rs485`; DE = GPIO3_IO21, active high.
- `hwrevision` stays `imx8mm-var-dart 2.0`; no swupdate, `sw-description` or layout change.
- Pinned sources: Variscite kernel `3fa5de4a61d76d59900096fd921edc8b6f7e69ef` (branch `6.6-2.2.x-imx_var01`); U-Boot `b6650c1f302033f749cb78b95cc2be7e42f7d887`; poky `a53cae3d…` (merges `*.cfg` U-Boot fragments).
- `gh` always with `-R delorean1483/cortex-yocto`; `gh run download` always with `-D ~/Downloads/<dir>`.
- Bench: `.swu` goes in `/tmp` on the device, never `/data` (64 MB). The SD card is the ~62.9 GB disk (was disk6); **disk4 is a 5 TB drive — never write to it.** After a software poweroff, remove power ≥15 s before powering on.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **R1 booting a slot that holds an older release** (no R1 DTB in it): must boot that slot on the dev-kit DTB (WiFi reachable), not fail over or stop. Pinned: Task 3 order test; Task 7 step 8 sets this up as the first-boot safety net; Task 9 check 16 proves it.
2. **Stray bytes on UART1 during the autoboot delay** (Ezurio module traffic): must not stop U-Boot. Pinned: Task 7 step 4 (`uboot-console.py --no-stop` with the new U-Boot).
3. **RS-485 DE timing at 9600 baud** (DE dropped early truncates the last byte; dropped late collides with the reply): Modbus must run error-free. Pinned: Task 9 check 4 (10-minute error count = 0).
4. **The carrier eMMC (`mmcblk1`) is never mounted or chosen as an OTA target**: pinned in Task 9 check 9 and check 14 (pre-install names `mmcblk2p2`/`p3`).
5. **R1 whose RTC doesn't answer** (dead part, I2C3 stuck): boots the dev-kit DTB and stays reachable. This is the same code path as the dev kit, where the probe fails. Pinned: Task 2 (`PROBE-6F=NONE` on .86), Task 6 (.86 regression), Task 7 step 7 (R1 SoM on the dev kit).

## File Structure

| File | Responsibility |
|---|---|
| `meta-ecofleet/recipes-kernel/linux/files/imx8mm-ecofleet-ef-mx8mm.dts` (new) | R1 carrier device tree |
| `meta-ecofleet/recipes-kernel/linux/linux-variscite-fslc-imx_%.bbappend` (new) | Ships the DTS into the kernel tree, adds the DTB to `KERNEL_DEVICETREE` |
| `scripts/tests/check-r1-dts.sh` (new) | Host compile + property checks of the R1 DTS against the pinned kernel |
| `meta-ecofleet/recipes-bsp/ecofleet-bootscript/files/ecofleet-boot.cmd` (modify) | Board detection, R1 → dev-kit DTB order |
| `scripts/tests/test-boot-script.sh` (modify) | Static checks of the above + cross-file DTB name checks |
| `.github/workflows/build.yml` (modify) | Stage the R1 DTB |
| `meta-ecofleet/recipes-ecofleet/gobi-agent/files/99-ecofleet-rs485.rules` (modify) | R1 `ttymxc1` → `/dev/ecofleet-rs485` |
| `scripts/tests/test-rs485-rule.sh` (new) | Rule + DTS alias consistency |
| `meta-ecofleet/recipes-bsp/u-boot/files/ecofleet-autoboot.cfg` (new) | Keyed autoboot fragment |
| `meta-ecofleet/recipes-bsp/u-boot/u-boot-variscite_%.bbappend` (modify) | Ships the fragment |
| `scripts/tests/test-uboot-autoboot.sh` (new) | Fragment checks |
| `docs/bench/tools/uboot-console.py` (new) | Stop U-Boot over serial, run commands |
| `docs/bench/tools/r1-try-dtb.sh` (new) | Try a DTB on the inactive slot with A/B trial |
| `docs/bench/2026-10-14-r1-bringup.md` (new) | Runbook + checklist results |
| `docs/hardware/EF-MX8MM-R1-findings.md` (new) | Hardware findings for Robb + bench evidence |

---

### Task 1: R1 device tree, built by the kernel recipe

**Files:**
- Create: `scripts/tests/check-r1-dts.sh`
- Create: `meta-ecofleet/recipes-kernel/linux/files/imx8mm-ecofleet-ef-mx8mm.dts`
- Create: `meta-ecofleet/recipes-kernel/linux/linux-variscite-fslc-imx_%.bbappend`

**Interfaces:**
- Consumes: Variscite `imx8mm-var-dart.dtsi` labels (`uart1..4`, `i2c2`, `i2c3`, `wm8904`, `sai3`, `snvs_rtc`, `snvs_pwrkey`, `panel_lvds`, `pwm1`, `fec1`, `reg_eth_phy`, `usbotg1/2`, `usdhc2`, `pcie_phy`, `pcie0`, `gpio1..5`, `iomuxc`, `clk`).
- Produces: DTB `imx8mm-ecofleet-ef-mx8mm.dtb` in every slot's `/boot` and in `$DEPLOY`; alias `/aliases/ecofleet-rs485-uart`; named GPIO lines `LCD_FLIP_LR`, `LCD_FLIP_UD`, `CAB_TEMP`, `BT_nRST`, …; `scripts/tests/check-r1-dts.sh [out.dtb]` (exit 0 = PASS, optional path keeps the compiled DTB).

- [ ] **Step 1: Write the failing check**

Create `scripts/tests/check-r1-dts.sh` (then `chmod +x`):

```sh
#!/bin/sh
# Compile the R1 (EF-MX8MM) device tree on the host against the pinned Variscite
# kernel sources and check the properties the rest of the image relies on.
# A DTS mistake found here costs seconds; found in CI it costs a full build.
#
# Needs: git, a C compiler (for its preprocessor), dtc and fdtget (brew install dtc).
# The first run fetches only the kernel's DTS + dt-bindings tree (shallow,
# sparse) into ${R1_DTS_CACHE:-$HOME/.cache/ecofleet-linux-dts}.
#
# Usage: check-r1-dts.sh [output.dtb]   (the compiled DTB is kept if a path is given)
set -eu

REPO=$(cd "$(dirname "$0")/../.." && pwd)
NAME=imx8mm-ecofleet-ef-mx8mm
DTS=$REPO/meta-ecofleet/recipes-kernel/linux/files/$NAME.dts
BBAPPEND=$REPO/meta-ecofleet/recipes-kernel/linux/linux-variscite-fslc-imx_%.bbappend

# linux-variscite-fslc-imx SRCREV (branch 6.6-2.2.x-imx_var01) pinned by the
# meta-variscite-bsp-imx commit in kas/dev.yml. Update both together.
KREV=3fa5de4a61d76d59900096fd921edc8b6f7e69ef
CACHE=${R1_DTS_CACHE:-$HOME/.cache/ecofleet-linux-dts}/$KREV

fail=0
ok()  { echo "ok   - $1"; }
bad() { echo "FAIL - $1"; fail=1; }

[ -f "$DTS" ] || { echo "FAIL - missing $DTS"; exit 1; }

if [ ! -f "$CACHE/.done" ]; then
    rm -rf "$CACHE"
    mkdir -p "$CACHE"
    git -C "$CACHE" init -q
    git -C "$CACHE" remote add origin https://github.com/varigit/linux-imx
    git -C "$CACHE" sparse-checkout set --no-cone \
        /arch/arm64/boot/dts/freescale/ /include/dt-bindings/ \
        /include/uapi/linux/input-event-codes.h
    git -C "$CACHE" fetch -q --depth=1 --filter=blob:none origin "$KREV"
    git -C "$CACHE" checkout -q FETCH_HEAD
    touch "$CACHE/.done"
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
DTB=${1:-$TMP/$NAME.dtb}
FS=$CACHE/arch/arm64/boot/dts/freescale

# Same preprocessing as the kernel's dtc rule (cmd_dtc in scripts/Makefile.lib)
cp "$DTS" "$FS/$NAME.dts"
${CC:-cc} -E -nostdinc -undef -D__DTS__ -x assembler-with-cpp \
    -I "$CACHE/include" -I "$FS" -I "$CACHE/arch/arm64/boot/dts" \
    -o "$TMP/$NAME.pp.dts" "$FS/$NAME.dts"
rm -f "$FS/$NAME.dts"
# -@ keeps labels in /__symbols__ so the checks below can find nodes by label
dtc -@ -q -I dts -O dtb -o "$DTB" "$TMP/$NAME.pp.dts"
ok "compiles ($(wc -c < "$DTB" | tr -d ' ') bytes)"

sym() { fdtget "$DTB" /__symbols__ "$1"; }
prop() { fdtget "$DTB" "$1" "$2" 2>/dev/null; }
has() { fdtget "$DTB" "$1" "$2" >/dev/null 2>&1; }

[ "$(prop / model)" = "EcoFleet EF-MX8MM Cortex Controller R1" ] && ok "model" || bad "model: $(prop / model)"
[ "$(prop / compatible | cut -d' ' -f1)" = "ecofleet,ef-mx8mm" ] && ok "compatible" || bad "compatible: $(prop / compatible)"

alias=ecofleet-rs485-uart
U2=$(prop /aliases $alias || true)
[ "$U2" = "$(sym uart2)" ] && ok "alias $alias -> uart2" || bad "alias $alias = '$U2'"
[ "$(prop "$U2" status)" = okay ] && ok "uart2 enabled" || bad "uart2 status"
has "$U2" linux,rs485-enabled-at-boot-time && ok "uart2 RS-485 at boot" || bad "uart2 RS-485 at boot"
[ "$(fdtget -t u "$DTB" "$U2" rts-gpios 2>/dev/null | cut -d' ' -f2-)" = "21 0" ] \
    && ok "uart2 DE = GPIO3_IO21 active high" || bad "uart2 rts-gpios"
has "$U2" rs485-rts-active-low && bad "uart2 DE must be active high" || ok "uart2 DE not inverted"
[ "$(prop "$(sym uart3)" status)" = disabled ] && ok "uart3 off (no CAN controller)" || bad "uart3 status"

[ "$(prop "$(sym sai3)" status)" = disabled ] && ok "sai3 off (pads used as GPIOs)" || bad "sai3 status"
[ "$(prop "$(sym wm8904)" status)" = disabled ] && ok "wm8904 off" || bad "wm8904 status"
has /sound-wm8904 compatible && bad "sound-wm8904 still present" || ok "sound-wm8904 removed"
[ "$(prop "$(sym snvs_rtc)" status)" = disabled ] && ok "SoC RTC off" || bad "snvs_rtc status"
[ "$(prop "$(sym i2c3)/rtc@6f" compatible)" = "microchip,mcp7940x" ] && ok "MCP7940N @0x6f" || bad "rtc@6f"
[ "$(prop "$(sym i2c3)/eeprom@50" compatible)" = "atmel,24c04" ] && ok "EEPROM @0x50" || bad "eeprom@50"

F=$(sym fec1 || true)
[ "$(prop "$F" phy-mode)" = rgmii-id ] && ok "fec1 rgmii-id" || bad "fec1 phy-mode"
has "$F" phy-handle && bad "fec1 still has the SoM phy-handle" || ok "fec1 scans MDIO"
[ "$(fdtget -t u "$DTB" "$F" phy-reset-gpios 2>/dev/null | cut -d' ' -f2-)" = "31 1" ] \
    && ok "PHY reset = GPIO4_IO31 active low" || bad "fec1 phy-reset-gpios"

[ "$(prop "$(sym usbotg1)" dr_mode)" = peripheral ] && ok "USB-C device only" || bad "usbotg1 dr_mode"
[ "$(prop "$(sym usbotg2)" dr_mode)" = host ] && ok "USB hub port host" || bad "usbotg2 dr_mode"
M=$(sym usdhc2 || true)
has "$M" no-1-8-v && has "$M" non-removable && ok "carrier eMMC 3.3 V, fixed" || bad "usdhc2 flags"

G4=$(sym gpio4 || true)
has "$G4/bt-rst-hog" output-low && ok "Ezurio held in reset" || bad "bt-rst-hog"
has "$G4/usb-hub-rst-hog" output-high && ok "USB hub out of reset" || bad "usb-hub-rst-hog"

grep -q "file://$NAME.dts" "$BBAPPEND" && ok "kernel bbappend ships $NAME.dts" || bad "bbappend SRC_URI"
grep -q "freescale/$NAME.dtb" "$BBAPPEND" && ok "kernel bbappend builds $NAME.dtb" || bad "bbappend KERNEL_DEVICETREE"

[ $fail = 0 ] && echo PASS || { echo FAILED; exit 1; }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `brew list dtc >/dev/null || brew install dtc; sh scripts/tests/check-r1-dts.sh`
Expected: `FAIL - missing …/imx8mm-ecofleet-ef-mx8mm.dts`, exit 1.

- [ ] **Step 3: Write the R1 device tree**

Create `meta-ecofleet/recipes-kernel/linux/files/imx8mm-ecofleet-ef-mx8mm.dts`:

```dts
// SPDX-License-Identifier: (GPL-2.0+ OR MIT)
/*
 * EcoFleet EF-MX8MM "Cortex Controller" R1 carrier for the Variscite
 * DART-MX8M-MINI (R1-spec SoM: no on-SoM Ethernet PHY, LVDS bridge, WiFi/BT).
 *
 * Only the carrier is described here; DDR, PMIC, SoM eMMC, WiFi/BT and the
 * SN65DSI84 LVDS bridge come from Variscite's imx8mm-var-dart.dtsi.
 * Schematic: EF-MX8MM R1.00.00. Design:
 * docs/superpowers/specs/2026-10-14-r1-board-support-design.md
 */

#include "imx8mm-var-dart.dtsi"

/ {
	model = "EcoFleet EF-MX8MM Cortex Controller R1";
	compatible = "ecofleet,ef-mx8mm", "variscite,imx8mm-var-dart", "fsl,imx8mm";

	aliases {
		/* Marker for udev (99-ecofleet-rs485.rules): the APU RS-485 port.
		 * The name must not end in a digit, or the kernel parses it as a
		 * numbered alias. */
		ecofleet-rs485-uart = &uart2;
	};

	chosen {
		stdout-path = &uart1;
	};

	/* R1 uses the SAI3 pads as GPIOs (Ethernet reset/IRQ, RTC wake, Ezurio
	 * wake); the SoM's WM8904 headphone/mic path is not wired out. */
	/delete-node/ sound-wm8904;

	backlight: backlight {
		compatible = "pwm-backlight";
		pwms = <&pwm1 0 1000000 0>;
		brightness-levels = < 0  1  2  3  4  5  6  7  8  9
				     10 11 12 13 14 15 16 17 18 19
				     20 21 22 23 24 25 26 27 28 29
				     30 31 32 33 34 35 36 37 38 39
				     40 41 42 43 44 45 46 47 48 49
				     50 51 52 53 54 55 56 57 58 59
				     60 61 62 63 64 65 66 67 68 69
				     70 71 72 73 74 75 76 77 78 79
				     80 81 82 83 84 85 86 87 88 89
				     90 91 92 93 94 95 96 97 98 99
				    100>;
		default-brightness-level = <80>;
		status = "okay";
	};

	/* 100 MHz PCIe reference clock from the carrier's clock generator (U24) */
	pcie0_refclk: pcie0-refclk {
		compatible = "fixed-clock";
		#clock-cells = <0>;
		clock-frequency = <100000000>;
	};
};

/* ---------------------------------------------------------------- UARTs */

/* Console. On R1 this UART is also wired to the Ezurio module, which is held
 * in reset (BT_nRST hog below) for the whole board-support phase. */
&uart1 {
	pinctrl-names = "default";
	pinctrl-0 = <&pinctrl_uart1>;
	status = "okay";
};

/* APU RS-485 (ISO1450). DE and /RE are tied to GPIO3_IO21: the kernel drives
 * DE high only while sending, so there is no echo and no userspace switching. */
&uart2 {
	pinctrl-names = "default";
	pinctrl-0 = <&pinctrl_uart2>;
	rts-gpios = <&gpio3 21 GPIO_ACTIVE_HIGH>;
	linux,rs485-enabled-at-boot-time;
	status = "okay";
};

/* Wired to the TCAN3414 CAN transceiver, but the i.MX8M Mini has no CAN
 * controller, so there is nothing to drive it with. */
&uart3 {
	status = "disabled";
};

/* ------------------------------------------------------------------ I2C */

/* Panel touch controller (added during bring-up once its address is known) */
&i2c2 {
	clock-frequency = <100000>;
	pinctrl-names = "default", "gpio";
	pinctrl-0 = <&pinctrl_i2c2>;
	pinctrl-1 = <&pinctrl_i2c2_gpio>;
	scl-gpios = <&gpio5 16 GPIO_ACTIVE_HIGH>;
	sda-gpios = <&gpio5 17 GPIO_ACTIVE_HIGH>;
	status = "okay";
};

&i2c3 {
	/* Battery-backed RTC; the boot script also probes 0x6f to detect R1 */
	rtc@6f {
		compatible = "microchip,mcp7940x";
		reg = <0x6f>;
	};

	/* BR24G04 4 Kbit carrier EEPROM (blank for now) */
	eeprom@50 {
		compatible = "atmel,24c04";
		reg = <0x50>;
		pagesize = <16>;
	};
};

&wm8904 {
	status = "disabled";
};

&sai3 {
	status = "disabled";
};

/* The MCP7940N is the only RTC (rtc0), as the DS1337 is on the dev kit */
&snvs_rtc {
	status = "disabled";
};

&snvs_pwrkey {
	status = "okay";
};

/* -------------------------------------------------------------- Display */

/* Riverdi 5" 800x480 LVDS (SM-RVT50HQLNWC00-B) behind the SoM's SN65DSI84.
 * Timings start from the dev kit's 800x480 panel; replace with the Riverdi
 * datasheet values during bring-up. */
&panel_lvds {
	compatible = "panel-lvds";
	data-mapping = "jeida-24";
	width-mm = <108>;
	height-mm = <65>;
	backlight = <&backlight>;

	panel-timing {
		clock-frequency = <33000000>;
		hactive = <800>;
		vactive = <480>;
		hback-porch = <30>;
		hfront-porch = <30>;
		vback-porch = <29>;
		vfront-porch = <13>;
		hsync-len = <48>;
		vsync-len = <3>;
		hsync-active = <0>;
		vsync-active = <0>;
		de-active = <1>;
		pixelclk-active = <0>;
	};
};

/* Backlight boost (MP3302) EN, PWM dimming */
&pwm1 {
	pinctrl-names = "default";
	pinctrl-0 = <&pinctrl_backlight>;
	status = "okay";
};

/* ------------------------------------------------------------- Ethernet */

/* KSZ9031 on the carrier over RGMII. No PHY node: the driver resets the PHY
 * through ETH_dReset and takes the first PHY it finds on MDIO, so the strap
 * address does not need to be known. */
&fec1 {
	phy-mode = "rgmii-id";
	/delete-property/ phy-handle;
	/delete-property/ phy-supply;
	phy-reset-gpios = <&gpio4 31 GPIO_ACTIVE_LOW>;
	phy-reset-duration = <10>;
	phy-reset-post-delay = <1>;
	/delete-node/ mdio;
};

/* Powered the SoM's own PHY, which the R1 SoM does not have */
&reg_eth_phy {
	status = "disabled";
};

/* ------------------------------------------------------------------ USB */

/* USB-C: Rd pull-downs on CC and no VBUS source, so device role only */
&usbotg1 {
	dr_mode = "peripheral";
	status = "okay";
};

/* Upstream of the USB2422 hub (2x USB-A); the hub handles over-current */
&usbotg2 {
	dr_mode = "host";
	disable-over-current;
	status = "okay";
};

/* --------------------------------------------------------- Carrier eMMC */

/* 4 GB recovery eMMC, 4-bit, VCCQ 3.3 V, so never switch to 1.8 V signalling.
 * Shows up as mmcblk1; the SoM eMMC stays mmcblk2. */
&usdhc2 {
	pinctrl-names = "default";
	pinctrl-0 = <&pinctrl_usdhc2>;
	bus-width = <4>;
	non-removable;
	no-1-8-v;
	no-sd;
	no-sdio;
	status = "okay";
};

/* ----------------------------------------------------------------- PCIe */

/* M.2 Key-M NVMe; reference clock comes in on the PCIE1_REF_CLK pads */
&pcie_phy {
	fsl,refclk-pad-mode = <IMX8_PCIE_REFCLK_PAD_INPUT>;
	fsl,tx-deemph-gen1 = <0x2d>;
	fsl,tx-deemph-gen2 = <0xf>;
	fsl,clkreq-unsupported;
	clocks = <&pcie0_refclk>;
	status = "okay";
};

&pcie0 {
	reset-gpio = <&gpio1 13 GPIO_ACTIVE_LOW>;
	clocks = <&clk IMX8MM_CLK_PCIE1_ROOT>, <&pcie0_refclk>,
		 <&clk IMX8MM_CLK_PCIE1_AUX>;
	assigned-clocks = <&clk IMX8MM_CLK_PCIE1_AUX>,
			  <&clk IMX8MM_CLK_PCIE1_CTRL>;
	assigned-clock-rates = <10000000>, <250000000>;
	assigned-clock-parents = <&clk IMX8MM_SYS_PLL2_50M>,
				 <&clk IMX8MM_SYS_PLL2_250M>;
	status = "okay";
};

/* ---------------------------------------------------------------- GPIOs */

&gpio1 {
	gpio-line-names = "", "", "", "LCD_dRST", "", "LCD_STB", "LCD_FLIP_LR", "",
			  "LCD_FLIP_UD", "", "I2C_IRQ", "BT_CTS", "BT_RTS", "PCIE1_dRST",
			  "PCIE1_WAKE";

	/* Panel and touch share this reset, so neither driver owns it */
	lcd-rst-hog {
		gpio-hog;
		gpios = <3 GPIO_ACTIVE_HIGH>;
		output-high;
		line-name = "LCD_dRST";
	};

	lcd-stb-hog {
		gpio-hog;
		gpios = <5 GPIO_ACTIVE_HIGH>;
		output-high;
		line-name = "LCD_STB";
	};
};

&gpio2 {
	gpio-line-names = "", "", "", "", "", "", "", "", "", "",
			  "", "", "", "", "", "", "", "", "", "SD2_dRST";

	sd2-rst-hog {
		gpio-hog;
		gpios = <19 GPIO_ACTIVE_HIGH>;
		output-high;
		line-name = "SD2_dRST";
	};
};

&gpio3 {
	gpio-line-names = "", "", "", "", "", "", "", "", "", "",
			  "", "", "", "", "", "", "", "", "", "",
			  "", "RS485_DE";
};

&gpio4 {
	gpio-line-names = "", "", "", "", "", "", "", "", "", "",
			  "", "", "", "", "", "", "", "", "", "",
			  "", "BT_RCVRY_MD", "FD_CAN_EN", "", "BT_nRST", "NVMe_ACT",
			  "USB_HUB_dRST", "CAB_TEMP", "", "", "", "ETH_dReset";

	/* Ezurio module held in reset until its own sub-project brings it up */
	bt-rst-hog {
		gpio-hog;
		gpios = <24 GPIO_ACTIVE_HIGH>;
		output-low;
		line-name = "BT_nRST";
	};

	usb-hub-rst-hog {
		gpio-hog;
		gpios = <26 GPIO_ACTIVE_HIGH>;
		output-high;
		line-name = "USB_HUB_dRST";
	};
};

&gpio5 {
	gpio-line-names = "EZURIO_WAKE", "RTC_WKUP", "ETH_INT";
};

/* -------------------------------------------------------------- Pinmux */

&iomuxc {
	pinctrl-names = "default";
	pinctrl-0 = <&pinctrl_hog>;

	/* Carrier GPIOs. Outputs 0x16; inputs 0x1c0 (pull-up, hysteresis);
	 * 0x100 (pull-down) where a pull-up would switch something on. */
	pinctrl_hog: hoggrp {
		fsl,pins = <
			MX8MM_IOMUXC_GPIO1_IO03_GPIO1_IO3		0x16	/* LCD_dRST */
			MX8MM_IOMUXC_GPIO1_IO05_GPIO1_IO5		0x16	/* LCD_STB */
			MX8MM_IOMUXC_GPIO1_IO06_GPIO1_IO6		0x100	/* LCD_FLIP_LR */
			MX8MM_IOMUXC_GPIO1_IO08_GPIO1_IO8		0x100	/* LCD_FLIP_UD */
			MX8MM_IOMUXC_GPIO1_IO10_GPIO1_IO10		0x1c0	/* I2C_IRQ */
			MX8MM_IOMUXC_GPIO1_IO11_GPIO1_IO11		0x100	/* BT_CTS */
			MX8MM_IOMUXC_GPIO1_IO12_GPIO1_IO12		0x100	/* BT_RTS */
			MX8MM_IOMUXC_GPIO1_IO13_GPIO1_IO13		0x16	/* PCIE1_dRST */
			MX8MM_IOMUXC_GPIO1_IO14_GPIO1_IO14		0x1c0	/* PCIE1_WAKE */
			MX8MM_IOMUXC_SD2_RESET_B_GPIO2_IO19		0x16	/* SD2_dRST */
			MX8MM_IOMUXC_SAI2_RXFS_GPIO4_IO21		0x100	/* BT_RCVRY_MD */
			MX8MM_IOMUXC_SAI2_RXC_GPIO4_IO22		0x100	/* FD_CAN_EN: off = CAN standby */
			MX8MM_IOMUXC_SAI2_TXFS_GPIO4_IO24		0x16	/* BT_nRST */
			MX8MM_IOMUXC_SAI2_TXC_GPIO4_IO25		0x1c0	/* NVMe_ACT */
			MX8MM_IOMUXC_SAI2_TXD0_GPIO4_IO26		0x16	/* USB_HUB_dRST */
			MX8MM_IOMUXC_SAI2_MCLK_GPIO4_IO27		0x1c0	/* CAB_TEMP (TMP05) */
			MX8MM_IOMUXC_SAI3_TXFS_GPIO4_IO31		0x16	/* ETH_dReset */
			MX8MM_IOMUXC_SAI3_TXC_GPIO5_IO0			0x100	/* EZURIO_WAKE */
			MX8MM_IOMUXC_SAI3_TXD_GPIO5_IO1			0x1c0	/* RTC_WKUP */
			MX8MM_IOMUXC_SAI3_MCLK_GPIO5_IO2		0x1c0	/* ETH_INT */
		>;
	};

	pinctrl_uart1: uart1grp {
		fsl,pins = <
			MX8MM_IOMUXC_UART1_RXD_UART1_DCE_RX		0x140
			MX8MM_IOMUXC_UART1_TXD_UART1_DCE_TX		0x140
		>;
	};

	pinctrl_uart2: uart2grp {
		fsl,pins = <
			MX8MM_IOMUXC_UART2_RXD_UART2_DCE_RX		0x140
			MX8MM_IOMUXC_UART2_TXD_UART2_DCE_TX		0x140
			MX8MM_IOMUXC_SAI5_RXD0_GPIO3_IO21		0x16	/* RS485_DE */
		>;
	};

	pinctrl_i2c2: i2c2grp {
		fsl,pins = <
			MX8MM_IOMUXC_I2C2_SCL_I2C2_SCL			0x400001c3
			MX8MM_IOMUXC_I2C2_SDA_I2C2_SDA			0x400001c3
		>;
	};

	pinctrl_i2c2_gpio: i2c2grp-gpio {
		fsl,pins = <
			MX8MM_IOMUXC_I2C2_SCL_GPIO5_IO16		0x1c3
			MX8MM_IOMUXC_I2C2_SDA_GPIO5_IO17		0x1c3
		>;
	};

	pinctrl_backlight: backlightgrp {
		fsl,pins = <
			MX8MM_IOMUXC_GPIO1_IO01_PWM1_OUT		0x06
		>;
	};

	/* VSELECT stays muxed so the SoM's SD2 I/O supply is driven (held at
	 * 3.3 V by no-1-8-v), not left to a default pad state. */
	pinctrl_usdhc2: usdhc2grp {
		fsl,pins = <
			MX8MM_IOMUXC_SD2_CLK_USDHC2_CLK			0x190
			MX8MM_IOMUXC_SD2_CMD_USDHC2_CMD			0x1d0
			MX8MM_IOMUXC_SD2_DATA0_USDHC2_DATA0		0x1d0
			MX8MM_IOMUXC_SD2_DATA1_USDHC2_DATA1		0x1d0
			MX8MM_IOMUXC_SD2_DATA2_USDHC2_DATA2		0x1d0
			MX8MM_IOMUXC_SD2_DATA3_USDHC2_DATA3		0x1d0
			MX8MM_IOMUXC_GPIO1_IO04_USDHC2_VSELECT		0x1d0
		>;
	};
};
```

- [ ] **Step 4: Write the kernel bbappend**

Create `meta-ecofleet/recipes-kernel/linux/linux-variscite-fslc-imx_%.bbappend`:

```bitbake
# EF-MX8MM (R1) carrier device tree, built next to Variscite's DTBs so one
# image boots both the dev kit and R1 (the boot script picks the DTB).
# Host check: scripts/tests/check-r1-dts.sh
FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

SRC_URI:append = " file://imx8mm-ecofleet-ef-mx8mm.dts"

KERNEL_DEVICETREE:append = " freescale/imx8mm-ecofleet-ef-mx8mm.dtb"

do_configure:append() {
    dtsdir=${S}/arch/arm64/boot/dts/freescale
    install -m 0644 ${WORKDIR}/imx8mm-ecofleet-ef-mx8mm.dts $dtsdir/
    grep -q 'imx8mm-ecofleet-ef-mx8mm.dtb' $dtsdir/Makefile || \
        echo 'dtb-$(CONFIG_ARCH_MXC) += imx8mm-ecofleet-ef-mx8mm.dtb' >> $dtsdir/Makefile
}
```

- [ ] **Step 5: Run the check to verify it passes**

Run: `sh scripts/tests/check-r1-dts.sh`
Expected: 25 `ok` lines ending `PASS` (first run fetches ~27 MB of kernel DTS sources). Validated while writing this plan: the DTB compiles to 56041 bytes; the only dtc warnings (`interrupt_map`, suppressed by `-q`) come from NXP's `imx8mm.dtsi`, same as for the dev-kit DTB.

- [ ] **Step 6: Commit**

```bash
git add scripts/tests/check-r1-dts.sh meta-ecofleet/recipes-kernel/linux
git commit -m "feat(bsp): EF-MX8MM R1 device tree

Full R1 carrier .dts on top of Variscite's SoM dtsi, built next to the
dev-kit DTB by a linux-variscite-fslc-imx bbappend. RS-485 on UART2 in
kernel RS-485 mode (DE = GPIO3_IO21), KSZ9031 over RGMII found by MDIO
scan, MCP7940N + BR24G04 on I2C3, SAI3/WM8904 off (pads are GPIOs on
R1), Ezurio module held in reset. scripts/tests/check-r1-dts.sh compiles
it on the host against the pinned kernel and checks those properties.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Confirm U-Boot's I2C probe on the dev kit (gates Task 3)

Needs the console cable from .86 plugged into the Mac (`/dev/cu.usbserial-DP07JT55`). This reboots .86 once.

**Files:**
- Create: `docs/bench/tools/uboot-console.py`

**Interfaces:**
- Produces: `docs/bench/tools/uboot-console.py [--port P] [--trigger CMD] [--boot] [--no-stop] [--timeout S] -- 'cmd' …` — waits for the autoboot prompt, stops it (sends `ecofleet`, which also works as "any key"), runs each command at `u-boot=> `, optionally `boot`s. With `--no-stop` it sends only spaces and exits 0 if autoboot was NOT stopped (1 if it was).

- [ ] **Step 1: Write the helper**

Create `docs/bench/tools/uboot-console.py` (then `chmod +x`):

```python
#!/usr/bin/env python3
"""Stop U-Boot at its prompt over serial, run commands there, optionally boot.

Works with both autoboot styles:
  - "Hit any key to stop autoboot"  (dev kit U-Boot today): any byte stops it
  - "Autoboot in N seconds - type ecofleet to stop" (keyed, R1 U-Boot)
The stop string is sent repeatedly during the 1 s delay, which a person can't
type in time. With --no-stop it sends only noise (spaces) instead, to prove
that stray bytes do NOT stop a keyed autoboot.

Stdlib only (termios + select), like capture-warm-reboot.py.

Usage:
  uboot-console.py [--port P] [--trigger CMD] [--boot] [--no-stop] -- 'cmd' ...

  --trigger runs CMD (e.g. "ssh root@192.168.0.86 reboot") after the port is
  open; otherwise power-cycle the board yourself once it says "waiting".

Example (.86):
  uboot-console.py --trigger 'ssh root@192.168.0.86 reboot' --boot -- \
      'i2c bus' 'i2c dev 2' \
      'if i2c probe 0x6f; then echo PROBE-6F=FOUND; else echo PROBE-6F=NONE; fi'
"""

import argparse
import glob
import os
import select
import subprocess
import sys
import termios
import time

PROMPT = b"u-boot=> "
AUTOBOOT = (b"Hit any key to stop autoboot", b"Autoboot in")
STOP_STR = b"ecofleet"


def open_port(path):
    fd = os.open(path, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
    a = termios.tcgetattr(fd)
    a[0] = 0                                                # iflag: raw
    a[1] = 0                                                # oflag: raw
    a[2] = termios.CS8 | termios.CREAD | termios.CLOCAL     # 8N1
    a[3] = 0                                                # lflag: raw
    a[4] = a[5] = termios.B115200
    a[6][termios.VMIN] = 0
    a[6][termios.VTIME] = 0
    termios.tcsetattr(fd, termios.TCSANOW, a)
    termios.tcflush(fd, termios.TCIOFLUSH)
    return fd


def read_until(fd, markers, timeout):
    """Echo serial output; return (data, marker) at the first marker or timeout."""
    buf = b""
    end = time.time() + timeout
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.05)
        if not r:
            continue
        chunk = os.read(fd, 4096)
        sys.stdout.write(chunk.decode(errors="replace"))
        sys.stdout.flush()
        buf += chunk
        for m in markers:
            if m in buf:
                return buf, m
    return buf, None


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--port", default=None, help="serial device (default: first /dev/cu.usbserial-*)")
    ap.add_argument("--trigger", default=None, help="shell command that reboots the board")
    ap.add_argument("--boot", action="store_true", help="send 'boot' after the commands")
    ap.add_argument("--no-stop", action="store_true",
                    help="send only spaces at the autoboot prompt (keyed autoboot must ignore them)")
    ap.add_argument("--timeout", type=float, default=90, help="seconds to wait for the autoboot prompt")
    ap.add_argument("cmds", nargs="*")
    args = ap.parse_args()

    port = args.port or (sorted(glob.glob("/dev/cu.usbserial-*")) or [None])[0]
    if not port:
        sys.exit("no serial port found (plug in the console cable or pass --port)")
    fd = open_port(port)
    print(f"[uboot-console] {port}: waiting for the autoboot prompt "
          f"({'trigger: ' + args.trigger if args.trigger else 'power-cycle the board now'})")
    if args.trigger:
        subprocess.Popen(args.trigger, shell=True)

    _, m = read_until(fd, AUTOBOOT, args.timeout)
    if not m:
        sys.exit("\n[uboot-console] no autoboot prompt seen")

    noise = b" " if args.no_stop else STOP_STR
    end = time.time() + 6
    got = None
    while time.time() < end and not got:
        os.write(fd, noise)
        _, got = read_until(fd, (PROMPT, b"Starting kernel", b"booting slot"), 0.1)
    if got != PROMPT:
        print(f"\n[uboot-console] autoboot NOT stopped (saw {got!r})")
        sys.exit(0 if args.no_stop else 1)
    if args.no_stop:
        print("\n[uboot-console] FAIL: noise stopped autoboot")
        sys.exit(1)

    # Leftover stop-string bytes may sit on the command line: Ctrl-C clears it.
    os.write(fd, b"\x03")
    read_until(fd, (PROMPT,), 2)
    for cmd in args.cmds:
        os.write(fd, cmd.encode() + b"\r")
        _, m = read_until(fd, (PROMPT,), 15)
        if not m:
            sys.exit(f"\n[uboot-console] no prompt after: {cmd}")
    if args.boot:
        os.write(fd, b"boot\r")
        read_until(fd, (b"Starting kernel",), 30)
    print("\n[uboot-console] done")


if __name__ == "__main__":
    main()
```

(Validated while writing this plan against a fake U-Boot on a pty: any-key stop, keyed stop, and `--no-stop` against keyed autoboot all behave as described.)

- [ ] **Step 2: Run it on .86**

```bash
ls /dev/cu.usbserial-*        # the console cable must be plugged in
python3 docs/bench/tools/uboot-console.py --trigger 'ssh root@192.168.0.86 reboot' --boot -- \
    'i2c bus' 'i2c dev 2' 'i2c probe' \
    'if i2c probe 0x6f; then echo PROBE-6F=FOUND; else echo PROBE-6F=NONE; fi'
```
Expected: `i2c bus` lists `Bus 2:` with `i2c@30a40000` (I2C3); `i2c dev 2` says `Setting bus to 2`; `i2c probe` lists the bus-2 addresses (record them); **`PROBE-6F=NONE`**; then `Starting kernel`, and `ssh root@192.168.0.86 uptime` works within ~90 s.

**Gate:** if `PROBE-6F=FOUND` on the dev kit, or bus 2 is not `i2c@30a40000`, stop: the detection in Task 3 must change (bring the `i2c probe` list back to the user before continuing).

- [ ] **Step 3: Commit**

```bash
git add docs/bench/tools/uboot-console.py
git commit -m "docs(bench): U-Boot console helper

Stops U-Boot over serial for both autoboot styles (any key today, keyed
'ecofleet' after the R1 change), runs commands at the prompt, optionally
boots. --no-stop sends only noise to prove keyed autoboot ignores it.
Used on .86: I2C3 is u-boot bus 2 and nothing answers at 0x6f.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Boot script picks the DTB by board

**Files:**
- Modify: `scripts/tests/test-boot-script.sh` (full replacement below)
- Modify: `meta-ecofleet/recipes-bsp/ecofleet-bootscript/files/ecofleet-boot.cmd`
- Modify: `.github/workflows/build.yml` ("Stage release files" step)

**Interfaces:**
- Consumes: DTB name `imx8mm-ecofleet-ef-mx8mm.dtb` (Task 1); `i2c dev 2` / `i2c probe 0x6f` behavior (Task 2).
- Produces: `ecofleet_board=r1|devkit` on `/proc/cmdline`; boot-script banner line `==> EcoFleet: board <name>`; `$DEPLOY/imx8mm-ecofleet-ef-mx8mm.dtb` staged in `/tmp/yocto-release`.

- [ ] **Step 1: Write the failing test**

Replace `scripts/tests/test-boot-script.sh` with:

```sh
#!/bin/sh
# Static checks for the u-boot hush boot script (no u-boot on the host).
# - u-boot's old hush only accepts NAME=value / for-loop variables whose name
#   starts with a letter: `for _try in 1 2` runs "_try=1" as a command and
#   leaves ${_try} empty (bench 2026-10-08: the same-pass slot fallback never
#   ran and the unit stopped at the u-boot prompt).
# - no `reset`: u-boot's reset is the WDOG path that hangs this board.
# - one image, two boards: the script probes the R1-only MCP7940N (I2C3 = u-boot
#   bus 2, 0x6f) before the slot loop, tries the R1 DTB before the dev-kit DTB,
#   and tries the dev-kit DTB before giving up on the slot (an older release in
#   a slot has no R1 DTB). The R1 DTB name must match the kernel bbappend and
#   the CI release staging, or R1 silently boots the dev-kit DTB.
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
F=$ROOT/meta-ecofleet/recipes-bsp/ecofleet-bootscript/files/ecofleet-boot.cmd
R1_DTB=imx8mm-ecofleet-ef-mx8mm.dtb
DK_DTB=imx8mm-var-dart-dt8mcustomboard.dtb
code=$(grep -v '^[[:space:]]*#' "$F")
fail=0
ok()  { echo "ok   - $1"; }
bad() { echo "FAIL - $1"; fail=1; }
line() { echo "$code" | grep -n -F -- "$1" | head -1 | cut -d: -f1; }

bad_vars=$(echo "$code" | grep -oE '(^|[;[:space:]])for[[:space:]]+[^[:space:]]+[[:space:]]+in([[:space:]]|$)' | awk '{print $2}' | grep -v '^[A-Za-z]')
[ -z "$bad_vars" ] && ok "for-loop variables start with a letter" || bad "for-loop variable(s) not starting with a letter: $bad_vars"
echo "$code" | grep -qw reset && bad "reset command present" || ok "no reset command"

n_bus=$(line 'i2c dev 2')
n_probe=$(line 'i2c probe 0x6f')
n_loop=$(line 'for try in')
n_r1=$(line "$R1_DTB")
n_dk=$(line "$DK_DTB")
n_fb=$(line 'did not boot, trying slot')
[ -n "$n_bus" ] && [ -n "$n_probe" ] && [ "$n_bus" -lt "$n_probe" ] && ok "probes I2C3 (bus 2) for 0x6f" || bad "board probe: i2c dev 2 then i2c probe 0x6f"
[ -n "$n_probe" ] && [ -n "$n_loop" ] && [ "$n_probe" -lt "$n_loop" ] && ok "board detected before the slot loop" || bad "board probe must come before the slot loop"
[ -n "$n_r1" ] && [ -n "$n_dk" ] && [ "$n_r1" -lt "$n_dk" ] && ok "R1 DTB tried before the dev-kit DTB" || bad "DTB order (R1 line $n_r1, dev kit line $n_dk)"
[ -n "$n_dk" ] && [ -n "$n_fb" ] && [ "$n_dk" -lt "$n_fb" ] && ok "dev-kit DTB tried before the slot fallback" || bad "dev-kit DTB must be tried before falling back to the other slot"
echo "$code" | grep -q 'ecofleet_board=${ecofleet_board}' && ok "detected board on the kernel command line" || bad "bootargs lack ecofleet_board=\${ecofleet_board}"

grep -q "freescale/$R1_DTB" "$ROOT/meta-ecofleet/recipes-kernel/linux/linux-variscite-fslc-imx_%.bbappend" 2>/dev/null \
    && ok "kernel bbappend builds $R1_DTB" || bad "kernel bbappend does not build $R1_DTB"
grep -q "\$DEPLOY/$R1_DTB" "$ROOT/.github/workflows/build.yml" \
    && ok "CI stages $R1_DTB" || bad "build.yml does not stage $R1_DTB"

[ $fail = 0 ] && echo PASS || { echo FAILED; exit 1; }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `sh scripts/tests/test-boot-script.sh`
Expected: FAIL on the board probe (2 lines), DTB order, `ecofleet_board` bootargs and CI staging; `ok` on loop variables, no reset, dev-kit-before-fallback and the bbappend; `FAILED`, exit 1.

- [ ] **Step 3: Change the boot script**

In `meta-ecofleet/recipes-bsp/ecofleet-bootscript/files/ecofleet-boot.cmd`:

(a) After the line `# Layout: p1 boot, p2 rootfs-a, p3 rootfs-b, p4 data.` add:

```
# Boards: one image boots both the Variscite dev kit (DT8MCustomBoard) and the
# EF-MX8MM (R1) carrier; the board is detected below and picks the DTB.
```

(b) Immediately before `# Required by booti when the kernel is compressed (Image.gz)` add:

```
# Board detection: R1 has an MCP7940N RTC at 0x6f on I2C3 (u-boot bus 2, alias
# i2c2 = &i2c3); the dev kit has nothing there. If the probe fails for any
# reason, the dev-kit DTB is used, which still boots R1 far enough for WiFi.
setenv ecofleet_board devkit
if i2c dev 2; then
    if i2c probe 0x6f; then
        setenv ecofleet_board r1
    fi
fi
echo "==> EcoFleet: board ${ecofleet_board}"

```

(c) Replace this block inside the `for try in 1 2` loop:

```
    if ext4load mmc ${devnum}:${_part} ${loadaddr} /boot/Image.gz; then
        if ext4load mmc ${devnum}:${_part} ${fdt_addr} /boot/imx8mm-var-dart-dt8mcustomboard.dtb; then
            setenv bootargs "console=ttymxc0,115200 root=/dev/mmcblk${devnum}p${_part} rootwait rw quiet ${ecofleet_extra_args}"
            booti ${loadaddr} - ${fdt_addr}
        fi
    fi
```

with:

```
    if ext4load mmc ${devnum}:${_part} ${loadaddr} /boot/Image.gz; then
        # R1 tries its own DTB first. The dev-kit DTB is the fallback for the
        # dev kit and for an R1 slot holding a release older than R1 support.
        setenv fdt_ok 0
        if test "${ecofleet_board}" = "r1"; then
            if ext4load mmc ${devnum}:${_part} ${fdt_addr} /boot/imx8mm-ecofleet-ef-mx8mm.dtb; then
                setenv fdt_ok 1
            fi
        fi
        if test "${fdt_ok}" = "0"; then
            if ext4load mmc ${devnum}:${_part} ${fdt_addr} /boot/imx8mm-var-dart-dt8mcustomboard.dtb; then
                setenv fdt_ok 1
            fi
        fi
        if test "${fdt_ok}" = "1"; then
            setenv bootargs "console=ttymxc0,115200 root=/dev/mmcblk${devnum}p${_part} rootwait rw quiet ecofleet_board=${ecofleet_board} ${ecofleet_extra_args}"
            booti ${loadaddr} - ${fdt_addr}
        fi
    fi
```

- [ ] **Step 4: Stage the R1 DTB in CI**

In `.github/workflows/build.yml`, step "Stage release files", after the line

```
          cp -L "$DEPLOY/imx8mm-var-dart-dt8mcustomboard.dtb" /tmp/yocto-release/
```

add

```
          cp -L "$DEPLOY/imx8mm-ecofleet-ef-mx8mm.dtb" /tmp/yocto-release/
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `sh scripts/tests/test-boot-script.sh && sh scripts/tests/test-ab-slot-scripts.sh && sh scripts/tests/test-hwrevision.sh`
Expected: `test-boot-script.sh` prints 9 `ok` lines and `PASS`; the other two still pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add scripts/tests/test-boot-script.sh meta-ecofleet/recipes-bsp/ecofleet-bootscript/files/ecofleet-boot.cmd .github/workflows/build.yml
git commit -m "feat(boot): pick the DTB by board (dev kit or R1)

The stable boot script probes the R1-only MCP7940N (I2C3, u-boot bus 2,
0x6f). R1 loads imx8mm-ecofleet-ef-mx8mm.dtb, then falls back to the
dev-kit DTB in the same slot (a slot with an older release has no R1
DTB) before trying the other slot. The detected board goes on the kernel
command line (ecofleet_board=) for diagnostics. CI stages the R1 DTB.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: RS-485 link on R1

**Files:**
- Create: `scripts/tests/test-rs485-rule.sh`
- Modify: `meta-ecofleet/recipes-ecofleet/gobi-agent/files/99-ecofleet-rs485.rules` (full replacement below; the gobi-agent recipe already installs it)

**Interfaces:**
- Consumes: alias `ecofleet-rs485-uart = &uart2;` in the R1 DTS (Task 1).
- Produces: `/dev/ecofleet-rs485` → `ttymxc1` on R1, → the FTDI `ttyUSBn` on the dev kit. gobi-agent unchanged (`device=/dev/ecofleet-rs485`).

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/test-rs485-rule.sh`:

```sh
#!/bin/sh
# The APU link is /dev/ecofleet-rs485 on both boards: the FTDI adapter on the dev
# kit, UART2 (ttymxc1) on R1. ttymxc1 also exists on the dev kit (a header UART),
# so the R1 rule must only fire when the R1 device tree is running: it tests for
# the alias the R1 DTS defines. The alias name must not end in a digit, or the
# kernel parses it as a numbered alias.
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
RULES=$ROOT/meta-ecofleet/recipes-ecofleet/gobi-agent/files/99-ecofleet-rs485.rules
DTS=$ROOT/meta-ecofleet/recipes-kernel/linux/files/imx8mm-ecofleet-ef-mx8mm.dts
fail=0
ok()  { echo "ok   - $1"; }
bad() { echo "FAIL - $1"; fail=1; }
rules=$(grep -v '^[[:space:]]*#' "$RULES")

echo "$rules" | grep -q 'ATTRS{idVendor}=="0403", ATTRS{idProduct}=="6001", SYMLINK+="ecofleet-rs485"' \
    && ok "dev kit FTDI rule kept" || bad "dev kit FTDI rule missing"

r1=$(echo "$rules" | grep 'KERNEL=="ttymxc1"')
[ -n "$r1" ] && ok "R1 rule for ttymxc1" || bad "no R1 rule for ttymxc1"
echo "$r1" | grep -q 'SYMLINK+="ecofleet-rs485"' && ok "R1 rule links ecofleet-rs485" || bad "R1 rule does not link ecofleet-rs485"
alias=$(echo "$r1" | sed -n 's#.*TEST=="/proc/device-tree/aliases/\([^"]*\)".*#\1#p')
[ -n "$alias" ] && ok "R1 rule gated on DT alias '$alias'" || bad "R1 rule is not gated on a /proc/device-tree/aliases TEST"
case "$alias" in *[0-9]) bad "alias '$alias' ends in a digit";; *) ok "alias name does not end in a digit";; esac
[ -n "$alias" ] && grep -Eq "^[[:space:]]*$alias = &uart2;" "$DTS" \
    && ok "R1 DTS defines $alias = &uart2" || bad "R1 DTS does not define '$alias = &uart2;'"

[ $fail = 0 ] && echo PASS || { echo FAILED; exit 1; }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `sh scripts/tests/test-rs485-rule.sh`
Expected: `ok` for the FTDI rule; FAIL for the R1 rule, link, TEST gate and DTS alias; `FAILED`, exit 1.

- [ ] **Step 3: Add the R1 rule**

Replace `meta-ecofleet/recipes-ecofleet/gobi-agent/files/99-ecofleet-rs485.rules` with:

```
# Stable name for the APU RS-485 port: /dev/ecofleet-rs485 (gobi-agent opens it).
#
# Dev kit: an FTDI USB adapter. ttyUSBn names follow plug order and skip names
# still held open, so after a quick unplug/replug the adapter can come back as
# ttyUSB1 while gobi-agent keeps retrying ttyUSB0 (and a cellular modem would
# claim ttyUSB0-3). udev moves this link to wherever the adapter lands; the agent
# reopens it by name. FTDI FT232R (0403:6001). Add other adapter chips here.
SUBSYSTEM=="tty", ATTRS{idVendor}=="0403", ATTRS{idProduct}=="6001", SYMLINK+="ecofleet-rs485"
#
# R1 (EF-MX8MM): the on-board isolated transceiver on UART2. The kernel drives
# its DE line (RS-485 mode, R1 DTS). ttymxc1 also exists on the dev kit, so only
# link it when the R1 device tree's marker alias is present.
SUBSYSTEM=="tty", KERNEL=="ttymxc1", TEST=="/proc/device-tree/aliases/ecofleet-rs485-uart", SYMLINK+="ecofleet-rs485"
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `sh scripts/tests/test-rs485-rule.sh`
Expected: 6 `ok` lines and `PASS`.

- [ ] **Step 5: Commit**

```bash
git add scripts/tests/test-rs485-rule.sh meta-ecofleet/recipes-ecofleet/gobi-agent/files/99-ecofleet-rs485.rules
git commit -m "feat(agent): /dev/ecofleet-rs485 on R1's UART2

On R1 the APU link is the on-board transceiver on ttymxc1, with DE
driven by the kernel's RS-485 mode. The rule only fires when the R1
device tree's marker alias exists (ttymxc1 is a header UART on the dev
kit). The FTDI rule for the dev kit is unchanged; gobi-agent keeps
opening /dev/ecofleet-rs485.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: U-Boot keyed autoboot

**Files:**
- Create: `scripts/tests/test-uboot-autoboot.sh`
- Create: `meta-ecofleet/recipes-bsp/u-boot/files/ecofleet-autoboot.cfg`
- Modify: `meta-ecofleet/recipes-bsp/u-boot/u-boot-variscite_%.bbappend`

**Interfaces:**
- Produces: U-Boot prompt text `Autoboot in %d seconds - type ecofleet to stop` (grepped in Task 6); only `ecofleet` stops autoboot (exercised in Task 7).

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/test-uboot-autoboot.sh`:

```sh
#!/bin/sh
# Keyed autoboot: on R1, UART1 (the U-Boot console) is also wired to the Ezurio
# module, and with "any key stops autoboot" one stray byte from it would park
# the board at the u-boot prompt. Only the full stop string may stop it.
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
D=$ROOT/meta-ecofleet/recipes-bsp/u-boot
CFG=$D/files/ecofleet-autoboot.cfg
fail=0
ok()  { echo "ok   - $1"; }
bad() { echo "FAIL - $1"; fail=1; }

[ -f "$CFG" ] && ok "fragment present" || bad "missing $CFG"
grep -qx 'CONFIG_AUTOBOOT_KEYED=y' "$CFG" 2>/dev/null && ok "keyed autoboot" || bad "CONFIG_AUTOBOOT_KEYED=y"
grep -qx 'CONFIG_AUTOBOOT_STOP_STR="ecofleet"' "$CFG" 2>/dev/null && ok "stop string" || bad 'CONFIG_AUTOBOOT_STOP_STR="ecofleet"'
grep -q '^CONFIG_AUTOBOOT_PROMPT=".*ecofleet' "$CFG" 2>/dev/null && ok "prompt names the stop string" || bad "CONFIG_AUTOBOOT_PROMPT must name the stop string"
grep -q '^CONFIG_AUTOBOOT_KEYED_CTRLC=y' "$CFG" 2>/dev/null && bad "Ctrl-C would stop autoboot" || ok "Ctrl-C does not stop autoboot"
grep -q '^CONFIG_BOOTDELAY=' "$CFG" 2>/dev/null && bad "fragment changes CONFIG_BOOTDELAY (keep the defconfig's 1 s)" || ok "boot delay untouched"
grep -q 'file://ecofleet-autoboot.cfg' "$D/u-boot-variscite_%.bbappend" && ok "u-boot bbappend ships the fragment" || bad "u-boot bbappend does not ship the fragment"

[ $fail = 0 ] && echo PASS || { echo FAILED; exit 1; }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `sh scripts/tests/test-uboot-autoboot.sh`
Expected: FAIL for the fragment, keyed, stop string, prompt and bbappend; `FAILED`, exit 1.

- [ ] **Step 3: Add the fragment and ship it**

Create `meta-ecofleet/recipes-bsp/u-boot/files/ecofleet-autoboot.cfg`:

```
# Only the full string "ecofleet" stops autoboot (bbappend: u-boot-variscite).
# On R1 the console UART is shared with the Ezurio module; any-key stopping
# would let one stray byte from it park the board at the u-boot prompt.
CONFIG_AUTOBOOT_KEYED=y
CONFIG_AUTOBOOT_PROMPT="Autoboot in %d seconds - type ecofleet to stop\\n"
CONFIG_AUTOBOOT_STOP_STR="ecofleet"
```

In `meta-ecofleet/recipes-bsp/u-boot/u-boot-variscite_%.bbappend`, replace

```
SRC_URI += "file://fw_env.config"
```

with

```
SRC_URI += "file://fw_env.config"

# Keyed autoboot (merged into the u-boot .config by u-boot-configure.inc)
SRC_URI += "file://ecofleet-autoboot.cfg"
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `sh scripts/tests/test-uboot-autoboot.sh`
Expected: 7 `ok` lines and `PASS`.

- [ ] **Step 5: Commit**

```bash
git add scripts/tests/test-uboot-autoboot.sh meta-ecofleet/recipes-bsp/u-boot
git commit -m "feat(u-boot): keyed autoboot, stop string 'ecofleet'

On R1 the U-Boot console UART is shared with the Ezurio module; with
any-key stopping one stray byte would park the board at the prompt.
Boot delay stays 1 s. On the bench use docs/bench/tools/uboot-console.py
(or keep typing 'ecofleet' while the board powers on).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Branch build, artifact checks, dev-kit regression

**Files:** none (CI + bench). Record results for the PR description.

**Interfaces:**
- Consumes: Tasks 1–5 committed.
- Produces: `D=~/Downloads/r1-<short-sha>` holding `ecofleet-*.swu` and `ecofleet-image-imx8mm-var-dart.rootfs.wic.zst` (+ `.bmap`); .86 running the branch build.

- [ ] **Step 1: All host tests pass**

Run: `for t in check-r1-dts test-boot-script test-rs485-rule test-uboot-autoboot test-ab-slot-scripts test-hwrevision; do sh scripts/tests/$t.sh >/dev/null && echo "PASS $t" || echo "FAIL $t"; done`
Expected: six `PASS` lines.

- [ ] **Step 2: Push and build**

```bash
git push -u origin feat/r1-board-support
gh workflow run build.yml -R delorean1483/cortex-yocto --ref feat/r1-board-support
RUN=$(gh run list -R delorean1483/cortex-yocto --workflow build.yml --branch feat/r1-board-support --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN" -R delorean1483/cortex-yocto --exit-status
```
Expected: the run succeeds (the kernel and U-Boot rebuild, so it takes longer than an app-only build). If it fails in `linux-variscite-fslc-imx:do_compile` on the R1 DTB, fix the DTS with `check-r1-dts.sh` locally first.

- [ ] **Step 3: Download and inspect the artifacts**

```bash
D=~/Downloads/r1-$(git rev-parse --short HEAD)
gh run download "$RUN" -R delorean1483/cortex-yocto -n ecofleet-bench-image -D "$D"
W=$(ls "$D"/*.wic.zst)
zstd -dc "$W" | head -c 8388608 | strings | grep -F 'type ecofleet to stop'          # U-Boot in imx-boot
zstd -dc "$W" | head -c 41943040 | strings | grep -F 'i2c probe 0x6f'                # boot.scr on p1
zstd -dc "$W" | head -c 1900000000 | strings | grep -c -F 'EcoFleet EF-MX8MM Cortex Controller R1'   # R1 DTB in slot A
```
Expected: the first two print one matching line each; the count is ≥ 1.

- [ ] **Step 4: Dev-kit regression on .86 (old p1 script, new slot)**

```bash
SWU=$(ls "$D"/ecofleet-*.swu)
scp "$SWU" root@192.168.0.86:/tmp/r1.swu
ssh root@192.168.0.86 'swupdate -i /tmp/r1.swu -f /etc/swupdate/ecofleet.cfg && rm /tmp/r1.swu && reboot'
# ~90 s later:
ssh root@192.168.0.86 'cat /proc/device-tree/model; echo; ls /boot/imx8mm-ecofleet-ef-mx8mm.dtb; readlink -f /dev/ecofleet-rs485; fw_printenv upgrade_available bootcount; systemctl --failed --no-legend | wc -l; grep -o "\"apu_fw_version\":[0-9]*" /var/lib/ecofleet/latest.json'
```
Expected: model `Variscite DART-MX8M-MINI on DT8MCustomBoard 2.x and above`; the R1 DTB file exists; `/dev/ttyUSB0`; `upgrade_available=0`, `bootcount=0`; `0` failed units; `"apu_fw_version":10106`. (.86 keeps its old p1 `boot.scr`, so `/proc/cmdline` has no `ecofleet_board=`; that is expected.)

---

### Task 7: First R1 SoM — flash on the dev kit, boot on R1

**User at the bench throughout:** SD card, the dev kit's boot-select switch, SoM swaps, power. Console cable stays on the dev kit.

**Files:** none. Record what you see for Task 9.

**Interfaces:**
- Consumes: `$W` and `$SWU` from Task 6; `uboot-console.py` (Task 2).
- Produces: an R1 board on WiFi at `R1=root@<ip>`, slot b active on trial with the R1 DTB, slot a without the R1 DTB (safety net).

- [ ] **Step 1: Take .86 off the bench**

```bash
mkdir -p ~/ecofleet-backup && ssh root@192.168.0.86 'tar -C /data -czf - .' > ~/ecofleet-backup/86-data-$(date +%Y%m%d).tgz
ssh root@192.168.0.86 poweroff
```
Remove power ≥15 s. Take .86's SoM out (label it ".86 dev kit SoM") and seat R1 SoM #1 in the dev kit.

- [ ] **Step 2: Write the image to the SD card (Mac)**

```bash
diskutil list external     # the SD card is the ~62.9 GB disk. NEVER disk4 (5 TB drive).
diskutil unmountDisk /dev/diskN
zstd -dc "$W" | sudo dd of=/dev/rdiskN bs=4m
diskutil eject /dev/diskN
```

- [ ] **Step 3: Boot the dev kit from SD**

Set the dev kit's boot-select switch to SD, insert the card. Start `python3 docs/bench/tools/uboot-console.py --no-stop` and power on.
Expected (keyed autoboot, Review Focus 2): `[uboot-console] autoboot NOT stopped`, exit 0. The board boots our image from SD; `==> EcoFleet: board devkit` on the console; gobi-ui on the dev kit panel.

- [ ] **Step 4: Stop the new U-Boot with the stop string**

Run `python3 docs/bench/tools/uboot-console.py --boot -- 'if i2c probe 0x6f; then echo PROBE-6F=FOUND; else echo PROBE-6F=NONE; fi'` and power-cycle the dev kit.
Expected: the prompt `Autoboot in 1 seconds - type ecofleet to stop`, then `u-boot=> `, `PROBE-6F=NONE`, then a normal boot.

- [ ] **Step 5: Flash the SoM eMMC from the SD-booted system**

On the dev kit panel: Maintenance → WiFi, join the bench network. Read the IP (panel Device screen, or `ip -4 addr show wlan0` on the console, login `root`, no password) as `SDIP`. Then:

```bash
ssh root@$SDIP 'cat /proc/cmdline'      # must show root=/dev/mmcblk1p2 (SD)
zstd -dc "$W" | ssh root@$SDIP 'for m in $(grep -o "^/dev/mmcblk2p[0-9]*" /proc/mounts); do umount $m; done; dd of=/dev/mmcblk2 bs=4M conv=fsync'
ssh root@$SDIP poweroff
```

- [ ] **Step 6: First eMMC boot on the dev kit**

Remove power ≥15 s, remove the SD card, set boot-select back to eMMC, power on. Join WiFi again on the panel (fresh `/data`). Then with `H=root@<ip>`:

```bash
ssh $H 'cat /proc/device-tree/model; echo; cat /proc/cmdline; fw_printenv slot_active'
```
Expected: dev-kit model; `/proc/cmdline` has `root=/dev/mmcblk2p2` and `ecofleet_board=devkit`; `slot_active=a`.

- [ ] **Step 7: Fill slot b, then make slot a the safety net**

```bash
scp "$SWU" $H:/tmp/r1.swu
ssh $H 'swupdate -i /tmp/r1.swu -f /etc/swupdate/ecofleet.cfg && rm /tmp/r1.swu && reboot'
# ~90 s later, on slot b and confirmed:
ssh $H 'cat /proc/cmdline; fw_printenv slot_active upgrade_available'
# slot a = "older release": no R1 DTB. Arm a trial for slot b so R1 rolls back to slot a if the R1 DTB fails.
ssh $H 'mkdir -p /mnt/a && mount /dev/mmcblk2p2 /mnt/a && rm /mnt/a/boot/imx8mm-ecofleet-ef-mx8mm.dtb && sync && umount /mnt/a && fw_setenv upgrade_available 1 && fw_setenv bootcount 0 && fw_printenv slot_active upgrade_available bootcount && poweroff'
```
Expected: `root=/dev/mmcblk2p3`, `slot_active=b`, `upgrade_available=0` after the install; the last command prints `slot_active=b`, `upgrade_available=1`, `bootcount=0` and powers off.

- [ ] **Step 8: Move the SoM to R1 and boot**

Remove power ≥15 s. Move R1 SoM #1 to the R1 board (Riverdi panel connected; APU RS-485 harness optional for now). Put .86's own SoM back in the dev kit and power .86 (it returns as the APU rig; confirm `ssh root@192.168.0.86 uptime`).

Power R1. Wait ~2 min, find its IP from the router's DHCP leases (hostname `imx8mm-var-dart`) or on the panel, then `R1=root@<ip>`:

```bash
ssh $R1 'cat /proc/device-tree/model; echo; cat /proc/cmdline; fw_printenv slot_active upgrade_available bootcount; systemctl is-active gobi-ui gobi-agent'
```
Expected: model `EcoFleet EF-MX8MM Cortex Controller R1`; `ecofleet_board=r1`, `root=/dev/mmcblk2p3`; after ~1 min `upgrade_available=0` (confirmed); both services `active`.

If R1 isn't reachable after 5 min: power-cycle it 3 times (remove power ≥15 s each). Slot a takes over with the dev-kit DTB (Review Focus 1); expect model = Variscite dev kit and `ecofleet_board=r1` on the command line, reachable over WiFi. Debug from there (`dmesg` of the failed boot is lost; compare DTBs with Task 8's tools). If even that fails: move the SoM back to the dev kit, which boots it with `board devkit`.

---

### Task 8: R1 tuning — touch, orientation, panel, Ethernet

**Files:**
- Create: `docs/bench/tools/r1-try-dtb.sh`
- Modify: `meta-ecofleet/recipes-kernel/linux/files/imx8mm-ecofleet-ef-mx8mm.dts`
- Modify: `scripts/tests/check-r1-dts.sh` (touch + flip checks)

**Interfaces:**
- Consumes: `R1=root@<ip>` (Task 7); `check-r1-dts.sh <out.dtb>` (Task 1).
- Produces: `docs/bench/tools/r1-try-dtb.sh <file.dtb> <root@host>`; final DTS with a touch node and the two flip hogs.

- [ ] **Step 1: Write the DTB trial helper**

Create `docs/bench/tools/r1-try-dtb.sh` (then `chmod +x`):

```sh
#!/bin/sh
# Try a device tree on a unit without risking the running slot: copy it into the
# INACTIVE slot's /boot as the R1 DTB, make that slot active on trial, reboot.
# If the unit doesn't come up healthy (gobi-ui + gobi-agent active), u-boot
# rolls back to the current slot after 3 boots (power-cycle it if it hangs).
# The inactive slot must already hold a full install (one .swu install first).
#
# Usage: r1-try-dtb.sh <file.dtb> <root@host>
#   e.g. scripts/tests/check-r1-dts.sh /tmp/r1.dtb && r1-try-dtb.sh /tmp/r1.dtb root@192.168.0.123
set -eu
DTB=$1
HOST=$2
scp -q "$DTB" "$HOST:/tmp/r1-try.dtb"
ssh "$HOST" 'set -eu
cur=$(fw_printenv -n slot_active)
if [ "$cur" = a ]; then part=/dev/mmcblk2p3; next=b; else part=/dev/mmcblk2p2; next=a; fi
mkdir -p /mnt/r1-try
mount "$part" /mnt/r1-try
if [ ! -f /mnt/r1-try/boot/Image.gz ]; then
    umount /mnt/r1-try
    echo "slot $next has no kernel: install a .swu once first" >&2
    exit 1
fi
cp /tmp/r1-try.dtb /mnt/r1-try/boot/imx8mm-ecofleet-ef-mx8mm.dtb
sync
umount /mnt/r1-try
fw_setenv slot_active "$next"
fw_setenv upgrade_available 1
fw_setenv bootcount 0
echo "slot $next armed on trial with the new DTB; rebooting"
reboot'
```

Run: `sh -n docs/bench/tools/r1-try-dtb.sh` → no output.

- [ ] **Step 2: Inventory R1**

```bash
ssh $R1 'i2cdetect -y 1; i2cdetect -y 2; ls /sys/bus/mdio_bus/devices/; cat /sys/bus/mdio_bus/devices/*/phy_id 2>/dev/null; modetest -c 2>/dev/null | head -20; gpioinfo | grep -E "LCD_|BT_nRST|CAB_TEMP|RS485_DE|USB_HUB|SD2_dRST"; dmesg | grep -i -E "fec|micrel|ksz|panel|lvds|sn65|rtc|at24|ttymxc|pcie|mmc1" | head -60'
```
Record: the I2C2 (`-y 1`) address(es) = touch controller; I2C3 (`-y 2`) should show `UU` at 0x6f and 0x50/0x51; the MDIO device name (its suffix is the PHY address) and `phy_id` (`0x00221622` = KSZ9031); the LVDS connector state; hog lines `BT_nRST` output, `USB_HUB_dRST` output.

- [ ] **Step 3: Panel orientation (live, no rebuild)**

The flip lines are not hogged yet, so set them from userspace and look at the panel after each:

```bash
ssh $R1 'pkill gpioset; gpioset -z LCD_FLIP_LR=0 LCD_FLIP_UD=0'
ssh $R1 'pkill gpioset; gpioset -z LCD_FLIP_LR=1 LCD_FLIP_UD=0'
ssh $R1 'pkill gpioset; gpioset -z LCD_FLIP_LR=0 LCD_FLIP_UD=1'
ssh $R1 'pkill gpioset; gpioset -z LCD_FLIP_LR=1 LCD_FLIP_UD=1'
ssh $R1 'pkill gpioset'
```
Record the combination where the UI is upright and not mirrored (text reads normally, the rail is on the side it is on the dev kit). If none is right, the panel is mounted differently from the UI's assumption; record what you see and bring it to the user.

Also check colours: if they look wrong (e.g. purple/green cast, banding), the LVDS mapping is VESA, not JEIDA.

- [ ] **Step 4: Write the failing checks for touch and flips**

In `scripts/tests/check-r1-dts.sh`, before the two `grep -q … "$BBAPPEND"` lines, add:

```sh
I2=$(sym i2c2 || true)
[ -n "$(fdtget -l "$DTB" "$I2" 2>/dev/null | grep '^touchscreen@')" ] && ok "touch controller on i2c2" || bad "no touchscreen@ node on i2c2"
G1=$(sym gpio1 || true)
has "$G1/lcd-flip-lr-hog" gpio-hog && has "$G1/lcd-flip-ud-hog" gpio-hog && ok "panel flip pins hogged" || bad "lcd-flip-lr-hog / lcd-flip-ud-hog"
```

Run: `sh scripts/tests/check-r1-dts.sh` → the two new lines FAIL, `FAILED`.

- [ ] **Step 5: Add the touch node, flip hogs and panel fixes**

In the R1 DTS, inside `&i2c2 { … }` after `status = "okay";`, add the node for the address found in Step 2 (exactly one):

0x41 → ILITEK:
```dts
	touchscreen@41 {
		compatible = "ilitek,ili2130";
		reg = <0x41>;
		interrupt-parent = <&gpio1>;
		interrupts = <10 IRQ_TYPE_EDGE_FALLING>;
	};
```
0x5d (or 0x14: change both `@5d` and `reg`) → Goodix:
```dts
	touchscreen@5d {
		compatible = "goodix,gt911";
		reg = <0x5d>;
		interrupt-parent = <&gpio1>;
		interrupts = <10 IRQ_TYPE_EDGE_FALLING>;
		irq-gpios = <&gpio1 10 GPIO_ACTIVE_HIGH>;
	};
```
0x38 → FocalTech:
```dts
	touchscreen@38 {
		compatible = "edt,edt-ft5206";
		reg = <0x38>;
		interrupt-parent = <&gpio1>;
		interrupts = <10 IRQ_TYPE_EDGE_FALLING>;
		touchscreen-size-x = <800>;
		touchscreen-size-y = <480>;
	};
```
(Any other address: bring the `i2cdetect` output and the Riverdi datasheet to the user before continuing.)

In `&gpio1 { … }` after `lcd-stb-hog`, add the two hogs, using `output-low` for a 0 and `output-high` for a 1 from Step 3:
```dts
	lcd-flip-lr-hog {
		gpio-hog;
		gpios = <6 GPIO_ACTIVE_HIGH>;
		output-low;
		line-name = "LCD_FLIP_LR";
	};

	lcd-flip-ud-hog {
		gpio-hog;
		gpios = <8 GPIO_ACTIVE_HIGH>;
		output-low;
		line-name = "LCD_FLIP_UD";
	};
```
and in `pinctrl_hog` change the pad values of `GPIO1_IO06` and `GPIO1_IO08` from `0x100` to `0x16` (outputs now).

If Step 3 showed wrong colours: in `&panel_lvds` set `data-mapping = "vesa-24";`. If the Riverdi datasheet is available, replace the `panel-timing` values with its typical values (pixel clock, h/v active, porches, sync lengths, polarities).

- [ ] **Step 6: Run the check, then try the DTB on R1**

```bash
sh scripts/tests/check-r1-dts.sh /tmp/r1.dtb
sh docs/bench/tools/r1-try-dtb.sh /tmp/r1.dtb $R1
# ~2 min later:
ssh $R1 'cat /proc/cmdline; fw_printenv slot_active upgrade_available; cat /proc/bus/input/devices | grep -A1 -i -E "ili|goodix|ft5|edt"'
```
Expected: `check-r1-dts.sh` 27 `ok` + `PASS`; on R1 the other slot is now active and confirmed (`upgrade_available=0`), and the touch controller is listed as an input device.

On the panel: tap the four corners of the UI (e.g. rail items top and bottom, a right-side control). If taps land mirrored, add `touchscreen-inverted-x;` and/or `touchscreen-inverted-y;` (or `touchscreen-swapped-x-y;`) to the touch node, re-run Step 6, and repeat until taps land where touched.

- [ ] **Step 7: Ethernet (record only)**

Plug a cable from R1's RJ45 to the bench switch.
```bash
ssh $R1 'cat /sys/class/net/eth0/operstate; cat /sys/class/net/eth0/speed 2>/dev/null; ip -4 addr show eth0; dmesg | grep -i -E "fec|micrel|ksz|eth0" | tail -20'
```
Record operstate/speed/IP. Working = `up`, `1000` (or `100`), an address. A link without traffic or no link is the likely result of hardware finding 3 (I/O voltage); record it, don't change the DTS for it.

- [ ] **Step 8: Commit**

```bash
git add docs/bench/tools/r1-try-dtb.sh scripts/tests/check-r1-dts.sh meta-ecofleet/recipes-kernel/linux/files/imx8mm-ecofleet-ef-mx8mm.dts
git commit -m "feat(bsp): R1 touch controller and panel orientation from the bench

Touch controller and LVDS flip-pin levels found on the first R1 board,
plus docs/bench/tools/r1-try-dtb.sh: try a DTB on the inactive slot
with an A/B trial so a bad one rolls back by itself.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(Adjust the message to say which controller and which flip levels; mention `vesa-24` or datasheet timings if changed.)

---

### Task 9: Final build on R1, checklist, findings

**User at the bench** (APU harness on R1's RJ45, power, button presses, USB stick, coin cell).

**Files:**
- Create: `docs/bench/2026-10-14-r1-bringup.md`
- Create: `docs/hardware/EF-MX8MM-R1-findings.md`

**Interfaces:**
- Consumes: Tasks 1–8; `R1`, `uboot-console.py`, `r1-try-dtb.sh`.

- [ ] **Step 1: Build and install the committed state on R1 and .86**

Repeat Task 6 Steps 1–3 for the new HEAD (new `RUN`, `D`, `W`, `SWU`). Then for each of `$R1` and `root@192.168.0.86`:

```bash
scp "$SWU" $HOST:/tmp/r1.swu
ssh $HOST 'swupdate -i /tmp/r1.swu -f /etc/swupdate/ecofleet.cfg 2>&1 | grep -i -E "writing to|mmcblk"; rm /tmp/r1.swu; reboot'
# ~90 s later:
ssh $HOST 'cat /proc/device-tree/model; echo; cat /proc/cmdline; fw_printenv slot_active upgrade_available; systemctl --failed --no-legend | wc -l'
```
Expected (check 14 + Review Focus 4): the install log names `/dev/mmcblk2p2` or `/dev/mmcblk2p3`, never `mmcblk1`; after reboot the other slot is active and `upgrade_available=0`; `0` failed units; R1 shows the R1 model, .86 the dev-kit model.

- [ ] **Step 2: Run the checklist on R1**

Record pass/fail and evidence for each in `docs/bench/2026-10-14-r1-bringup.md`.

1. **Boot** — `ssh $R1 'cat /proc/device-tree/model; systemctl is-active gobi-ui gobi-agent'` → R1 model, `active` ×2; UI on the panel.
2. **Display** — picture correct and upright; `ssh $R1 'echo 20 > /sys/class/backlight/backlight/brightness; sleep 3; echo 80 > /sys/class/backlight/backlight/brightness'` dims then restores; the UI brightness slider dims too.
3. **Touch** — taps land where touched across the screen.
4. **RS-485** (APU on the RJ45 harness) — `ssh $R1 'readlink -f /dev/ecofleet-rs485; grep -o "\"apu_fw_version\":[0-9]*" /var/lib/ecofleet/latest.json'` → `/dev/ttymxc1` and the APU's version (10106 on the bench APU). Change the climate setpoint on the panel by 1 °F; within 10 s `grep -o '"clmt_setpoint_f":[0-9.]*' /var/lib/ecofleet/latest.json` shows the new value; set it back. After ≥10 min of polling: `ssh $R1 'journalctl -u gobi-agent --since "-10 min" | grep -c -i -E "timed out|timeout|crc|invalid"'` → `0` (Review Focus 3).
5. **RTC** — `ssh $R1 'timedatectl | grep synchronized; hwclock -w; hwclock -r; date'`; `poweroff`, remove power 2 min (coin cell fitted), power on; `ssh $R1 'dmesg | grep -i "setting system clock"'` shows the right date/time (±2 s).
6. **EEPROM** — `ssh $R1 'E=/sys/bus/i2c/devices/2-0050/eeprom; printf R1TEST | dd of=$E bs=1 seek=500 conv=notrunc 2>/dev/null; dd if=$E bs=1 skip=500 count=6 2>/dev/null; echo; printf "\377\377\377\377\377\377" | dd of=$E bs=1 seek=500 conv=notrunc 2>/dev/null'` → `R1TEST`.
7. **Ethernet** — result from Task 8 Step 7 (and repeat it now).
8. **USB** — a USB stick in each USB-A port: `ssh $R1 'lsusb -t'` shows the hub and the stick; `ssh $R1 'ls /sys/class/udc'` lists a UDC (USB-C device controller).
9. **Storage** — `ssh $R1 'cat /sys/block/mmcblk1/device/name /sys/block/mmcblk1/size; grep -c mmcblk1 /proc/mounts; lspci; ls /dev/nvme* 2>/dev/null'` → carrier eMMC name and ~4 GB in 512-byte sectors; `0` mounts (Review Focus 4); NVMe listed if a drive is fitted.
10. **On/off** — short press while on: clean shutdown; short press while off: boots; hold 5 s while on: hard off.
11. **Reboots** — `ssh $R1 reboot`: back within ~60 s. Watchdog: `ssh $R1 'cat /sys/class/watchdog/watchdog0/state'`; if `inactive`, `ssh $R1 'sh -c "exec 3>/dev/watchdog0; exec 3>&-"'` → the board resets about 60 s later through WDOG_B → PMIC and comes back; afterwards record `ssh $R1 'i2cget -f -y 0 0x4b 0x29'` (PMIC reset source). If `active` (systemd owns it), record and skip.
12. **Cab temp** — `ssh $R1 'gpiomon --num-events=6 CAB_TEMP'` → edges with timestamps; high ≈ 40 ms, low ≈ 76 ms near 25 °C. Record T = 421 − 751 × (T_high / T_low) °C.
13. **Ezurio** — `ssh $R1 'gpioinfo | grep BT_nRST'` → `output`, consumer `BT_nRST` (hog, held low).
14. **OTA** — Step 1 result.
15. **Dev kit** — Step 1 result for .86, plus `ssh root@192.168.0.86 'readlink -f /dev/ecofleet-rs485; grep -o "\"apu_fw_version\":[0-9]*" /var/lib/ecofleet/latest.json'` → `/dev/ttyUSB0`, `10106`.
16. **Older slot on R1** (Review Focus 1) —
```bash
ssh $R1 'cur=$(fw_printenv -n slot_active); if [ "$cur" = a ]; then p=/dev/mmcblk2p3; n=b; else p=/dev/mmcblk2p2; n=a; fi; mkdir -p /mnt/o && mount $p /mnt/o && mv /mnt/o/boot/imx8mm-ecofleet-ef-mx8mm.dtb /mnt/o/boot/r1.dtb.off && sync && umount /mnt/o && fw_setenv slot_active $n && reboot'
# ~90 s later:
ssh $R1 'cat /proc/device-tree/model; echo; cat /proc/cmdline'
```
Expected: dev-kit model, `ecofleet_board=r1`, root on the other partition, reachable over WiFi. Restore: mount that slot again, `mv /mnt/o/boot/r1.dtb.off /mnt/o/boot/imx8mm-ecofleet-ef-mx8mm.dtb`, reboot, and confirm the R1 model.

- [ ] **Step 3: Write the bring-up runbook and results**

Create `docs/bench/2026-10-14-r1-bringup.md` with these sections, filled from Tasks 7–9:
- **Flashing an R1 SoM** — Task 7 Steps 1–7 as a numbered procedure (SD write with the disk warning, boot-select switch, WiFi join, `dd` to `mmcblk2`, fill slot b).
- **Stopping U-Boot** — keyed autoboot: `uboot-console.py`, or keep typing `ecofleet` while the board powers on.
- **Trying a DTB** — `check-r1-dts.sh /tmp/r1.dtb && r1-try-dtb.sh /tmp/r1.dtb root@<ip>`.
- **Recovery** — rollback after 3 boots; U-Boot console; SoM back to the dev kit.
- **Checklist results** — table: #, check, result (PASS/FAIL/SKIP), evidence (command output excerpt), date, board/SoM serial.

- [ ] **Step 4: Write the findings for Robb**

Create `docs/hardware/EF-MX8MM-R1-findings.md`:
- Header: board EF-MX8MM R1.00.00, date, which units/SoMs were tested.
- The five findings from the spec section "R1 hardware findings" (no console; SPKDRV pin conflict with fix `GPIO1_IO15/PWM4_OUT`, SOK3 pin 38; NVCC_ENET 1.8 V vs KSZ9031 DVDDH 3.3 V; no CAN controller; USB-C device-only), each with what the bench showed (e.g. Ethernet result from check 7, PMIC reset source from check 11).
- "Good as drawn": WDOG_B → TPS3808 → PMIC_ON_REQ cold reset (with check 11 evidence); TMP05 continuous mode (check 12 evidence).
- Bench-derived values: touch controller part/address, flip levels, LVDS mapping/timings used.

- [ ] **Step 5: Commit**

```bash
git add docs/bench/2026-10-14-r1-bringup.md docs/hardware/EF-MX8MM-R1-findings.md
git commit -m "docs: R1 bring-up runbook, checklist results, hardware findings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Finish the branch

- [ ] **Step 1:** Run all host tests again (Task 6 Step 1 loop) → six `PASS`.
- [ ] **Step 2:** Use superpowers:finishing-a-development-branch. The PR (base `main`, `-R delorean1483/cortex-yocto`) summarizes: one image for both boards, R1 DTS, board detection, keyed autoboot (the dev-kit console habit changes from spaces to `ecofleet` on any reflashed unit), RS-485 on R1, checklist results, and the findings doc. End the body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Releasing (tag + `gh workflow run build.yml --ref vX.Y.Z`) is the user's call after merge.
