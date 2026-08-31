import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
Item {
    id: page
    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: 12
        ScreenHeader { title: "Cloud Connection"; onBack: if (page.StackView.view) page.StackView.view.pop() }

        // Network link card
        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 96
            radius: 12; color: Theme.surface
            ColumnLayout {
                anchors.fill: parent; anchors.margins: 14; spacing: 8
                RowLayout { spacing: 8
                    Text { text: "Network"; color: Theme.textLabel; font.pixelSize: 12; font.weight: Font.Medium }
                    Rectangle { width: 8; height: 8; radius: 4; Layout.alignment: Qt.AlignVCenter
                        color: devinfo.ethLinked ? Theme.ok : Theme.fault }
                    Text { text: devinfo.ethLinked ? "Linked" : "No Link"; Layout.alignment: Qt.AlignVCenter
                        color: devinfo.ethLinked ? Theme.ok : Theme.fault; font.pixelSize: 12 }
                }
                GridLayout { columns: 2; columnSpacing: 16; rowSpacing: 5
                    Text { text: "IP Address"; color: Theme.textMute; font.pixelSize: 13 }
                    Text { text: devinfo.ipAddress; color: Theme.textDim; font.pixelSize: 13; font.weight: Font.Medium }
                }
            }
        }

        // Cloud reporting note (IoT connection state not yet surfaced)
        Rectangle {
            Layout.fillWidth: true; Layout.fillHeight: true
            radius: 12; color: Theme.surface
            ColumnLayout {
                anchors.fill: parent; anchors.margins: 14; spacing: 8
                Text { text: "EcoFleet Cloud"; color: Theme.textLabel; font.pixelSize: 12; font.weight: Font.Medium }
                Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.textDim; font.pixelSize: 14
                    text: devinfo.ethLinked
                          ? "This unit is on the network and can report telemetry to EcoFleet."
                          : "This unit is offline. Telemetry is buffered and sent once a connection returns." }
                Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.textMute; font.pixelSize: 12
                    text: "Live cloud connection status and fleet assignment are a later update." }
                Item { Layout.fillHeight: true }
            }
        }
    }
}
