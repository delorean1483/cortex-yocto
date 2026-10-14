SUMMARY = "Login console on the EF-MX8MM USB-C port"
DESCRIPTION = "A CDC ACM USB serial device on usbotg1, the USB-C port used for \
programming, with a login on ttyGS0. R1's UART1 is shared with the Ezurio \
module, so this is the console once Linux is up. R1 only (the unit checks the \
device tree); the kernel already has the configfs ACM function built in."
LICENSE = "CLOSED"

SRC_URI = " \
    file://ecofleet-usb-console \
    file://ecofleet-usb-console.service \
"
S = "${WORKDIR}"

inherit systemd allarch

SYSTEMD_SERVICE:${PN} = "ecofleet-usb-console.service"
SYSTEMD_AUTO_ENABLE:${PN} = "enable"

do_install() {
    install -D -m 0755 ${WORKDIR}/ecofleet-usb-console ${D}${sbindir}/ecofleet-usb-console
    install -d ${D}${systemd_system_unitdir}
    install -m 0644 ${WORKDIR}/ecofleet-usb-console.service ${D}${systemd_system_unitdir}/
}

FILES:${PN} = " \
    ${sbindir}/ecofleet-usb-console \
    ${systemd_system_unitdir}/ecofleet-usb-console.service \
"
