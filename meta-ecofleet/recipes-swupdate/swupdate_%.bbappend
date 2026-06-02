FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

SRC_URI += "file://swupdate.cfg"

do_install:append() {
    install -d ${D}${sysconfdir}
    install -m 0644 ${WORKDIR}/swupdate.cfg ${D}${sysconfdir}/swupdate.cfg
}

FILES:${PN} += "${sysconfdir}/swupdate.cfg"
