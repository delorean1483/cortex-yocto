import QtQuick
import ".."
Rectangle {
    id: banner
    property string text: ""
    property color hue: Theme.fault
    signal clicked()
    visible: text !== ""
    implicitHeight: visible ? 30 : 0; radius: 8
    color: Qt.rgba(hue.r, hue.g, hue.b, 0.15); border.color: hue; border.width: 1
    Row { anchors.left: parent.left; anchors.leftMargin: 12; anchors.verticalCenter: parent.verticalCenter; spacing: 8
        Rectangle { width: 8; height: 8; radius: 4; color: banner.hue; anchors.verticalCenter: parent.verticalCenter }
        Text { text: banner.text; color: banner.hue; font.pixelSize: 13; font.weight: Font.DemiBold
               anchors.verticalCenter: parent.verticalCenter } }
    MouseArea { anchors.fill: parent; onClicked: banner.clicked() }
}
