import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
Item {
    id: page
    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: 12
        ScreenHeader { title: "Error Log"; onBack: if (page.StackView.view) page.StackView.view.pop() }

        Rectangle {
            Layout.fillWidth: true; Layout.fillHeight: true
            radius: 12; color: Theme.surface
            ColumnLayout {
                anchors.centerIn: parent; width: parent.width - 48; spacing: 12
                Icon { name: "list"; size: 44; color: Theme.textMute; Layout.alignment: Qt.AlignHCenter }
                Text { Layout.alignment: Qt.AlignHCenter; text: "No stored events"
                    color: Theme.textDim; font.pixelSize: 20; font.weight: Font.DemiBold }
                Text { Layout.fillWidth: true; horizontalAlignment: Text.AlignHCenter; wrapMode: Text.WordWrap
                    color: Theme.textMute; font.pixelSize: 14
                    text: "A history of past faults will appear here once on-device event logging is enabled. For the current fault, see Alerts." }
            }
        }
    }
}
