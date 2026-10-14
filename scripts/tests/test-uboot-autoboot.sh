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
