import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
Item {
    id: page

    function apuVer(v) { return v>0 ? (Math.floor(v/10000)+"."+(Math.floor(v/100)%100)+"."+(v%100)) : "—" }

    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: Theme.gap
        ScreenHeader { title: "Unit Information"; onBack: if (page.StackView.view) page.StackView.view.pop() }

        // nested layouts default to fillHeight — size the row to its cards instead
        RowLayout {
            Layout.fillWidth: true; Layout.fillHeight: false; spacing: Theme.gap
            InfoCard { Layout.fillWidth: true; Layout.preferredWidth: 1; Layout.alignment: Qt.AlignTop
                title: "Identity"
                rows: [ {k: "Serial",       v: devinfo.serial},
                        {k: "Hostname",     v: devinfo.hostname},
                        {k: "Firmware",     v: devinfo.fwVersion},
                        {k: "APU firmware", v: page.apuVer(telemetry.apuFwVersion)} ] }
            InfoCard { Layout.fillWidth: true; Layout.preferredWidth: 1; Layout.alignment: Qt.AlignTop
                title: "Network"
                rows: [ {k: "Link",        v: devinfo.ethLinked ? "Linked" : "No link",
                                           hue: devinfo.ethLinked ? Theme.ok : Theme.fault},
                        {k: "IP address",  v: devinfo.ipAddress},
                        {k: "MAC address", v: devinfo.macAddress} ] }
        }
        Item { Layout.fillHeight: true }
    }
}
