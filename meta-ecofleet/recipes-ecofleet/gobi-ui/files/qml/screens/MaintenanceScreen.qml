import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
Item {
    id: page
    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: 12
        ScreenHeader { title: "Maintenance"; onBack: if (page.StackView.view) page.StackView.view.pop() }

        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 96
            radius: 12; color: Qt.rgba(Theme.warn.r, Theme.warn.g, Theme.warn.b, 0.10)
            border.color: Theme.warn; border.width: 1
            RowLayout {
                anchors.fill: parent; anchors.margins: 16; spacing: 14
                Icon { name: "cpu"; size: 34; color: Theme.warn; Layout.alignment: Qt.AlignVCenter }
                ColumnLayout { Layout.fillWidth: true; spacing: 2
                    Text { text: "Technician tools"; color: Theme.warn; font.pixelSize: 18; font.weight: Font.Bold }
                    Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.textDim; font.pixelSize: 13
                        text: "Component test, calibration, and fault codes need a firmware update and a maintenance passcode." }
                }
            }
        }

        Rectangle {
            Layout.fillWidth: true; Layout.fillHeight: true
            radius: 12; color: Theme.surface
            ColumnLayout {
                anchors.fill: parent; anchors.margins: 16; spacing: 10
                Text { text: "Available now"; color: Theme.textLabel; font.pixelSize: 12; font.weight: Font.Medium }
                Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.textDim; font.pixelSize: 14
                    text: "• Live sensor readings and the fan test are in Live Diagnostics.\n• Oil-timer reset is in User Maintenance." }
                Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.textMute; font.pixelSize: 12
                    text: "Individual relay/actuator tests will arrive with an APU firmware update that adds a guarded component-test mode." }
                Item { Layout.fillHeight: true }
            }
        }
    }
}
