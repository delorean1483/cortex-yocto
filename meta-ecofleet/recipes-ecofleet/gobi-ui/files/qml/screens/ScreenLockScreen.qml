import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
Item {
    id: page
    // "set" = choosing a PIN; "menu" = PIN exists, offer lock/change/remove
    property string localMode: LockController.hasPin ? "menu" : "set"

    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: 14
        ScreenHeader { title: "Screen Lock"; onBack: if (page.StackView.view) page.StackView.view.pop() }

        // Set / change a PIN
        ColumnLayout {
            visible: page.localMode === "set"
            Layout.fillWidth: true; Layout.fillHeight: true; spacing: 14
            Item { Layout.fillHeight: true }
            // fillWidth lifts the column's max width off the fixed-size keypad so
            // the keypad centers instead of packing left
            Text { Layout.fillWidth: true; horizontalAlignment: Text.AlignHCenter; text: "Choose a 4-digit PIN"
                color: Theme.text; font.pixelSize: Theme.fsBody + 1; font.weight: Font.Medium }
            Keypad {
                Layout.alignment: Qt.AlignHCenter
                onEntered: function(code) { LockController.setPin(code); page.localMode = "menu" }
            }
            Item { Layout.fillHeight: true }
        }

        // Lock now / change / remove
        ColumnLayout {
            visible: page.localMode === "menu"
            Layout.fillWidth: true; Layout.fillHeight: true; spacing: 12
            Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.textDim; font.pixelSize: Theme.fsBody
                text: "A PIN is set. Lock the screen to stop accidental input; unlock with your PIN. A reboot also clears the lock." }

            // Lock now (primary)
            Rectangle {
                Layout.fillWidth: true; Layout.preferredHeight: 60; radius: Theme.radius
                color: lockMa.pressed ? Qt.darker(Theme.accent, 1.15) : Theme.accent
                Row { anchors.centerIn: parent; spacing: 10
                    Icon { name: "lock"; size: 22; stroke: 2.4; color: Theme.textOnAccent; anchors.verticalCenter: parent.verticalCenter }
                    Text { text: "Lock now"; color: Theme.textOnAccent; font.pixelSize: Theme.fsTitle; font.weight: Font.Bold
                        anchors.verticalCenter: parent.verticalCenter } }
                MouseArea { id: lockMa; anchors.fill: parent; onClicked: LockController.lock() }
            }

            RowLayout {
                Layout.fillWidth: true; spacing: 12
                Rectangle {
                    Layout.fillWidth: true; Layout.preferredHeight: 52; radius: Theme.radius
                    color: chMa.pressed ? Theme.surface2 : Theme.surface; border.color: Theme.border; border.width: 1
                    Text { anchors.centerIn: parent; text: "Change PIN"; color: Theme.text; font.pixelSize: Theme.fsBody; font.weight: Font.Medium }
                    MouseArea { id: chMa; anchors.fill: parent; onClicked: page.localMode = "set" }
                }
                Rectangle {
                    Layout.fillWidth: true; Layout.preferredHeight: 52; radius: Theme.radius
                    color: rmMa.pressed ? Theme.surface2 : Theme.surface; border.color: Theme.border; border.width: 1
                    Text { anchors.centerIn: parent; text: "Remove PIN"; color: Theme.fault; font.pixelSize: Theme.fsBody; font.weight: Font.Medium }
                    MouseArea { id: rmMa; anchors.fill: parent
                        onClicked: { LockController.removePin(); page.localMode = "set" } }
                }
            }
            Item { Layout.fillHeight: true }
        }
    }
}
