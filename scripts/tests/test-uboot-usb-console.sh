#!/bin/sh
# U-Boot console on R1's USB-C port (Robb, 2026-10-14): R1's UART1, the only
# console SPL and U-Boot have, is wired to the Ezurio module. The u-boot append
# adds the CDC ACM console (stdout=serial,usbacm) on R1 only. Checks:
#   - the config fragment and the patch list in the append;
#   - every patch applies, in order, to the U-Boot sources the build pins
#     (a do_patch failure here costs seconds; in CI it costs a build);
#   - the patched sources keep the properties a person at the board relies
#     on: no hang without a host, not during uuu flashing, gadget stopped
#     before Linux, same R1 detection as the boot script.
# U-Boot itself is only compiled in CI; the bench run is in
# docs/bench/r1-usb-console.md.
#
# The first run fetches the two patched files (shallow, sparse) into
# ${UBOOT_SRC_CACHE:-$HOME/.cache/ecofleet-uboot}.
set -eu

REPO=$(cd "$(dirname "$0")/../.." && pwd)
D=$REPO/meta-ecofleet/recipes-bsp/u-boot
CFG=$D/files/ecofleet-usb-console.cfg
BBAPPEND=$D/u-boot-variscite.bbappend
BOOTCMD=$REPO/meta-ecofleet/recipes-bsp/ecofleet-bootscript/files/ecofleet-boot.cmd

# u-boot-variscite SRCREV (branch lf_v2024.04_6.6.52-2.2.2_var01) pinned by
# the meta-variscite-bsp-imx commit in kas/dev.yml. Update both together.
BSPREV=04c6a0b2ce5a05a5b1ee3589565a38b2a015a36a
UREV=b6650c1f302033f749cb78b95cc2be7e42f7d887
CACHE=${UBOOT_SRC_CACHE:-$HOME/.cache/ecofleet-uboot}/$UREV
ACM=drivers/usb/gadget/f_acm.c
BOARD=board/variscite/imx8mm_var_dart/imx8mm_var_dart.c
PATCHES="0001-usb-gadget-f_acm-Claim-requested-USB-endpoints.patch
0002-usb-gadget-f_acm-Allow-restarting-ACM-console-after-.patch
0003-usb-gadget-f_acm-never-hang-the-console-without-a-ho.patch
0004-imx8mm_var_dart-EcoFleet-R1-U-Boot-console-on-the-US.patch"

fail=0
ok()  { echo "ok   - $1"; }
bad() { echo "FAIL - $1"; fail=1; }

grep -A2 'meta-variscite-bsp-imx:' "$REPO/kas/dev.yml" | grep -q "commit: $BSPREV" \
    && ok "kas pins the BSP this U-Boot revision belongs to" \
    || bad "meta-variscite-bsp-imx moved: re-check UREV against its u-boot-common.inc"

# 1. Fragment and append.
for opt in CONFIG_USB_FUNCTION_ACM=y CONFIG_CONSOLE_MUX=y CONFIG_SYS_CONSOLE_IS_IN_ENV=y CONFIG_OF_BOARD_SETUP=y; do
    grep -qx "$opt" "$CFG" 2>/dev/null && ok "fragment: $opt" || bad "fragment lacks $opt"
done
grep -q 'file://ecofleet-usb-console.cfg' "$BBAPPEND" && ok "append ships the fragment" || bad "append does not ship ecofleet-usb-console.cfg"
listed=$(sed -n 's#.*file://\([0-9][0-9][0-9][0-9]-[^ "]*\.patch\).*#\1#p' "$BBAPPEND")
[ "$listed" = "$PATCHES" ] && ok "append lists the 4 patches in order" || bad "append patch list is: $(echo $listed)"

# 2. The patches apply to the pinned sources.
if [ ! -f "$CACHE/.done" ]; then
    rm -rf "$CACHE"
    mkdir -p "$CACHE"
    git -C "$CACHE" init -q
    git -C "$CACHE" remote add origin https://github.com/varigit/uboot-imx
    git -C "$CACHE" sparse-checkout set --no-cone "/$ACM" "/$BOARD"
    git -C "$CACHE" fetch -q --depth=1 --filter=blob:none origin "$UREV"
    git -C "$CACHE" checkout -q FETCH_HEAD
    touch "$CACHE/.done"
fi
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/src/$(dirname $ACM)" "$TMP/src/$(dirname $BOARD)"
cp "$CACHE/$ACM" "$TMP/src/$ACM"
cp "$CACHE/$BOARD" "$TMP/src/$BOARD"
applied=0
for p in $PATCHES; do
    if [ -f "$D/files/$p" ] && (cd "$TMP/src" && git apply "$D/files/$p" 2>"$TMP/err"); then
        applied=$((applied + 1))
    else
        bad "$p does not apply: $(cat "$TMP/err" 2>/dev/null)"
        break
    fi
done
[ $applied = 4 ] && ok "all 4 patches apply to uboot-imx ${UREV%"${UREV#???????}"}"
A=$TMP/src/$ACM
B=$TMP/src/$BOARD

# 3. Properties of the patched sources.
fn() { sed -n "/^static [a-z]* *\**$1(/,/^}/p" "$2"; }
fn acm_stdio_start "$A" | grep -q 'while' && bad "acm_stdio_start still waits for a host" \
    || ok "console start does not wait for a host"
fn __acm_tx "$A" | grep -q 'get_timer(start) > ACM_TX_TIMEOUT_MS' \
    && ok "TX gives up on a packet the host never takes" || bad "__acm_tx has no timeout"
fn acm_disable "$A" | grep -q 'connected = false' \
    && ok "bus reset/unplug forgets the host" || bad "acm_disable leaves connected set"
fn acm_stdio_stop "$A" | grep -q 'dev->priv = NULL' \
    && ok "console can restart after a stop" || bad "acm_stdio_stop keeps dev->priv"

late=$(sed -n '/^int board_late_init(void)/,/^}/p' "$B")
echo "$late" | awk '/board_late_mmc_env_init\(\);/{m=1} /ecofleet_usb_console\(\);/{if(m)u=1} END{exit !u}' \
    && ok "hook runs at the end of board_late_init (after the env device is set)" \
    || bad "ecofleet_usb_console() not called after board_late_mmc_env_init() in board_late_init"
fn ecofleet_usb_console "$B" | grep -q 'is_usb_boot()' \
    && ok "skipped when booted by uuu (fastboot keeps the port)" || bad "no is_usb_boot() guard"
fn ecofleet_usb_console "$B" | grep -q 'env_get_yesno("ecofleet_usbcon")' \
    && ok "ecofleet_usbcon=1 override for the dev kit" || bad "no ecofleet_usbcon override"
# Same R1 detection as the boot script: bus 2, address 0x6f.
grep -q '^if i2c dev 2; then' "$BOOTCMD" && grep -q 'if i2c probe 0x6f; then' "$BOOTCMD" \
    && fn ecofleet_is_r1 "$B" | grep -q 'uclass_get_device_by_seq(UCLASS_I2C, 2,' \
    && fn ecofleet_is_r1 "$B" | grep -q 'dm_i2c_probe(bus, 0x6f,' \
    && ok "R1 detection matches the boot script (bus 2, 0x6f)" || bad "R1 detection differs from the boot script"
sed -n '/^int ft_board_setup(/,/^}/p' "$B" | grep -q 'ecofleet_console_serial();' \
    && ok "console back on serial (gadget stopped) before the kernel" || bad "ft_board_setup does not stop the USB console"

[ $fail = 0 ] && echo PASS || { echo FAILED; exit 1; }
