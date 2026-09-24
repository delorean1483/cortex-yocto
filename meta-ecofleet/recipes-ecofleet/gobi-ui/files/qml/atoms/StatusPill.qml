import QtQuick
import ".."
Rectangle {
    property string label: ""
    property color hue: Theme.accent
    implicitWidth: t.width + 28; implicitHeight: 30; radius: height/2
    color: Theme.tint(hue, 0.16); border.color: hue; border.width: 1
    Text { id: t; anchors.centerIn: parent; text: label; color: hue
           font.pixelSize: Theme.fsLabel; font.weight: Font.Bold; font.letterSpacing: Theme.lsCaps }
}
