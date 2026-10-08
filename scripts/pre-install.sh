#!/bin/sh
# Determine which partition is currently inactive and create a symlink so
# sw-description can reference it as /dev/swupdate-inactive.
#
# Partition map:  mmcblk2p1 = boot (never written here), mmcblk2p2 = rootfs-a,
#                 mmcblk2p3 = rootfs-b, mmcblk2p4 = data
# u-boot env var: slot_active = "a" | "b"

set -e

# swupdate runs a "shellscript" in BOTH the pre- and post-install phases,
# passing the phase name as $1 ("preinst" | "postinst"). This script must act
# ONLY in pre-install — it points /dev/swupdate-inactive at the slot the image
# is about to be written to. If it also ran in postinst it would re-evaluate
# against the already-flipped slot_active and mis-target the next OTA. (The
# sw-description "execute-before-update" property does NOT gate this.)
[ "$1" = preinst ] || exit 0

ACTIVE=$(fw_printenv -n slot_active 2>/dev/null || echo "a")

if [ "$ACTIVE" = "a" ]; then
    INACTIVE_DEV=/dev/mmcblk2p3
    NEXT_SLOT=b
else
    INACTIVE_DEV=/dev/mmcblk2p2
    NEXT_SLOT=a
fi

refuse() { echo "pre-install: $* — refusing to install" >&2; exit 1; }
sectors() { cat "$SYS_BLOCK/$1/size" 2>/dev/null || echo 0; }

# Only ever write a root slot of the current layout. On the old layout (p1/p2
# slots, p3 data) the mapping above would hit /data (slot a) or the RUNNING root
# (slot b, old p2 is slot-sized too), so check the whole layout: p1 is the 32 MiB
# boot partition and p4 exists. Slots carry no label once written, so sizes it is.
SYS_BLOCK=${ECOFLEET_SYS_BLOCK:-/sys/class/block}
[ "$(sectors mmcblk2p1)" = 65536 ] && [ -e "$SYS_BLOCK/mmcblk2p4" ] || \
    refuse "not the boot/rootfs-a/rootfs-b/data layout (p1 is $(sectors mmcblk2p1) sectors)"
[ "$(sectors "$(basename "$INACTIVE_DEV")")" = 3481600 ] || \
    refuse "${INACTIVE_DEV} is not a 1700 MiB root slot"

# Never write the partition we are running from, whatever slot_active says
# (e.g. a fresh or reset u-boot env reading "a" on a unit booted from p3).
ROOT_DEV=$(sed -n 's/.*root=\([^ ]*\).*/\1/p' "${ECOFLEET_PROC_CMDLINE:-/proc/cmdline}")
[ "$ROOT_DEV" != "$INACTIVE_DEV" ] || \
    refuse "${INACTIVE_DEV} is the running root (slot_active=${ACTIVE} disagrees with root=${ROOT_DEV})"

echo "pre-install: active slot=${ACTIVE}, writing to ${INACTIVE_DEV} (slot ${NEXT_SLOT})"

ln -sf "$INACTIVE_DEV" /dev/swupdate-inactive
echo "$NEXT_SLOT" > /tmp/next-slot
