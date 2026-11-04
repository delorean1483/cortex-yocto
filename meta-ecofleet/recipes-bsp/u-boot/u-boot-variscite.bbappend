# Variscite's recipe is u-boot-variscite.bb (no version in the file name), so
# this append must keep exactly this name: a u-boot-variscite_%.bbappend never
# applies to it. (/etc/fw_env.config comes from Variscite's own recipe.)
FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

# Keyed autoboot (merged into the u-boot .config by u-boot-configure.inc)
SRC_URI += "file://ecofleet-autoboot.cfg"

# U-Boot console on R1's USB-C port too (CDC ACM), from board_late_init on.
# 0001/0002 are upstream f_acm fixes (U-Boot 2025.07); 0003 keeps the console
# from hanging without a host; 0004 is the R1-only board hook.
# Host check: scripts/tests/test-uboot-usb-console.sh
SRC_URI += " \
    file://ecofleet-usb-console.cfg \
    file://0001-usb-gadget-f_acm-Claim-requested-USB-endpoints.patch \
    file://0002-usb-gadget-f_acm-Allow-restarting-ACM-console-after-.patch \
    file://0003-usb-gadget-f_acm-never-hang-the-console-without-a-ho.patch \
    file://0004-imx8mm_var_dart-EcoFleet-R1-U-Boot-console-on-the-US.patch \
"
