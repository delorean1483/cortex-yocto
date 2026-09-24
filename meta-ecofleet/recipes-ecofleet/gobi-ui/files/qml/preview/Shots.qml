import QtQuick
import ".."
import "../screens"
// Headless screenshot tour of every screen at the native 800x480 canvas.
// Run by runner/ (see runner/README.md), which exposes `telemetry` / `devinfo` (from
// Mocks.qml) and `shotDir` as context properties, then quits when done.
Item {
    id: root
    width: 800; height: 480

    Rectangle { anchors.fill: parent; color: Theme.bg }   // ApplicationWindow background on device
    AppShell {
        id: shell
        railModel: [ {key:"home",label:"Home",icon:"home"}, {key:"batt",label:"Battery",icon:"battery"},
                     {key:"menu",label:"Menu",icon:"menu"} ]
        railScreens: [ homeC, battC, menuC ]
    }
    LockOverlay { anchors.fill: parent }

    Component { id: homeC; HomeScreen {} }
    Component { id: battC; BatteryScreen {} }
    Component { id: menuC; MenuScreen { appShell: shell } }
    Component { id: diagC;      DiagnosticsScreen {} }
    Component { id: comptestC;  ComponentTestScreen {} }
    Component { id: usermaintC; UserMaintScreen {} }
    Component { id: unitC;      UnitInfoScreen {} }
    Component { id: alertsC;    AlertsScreen {} }
    Component { id: logC;       ErrorLogScreen {} }
    Component { id: settingsC;  SettingsScreen {} }
    Component { id: cloudC;     CloudScreen {} }
    Component { id: lockC;      ScreenLockScreen {} }
    Component { id: maintC;     MaintenanceScreen {} }
    Component { id: supportC;   SupportScreen {} }

    function sub(c) { shell.selectRail(2); return shell.pushScreen(c) }
    function poke() { telemetry.tsMs += 1; telemetry.dataChanged() }

    property var steps: [
        ["01-home",          function() { telemetry.load() }],
        ["02-home-cooling",  function() { telemetry.mode = "climate"; telemetry.controlStatus = "cooling"
                                          telemetry.fanAuto = true; telemetry.heaterCommsOk = true
                                          telemetry.heaterState = "running"; telemetry.heaterFanRpm = 2600
                                          telemetry.heaterExchanger = 180; root.poke() }],
        ["03-battery",       function() { telemetry.mode = "off"; telemetry.controlStatus = "off"
                                          telemetry.fanAuto = false; telemetry.heaterCommsOk = false
                                          telemetry.heaterState = "off"; telemetry.heaterFanRpm = 0
                                          telemetry.heaterExchanger = 0; root.poke(); shell.selectRail(1) }],
        ["04-menu",          function() { shell.selectRail(2) }],
        ["05-diagnostics",   function() { root.sub(diagC) }],
        ["06-usermaint",     function() { root.sub(usermaintC) }],
        ["07-unitinfo",      function() { root.sub(unitC) }],
        ["08-alerts",        function() { root.sub(alertsC) }],
        ["09-alerts-fault",  function() { telemetry.hasError = true; telemetry.error = "low_oil"; root.poke(); root.sub(alertsC) }],
        ["10-errorlog",      function() { telemetry.hasError = false; telemetry.error = "none"; root.poke(); root.sub(logC) }],
        ["11-settings",      function() { root.sub(settingsC) }],
        ["12-cloud",         function() { root.sub(cloudC) }],
        ["13-screenlock",    function() { root.sub(lockC) }],
        ["14-maintenance",   function() { root.sub(maintC) }],
        ["15-comptest-lock", function() { root.sub(comptestC) }],
        ["16-comptest",      function() { var p = root.sub(comptestC); p.tryUnlock(MaintController.defaultPin)
                                          telemetry.diagActive = true; root.poke() }],
        ["17-support",       function() { telemetry.diagActive = false; root.poke(); root.sub(supportC) }],
        ["18-lockoverlay",   function() { shell.selectRail(0); LockController.setPin("1234"); LockController.lock() }]
    ]
    property int idx: 0
    Timer { id: act; interval: 300; onTriggered: { root.steps[root.idx][1](); grab.restart() } }
    Timer { id: grab; interval: 500
        onTriggered: root.grabToImage(function(r) {
            r.saveToFile(shotDir + "/" + root.steps[root.idx][0] + ".png")
            root.idx++
            if (root.idx < root.steps.length) act.restart(); else Qt.quit()
        }) }
    Component.onCompleted: act.start()
}
