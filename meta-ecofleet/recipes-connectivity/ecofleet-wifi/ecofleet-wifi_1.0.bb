SUMMARY = "EcoFleet WiFi setup for the DART-MX8M-MINI IW612"
DESCRIPTION = "WiFi on the SoM's IW612, made safe. Bluetooth (same chip) is \
masked: with it running, the board hard-hangs within seconds of WiFi \
associating; with it off WiFi passed 150/150 reconnect cycles (bench \
2026-09-30). The driver is never unloaded, and wpa_supplicant always runs \
with its config on /data/wifi."
LICENSE = "CLOSED"

SRC_URI = " \
    file://25-wlan0.network \
    file://ecofleet-wifi-init \
    file://wpa_supplicant-wlan0.conf \
    file://variscite-wifi-nostop.conf \
"
S = "${WORKDIR}"

inherit allarch

RDEPENDS:${PN} = "wpa-supplicant"

do_install() {
    install -D -m 0644 ${WORKDIR}/25-wlan0.network \
        ${D}${sysconfdir}/systemd/network/25-wlan0.network

    install -D -m 0755 ${WORKDIR}/ecofleet-wifi-init ${D}${sbindir}/ecofleet-wifi-init

    unitdir=${D}${sysconfdir}/systemd/system
    install -D -m 0644 ${WORKDIR}/wpa_supplicant-wlan0.conf \
        $unitdir/wpa_supplicant@wlan0.service.d/ecofleet.conf
    install -D -m 0644 ${WORKDIR}/variscite-wifi-nostop.conf \
        $unitdir/variscite-wifi.service.d/ecofleet.conf

    # Start WiFi at boot; the drop-in above waits for /data and runs
    # ecofleet-wifi-init first so a usable config always exists.
    install -d $unitdir/multi-user.target.wants
    ln -sf ${systemd_system_unitdir}/wpa_supplicant@.service \
        $unitdir/multi-user.target.wants/wpa_supplicant@wlan0.service

    # Bluetooth off: masking variscite-bt also skips its BT_EN pulse and the
    # BT firmware load, the combination that hung the board.
    ln -sf /dev/null $unitdir/variscite-bt.service
    ln -sf /dev/null $unitdir/bluetooth.service
}

FILES:${PN} = " \
    ${sbindir}/ecofleet-wifi-init \
    ${sysconfdir}/systemd/network/25-wlan0.network \
    ${sysconfdir}/systemd/system \
"
