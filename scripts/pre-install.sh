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

# Refuse anything that isn't a root slot. On the old layout (p1/p2 slots,
# p3 data) "the inactive slot" of a unit on slot a would be /data. Slots carry
# no label once written, so check the size: 1700 MiB = 3481600 sectors.
SYS_BLOCK=${ECOFLEET_SYS_BLOCK:-/sys/class/block}
SECTORS=$(cat "$SYS_BLOCK/$(basename "$INACTIVE_DEV")/size" 2>/dev/null || echo 0)
if [ "$SECTORS" != 3481600 ]; then
    echo "pre-install: ${INACTIVE_DEV} is ${SECTORS} sectors, not a 1700 MiB root slot — wrong partition layout, refusing to install" >&2
    exit 1
fi

echo "pre-install: active slot=${ACTIVE}, writing to ${INACTIVE_DEV} (slot ${NEXT_SLOT})"

ln -sf "$INACTIVE_DEV" /dev/swupdate-inactive
echo "$NEXT_SLOT" > /tmp/next-slot
