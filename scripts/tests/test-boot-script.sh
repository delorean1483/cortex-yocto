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
