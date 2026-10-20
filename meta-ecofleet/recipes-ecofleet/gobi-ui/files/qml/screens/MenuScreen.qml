import QtQuick
import "../templates"
import ".."
Item {
    id: menu
    property var appShell   // the AppShell (renamed from `shell` to avoid an id/property name clash → binding loop)
    Component { id: diag;      DiagnosticsScreen {} }
    Component { id: comptest;  ComponentTestScreen {} }
    Component { id: usermaint; UserMaintScreen {} }
    Component { id: unit;      UnitInfoScreen {} }
    Component { id: alerts;    AlertsScreen {} }
    Component { id: log;       ErrorLogScreen {} }
    Component { id: settings;  SettingsScreen {} }
    Component { id: cloud;     CloudScreen {} }
    Component { id: wifiS;     WifiScreen {} }
    Component { id: lock;      ScreenLockScreen {} }
    Component { id: maint;     MaintenanceScreen {} }
    Component { id: support;   SupportScreen {} }
    property var _routes: ({
        "diag": diag, "comptest": comptest, "usermaint": usermaint, "unit": unit, "alerts": alerts,
        "log": log, "settings": settings, "cloud": cloud, "wifi": wifiS, "lock": lock,
        "maint": maint, "support": support
    })
    function open(target) {
        if (menu._routes[target] !== undefined) menu.appShell.pushScreen(menu._routes[target]);
    }
    TileGrid {
        anchors.fill: parent
        counts: ({ alerts: StatusLabels.faultCount(telemetry.hasError, eventlog.activeCount) })
        tiles: [
            {title:"Alerts",target:"alerts",icon:"bell"}, {title:"Error Log",target:"log",icon:"list"},
            {title:"Live Diagnostics",target:"diag",icon:"diag"}, {title:"Unit Information",target:"unit",icon:"info"},
            {title:"WiFi",target:"wifi",icon:"wifi"}, {title:"Cloud Connection",target:"cloud",icon:"cloud"},
            {title:"Settings",target:"settings",icon:"settings"}, {title:"Screen Lock",target:"lock",icon:"lock"},
            {title:"User Maintenance",target:"usermaint",icon:"wrench"},
            {title:"Maintenance",target:"maint",icon:"cpu",locked:true},
            {title:"Component Test",target:"comptest",icon:"mode",locked:true},
            {title:"Support",target:"support",icon:"support"}
        ]
        onOpened: function(target) { menu.open(target) }
    }
}
