SUMMARY = "EcoFleet Gobi APU telemetry agent"
DESCRIPTION = "Reads Modbus registers from the Gobi APU, publishes to AWS IoT Core \
over MQTT/TLS, buffers to SQLite when offline, and manages Device Shadow."
LICENSE = "CLOSED"

# ── Source files from recipe files/ dir ───────────────────────────────────────
SRC_URI = " \
    file://main.c \
    file://shadow.c \
    file://shadow.h \
    file://config.h \
    file://CMakeLists.txt \
    file://gobi-agent.service \
    file://gobi-agent.conf \
    file://AmazonRootCA1.pem \
    file://device.crt \
    file://device.key \
    file://unit-serial \
"

S = "${WORKDIR}"

# ── Build deps ────────────────────────────────────────────────────────────────
DEPENDS = "libmodbus mosquitto sqlite3 cjson"

inherit cmake systemd

# ── MQTT_ENDPOINT guard ───────────────────────────────────────────────────────
# Fail the build if MQTT_ENDPOINT is not set in local.conf / kas yaml, or if
# the per-unit files still contain placeholder content.
do_configure:prepend() {
    # MQTT endpoint
    if [ -z "${MQTT_ENDPOINT}" ]; then
        bbfatal "MQTT_ENDPOINT is not set. Add to local.conf: \
EXTRA_OECMAKE:pn-gobi-agent = \"-DMQTT_ENDPOINT=<your-iot-endpoint>\""
    fi

    # device.crt placeholder check
    if grep -q "REPLACE_ME" "${WORKDIR}/device.crt"; then
        bbfatal "device.crt is still the placeholder. \
Run scripts/provision-device.sh <UNIT_ID> first."
    fi

    # device.key placeholder check
    if grep -q "REPLACE_ME" "${WORKDIR}/device.key"; then
        bbfatal "device.key is still the placeholder. \
Run scripts/provision-device.sh <UNIT_ID> first."
    fi

    # unit-serial placeholder check
    if grep -q "TRUCK-XXX" "${WORKDIR}/unit-serial"; then
        bbfatal "unit-serial is still TRUCK-XXX. \
Copy the real serial into meta-ecofleet/recipes-ecofleet/gobi-agent/files/unit-serial"
    fi
}

# ── Pass MQTT_ENDPOINT and FIRMWARE_VERSION to cmake ─────────────────────────
EXTRA_OECMAKE += "-DMQTT_ENDPOINT=${MQTT_ENDPOINT}"
EXTRA_OECMAKE += "-DFIRMWARE_VERSION=${PV}"

# ── Install files ─────────────────────────────────────────────────────────────
do_install:append() {
    # Runtime directories
    install -d ${D}${sysconfdir}/ecofleet/certs
    install -d ${D}/var/lib/ecofleet

    # TLS certificates (private key must be 0600)
    install -m 0644 ${WORKDIR}/AmazonRootCA1.pem  ${D}${sysconfdir}/ecofleet/certs/
    install -m 0644 ${WORKDIR}/device.crt          ${D}${sysconfdir}/ecofleet/certs/
    install -m 0600 ${WORKDIR}/device.key          ${D}${sysconfdir}/ecofleet/certs/

    # Unit serial
    install -m 0644 ${WORKDIR}/unit-serial         ${D}${sysconfdir}/ecofleet/

    # Agent config file
    install -m 0644 ${WORKDIR}/gobi-agent.conf     ${D}${sysconfdir}/ecofleet/

    # systemd service
    install -d ${D}${systemd_system_unitdir}
    install -m 0644 ${WORKDIR}/gobi-agent.service  ${D}${systemd_system_unitdir}/
}

# ── systemd integration ───────────────────────────────────────────────────────
SYSTEMD_SERVICE:${PN} = "gobi-agent.service"
SYSTEMD_AUTO_ENABLE:${PN} = "enable"

# ── File permissions QA ───────────────────────────────────────────────────────
# Suppress insane-permissions warning for 0600 key file
INSANE_SKIP:${PN} = "installed-vs-shipped"

FILES:${PN} += " \
    ${sysconfdir}/ecofleet/ \
    /var/lib/ecofleet/ \
    ${systemd_system_unitdir}/gobi-agent.service \
"
