import QtQuick
import QtQuick.Controls
import "."
Item {
    id: shell
    width: 800; height: 480
    property var railModel: []
    property var railScreens: []     // Component[] aligned with railModel
    property int railIndex: 0
    function pushScreen(comp) { stack.push(comp) }
    function popScreen() { if (stack.depth > 1) stack.pop() }
    function selectRail(i) {
        shell.railIndex = i
        stack.clear()
        stack.push(railScreens[i])
    }
    Header { id: hdr; anchors.top: parent.top; anchors.left: parent.left; anchors.right: parent.right }
    Rail {
        id: rail
        anchors.top: hdr.bottom; anchors.bottom: parent.bottom; anchors.left: parent.left
        model: shell.railModel; currentIndex: shell.railIndex
        onPicked: shell.selectRail(index)
    }
    StackView {
        id: stack
        anchors.top: hdr.bottom; anchors.bottom: parent.bottom
        anchors.left: rail.right; anchors.right: parent.right
        clip: true
        Component.onCompleted: if (shell.railScreens.length) push(shell.railScreens[0])
    }
}
