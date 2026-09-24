import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
Item {
    id: page
    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: Theme.gap
        ScreenHeader { title: "Error Log"; onBack: if (page.StackView.view) page.StackView.view.pop() }

        Rectangle {
            Layout.fillWidth: true; Layout.fillHeight: true
            radius: Theme.radius; color: Theme.surface
            ColumnLayout {
                anchors.centerIn: parent; width: Math.min(parent.width - 48, 440); spacing: 10
                Icon { name: "list"; size: 44; color: Theme.textMute; Layout.alignment: Qt.AlignHCenter }
                Text { Layout.alignment: Qt.AlignHCenter; text: "No stored events"
                    color: Theme.text; font.pixelSize: Theme.fsTitle; font.weight: Font.DemiBold }
                Text { Layout.fillWidth: true; horizontalAlignment: Text.AlignHCenter; wrapMode: Text.WordWrap
                    color: Theme.textMute; font.pixelSize: Theme.fsLabel + 1
                    text: "There are no past faults recorded on this unit. For the current status, see Alerts." }
            }
        }
    }
}
