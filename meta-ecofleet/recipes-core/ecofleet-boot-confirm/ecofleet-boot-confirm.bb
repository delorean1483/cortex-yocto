SUMMARY = "Confirms A/B boot health and clears the u-boot rollback trial"
LICENSE = "CLOSED"

SRC_URI = " \
    file://ecofleet-boot-confirm.sh \
    file://ecofleet-boot-confirm.service \
"

S = "${WORKDIR}"

inherit systemd

RDEPENDS:${PN} += "libubootenv-bin"

SYSTEMD_SERVICE:${PN} = "ecofleet-boot-confirm.service"
SYSTEMD_AUTO_ENABLE:${PN} = "enable"

do_install() {
    install -d ${D}${bindir}
    install -m 0755 ${WORKDIR}/ecofleet-boot-confirm.sh ${D}${bindir}/ecofleet-boot-confirm.sh
    install -d ${D}${systemd_system_unitdir}
    install -m 0644 ${WORKDIR}/ecofleet-boot-confirm.service ${D}${systemd_system_unitdir}/
}

FILES:${PN} = " \
    ${bindir}/ecofleet-boot-confirm.sh \
    ${systemd_system_unitdir}/ecofleet-boot-confirm.service \
"
