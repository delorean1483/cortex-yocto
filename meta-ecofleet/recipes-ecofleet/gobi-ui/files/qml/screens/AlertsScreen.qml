import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
Item {
    id: page
    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: Theme.gap
        ScreenHeader { title: "Alerts"; onBack: if (page.StackView.view) page.StackView.view.pop() }

        // Active fault card (red) or all-clear card (green)
        Rectangle {
            id: card
            Layout.fillWidth: true; Layout.preferredHeight: 112
            radius: Theme.radius
            property color hue: telemetry.hasError ? Theme.fault : Theme.ok
            color: Theme.tint(hue, 0.10); border.color: hue; border.width: 1
            RowLayout {
                anchors.fill: parent; anchors.margins: 20; spacing: 18
                Icon { name: telemetry.hasError ? "alert" : "check-circle"
                    size: 40; stroke: 2.2; color: card.hue; Layout.alignment: Qt.AlignVCenter }
                ColumnLayout { Layout.fillWidth: true; spacing: 4
                    Text { text: telemetry.hasError ? StatusLabels.error(telemetry.error) : "No active alerts"
                        color: card.hue; font.pixelSize: Theme.fsTitle + 2; font.weight: Font.Bold }
                    Text { Layout.fillWidth: true; wrapMode: Text.WordWrap
                        color: Theme.textDim; font.pixelSize: Theme.fsLabel + 1
                        text: telemetry.hasError
                              ? "The APU reported an active fault. Resolve it before running the unit."
                              : "The APU is operating normally. Active faults are shown here as they occur." }
                }
            }
        }
        Item { Layout.fillHeight: true }
    }
}
