import QtQuick
import QtQuick.Layouts
import "."
import "atoms"
// Covers the whole 800x480 canvas (rail included) while LockController.locked.
// Left: clock, date, live climate status line and any active fault. Right: PIN pad.
// A correct PIN dismisses it; a wrong PIN shakes the dots and shows a hint.
Rectangle {
    id: overlay
    anchors.fill: parent
    visible: LockController.locked
    color: Theme.bg
    z: 50

    property date now: new Date()
    // "h" is only 12-hour when the format also has AP, so format once and split.
    readonly property var clock12: Qt.formatDateTime(now, "h:mm AP").split(" ")
    Timer { interval: 10000; repeat: true; running: overlay.visible; triggeredOnStart: true
        onTriggered: overlay.now = new Date() }

    // Left column (380 wide)
    Item {
        id: left
        anchors.left: parent.left; anchors.top: parent.top; anchors.bottom: parent.bottom
        width: 380

        Row {
            x: 44; y: 40; spacing: 10
            Icon { name: "lock"; size: 20; color: Theme.textDim; anchors.verticalCenter: parent.verticalCenter }
            Text { text: "Screen locked"; color: Theme.textDim; font.pixelSize: 17; font.weight: Font.DemiBold
                anchors.verticalCenter: parent.verticalCenter }
        }
        Column {
            x: 44; y: 84; spacing: 4
            Row {
                spacing: 8
                Text { id: clock; text: overlay.clock12[0]; color: Theme.text
                    font.pixelSize: 72; font.weight: Font.DemiBold }
                Text { text: overlay.clock12[1]; color: Theme.textDim
                    font.pixelSize: 28; font.weight: Font.Medium
                    anchors.baseline: clock.baseline }
            }
            Text { text: Qt.formatDateTime(overlay.now, "ddd MMM d"); color: Theme.textDim; font.pixelSize: 16 }
        }
        Column {
            x: 44; anchors.bottom: parent.bottom; anchors.bottomMargin: 40; spacing: 12
            width: left.width - 88
            Row {
                spacing: 10
                Rectangle { width: 10; height: 10; radius: 5; anchors.verticalCenter: parent.verticalCenter
                    color: StatusLabels.controlHue(telemetry.controlStatus) }
                Text { color: Theme.text; font.pixelSize: 17
                    text: "Cabin " + telemetry.cabinTempF.toFixed(0) + "° · "
                          + StatusLabels.climateLine(telemetry.mode !== "off", telemetry.controlStatus,
                                                     Math.round(telemetry.clmtSetpointF)) }
            }
            Rectangle {
                visible: telemetry.hasError
                height: 40; width: chip.implicitWidth + 28; radius: Theme.radiusSm
                color: Theme.tint(Theme.fault, 0.18)
                Row {
                    id: chip
                    x: 14; spacing: 10; anchors.verticalCenter: parent.verticalCenter
                    Icon { name: "alert"; size: 18; color: Theme.fault; anchors.verticalCenter: parent.verticalCenter }
                    Text { text: StatusLabels.error(telemetry.error); color: Theme.faultText
                        font.pixelSize: 16; font.weight: Font.Bold; elide: Text.ElideRight
                        width: Math.min(implicitWidth, 150); anchors.verticalCenter: parent.verticalCenter }
                    Text { text: "active"; color: Theme.textDim; font.pixelSize: 14
                        anchors.verticalCenter: parent.verticalCenter }
                }
            }
        }
    }

    // Right panel
    Rectangle {
        anchors.right: parent.right; anchors.top: parent.top; anchors.bottom: parent.bottom
        width: parent.width - left.width
        color: Theme.lockPanel
        Column {
            anchors.centerIn: parent; spacing: 14
            Text { id: hint; anchors.horizontalCenter: parent.horizontalCenter; text: "Enter PIN"
                color: Theme.textDim; font.pixelSize: 16 }
            Keypad {
                id: pad
                anchors.horizontalCenter: parent.horizontalCenter
                hue: Theme.accent
                keyW: 96; keyH: 64; keyFill: Theme.surface2; showBorder: false
                backFill: "transparent"; digitSize: 28
                dotSize: 16; dotSpacing: 18; dotFilledStyle: true
                onEntered: function(code) {
                    if (!LockController.tryUnlock(code)) {
                        hint.text = "Wrong PIN — try again"; hint.color = Theme.fault
                        pad.shake()
                    } else {
                        hint.text = "Enter PIN"; hint.color = Theme.textDim
                    }
                }
            }
        }
    }
    // Swallow any touch that misses the keypad so the UI behind stays locked.
    MouseArea { anchors.fill: parent; z: -1 }
}
