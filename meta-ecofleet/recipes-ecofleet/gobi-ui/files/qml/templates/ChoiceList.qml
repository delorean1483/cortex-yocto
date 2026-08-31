import QtQuick
import QtQuick.Layouts
import ".."
ColumnLayout {
    id: list
    property var model: []
    property string current: ""
    signal picked(string value)
    anchors.margins: 16; spacing: 10
    Repeater {
        model: list.model
        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 88; radius: 12
            property bool sel: modelData.value === list.current
            color: sel ? Theme.surface2 : Theme.surface
            border.color: sel ? Theme.accent : Theme.border; border.width: sel ? 2 : 1
            Column { anchors.left: parent.left; anchors.leftMargin: 18; anchors.right: parent.right
                     anchors.rightMargin: 18; anchors.verticalCenter: parent.verticalCenter; spacing: 4
                Text { text: modelData.title; color: sel ? Theme.accent : Theme.text
                       font.pixelSize: 20; font.weight: Font.Bold }
                Text { text: modelData.help; color: Theme.textMute; font.pixelSize: 14
                       width: parent.width; wrapMode: Text.WordWrap } }
            MouseArea { anchors.fill: parent; onClicked: list.picked(modelData.value) }
        }
    }
    Item { Layout.fillHeight: true }
}
