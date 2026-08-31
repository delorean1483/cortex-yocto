import QtQuick
import "."
import "atoms"
// Covers the whole 800x480 canvas (rail included) while LockController.locked.
// A correct PIN dismisses it; a wrong PIN flashes the dots red.
Rectangle {
    id: overlay
    anchors.fill: parent
    visible: LockController.locked
    color: Theme.bg
    z: 50

    Column {
        anchors.centerIn: parent; spacing: 22
        Icon { anchors.horizontalCenter: parent.horizontalCenter; name: "lock"; size: 40; color: Theme.accent }
        Text { anchors.horizontalCenter: parent.horizontalCenter; text: "Screen locked"
            color: Theme.text; font.pixelSize: 22; font.weight: Font.DemiBold }
        Text { id: hint; anchors.horizontalCenter: parent.horizontalCenter; text: "Enter your PIN to unlock"
            color: Theme.textMute; font.pixelSize: 14 }
        Keypad {
            id: pad
            anchors.horizontalCenter: parent.horizontalCenter
            hue: Theme.accent
            onEntered: function(code) {
                if (!LockController.tryUnlock(code)) {
                    hint.text = "Wrong PIN — try again"; hint.color = Theme.fault
                } else {
                    hint.text = "Enter your PIN to unlock"; hint.color = Theme.textMute
                }
            }
        }
    }
    // Swallow any touch that misses the keypad so the UI behind stays locked.
    MouseArea { anchors.fill: parent; z: -1 }
}
