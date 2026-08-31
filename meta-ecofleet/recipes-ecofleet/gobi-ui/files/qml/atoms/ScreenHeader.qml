import QtQuick
import QtQuick.Layouts
import ".."
// Back chevron + title row for Menu sub-screens. Emits back(); the screen wires
// it to its StackView pop (the atom can't reach the StackView attached prop).
RowLayout {
    id: h
    property string title: ""
    signal back()
    Layout.fillWidth: true
    spacing: 6
    Text { text: "‹"; color: Theme.accentBlue; font.pixelSize: 26
        MouseArea { anchors.fill: parent; anchors.margins: -12; onClicked: h.back() } }
    Text { text: h.title; color: Theme.textDim; font.pixelSize: 18; font.weight: Font.DemiBold }
    Item { Layout.fillWidth: true }
}
