import QtQuick
import "."
import "atoms"
Rectangle {
    id: rail
    property var model: []
    property int currentIndex: 0
    signal picked(int index)
    implicitWidth: 160; color: Theme.surface
    Rectangle { anchors.right: parent.right; width: 1; height: parent.height; color: Theme.border }
    Column {
        anchors.fill: parent; anchors.topMargin: 8
        Repeater {
            model: rail.model
            Item {
                id: item
                width: 160; height: 84
                property bool active: index === rail.currentIndex
                Rectangle { anchors.left: parent.left; width: 3; height: parent.height
                    color: item.active ? Theme.accent : "transparent" }
                Column { anchors.centerIn: parent; spacing: 6
                    Icon { anchors.horizontalCenter: parent.horizontalCenter
                        name: modelData.icon !== undefined ? modelData.icon : modelData.key
                        size: 28; stroke: item.active ? 2.4 : 2
                        color: item.active ? Theme.accent : Theme.textMute }
                    Text { text: modelData.label; anchors.horizontalCenter: parent.horizontalCenter
                        color: item.active ? Theme.accent : Theme.textMute
                        font.pixelSize: 14; font.weight: item.active ? Font.Bold : Font.Medium }
                }
                MouseArea { anchors.fill: parent; onClicked: rail.picked(index) }
            }
        }
    }
}
