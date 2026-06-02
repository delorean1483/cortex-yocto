SUMMARY = "EcoFleet A/B slot u-boot boot script"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = "file://ecofleet-boot.cmd"

inherit deploy

DEPENDS = "u-boot-mkimage-native"

do_compile() {
    mkimage -A arm64 -O linux -T script -C none \
        -n "EcoFleet boot script" \
        -d ${WORKDIR}/ecofleet-boot.cmd \
        ${WORKDIR}/boot.scr
}

do_install() {
    install -d ${D}/boot
    install -m 0644 ${WORKDIR}/boot.scr ${D}/boot/boot.scr
}

FILES:${PN} = "/boot/boot.scr"
