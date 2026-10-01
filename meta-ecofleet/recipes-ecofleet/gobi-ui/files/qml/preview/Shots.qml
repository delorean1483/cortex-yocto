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
    UpdateOverlay { anchors.fill: parent }

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
    Component { id: wifiC;      WifiScreen {} }
    Component { id: wifiJoinC;  WifiJoinScreen { ssid: "Pilot-Travel-Center" } }
    Component { id: wifiHidC;   WifiJoinScreen { hidden: true } }
    Component { id: wifiSavedC; WifiSavedScreen {} }

    function sub(c) { shell.selectRail(2); return shell.pushScreen(c) }
    function notice(kind, title, detail, key) {
        telemetry.updateKind = kind; telemetry.updateTitle = title
        telemetry.updateDetail = detail; telemetry.updateKey = key; root.poke()
    }
    // Swipe the Menu tile grid to its second page (find the SwipeView by walking the item tree).
    function findSwipe(it) {
        if (it.currentIndex !== undefined && it.incrementCurrentIndex) return it
        for (var i = 0; i < it.children.length; i++) { var r = findSwipe(it.children[i]); if (r) return r }
        return null
    }
    function menuPage2() { var sv = findSwipe(shell); if (sv) sv.setCurrentIndex(1) }
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
        ["10b-errorlog-events", function() { eventlog.sample(); root.sub(logC) }],
        ["11-settings",      function() { root.sub(settingsC) }],
        ["12-cloud",         function() { root.sub(cloudC) }],
        ["12b-cloud-offline", function() { telemetry.cloudConnected = false
                                           telemetry.cloudLastAckMs = Date.now() - 7 * 60000
                                           root.poke(); root.sub(cloudC) }],
        ["12c-cloud-back",   function() { telemetry.cloudConnected = true
                                           telemetry.cloudLastAckMs = Date.now() - 12000
                                           root.poke(); root.sub(cloudC) }],
        ["13-screenlock",    function() { root.sub(lockC) }],
        ["14-maintenance",   function() { root.sub(maintC) }],
        ["15-comptest-lock", function() { root.sub(comptestC) }],
        ["16-comptest",      function() { var p = root.sub(comptestC); p.tryUnlock(MaintController.defaultPin)
                                          telemetry.diagActive = true; root.poke() }],
        ["17-support",       function() { telemetry.diagActive = false; root.poke(); root.sub(supportC) }],
        ["18-lockoverlay",   function() { shell.selectRail(0); LockController.setPin("1234"); LockController.lock() }],
        ["19-update-download", function() { root.notice("busy", "Updating software to 1.2.67", "Downloading…", "") }],
        ["19b-update-apu",   function() { telemetry.updateProgress = 42
                                          root.notice("busy", "Updating APU controller", "42% complete", "") }],
        ["19c-update-failed", function() { telemetry.updateProgress = -1; LockController.tryUnlock("1234"); shell.selectRail(0)
                                           root.notice("failed", "Software update to 1.2.67 failed",
                                                       "The unit is still running its current software.",
                                                       "failed: install 1.2.67 (rc 1)") }],
        ["21-wifi",            function() { root.notice("none", "", "", ""); root.sub(wifiC) }],
        ["21b-wifi-portal",    function() { wifi.internet = "portal"; root.sub(wifiC) }],
        ["21c-wifi-connecting",function() { wifi.internet = "online"; wifi.state = "connecting"; wifi.pendingSsid = "Shop-Guest"; root.sub(wifiC) }],
        ["21d-wifi-wrongpw",   function() { wifi.state = "idle"; wifi.pendingSsid = ""; wifi.lastError = "Wrong password."; root.sub(wifiC) }],
        ["21e-wifi-unavail",   function() { wifi.lastError = ""; wifi.state = "unavailable"; wifi.networks = []; root.sub(wifiC) }],
        ["21f-wifi-join",      function() { wifi.state = "connected"; root.sub(wifiJoinC) }],
        ["21f2-wifi-join-symbols", function() { var p = root.sub(wifiJoinC); p.kbSymbols = true; p.error = "Wrong password." }],
        ["21g-wifi-hidden",    function() { root.sub(wifiHidC) }],
        ["21h-wifi-saved",     function() { root.sub(wifiSavedC) }],
        ["21i-menu-p2",        function() { shell.selectRail(2); root.menuPage2() }]
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
