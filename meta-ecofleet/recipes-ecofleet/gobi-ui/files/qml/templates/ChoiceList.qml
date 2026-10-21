import QtQuick
import QtQuick.Layouts
import ".."
import "../atoms"
// Radio-card list. Sizing/margins belong to the parent (ModeScreen puts it in a
// margined ColumnLayout), so it works both anchored and as a layout child.
ColumnLayout {
    id: list
    property var model: []
    property string current: ""
    signal picked(string value)
    spacing: 10
    Repeater {
        model: list.model
        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 100; radius: 12
            property bool sel: modelData.value === list.current
            color: sel ? Theme.surface2 : Theme.surface
            RowLayout {
                anchors.fill: parent; anchors.leftMargin: 20; anchors.rightMargin: 20; spacing: 18
                Rectangle {
                    Layout.preferredWidth: 28; Layout.preferredHeight: 28; Layout.alignment: Qt.AlignVCenter
                    radius: 14
                    color: sel ? Theme.accent : "transparent"
                    border.color: Theme.radioRing; border.width: sel ? 0 : 2
                    Icon { anchors.centerIn: parent; visible: sel; name: "check"; size: 18; stroke: 3; color: Theme.textOnAccent }
                }
                ColumnLayout {
                    Layout.fillWidth: true; Layout.alignment: Qt.AlignVCenter; spacing: 4
                    Text { text: modelData.title; color: sel ? Theme.accent : Theme.text
                           font.pixelSize: 20; font.weight: sel ? Font.Bold : Font.DemiBold }
                    Text { text: modelData.help; color: Theme.textDim; font.pixelSize: 15
                           Layout.fillWidth: true; wrapMode: Text.WordWrap }
                }
            }
            MouseArea { anchors.fill: parent; onClicked: list.picked(modelData.value) }
        }
    }
    Item { Layout.fillHeight: true }
}
