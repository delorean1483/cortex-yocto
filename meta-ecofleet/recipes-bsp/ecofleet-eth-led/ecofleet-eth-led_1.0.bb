SUMMARY = "EF-MX8MM Ethernet link LED: green at 1000 Mb/s, orange at 10/100"
DESCRIPTION = "udev rule that points the kernel netdev LED trigger of the \
device tree's eth-speed LED (JK4 colour select, ETH_LNK_MD) at eth0, lit at \
10/100 only. Needs CONFIG_LEDS_TRIGGER_NETDEV (linux bbappend fragment)."
LICENSE = "CLOSED"

SRC_URI = "file://99-ecofleet-eth-led.rules"
S = "${WORKDIR}"

inherit allarch

do_install() {
    install -D -m 0644 ${WORKDIR}/99-ecofleet-eth-led.rules \
        ${D}${nonarch_base_libdir}/udev/rules.d/99-ecofleet-eth-led.rules
}

FILES:${PN} = "${nonarch_base_libdir}/udev/rules.d/99-ecofleet-eth-led.rules"
