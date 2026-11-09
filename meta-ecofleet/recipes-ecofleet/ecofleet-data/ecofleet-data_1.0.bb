SUMMARY = "EcoFleet shared /data partition mount"
DESCRIPTION = "Mounts the 64 MB 'data' partition (shared by both A/B root \
slots) at /data so data kept there survives OTA updates, and keeps the udev \
automounter off it, the boot partition, both root slots and mmcblk1."
LICENSE = "CLOSED"

SRC_URI = " \
    file://data.mount \
    file://ecofleet-data.ignorelist \
    file://ecofleet-slots.ignorelist \
    file://ecofleet-carrier.ignorelist \
"
S = "${WORKDIR}"

inherit systemd allarch

SYSTEMD_SERVICE:${PN} = "data.mount"
SYSTEMD_AUTO_ENABLE:${PN} = "enable"

do_install() {
    install -d ${D}${systemd_system_unitdir}
    install -m 0644 ${WORKDIR}/data.mount ${D}${systemd_system_unitdir}/data.mount
    install -D -m 0644 ${WORKDIR}/ecofleet-data.ignorelist \
        ${D}${sysconfdir}/udev/mount.ignorelist.d/ecofleet-data
    install -m 0644 ${WORKDIR}/ecofleet-slots.ignorelist \
        ${D}${sysconfdir}/udev/mount.ignorelist.d/ecofleet-slots
    install -m 0644 ${WORKDIR}/ecofleet-carrier.ignorelist \
        ${D}${sysconfdir}/udev/mount.ignorelist.d/ecofleet-carrier
    install -d ${D}/data
}

FILES:${PN} = " \
    ${systemd_system_unitdir}/data.mount \
    ${sysconfdir}/udev/mount.ignorelist.d/ecofleet-data \
    ${sysconfdir}/udev/mount.ignorelist.d/ecofleet-slots \
    ${sysconfdir}/udev/mount.ignorelist.d/ecofleet-carrier \
    /data \
"
