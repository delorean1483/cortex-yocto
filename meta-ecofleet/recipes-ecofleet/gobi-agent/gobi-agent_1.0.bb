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
    file://heater_fields.h \
    file://heater_fields.c \
    file://apu_command.h \
    file://apu_command.c \
    file://weather.h \
    file://weather.c \
    file://weather-fetch.c \
    file://bl_crc32.c \
    file://bl_crc32.h \
    file://bl_frame.c \
    file://bl_frame.h \
    file://bl_proto.h \
    file://bl_session.c \
    file://bl_session.h \
    file://stm32_update.c \
    file://stm32_update.h \
    file://bl_transport_serial.c \
    file://bl_transport_serial.h \
    file://stm32_flash_task.c \
    file://stm32_flash_task.h \
    file://CMakeLists.txt \
    file://gobi-ota-apply \
    file://gobi-cold-reboot \
    file://gobi-agent.sudoers \
    file://gobi-agent.service \
    file://weather-fetch.service \
    file://weather-fetch.timer \
    file://gobi-agent.conf \
    file://AmazonRootCA1.pem \
    file://device.crt \
    file://device.key \
    file://unit-serial \
"

S = "${WORKDIR}"

# ── Build deps ────────────────────────────────────────────────────────────────
DEPENDS = "libmodbus mosquitto sqlite3 cjson curl"

# ── Runtime deps ──────────────────────────────────────────────────────────────
# weather-fetch does TLS to Open-Meteo; ca-certificates supplies the trust store
# (only Amazon's root ships for MQTT, which won't validate a public API host).
# sudo: the non-root agent applies OTA via the gobi-ota-apply root helper.
# i2c-tools: gobi-cold-reboot uses i2cset to command the BD71847 PMIC cold reset
# (a normal reboot hangs this board before U-Boot SPL).
RDEPENDS:${PN} += "ca-certificates sudo i2c-tools"

inherit cmake systemd useradd

# ── System user ───────────────────────────────────────────────────────────────
USERADD_PACKAGES = "${PN}"
USERADD_PARAM:${PN} = "-r -s /sbin/nologin -d /var/lib/ecofleet -G dialout ecofleet"

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
    # Runtime directories (owned by ecofleet user)
    install -d -o ecofleet -g ecofleet ${D}${sysconfdir}/ecofleet/certs
    install -d -o ecofleet -g ecofleet ${D}/var/lib/ecofleet

    # TLS certificates (private key must be 0600)
    install -m 0644 -o ecofleet -g ecofleet ${WORKDIR}/AmazonRootCA1.pem  ${D}${sysconfdir}/ecofleet/certs/
    install -m 0644 -o ecofleet -g ecofleet ${WORKDIR}/device.crt          ${D}${sysconfdir}/ecofleet/certs/
    install -m 0600 -o ecofleet -g ecofleet ${WORKDIR}/device.key          ${D}${sysconfdir}/ecofleet/certs/

    # Unit serial
    install -m 0644 -o ecofleet -g ecofleet ${WORKDIR}/unit-serial         ${D}${sysconfdir}/ecofleet/

    # Agent config file
    install -m 0644 -o ecofleet -g ecofleet ${WORKDIR}/gobi-agent.conf     ${D}${sysconfdir}/ecofleet/

    # systemd units
    install -d ${D}${systemd_system_unitdir}
    install -m 0644 ${WORKDIR}/gobi-agent.service      ${D}${systemd_system_unitdir}/
    install -m 0644 ${WORKDIR}/weather-fetch.service   ${D}${systemd_system_unitdir}/
    install -m 0644 ${WORKDIR}/weather-fetch.timer     ${D}${systemd_system_unitdir}/

    # OTA root helper + its sudoers grant (agent runs as unprivileged ecofleet;
    # swupdate + reboot need root). sudoers.d files must be 0440 root:root.
    install -d ${D}${sbindir}
    install -m 0755 ${WORKDIR}/gobi-ota-apply          ${D}${sbindir}/gobi-ota-apply
    # PMIC-cold-reset reboot helper (a normal reboot hangs this board before SPL);
    # gobi-ota-apply calls it instead of `reboot`.
    install -m 0755 ${WORKDIR}/gobi-cold-reboot        ${D}${sbindir}/gobi-cold-reboot
    # /etc/sudoers.d is co-owned with the sudo package, which ships it 0750
    # root:root — match that mode exactly or do_rootfs hits a file conflict
    # ("/etc/sudoers.d conflicts between gobi-agent and sudo-lib").
    install -d -m 0750 ${D}${sysconfdir}/sudoers.d
    install -m 0440 ${WORKDIR}/gobi-agent.sudoers      ${D}${sysconfdir}/sudoers.d/gobi-agent
}

# ── systemd integration ───────────────────────────────────────────────────────
# Enable the agent and the weather timer; weather-fetch.service is oneshot and
# started by the timer, so it is installed but not enabled on its own.
SYSTEMD_SERVICE:${PN} = "gobi-agent.service weather-fetch.timer"
SYSTEMD_AUTO_ENABLE:${PN} = "enable"

# ── File permissions QA ───────────────────────────────────────────────────────
# Suppress insane-permissions warning for 0600 key file
INSANE_SKIP:${PN} = "installed-vs-shipped"

FILES:${PN} += " \
    ${sysconfdir}/ecofleet/ \
    /var/lib/ecofleet/ \
    ${sbindir}/gobi-ota-apply \
    ${sbindir}/gobi-cold-reboot \
    ${sysconfdir}/sudoers.d/gobi-agent \
    ${systemd_system_unitdir}/gobi-agent.service \
    ${systemd_system_unitdir}/weather-fetch.service \
    ${systemd_system_unitdir}/weather-fetch.timer \
"
