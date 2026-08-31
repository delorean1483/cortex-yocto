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
            [ {title:"Live Diagnostics",target:"diag"}, {title:"User Maintenance",target:"usermaint"},
              {title:"Unit Information",target:"unit"}, {title:"Alerts",target:"alerts"},
              {title:"Error Log",target:"log"}, {title:"Settings",target:"settings"} ],
            [ {title:"Cloud Connection",target:"cloud"}, {title:"Screen Lock",target:"lock"},
              {title:"Maintenance",target:"maint",locked:true}, {title:"Support",target:"support"} ]
        ]
        onOpened: menu.open(target)
    }
}
