import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
Item {
    id: page
    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: 12
        ScreenHeader { title: "Alerts"; onBack: if (page.StackView.view) page.StackView.view.pop() }

        // Active fault card (red) or all-clear card (green)
        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 120
            radius: 12
            property color hue: telemetry.hasError ? Theme.fault : Theme.ok
            color: Qt.rgba(hue.r, hue.g, hue.b, 0.10); border.color: hue; border.width: 1
            RowLayout {
                anchors.fill: parent; anchors.margins: 16; spacing: 16
                Icon { name: telemetry.hasError ? "bell" : "info"
                    size: 40; color: parent.parent.hue; Layout.alignment: Qt.AlignVCenter }
                ColumnLayout { Layout.fillWidth: true; spacing: 4
                    Text { text: telemetry.hasError ? "Active fault" : "No active alerts"
                        color: parent.parent.parent.hue; font.pixelSize: 22; font.weight: Font.Bold }
                    Text { Layout.fillWidth: true; wrapMode: Text.WordWrap
                        color: Theme.textDim; font.pixelSize: 14
                        text: telemetry.hasError
                              ? ("The APU reported: " + telemetry.error + ". Resolve it before running the unit.")
                              : "The APU is operating normally. Faults will appear here as they occur." }
                }
            }
        }

        Text { Layout.fillWidth: true; wrapMode: Text.WordWrap
            color: Theme.textMute; font.pixelSize: 12
            text: "Shows the current active fault. A full fault-history log is a later update." }
        Item { Layout.fillHeight: true }
    }
}
