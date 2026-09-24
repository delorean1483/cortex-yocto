import QtQuick
import "."
import "atoms"
Rectangle {
    id: rail
    property var model: []
    property int currentIndex: 0
    signal picked(int index)
    implicitWidth: 112; color: Theme.surface
    Rectangle { anchors.right: parent.right; width: 1; height: parent.height; color: Theme.border }
    Column {
        anchors.fill: parent; anchors.topMargin: 10; spacing: 4
        Repeater {
            model: rail.model
            Item {
                id: item
                width: rail.width; height: 80
                property bool active: index === rail.currentIndex
                // active item: tinted pill, so the selection reads as a fill, not a hairline
                Rectangle {
                    anchors.fill: parent; anchors.leftMargin: 10; anchors.rightMargin: 10
                    radius: Theme.radius
                    color: item.active ? Theme.tint(Theme.accent, 0.16) : (ma.pressed ? Theme.surface2 : "transparent")
                }
                Column { anchors.centerIn: parent; spacing: 6
                    Icon { anchors.horizontalCenter: parent.horizontalCenter
                        name: modelData.icon !== undefined ? modelData.icon : modelData.key
                        size: 28; stroke: item.active ? 2.4 : 2
                        color: item.active ? Theme.accent : Theme.textMute }
                    Text { text: modelData.label; anchors.horizontalCenter: parent.horizontalCenter
                        color: item.active ? Theme.accent : Theme.textMute
                        font.pixelSize: Theme.fsLabel + 1; font.weight: item.active ? Font.DemiBold : Font.Medium }
                }
                MouseArea { id: ma; anchors.fill: parent; onClicked: rail.picked(index) }
            }
        }
    }
}
