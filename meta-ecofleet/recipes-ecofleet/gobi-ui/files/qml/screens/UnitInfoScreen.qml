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
                rows: [ {k: "Ethernet",    v: devinfo.ethLinked ? "Linked" : "No link",
                                           hue: devinfo.ethLinked ? Theme.ok : Theme.fault},
                        {k: "Ethernet IP", v: devinfo.ipAddress},
                        {k: "WiFi",        v: wifi.state === "connected" && wifi.ssid !== "" ? wifi.ssid : "Not connected",
                                           hue: wifi.state === "connected" ? Theme.ok : Theme.textMute},
                        {k: "WiFi IP",     v: wifi.state === "connected" && wifi.ip !== "" ? wifi.ip : "No IP"},
                        {k: "MAC (Ethernet)", v: devinfo.macAddress} ] }
        }
        Item { Layout.fillHeight: true }
    }
}
