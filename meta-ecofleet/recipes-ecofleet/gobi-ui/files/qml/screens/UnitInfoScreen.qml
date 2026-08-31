import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
Item {
    id: page

    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: 10

        RowLayout { Layout.fillWidth: true
            Text { text: "‹"; color: Theme.accentBlue; font.pixelSize: 26
                MouseArea { anchors.fill: parent; anchors.margins: -10; onClicked: if (page.StackView.view) page.StackView.view.pop() } }
            Text { text: "Unit Information"; color: Theme.textDim; font.pixelSize: 18; font.weight: Font.DemiBold } }

        // ── Identity card ─────────────────────────────────────────────────────
        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 118
            radius: 12; color: Theme.surface
            ColumnLayout {
                anchors.fill: parent; anchors.margins: 12; spacing: 6
                Text { text: "Identity"; color: Theme.textLabel; font.pixelSize: 12; font.weight: Font.Medium }
                GridLayout {
                    columns: 2; columnSpacing: 16; rowSpacing: 5
                    Text { text: "Serial";   color: Theme.textMute; font.pixelSize: 13 }
                    Text { text: devinfo.serial;    color: Theme.textDim; font.pixelSize: 13; font.weight: Font.Medium }
                    Text { text: "Hostname"; color: Theme.textMute; font.pixelSize: 13 }
                    Text { text: devinfo.hostname;  color: Theme.textDim; font.pixelSize: 13; font.weight: Font.Medium }
                    Text { text: "Firmware"; color: Theme.textMute; font.pixelSize: 13 }
                    Text { text: devinfo.fwVersion; color: Theme.textDim; font.pixelSize: 13; font.weight: Font.Medium }
                }
            }
        }

        // ── Network card ──────────────────────────────────────────────────────
        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 108
            radius: 12; color: Theme.surface
            ColumnLayout {
                anchors.fill: parent; anchors.margins: 12; spacing: 6
                RowLayout { spacing: 8
                    Text { text: "Network"; color: Theme.textLabel; font.pixelSize: 12; font.weight: Font.Medium }
                    Rectangle { width: 8; height: 8; radius: 4
                        color: devinfo.ethLinked ? Theme.ok : Theme.fault
                        Layout.alignment: Qt.AlignVCenter }
                    Text { text: devinfo.ethLinked ? "Linked" : "No Link"
                        color: devinfo.ethLinked ? Theme.ok : Theme.fault
                        font.pixelSize: 12; Layout.alignment: Qt.AlignVCenter }
                }
                GridLayout {
                    columns: 2; columnSpacing: 16; rowSpacing: 5
                    Text { text: "IP Address";  color: Theme.textMute; font.pixelSize: 13 }
                    Text { text: devinfo.ipAddress;  color: Theme.textDim; font.pixelSize: 13; font.weight: Font.Medium }
                    Text { text: "MAC Address"; color: Theme.textMute; font.pixelSize: 13 }
                    Text { text: devinfo.macAddress; color: Theme.textDim; font.pixelSize: 13; font.weight: Font.Medium }
                }
            }
        }

        Item { Layout.fillHeight: true }
    }
}
