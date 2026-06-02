#!/bin/sh
# Determine which partition is currently inactive and create a symlink so
# sw-description can reference it as /dev/swupdate-inactive.
#
# Partition map:  mmcblk2p1 = rootfs-a,  mmcblk2p2 = rootfs-b
# u-boot env var: slot_active = "a" | "b"

set -e

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
