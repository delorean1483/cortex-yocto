import QtQuick
import ".."
Rectangle {
    property string label: ""; property string value: ""
    property color valueColor: Theme.text
    radius: Theme.radius; color: Theme.surface
    Column {
        anchors.left: parent.left; anchors.leftMargin: 14
        anchors.verticalCenter: parent.verticalCenter; spacing: 2
        Text { text: label; color: Theme.textMute; font.pixelSize: Theme.fsCaption }
        Text { text: value; color: valueColor; font.pixelSize: 22; font.weight: Font.DemiBold }
    }
}
