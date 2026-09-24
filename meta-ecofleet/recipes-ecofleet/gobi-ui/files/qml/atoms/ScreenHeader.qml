import QtQuick
import QtQuick.Layouts
import ".."
// Back button + title (+ optional subtitle) row for Menu sub-screens. Emits
// back(); the screen wires it to its StackView pop (the atom can't reach the
// StackView attached prop).
RowLayout {
    id: h
    property string title: ""
    property string subtitle: ""
    property color subtitleColor: Theme.textMute
    signal back()
    Layout.fillWidth: true
    spacing: 6
    Rectangle {
        Layout.preferredWidth: 44; Layout.preferredHeight: 44
        radius: Theme.radiusSm
        color: bma.pressed ? Theme.surface2 : "transparent"
        Icon { anchors.centerIn: parent; name: "chevron-left"; size: 26; stroke: 2.4; color: Theme.accent }
        MouseArea { id: bma; anchors.fill: parent; anchors.margins: -6; onClicked: h.back() }
    }
    ColumnLayout {
        spacing: 0
        Text { text: h.title; color: Theme.text; font.pixelSize: Theme.fsTitle; font.weight: Font.DemiBold }
        Text { visible: h.subtitle !== ""; text: h.subtitle; color: h.subtitleColor; font.pixelSize: Theme.fsCaption }
    }
    Item { Layout.fillWidth: true }
}
