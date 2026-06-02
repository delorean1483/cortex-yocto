#!/bin/sh
# After a successful rootfs write, commit the slot switch in u-boot env.
# On next reboot, boot.scr will load from the newly written partition.

set -e

NEXT_SLOT=$(cat /tmp/next-slot)
if [ -z "$NEXT_SLOT" ]; then
    echo "post-install: /tmp/next-slot missing — aborting slot switch" >&2
    exit 1
fi

fw_setenv slot_active "$NEXT_SLOT"
echo "post-install: slot_active set to '${NEXT_SLOT}' — reboot to activate"
