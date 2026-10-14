# Variscite's recipe is u-boot-variscite.bb (no version in the file name), so
# this append must keep exactly this name: a u-boot-variscite_%.bbappend never
# applies to it. (/etc/fw_env.config comes from Variscite's own recipe.)
FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

# Keyed autoboot (merged into the u-boot .config by u-boot-configure.inc)
SRC_URI += "file://ecofleet-autoboot.cfg"
