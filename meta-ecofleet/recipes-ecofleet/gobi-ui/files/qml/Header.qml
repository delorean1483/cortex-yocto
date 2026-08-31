import QtQuick
import "."
Rectangle {
    implicitHeight: 40; color: Theme.surface
    Rectangle { anchors.bottom: parent.bottom; width: parent.width; height: 1; color: Theme.border }
    Row {
        anchors.left: parent.left; anchors.leftMargin: 12
        anchors.verticalCenter: parent.verticalCenter; spacing: 8
        Rectangle { width: 8; height: 8; radius: 4; anchors.verticalCenter: parent.verticalCenter
            color: telemetry.stale ? Theme.fault : Theme.ok }
        Text { text: devinfo.ipAddress; color: Theme.textMute; font.pixelSize: 12
               anchors.verticalCenter: parent.verticalCenter }
    }
    Text {
        id: clock
        anchors.right: parent.right; anchors.rightMargin: 12; anchors.verticalCenter: parent.verticalCenter
        property var now: new Date()
        text: Qt.formatDateTime(now, "ddd MMM d  h:mm AP"); color: Theme.textMute; font.pixelSize: 13
        Timer { interval: 1000; running: true; repeat: true; onTriggered: clock.now = new Date() }
    }
}
