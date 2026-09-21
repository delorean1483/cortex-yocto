SUMMARY = "EcoFleet g0b1/APU STM32 firmware images (A/B slots) for RS-485 remote update"
LICENSE = "CLOSED"

SRC_URI = " \
    file://g0b1-apu-1.1.2-slotA.bin \
    file://g0b1-apu-1.1.2-slotB.bin \
    file://manifest.json \
"
S = "${WORKDIR}"

# Install under ${nonarch_base_libdir} (arch-independent /lib), NOT a literal
# /lib: this distro enables the usrmerge feature, so ${nonarch_base_libdir}
# resolves to /usr/lib and a hardcoded /lib fails do_package_qa [usrmerge].
# The agent reads G0B1_FW_DIR="/lib/firmware/g0b1-apu" (config.h), which still
# resolves here via the usrmerge /lib -> usr/lib symlink.
do_install() {
    install -d ${D}${nonarch_base_libdir}/firmware/g0b1-apu
    install -m 0644 ${WORKDIR}/g0b1-apu-1.1.2-slotA.bin ${D}${nonarch_base_libdir}/firmware/g0b1-apu/
    install -m 0644 ${WORKDIR}/g0b1-apu-1.1.2-slotB.bin ${D}${nonarch_base_libdir}/firmware/g0b1-apu/
    install -m 0644 ${WORKDIR}/manifest.json            ${D}${nonarch_base_libdir}/firmware/g0b1-apu/
}

FILES:${PN} = "${nonarch_base_libdir}/firmware/g0b1-apu"
