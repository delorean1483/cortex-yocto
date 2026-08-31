import QtQuick
import "../templates"
import ".."
Item {
    id: menu
    property var shell
    Component { id: diag;      DiagnosticsScreen {} }
    Component { id: usermaint; UserMaintScreen {} }
    Component { id: unit;      UnitInfoScreen {} }
    Component { id: soon; Item { Rectangle { anchors.fill: parent; color: Theme.bg
        Text { anchors.centerIn: parent; text: "Coming soon"; color: Theme.textMute; font.pixelSize: 18 } } } }
    function open(target) {
        if (target === "diag") menu.shell.pushScreen(diag);
        else if (target === "usermaint") menu.shell.pushScreen(usermaint);
        else if (target === "unit") menu.shell.pushScreen(unit);
        else menu.shell.pushScreen(soon);
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
