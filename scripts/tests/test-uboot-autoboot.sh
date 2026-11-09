#!/bin/sh
# Keyed autoboot: on R1, UART1 (the U-Boot console) is also wired to the Ezurio
# module, and with "any key stops autoboot" one stray byte from it would park
# the board at the u-boot prompt. Only the full stop string may stop it.
# Variscite's recipe is u-boot-variscite.bb (no version in the file name), so
# the append must be named exactly u-boot-variscite.bbappend: BitBake matches
# u-boot-variscite_%.bbappend only against u-boot-variscite_<ver>.bb, and the
# fragment then silently never reaches the build (CI run 38575643017).
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
# U-Boot 2024.04's kconfig copies .config strings into C verbatim (no escaping
# either way), so the fragment needs a single backslash: \\n printed a literal
# "\n" on the console (CI run 38578285180).
grep -q '^CONFIG_AUTOBOOT_PROMPT=".*[^\\]\\n"$' "$CFG" 2>/dev/null && ok "prompt ends in a C newline" || bad "CONFIG_AUTOBOOT_PROMPT must end in a single backslash-n"
grep -q '^CONFIG_AUTOBOOT_KEYED_CTRLC=y' "$CFG" 2>/dev/null && bad "Ctrl-C would stop autoboot" || ok "Ctrl-C does not stop autoboot"
grep -q '^CONFIG_BOOTDELAY=' "$CFG" 2>/dev/null && bad "fragment changes CONFIG_BOOTDELAY (keep the defconfig's 1 s)" || ok "boot delay untouched"
[ -f "$D/u-boot-variscite.bbappend" ] && ok "bbappend named for the unversioned recipe" || bad "missing $D/u-boot-variscite.bbappend"
ls "$D"/u-boot-variscite_*.bbappend >/dev/null 2>&1 && bad "u-boot-variscite_*.bbappend never applies to u-boot-variscite.bb" || ok "no versioned u-boot bbappend"
grep -q 'file://ecofleet-autoboot.cfg' "$D/u-boot-variscite.bbappend" 2>/dev/null && ok "u-boot bbappend ships the fragment" || bad "u-boot bbappend does not ship the fragment"

[ $fail = 0 ] && echo PASS || { echo FAILED; exit 1; }
