SUMMARY = "EcoFleet Gobi APU touchscreen dashboard"
LICENSE = "CLOSED"
PR = "r1"

SRC_URI = " \
    file://CMakeLists.txt \
    file://main.cpp \
    file://TelemetryModel.h \
    file://TelemetryModel.cpp \
    file://DeviceInfoModel.h \
    file://DeviceInfoModel.cpp \
    file://qml/main.qml \
    file://qml/DashboardPage.qml \
    file://qml/DiagnosticsPage.qml \
    file://qml/DevicePage.qml \
    file://gobi-ui.service \
    file://ecofleet_logo.png \
    file://ecofleet_logo_topbar.png \
"

S = "${WORKDIR}"

DEPENDS = "qtbase qtbase-native qtdeclarative qtdeclarative-native qtshadertools qtwayland sqlite3"

# Qt6 CMake cross-compilation requires QT_HOST_PATH pointing at the native
# (build-machine) Qt6 installation that provides moc, rcc, qmltyperegistrar, etc.
EXTRA_OECMAKE += "-DQT_HOST_PATH=${STAGING_DIR_NATIVE}/usr"

inherit cmake systemd

# ── systemd integration ───────────────────────────────────────────────────────
SYSTEMD_SERVICE:${PN} = "gobi-ui.service"
SYSTEMD_AUTO_ENABLE:${PN} = "enable"

do_install:append() {
    install -d ${D}${systemd_system_unitdir}
    install -m 0644 ${WORKDIR}/gobi-ui.service ${D}${systemd_system_unitdir}/

    install -d ${D}${datadir}/gobi-ui/qml
    install -m 0644 ${WORKDIR}/qml/main.qml            ${D}${datadir}/gobi-ui/qml/
    install -m 0644 ${WORKDIR}/qml/DashboardPage.qml   ${D}${datadir}/gobi-ui/qml/
    install -m 0644 ${WORKDIR}/qml/DiagnosticsPage.qml ${D}${datadir}/gobi-ui/qml/
    install -m 0644 ${WORKDIR}/qml/DevicePage.qml      ${D}${datadir}/gobi-ui/qml/
    install -m 0644 ${WORKDIR}/ecofleet_logo.png        ${D}${datadir}/gobi-ui/
    install -m 0644 ${WORKDIR}/ecofleet_logo_topbar.png ${D}${datadir}/gobi-ui/
}

FILES:${PN} += " \
    ${systemd_system_unitdir}/gobi-ui.service \
    ${datadir}/gobi-ui/ \
"

# ── Qt runtime plugins needed at runtime (not link-time deps) ─────────────────
RDEPENDS:${PN} += "qtwayland qtbase-plugins"
