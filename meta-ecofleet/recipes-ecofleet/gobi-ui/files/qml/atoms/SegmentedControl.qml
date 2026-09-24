import QtQuick
import QtQuick.Layouts
import ".."
// One-of-N selector. The track is a single control; the selected segment is a
// solid accent fill (reads through glare, unlike an outline). `options` is
// [{label, value}]; `current` is the selected value — pass a value that matches
// no option (e.g. "") to show nothing selected.
Rectangle {
    id: seg
    property var options: []
    property var current
    property int fontSize: Theme.fsBody
    signal picked(var value)
    implicitHeight: Theme.touch
    radius: Theme.radius
    color: Theme.surface; border.color: Theme.border; border.width: 1
    RowLayout {
        anchors.fill: parent; anchors.margins: 4; spacing: 4
        Repeater {
            model: seg.options
            Rectangle {
                id: opt
                Layout.fillWidth: true; Layout.fillHeight: true
                radius: seg.radius - 4
                readonly property bool sel: modelData.value === seg.current
                color: sel ? Theme.accent : (ma.pressed ? Theme.surface2 : "transparent")
                Behavior on color { ColorAnimation { duration: 120 } }
                Text {
                    anchors.centerIn: parent; text: modelData.label
                    font.pixelSize: seg.fontSize; font.weight: Font.DemiBold
                    color: opt.sel ? Theme.textOnAccent : Theme.textDim
                }
                MouseArea { id: ma; anchors.fill: parent; onClicked: seg.picked(modelData.value) }
            }
        }
    }
}
