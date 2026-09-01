#!/bin/sh
# Determine which partition is currently inactive and create a symlink so
# sw-description can reference it as /dev/swupdate-inactive.
#
# Partition map:  mmcblk2p1 = rootfs-a,  mmcblk2p2 = rootfs-b
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
    INACTIVE_DEV=/dev/mmcblk2p2
    NEXT_SLOT=b
else
    INACTIVE_DEV=/dev/mmcblk2p1
    NEXT_SLOT=a
fi

echo "pre-install: active slot=${ACTIVE}, writing to ${INACTIVE_DEV} (slot ${NEXT_SLOT})"

ln -sf "$INACTIVE_DEV" /dev/swupdate-inactive
echo "$NEXT_SLOT" > /tmp/next-slot
