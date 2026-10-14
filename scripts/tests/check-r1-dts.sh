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
# Until the R1 Ethernet I/O-voltage finding is settled (KSZ9031 DVDDH 3.3 V vs
# NVCC_ENET 1.8 V), Ethernet stays off on R1 and the PHY is held in reset, so it
# never drives 3.3 V RGMII into the SoC. The fec1 setup above is kept for when
# it's turned back on (then drop the hog: phy-reset-gpios uses the same line).
[ "$(prop "$F" status)" = disabled ] && ok "fec1 off on R1 (Ethernet I/O voltage finding)" || bad "fec1 must stay disabled until the I/O voltage is fixed"
has "$(sym gpio4 || true)/eth-rst-hog" output-low && ok "KSZ9031 held in reset (ETH_dReset low)" || bad "eth-rst-hog (GPIO4_IO31 output-low)"

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
