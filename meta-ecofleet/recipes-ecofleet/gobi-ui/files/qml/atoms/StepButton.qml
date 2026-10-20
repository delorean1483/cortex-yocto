import QtQuick
import ".."
// Square icon button for steppers. Fires on press and auto-repeats while held,
// so a setpoint can be walked across its range without a tap per step.
Rectangle {
    id: b
    property string icon: "plus"
    property bool autoRepeat: true
    property int w: Theme.touch + 4
    property int h: Theme.touch
    property color fill: Theme.surface
    property bool showBorder: true
    property int iconSize: 22
    property real iconStroke: 2.4
    signal activated()
    implicitWidth: w; implicitHeight: h
    radius: Theme.radius
    color: ma.pressed ? (Qt.colorEqual(fill, Theme.surface) ? Theme.surface2 : Theme.border) : fill
    border.color: Theme.border; border.width: showBorder ? 1 : 0
    opacity: enabled ? 1 : 0.4
    Icon { anchors.centerIn: parent; name: b.icon; size: b.iconSize; stroke: b.iconStroke; color: Theme.accent }
    Timer { id: rep; repeat: true; onTriggered: { interval = 110; b.activated() } }
    MouseArea {
        id: ma; anchors.fill: parent
        onPressed: { b.activated(); if (b.autoRepeat) { rep.interval = 450; rep.start() } }
        onReleased: rep.stop()
        onCanceled: rep.stop()
    }
}
