import QtQuick
import "."
import "atoms"
// Firmware update notice, driven by telemetry.update* (UpdateNotice.h).
//  busy   → covers the whole canvas (rail and screen lock included) and swallows
//           touch: the install needs no input and the unit restarts at the end.
//  failed → a banner along the bottom; tapping it hides it until a different
//           failure shows up (updateKey changes).
Item {
    id: root
    anchors.fill: parent
    z: 60   // above LockOverlay (50): the notice must show on a locked screen too
    property string dismissedKey: ""
    readonly property bool busy: telemetry.updateKind === "busy"
    readonly property bool failed: telemetry.updateKind === "failed" && telemetry.updateKey !== dismissedKey

    Rectangle {
        anchors.fill: parent
        visible: root.busy
        color: Theme.bg
        MouseArea { anchors.fill: parent }   // block the UI behind

        Column {
            anchors.centerIn: parent; spacing: 16; width: 480
            Icon { anchors.horizontalCenter: parent.horizontalCenter; name: "cpu"; size: 44; color: Theme.accent }
            Text { width: parent.width; horizontalAlignment: Text.AlignHCenter; wrapMode: Text.WordWrap
                text: telemetry.updateTitle; color: Theme.text; font.pixelSize: 24; font.weight: Font.DemiBold }
            Text { width: parent.width; horizontalAlignment: Text.AlignHCenter
                text: telemetry.updateDetail; color: Theme.textMute; font.pixelSize: Theme.fsBody }
            // Indeterminate sweep: the worker only reports phases, not progress.
            Rectangle {
                anchors.horizontalCenter: parent.horizontalCenter
                width: 320; height: 6; radius: 3; color: Theme.surface; clip: true
                Rectangle {
                    id: sweep; width: 96; height: parent.height; radius: 3; color: Theme.accent
                    NumberAnimation on x { from: -96; to: 320; duration: 1400; loops: Animation.Infinite; running: root.busy }
                }
            }
            Text { width: parent.width; horizontalAlignment: Text.AlignHCenter
                text: "Don't power off the unit."; color: Theme.warn
                font.pixelSize: Theme.fsBody; font.weight: Font.DemiBold }
        }
    }

    Rectangle {
        visible: root.failed
        anchors.bottom: parent.bottom; anchors.bottomMargin: 16
        anchors.horizontalCenter: parent.horizontalCenter
        width: 560; height: 60; radius: Theme.radiusSm
        color: Theme.surface   // opaque: the banner floats over live screen content
        Rectangle { anchors.fill: parent; radius: parent.radius
            color: Theme.tint(Theme.fault, 0.16); border.color: Theme.fault; border.width: 1 }
        Row {
            anchors.left: parent.left; anchors.leftMargin: 14; anchors.verticalCenter: parent.verticalCenter; spacing: 12
            Icon { name: "alert"; size: 22; color: Theme.fault; anchors.verticalCenter: parent.verticalCenter }
            Column { anchors.verticalCenter: parent.verticalCenter; spacing: 2
                Text { text: telemetry.updateTitle; color: Theme.fault; font.pixelSize: Theme.fsBody; font.weight: Font.DemiBold }
                Text { text: telemetry.updateDetail + " Tap to dismiss."; color: Theme.textMute; font.pixelSize: Theme.fsLabel } }
        }
        MouseArea { anchors.fill: parent; onClicked: root.dismissedKey = telemetry.updateKey }
    }
}
