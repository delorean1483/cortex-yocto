import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
Item {
    id: page
    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: Theme.gap
        ScreenHeader { title: "Cloud Connection"; onBack: if (page.StackView.view) page.StackView.view.pop() }

        // nested layouts default to fillHeight — size the row to its cards instead
        RowLayout {
            Layout.fillWidth: true; Layout.fillHeight: false; spacing: Theme.gap
            // link state + what it means for EcoFleet reporting
            Rectangle {
                id: status
                Layout.fillWidth: true; Layout.preferredWidth: 1; Layout.fillHeight: true
                property color hue: devinfo.ethLinked ? Theme.ok : Theme.fault
                radius: Theme.radius; color: Theme.tint(hue, 0.10); border.color: hue; border.width: 1
                ColumnLayout {
                    anchors.fill: parent; anchors.margins: Theme.pad; spacing: 8
                    RowLayout { spacing: 10
                        Icon { name: "cloud"; size: 26; stroke: 2.2; color: status.hue }
                        Text { text: devinfo.ethLinked ? "Network linked" : "No network"
                            color: status.hue; font.pixelSize: Theme.fsTitle; font.weight: Font.DemiBold } }
                    Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.textDim; font.pixelSize: Theme.fsLabel + 1
                        text: devinfo.ethLinked
                              ? "This unit is on the network and reports telemetry to EcoFleet."
                              : "This unit is offline. Telemetry is buffered and sent once a connection returns." }
                    Item { Layout.fillHeight: true }
                }
            }
            InfoCard { id: net; Layout.fillWidth: true; Layout.preferredWidth: 1; Layout.alignment: Qt.AlignTop
                title: "Network"
                rows: [ {k: "IP address",  v: devinfo.ipAddress},
                        {k: "MAC address", v: devinfo.macAddress} ] }
        }
        Item { Layout.fillHeight: true }
    }
}
