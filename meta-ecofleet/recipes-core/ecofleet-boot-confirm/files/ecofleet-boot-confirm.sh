#!/bin/sh
# EcoFleet A/B boot-health confirm.
# Clears the u-boot rollback trial once this slot has booted healthy, so the
# bootloader won't revert on the next power-cycle. If the apps aren't up, leave
# the trial armed and fail — the guard keeps counting and will eventually roll
# back (see ecofleet-boot.cmd).
set -e

if systemctl is-active --quiet gobi-ui && systemctl is-active --quiet gobi-agent; then
    fw_setenv upgrade_available 0
    fw_setenv bootcount 0
    echo "boot-confirm: slot healthy — cleared boot trial"
else
    echo "boot-confirm: gobi-ui/gobi-agent not active — leaving boot trial armed" >&2
    exit 1
fi
