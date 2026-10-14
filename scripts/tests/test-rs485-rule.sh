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
