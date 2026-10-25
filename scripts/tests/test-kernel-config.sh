#!/bin/sh
# Static checks for the kernel config fragments in the linux bbappend.
# - R1 touch (ILI2132A on I2C2): the ilitek_ts driver is a module, not built in.
#   Built in, it probes about 0.3 s into boot, the controller NACKs (-6) and the
#   driver never retries, so touch never comes up. As a module, udev loads it
#   from the DT compatible a few seconds later. Variscite's imx8_var_defconfig
#   has CONFIG_TOUCHSCREEN_ILITEK=y; meta-freescale's linux-imx.inc inherits
#   kernel-yocto, which merges .cfg fragments from SRC_URI over it.
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
D=$ROOT/meta-ecofleet/recipes-kernel/linux
BBAPPEND=$D/linux-variscite-fslc-imx_%.bbappend
CFG=ilitek-touch-module.cfg
fail=0
ok()  { echo "ok   - $1"; }
bad() { echo "FAIL - $1"; fail=1; }

[ -f "$D/files/$CFG" ] && ok "$CFG exists" || bad "missing files/$CFG"
grep -qx 'CONFIG_TOUCHSCREEN_ILITEK=m' "$D/files/$CFG" 2>/dev/null \
    && ok "ilitek_ts built as a module" || bad "$CFG must set CONFIG_TOUCHSCREEN_ILITEK=m"
grep -q "file://$CFG" "$BBAPPEND" && ok "bbappend adds $CFG to SRC_URI" || bad "bbappend SRC_URI lacks file://$CFG"

[ $fail = 0 ] && echo PASS || { echo FAILED; exit 1; }
