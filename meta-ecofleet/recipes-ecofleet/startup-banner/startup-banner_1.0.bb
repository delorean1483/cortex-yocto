SUMMARY = "EcoFleet startup banner"
LICENSE = "CLOSED"

SRC_URI = "file://ecofleet-banner"

S = "${WORKDIR}"

do_install() {
    install -d ${D}${bindir}
    install -m 0755 ${WORKDIR}/ecofleet-banner ${D}${bindir}/ecofleet-banner
}
