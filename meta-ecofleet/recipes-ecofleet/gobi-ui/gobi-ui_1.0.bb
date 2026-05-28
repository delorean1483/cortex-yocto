SUMMARY = "EcoFleet Gobi APU touchscreen dashboard"
LICENSE = "CLOSED"

SRC_URI = " \
    file://CMakeLists.txt \
    file://main.cpp \
    file://TelemetryModel.h \
    file://TelemetryModel.cpp \
    file://qml/main.qml \
    file://qml/DashboardPage.qml \
    file://qml/DiagnosticsPage.qml \
    file://gobi-ui.service \
"

S = "${WORKDIR}"

DEPENDS = "qtbase qtdeclarative qtshadertools qtwayland sqlite3"

inherit cmake systemd

# ── systemd integration ───────────────────────────────────────────────────────
SYSTEMD_SERVICE:${PN} = "gobi-ui.service"
SYSTEMD_AUTO_ENABLE:${PN} = "enable"

do_install:append() {
    install -d ${D}${systemd_system_unitdir}
    install -m 0644 ${WORKDIR}/gobi-ui.service ${D}${systemd_system_unitdir}/
}

FILES:${PN} += "${systemd_system_unitdir}/gobi-ui.service"

# ── Qt runtime plugins needed at runtime (not link-time deps) ─────────────────
RDEPENDS:${PN} += "qtwayland qtbase-plugins"
