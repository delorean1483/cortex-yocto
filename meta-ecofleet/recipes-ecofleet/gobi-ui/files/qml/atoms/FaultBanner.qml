import QtQuick
import ".."
Rectangle {
    id: banner
    property string text: ""
    property color hue: Theme.fault
    signal clicked()
    visible: text !== ""
    implicitHeight: visible ? 36 : 0; radius: Theme.radiusSm
    color: Theme.tint(hue, 0.16); border.color: hue; border.width: 1
    Row { anchors.left: parent.left; anchors.leftMargin: 12; anchors.verticalCenter: parent.verticalCenter; spacing: 8
        Icon { name: "alert"; size: 18; color: banner.hue; anchors.verticalCenter: parent.verticalCenter }
        Text { text: banner.text; color: banner.hue; font.pixelSize: Theme.fsLabel + 1; font.weight: Font.DemiBold
               anchors.verticalCenter: parent.verticalCenter } }
    MouseArea { anchors.fill: parent; onClicked: banner.clicked() }
}
