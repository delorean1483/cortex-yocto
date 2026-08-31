import QtQuick
import "."
Item {
    id: root
    default property alias content: canvas.data
    Rectangle { anchors.fill: parent; color: Theme.bg }   // fills letterbox area
    Item {
        id: canvas
        width: 800; height: 480
        anchors.centerIn: parent
        scale: Math.min(root.width / 800, root.height / 480)
        transformOrigin: Item.Center
        clip: true
    }
}
