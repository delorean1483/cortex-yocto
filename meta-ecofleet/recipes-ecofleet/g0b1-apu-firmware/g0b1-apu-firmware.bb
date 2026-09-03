SUMMARY = "EcoFleet g0b1/APU STM32 firmware images (A/B slots) for RS-485 remote update"
LICENSE = "CLOSED"

SRC_URI = " \
    file://g0b1-apu-1.1.0-slotA.bin \
    file://g0b1-apu-1.1.0-slotB.bin \
    file://manifest.json \
"
S = "${WORKDIR}"

do_install() {
    install -d ${D}/lib/firmware/g0b1-apu
    install -m 0644 ${WORKDIR}/g0b1-apu-1.1.0-slotA.bin ${D}/lib/firmware/g0b1-apu/
    install -m 0644 ${WORKDIR}/g0b1-apu-1.1.0-slotB.bin ${D}/lib/firmware/g0b1-apu/
    install -m 0644 ${WORKDIR}/manifest.json            ${D}/lib/firmware/g0b1-apu/
}

FILES:${PN} = "/lib/firmware/g0b1-apu"
