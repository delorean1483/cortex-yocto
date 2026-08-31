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
            Layout.fillWidth: true; Layout.fillHeight: true; spacing: 16
            Text { Layout.alignment: Qt.AlignHCenter; text: "Choose a 4-digit PIN"
                color: Theme.textDim; font.pixelSize: 16 }
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
            Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.textDim; font.pixelSize: 15
                text: "A PIN is set. Lock the screen to stop accidental input; unlock with your PIN. A reboot also clears the lock." }

            // Lock now (primary)
            Rectangle {
                Layout.fillWidth: true; Layout.preferredHeight: 60; radius: 12
                color: lockMa.pressed ? Qt.rgba(Theme.accent.r,Theme.accent.g,Theme.accent.b,0.28)
                                      : Qt.rgba(Theme.accent.r,Theme.accent.g,Theme.accent.b,0.15)
                border.color: Theme.accent; border.width: 2
                Row { anchors.centerIn: parent; spacing: 10
                    Icon { name: "lock"; size: 22; color: Theme.accent; anchors.verticalCenter: parent.verticalCenter }
                    Text { text: "Lock now"; color: Theme.accent; font.pixelSize: 20; font.weight: Font.Bold
                        anchors.verticalCenter: parent.verticalCenter } }
                MouseArea { id: lockMa; anchors.fill: parent; onClicked: LockController.lock() }
            }

            RowLayout {
                Layout.fillWidth: true; spacing: 12
                Rectangle {
                    Layout.fillWidth: true; Layout.preferredHeight: 52; radius: 12
                    color: chMa.pressed ? Theme.surface2 : Theme.surface; border.color: Theme.border; border.width: 1
                    Text { anchors.centerIn: parent; text: "Change PIN"; color: Theme.textDim; font.pixelSize: 16 }
                    MouseArea { id: chMa; anchors.fill: parent; onClicked: page.localMode = "set" }
                }
                Rectangle {
                    Layout.fillWidth: true; Layout.preferredHeight: 52; radius: 12
                    color: rmMa.pressed ? Theme.surface2 : Theme.surface; border.color: Theme.border; border.width: 1
                    Text { anchors.centerIn: parent; text: "Remove PIN"; color: Theme.fault; font.pixelSize: 16 }
                    MouseArea { id: rmMa; anchors.fill: parent
                        onClicked: { LockController.removePin(); page.localMode = "set" } }
                }
            }
            Item { Layout.fillHeight: true }
        }
    }
}
