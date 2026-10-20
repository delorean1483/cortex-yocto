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
# - R1 safety (R1 hardware finding 3 + review): U-Boot itself holds the KSZ9031
#   in reset on R1 (SAI3_TXFS muxed to GPIO4_IO31 and driven low) before any
#   DTB loads, because nothing pulls that reset line; and when R1 boots the
#   dev-kit DTB, the script disables that DTB's SAI3 (it would take the pad
#   back) and SD-card host (it could run R1's 3.3 V carrier eMMC at 1.8 V).
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

n_mux=$(line 'mw.l 0x303301d8 0x5')
n_pad=$(line 'mw.l 0x30330440 0x16')
n_low=$(line 'gpio clear GPIO4_31')
n_r1if=$(echo "$code" | grep -n -F 'if test "${ecofleet_board}" = "r1"' | cut -d: -f1 | head -1)
[ -n "$n_mux" ] && [ -n "$n_pad" ] && [ -n "$n_low" ] && [ "$n_mux" -lt "$n_low" ] && [ "$n_pad" -lt "$n_low" ] \
    && ok "R1: U-Boot muxes ETH_dReset to GPIO4_IO31 and drives it low" || bad "R1 PHY hold: mw.l mux/pad then gpio clear GPIO4_31"
[ -n "$n_r1if" ] && [ -n "$n_probe" ] && [ -n "$n_mux" ] && [ -n "$n_loop" ] && [ "$n_probe" -lt "$n_r1if" ] && [ "$n_r1if" -lt "$n_mux" ] && [ "$n_low" -lt "$n_loop" ] \
    && ok "R1 PHY hold is board-gated and runs before any DTB loads" || bad "R1 PHY hold must sit in an r1 block between the probe and the slot loop"
n_resize=$(echo "$code" | grep -n -F 'fdt resize' | cut -d: -f1 | awk -v a="$n_dk" '$1 > a' | head -1)
n_sai=$(line 'fdt set /soc@0/bus@30000000/spba-bus@30000000/sai@30030000 status disabled')
n_sd=$(line 'fdt set /soc@0/bus@30800000/mmc@30b50000 status disabled')
n_booti=$(line 'booti ${loadaddr}')
[ -n "$n_dk" ] && [ -n "$n_resize" ] && [ -n "$n_sai" ] && [ -n "$n_sd" ] && [ -n "$n_booti" ] \
    && [ "$n_dk" -lt "$n_resize" ] && [ "$n_resize" -lt "$n_sai" ] && [ "$n_resize" -lt "$n_sd" ] && [ "$n_sai" -lt "$n_booti" ] && [ "$n_sd" -lt "$n_booti" ] \
    && ok "R1 on the dev-kit DTB: SAI3 and SD host disabled before booti" || bad "dev-kit DTB on R1 needs fdt resize + sai3/usdhc2 disabled between its load and booti"
n_r1if2=$(echo "$code" | grep -n -F 'if test "${ecofleet_board}" = "r1"' | cut -d: -f1 | sed -n 3p)
[ -n "$n_r1if2" ] && [ -n "$n_dk" ] && [ -n "$n_resize" ] && [ "$n_dk" -lt "$n_r1if2" ] && [ "$n_r1if2" -lt "$n_resize" ] \
    && ok "dev-kit DTB fixups only on R1" || bad "the fdt fixups must be inside an r1 check after the dev-kit DTB load"

# R1 Ethernet opt-in: Ethernet stays off on R1 (finding 3) unless a board whose
# Ethernet I/O voltages were reworked to match sets ecofleet_eth=1. Then, on the
# R1 DTB only, the FEC is switched on and the reset hog dropped so the FEC
# driver can release the PHY. Unset or any other value = off.
n_eth=$(line 'if test "${ecofleet_eth}" = "1"')
n_eon=$(line 'fdt set /soc@0/bus@30800000/ethernet@30be0000 status okay')
n_ehog=$(line 'fdt rm /soc@0/bus@30000000/gpio@30230000/eth-rst-hog')
n_eresize=$(echo "$code" | grep -n -F 'fdt resize' | cut -d: -f1 | awk -v a="$n_eth" '$1 > a' | head -1)
[ -n "$n_eth" ] && ok "Ethernet opt-in gated on ecofleet_eth = 1" || bad "no ecofleet_eth = 1 gate"
[ -n "$n_r1" ] && [ -n "$n_eth" ] && [ -n "$n_dk" ] && [ "$n_r1" -lt "$n_eth" ] && [ "$n_eth" -lt "$n_dk" ] \
    && ok "Ethernet opt-in only after the R1 DTB loads, not on the dev-kit DTB" || bad "the ecofleet_eth block must sit between the R1 DTB load and the dev-kit DTB load"
[ -n "$n_eon" ] && [ -n "$n_ehog" ] && [ -n "$n_eresize" ] && [ "$n_eth" -lt "$n_eresize" ] && [ "$n_eresize" -lt "$n_eon" ] && [ "$n_eresize" -lt "$n_ehog" ] \
    && [ "$n_eon" -lt "$n_dk" ] && [ "$n_ehog" -lt "$n_dk" ] \
    && ok "opt-in: fdt resize, FEC on, eth-rst-hog removed" || bad "opt-in must fdt resize, set the FEC okay and rm eth-rst-hog inside the ecofleet_eth block"
[ "$(echo "$code" | grep -c -F 'ethernet@30be0000 status okay')" = 1 ] && ok "FEC switched on in one place only" || bad "FEC status okay must appear exactly once"

grep -q "freescale/$R1_DTB" "$ROOT/meta-ecofleet/recipes-kernel/linux/linux-variscite-fslc-imx_%.bbappend" 2>/dev/null \
    && ok "kernel bbappend builds $R1_DTB" || bad "kernel bbappend does not build $R1_DTB"
grep -q "\$DEPLOY/$R1_DTB" "$ROOT/.github/workflows/build.yml" \
    && ok "CI stages $R1_DTB" || bad "build.yml does not stage $R1_DTB"

[ $fail = 0 ] && echo PASS || { echo FAILED; exit 1; }
