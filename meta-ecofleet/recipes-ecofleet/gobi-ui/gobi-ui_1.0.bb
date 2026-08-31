SUMMARY = "EcoFleet Gobi APU touchscreen dashboard"
LICENSE = "CLOSED"
PR = "r9"

SRC_URI = " \
    file://CMakeLists.txt \
    file://main.cpp \
    file://TelemetryModel.h \
    file://TelemetryModel.cpp \
    file://DeviceInfoModel.h \
    file://DeviceInfoModel.cpp \
    file://WeatherModel.h \
    file://WeatherModel.cpp \
    file://qml/main.qml \
    file://qml/Theme.qml \
    file://qml/qmldir \
    file://qml/ScaleRoot.qml \
    file://qml/AppShell.qml \
    file://qml/Rail.qml \
    file://qml/Header.qml \
    file://qml/LockController.qml \
    file://qml/LockOverlay.qml \
    file://qml/atoms/StatusPill.qml \
    file://qml/atoms/FaultBanner.qml \
    file://qml/atoms/StatCard.qml \
    file://qml/atoms/Icon.qml \
    file://qml/atoms/ScreenHeader.qml \
    file://qml/atoms/Keypad.qml \
    file://qml/templates/BigNumberScreen.qml \
    file://qml/templates/ChoiceList.qml \
    file://qml/templates/TileGrid.qml \
    file://qml/screens/HomeScreen.qml \
    file://qml/screens/ModeScreen.qml \
    file://qml/screens/BatteryScreen.qml \
    file://qml/screens/MenuScreen.qml \
    file://qml/screens/DiagnosticsScreen.qml \
    file://qml/screens/UserMaintScreen.qml \
    file://qml/screens/UnitInfoScreen.qml \
    file://qml/screens/AlertsScreen.qml \
    file://qml/screens/ErrorLogScreen.qml \
    file://qml/screens/SettingsScreen.qml \
    file://qml/screens/CloudScreen.qml \
    file://qml/screens/ScreenLockScreen.qml \
    file://qml/screens/MaintenanceScreen.qml \
    file://qml/screens/SupportScreen.qml \
    file://qml/WeatherStrip.qml \
    file://qml/WeatherIcon.qml \
    file://gobi-ui.service \
    file://ecofleet_logo.png \
    file://ecofleet_logo_topbar.png \
"

S = "${WORKDIR}"

DEPENDS = "qtbase qtbase-native qtdeclarative qtdeclarative-native qtshadertools qtwayland"

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
    install -d ${D}${datadir}/gobi-ui/qml/atoms
    install -d ${D}${datadir}/gobi-ui/qml/templates
    install -d ${D}${datadir}/gobi-ui/qml/screens
    install -m 0644 ${WORKDIR}/qml/main.qml            ${D}${datadir}/gobi-ui/qml/
    install -m 0644 ${WORKDIR}/qml/Theme.qml           ${D}${datadir}/gobi-ui/qml/
    install -m 0644 ${WORKDIR}/qml/qmldir              ${D}${datadir}/gobi-ui/qml/
    install -m 0644 ${WORKDIR}/qml/ScaleRoot.qml       ${D}${datadir}/gobi-ui/qml/
    install -m 0644 ${WORKDIR}/qml/AppShell.qml        ${D}${datadir}/gobi-ui/qml/
    install -m 0644 ${WORKDIR}/qml/Rail.qml            ${D}${datadir}/gobi-ui/qml/
    install -m 0644 ${WORKDIR}/qml/Header.qml          ${D}${datadir}/gobi-ui/qml/
    install -m 0644 ${WORKDIR}/qml/LockController.qml  ${D}${datadir}/gobi-ui/qml/
    install -m 0644 ${WORKDIR}/qml/LockOverlay.qml     ${D}${datadir}/gobi-ui/qml/
    install -m 0644 ${WORKDIR}/qml/WeatherStrip.qml    ${D}${datadir}/gobi-ui/qml/
    install -m 0644 ${WORKDIR}/qml/WeatherIcon.qml     ${D}${datadir}/gobi-ui/qml/
    install -m 0644 ${WORKDIR}/qml/atoms/*.qml         ${D}${datadir}/gobi-ui/qml/atoms/
    install -m 0644 ${WORKDIR}/qml/templates/*.qml     ${D}${datadir}/gobi-ui/qml/templates/
    install -m 0644 ${WORKDIR}/qml/screens/*.qml       ${D}${datadir}/gobi-ui/qml/screens/
    install -m 0644 ${WORKDIR}/ecofleet_logo.png        ${D}${datadir}/gobi-ui/
    install -m 0644 ${WORKDIR}/ecofleet_logo_topbar.png ${D}${datadir}/gobi-ui/
}

FILES:${PN} += " \
    ${systemd_system_unitdir}/gobi-ui.service \
    ${datadir}/gobi-ui/ \
"

# ── Qt runtime plugins needed at runtime (not link-time deps) ─────────────────
RDEPENDS:${PN} += "qtwayland qtbase-plugins"
