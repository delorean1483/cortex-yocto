SUMMARY = "EcoFleet stable u-boot boot script (eMMC boot partition)"
DESCRIPTION = "Builds boot.scr and deploys it as ecofleet-boot.scr for the wic \
'boot' partition (p1). Nothing is installed into the root filesystem: the \
script lives outside both A/B slots so an update can never rewrite it."
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = "file://ecofleet-boot.cmd"

inherit deploy nopackages

DEPENDS = "u-boot-mkimage-native"

do_compile() {
    mkimage -A arm64 -O linux -T script -C none \
        -n "EcoFleet boot script" \
        -d ${WORKDIR}/ecofleet-boot.cmd \
        ${WORKDIR}/boot.scr
}

do_deploy() {
    install -m 0644 ${WORKDIR}/boot.scr ${DEPLOYDIR}/ecofleet-boot.scr
}
addtask deploy after do_compile before do_build
