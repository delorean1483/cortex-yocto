import QtQuick
import "."
import "atoms"
Rectangle {
    id: rail
    property var model: []
    property int currentIndex: 0
    property int badgeCount: 0
    property string badgeKey: "menu"
    signal picked(int index)
    implicitWidth: 112; color: Theme.surface
    Rectangle { anchors.right: parent.right; width: 1; height: parent.height; color: Theme.border }
    Column {
        anchors.fill: parent; anchors.topMargin: 12; spacing: 8
        Repeater {
            model: rail.model
            Item {
                id: item
                width: rail.width; height: 84
                property bool active: index === rail.currentIndex
                // active item: tinted pill, so the selection reads as a fill, not a hairline
                Rectangle {
                    anchors.fill: parent; anchors.leftMargin: 10; anchors.rightMargin: 10
                    radius: 12
                    color: item.active ? Theme.tint(Theme.accent, 0.18) : (ma.pressed ? Theme.surface2 : "transparent")
                }
                Column { anchors.centerIn: parent; spacing: 6
                    Icon { anchors.horizontalCenter: parent.horizontalCenter
                        name: modelData.icon !== undefined ? modelData.icon : modelData.key
                        size: 28; stroke: item.active ? 2.4 : 2
                        color: item.active ? Theme.accent : Theme.textDim }
                    Text { text: modelData.label; anchors.horizontalCenter: parent.horizontalCenter
                        color: item.active ? Theme.accent : Theme.textDim
                        font.pixelSize: 15; font.weight: item.active ? Font.DemiBold : Font.Medium }
                }
                Rectangle {
                    visible: rail.badgeCount > 0 && modelData.key === rail.badgeKey
                    anchors.top: parent.top; anchors.topMargin: 10; anchors.right: parent.right; anchors.rightMargin: 28
                    width: 18; height: 18; radius: 9; color: Theme.fault
                    Text { anchors.centerIn: parent; text: rail.badgeCount; color: "#2A0705"
                        font.pixelSize: 12; font.weight: Font.Bold }
                }
                MouseArea { id: ma; anchors.fill: parent; onClicked: rail.picked(index) }
            }
        }
    }
}
