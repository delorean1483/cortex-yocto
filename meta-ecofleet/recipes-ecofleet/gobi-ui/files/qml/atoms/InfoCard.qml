import QtQuick
import QtQuick.Layouts
import ".."
// Titled card of key/value rows: label left, value right-aligned, hairline
// between rows. `rows` is [{k, v, hue?}] (hue colours the value, e.g. a link
// state). Extra content (buttons, notes) can be declared as children and is
// laid out below the rows. Height follows content.
Rectangle {
    id: card
    property string title: ""
    property var rows: []
    default property alias content: extra.data
    radius: Theme.radius; color: Theme.surface
    implicitHeight: col.implicitHeight + 2 * Theme.pad - 6
    ColumnLayout {
        id: col
        anchors.left: parent.left; anchors.right: parent.right; anchors.top: parent.top
        anchors.leftMargin: Theme.pad; anchors.rightMargin: Theme.pad; anchors.topMargin: Theme.pad
        spacing: 0
        Text { visible: card.title !== ""; Layout.bottomMargin: 4; text: card.title
            color: Theme.textMute; font.pixelSize: Theme.fsCaption; font.letterSpacing: Theme.lsCaps
            font.weight: Font.DemiBold; font.capitalization: Font.AllUppercase }
        Repeater {
            model: card.rows
            Item {
                Layout.fillWidth: true; Layout.preferredHeight: 38
                Rectangle { visible: index > 0; width: parent.width; height: 1; color: Theme.border; opacity: 0.6 }
                Text { anchors.left: parent.left; anchors.verticalCenter: parent.verticalCenter
                    text: modelData.k; color: Theme.textMute; font.pixelSize: Theme.fsLabel + 1 }
                Text { anchors.right: parent.right; anchors.verticalCenter: parent.verticalCenter
                    text: modelData.v; color: modelData.hue !== undefined ? modelData.hue : Theme.text
                    font.pixelSize: Theme.fsLabel + 1; font.weight: Font.Medium }
            }
        }
        ColumnLayout { id: extra; Layout.fillWidth: true; spacing: 8 }
    }
}
