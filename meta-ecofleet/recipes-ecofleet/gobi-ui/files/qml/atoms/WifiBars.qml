import QtQuick
import ".."
// Four rising bars; `bars` (0-4) are filled. Grey and unfilled when !active.
Row {
    id: wb
    property int bars: 0
    property bool active: true
    property color hue: Theme.accent
    property real unit: 4
    spacing: unit * 0.5
    Repeater { model: 4
        Rectangle {
            anchors.bottom: parent.bottom
            width: wb.unit; height: wb.unit * (index + 1.5); radius: 1
            color: wb.active && index < wb.bars ? wb.hue : Theme.border } }
}
