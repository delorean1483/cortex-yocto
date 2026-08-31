import QtQuick
import ".."
Rectangle {
    property string label: ""; property string value: ""
    property color valueColor: Theme.text
    radius: 10; color: Theme.surface
    Column {
        anchors.left: parent.left; anchors.leftMargin: 12
        anchors.verticalCenter: parent.verticalCenter; spacing: 2
        Text { text: label; color: Theme.textMute; font.pixelSize: 12 }
        Text { text: value; color: valueColor; font.pixelSize: 22; font.weight: Font.DemiBold }
    }
}
