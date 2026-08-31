import QtQuick
import "."
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
                Column { anchors.centerIn: parent; spacing: 4
                    // icon placeholder: a rounded square; replace with line-icon set during styling
                    Rectangle { width: 30; height: 30; radius: 8; anchors.horizontalCenter: parent.horizontalCenter
                        color: "transparent"; border.width: 2
                        border.color: item.active ? Theme.accent : Theme.textMute }
                    Text { text: modelData.label; anchors.horizontalCenter: parent.horizontalCenter
                        color: item.active ? Theme.accent : Theme.textMute
                        font.pixelSize: 14; font.weight: item.active ? Font.Bold : Font.Medium }
                }
                MouseArea { anchors.fill: parent; onClicked: rail.picked(index) }
            }
        }
    }
}
