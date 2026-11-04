#!/bin/sh
# udev's automounter (/etc/udev/scripts/mount.sh) mounts any partition it isn't
# told to ignore under /run/media, read-write. It must stay off the SoM eMMC's
# boot/slot/data partitions (mmcblk2p1-p4) and off mmcblk1: on R1 that is the
# carrier eMMC (the future recovery image), on the dev kit the SD card. Each
# ignore-list line is an `expr match` prefix of the device node (tested here
# with the portable `expr STRING : REGEX`, the same anchored match).
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
R=$ROOT/meta-ecofleet/recipes-ecofleet/ecofleet-data
fail=0
ok()  { echo "ok   - $1"; }
bad() { echo "FAIL - $1"; fail=1; }

# Lines (non-comment) of every ignore list the recipe installs.
lists=$(sed -n 's#.*\${WORKDIR}/\([^ ]*\.ignorelist\).*#\1#p' "$R/ecofleet-data_1.0.bb")
[ -n "$lists" ] && ok "recipe installs ignore lists: $(echo $lists)" || bad "recipe installs no ignore list"
lines=$(for f in $lists; do grep -v '^[[:space:]]*#' "$R/files/$f"; done)

for dev in /dev/mmcblk2p1 /dev/mmcblk2p2 /dev/mmcblk2p3 /dev/mmcblk2p4 /dev/mmcblk1p1 /dev/mmcblk1p4; do
    hit=""
    for l in $lines; do
        [ "$(expr "$dev" : "$l")" -gt 0 ] && hit=$l && break
    done
    [ -n "$hit" ] && ok "$dev ignored (by $hit)" || bad "$dev would be automounted"
done

for f in $lists; do
    grep -q "file://$f" "$R/ecofleet-data_1.0.bb" && ok "$f in SRC_URI" || bad "$f missing from SRC_URI"
    grep -q "mount.ignorelist.d/$(basename "$f" .ignorelist)" "$R/ecofleet-data_1.0.bb" && ok "$f packaged" || bad "$f not in FILES"
done

[ $fail = 0 ] && echo PASS || { echo FAILED; exit 1; }
