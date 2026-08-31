import QtQuick
import ".."
Rectangle {
    property string label: ""
    property color hue: Theme.accent
    implicitWidth: t.width + 28; implicitHeight: 30; radius: height/2
    color: Qt.rgba(hue.r, hue.g, hue.b, 0.15); border.color: hue; border.width: 1
    Text { id: t; anchors.centerIn: parent; text: label; color: hue
           font.pixelSize: 15; font.weight: Font.Bold }
}
