#!/bin/sh
# After a successful rootfs write, commit the slot switch in u-boot env.
# On next reboot, boot.scr will load from the newly written partition.

set -e

# swupdate runs this "shellscript" in BOTH phases (phase in $1). Commit the slot
# switch ONLY in post-install, after the image is written. If it also ran in
# preinst it would flip slot_active before the write, and pre-install's second
# (postinst) run would then rewrite /tmp/next-slot so this reverts slot_active —
# leaving the device on the OLD slot, so the OTA never activates. (The
# sw-description "execute-after-update" property does NOT gate this.)
[ "$1" = postinst ] || exit 0

NEXT_SLOT=$(cat /tmp/next-slot)
if [ -z "$NEXT_SLOT" ]; then
    echo "post-install: /tmp/next-slot missing — aborting slot switch" >&2
    exit 1
fi

fw_setenv slot_active "$NEXT_SLOT"
# Arm the boot trial: the bootloader will count attempts on the new slot and roll
# back if it never confirms healthy (see ecofleet-boot.cmd + ecofleet-boot-confirm).
fw_setenv upgrade_available 1
fw_setenv bootcount 0
echo "post-install: slot_active set to '${NEXT_SLOT}', boot trial armed (upgrade_available=1)"
