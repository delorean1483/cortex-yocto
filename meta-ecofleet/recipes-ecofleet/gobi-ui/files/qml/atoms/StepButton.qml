import QtQuick
import ".."
// Square icon button for steppers. Fires on press and auto-repeats while held,
// so a setpoint can be walked across its range without a tap per step.
Rectangle {
    id: b
    property string icon: "plus"
    property bool autoRepeat: true
    signal activated()
    implicitWidth: Theme.touch + 4; implicitHeight: Theme.touch
    radius: Theme.radius
    color: ma.pressed ? Theme.surface2 : Theme.surface
    border.color: Theme.border; border.width: 1
    opacity: enabled ? 1 : 0.4
    Icon { anchors.centerIn: parent; name: b.icon; size: 22; stroke: 2.4; color: Theme.accent }
    Timer { id: rep; repeat: true; onTriggered: { interval = 110; b.activated() } }
    MouseArea {
        id: ma; anchors.fill: parent
        onPressed: { b.activated(); if (b.autoRepeat) { rep.interval = 450; rep.start() } }
        onReleased: rep.stop()
        onCanceled: rep.stop()
    }
}
