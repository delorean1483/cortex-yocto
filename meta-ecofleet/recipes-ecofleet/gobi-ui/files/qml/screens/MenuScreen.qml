import QtQuick
import "../templates"
import ".."
Item {
    id: menu
    property var shell
    Component { id: diag;      DiagnosticsScreen {} }
    Component { id: usermaint; UserMaintScreen {} }
    Component { id: unit;      UnitInfoScreen {} }
    Component { id: alerts;    AlertsScreen {} }
    Component { id: log;       ErrorLogScreen {} }
    Component { id: settings;  SettingsScreen {} }
    Component { id: cloud;     CloudScreen {} }
    Component { id: lock;      ScreenLockScreen {} }
    Component { id: maint;     MaintenanceScreen {} }
    Component { id: support;   SupportScreen {} }
    property var _routes: ({
        "diag": diag, "usermaint": usermaint, "unit": unit, "alerts": alerts,
        "log": log, "settings": settings, "cloud": cloud, "lock": lock,
        "maint": maint, "support": support
    })
    function open(target) {
        if (menu._routes[target] !== undefined) menu.shell.pushScreen(menu._routes[target]);
    }
    TileGrid {
        anchors.fill: parent
        pages: [
            [ {title:"Live Diagnostics",target:"diag",icon:"diag"}, {title:"User Maintenance",target:"usermaint",icon:"wrench"},
              {title:"Unit Information",target:"unit",icon:"info"}, {title:"Alerts",target:"alerts",icon:"bell"},
              {title:"Error Log",target:"log",icon:"list"}, {title:"Settings",target:"settings",icon:"settings"} ],
            [ {title:"Cloud Connection",target:"cloud",icon:"cloud"}, {title:"Screen Lock",target:"lock",icon:"lock"},
              {title:"Maintenance",target:"maint",icon:"cpu",locked:true}, {title:"Support",target:"support",icon:"support"} ]
        ]
        onOpened: menu.open(target)
    }
}
