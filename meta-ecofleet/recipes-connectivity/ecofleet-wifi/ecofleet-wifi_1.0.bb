SUMMARY = "EcoFleet WiFi setup for the DART-MX8M-MINI IW612"
DESCRIPTION = "WiFi + Bluetooth on the SoM's IW612, made safe. The driver is \
never unloaded, wpa_supplicant always runs with its config on /data/wifi, and \
Bluetooth starts only when the kernel console is off the BT UART (the cause of \
the 2026-09-30 hangs). BT audio and OBEX file transfer stay masked."
LICENSE = "CLOSED"

SRC_URI = " \
    file://25-wlan0.network \
    file://ecofleet-wifi-init \
    file://wpa_supplicant-wlan0.conf \
    file://variscite-wifi-nostop.conf \
    file://variscite-bt-guard.conf \
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

    install -D -m 0644 ${WORKDIR}/variscite-bt-guard.conf \
        $unitdir/variscite-bt.service.d/ecofleet.conf

    # BT audio and OBEX are not used. obexd runs with -a (auto-accept incoming
    # files), so keep it off.
    for u in bluealsa.service bluealsa-aplay.service obex.service; do
        ln -sf /dev/null $unitdir/$u
    done
}

FILES:${PN} = " \
    ${sbindir}/ecofleet-wifi-init \
    ${sysconfdir}/systemd/network/25-wlan0.network \
    ${sysconfdir}/systemd/system \
"
