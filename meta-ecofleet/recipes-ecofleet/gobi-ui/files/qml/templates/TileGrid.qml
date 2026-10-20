import QtQuick
import QtQuick.Layouts
import ".."
import "../atoms"
Item {
    id: grid
    property var tiles: []
    property int columns: 4
    property var counts: ({})     // active-alert count keyed by tile target
    signal opened(string target)
    GridLayout {
        anchors.fill: parent; anchors.margins: Theme.pad
        columns: grid.columns; columnSpacing: 12; rowSpacing: 12
        Repeater {
            model: grid.tiles
            Rectangle {
                id: tile
                readonly property int n: grid.counts[modelData.target] || 0
                readonly property bool alert: n > 0
                Layout.fillWidth: true; Layout.fillHeight: true
                Layout.preferredWidth: 155; Layout.preferredHeight: 128
                radius: 14
                color: alert ? Theme.tint(Theme.fault, 0.18) : (tap.pressed ? Theme.surface2 : Theme.surface)
                Column { anchors.centerIn: parent; spacing: 10
                    Icon { anchors.horizontalCenter: parent.horizontalCenter
                        name: modelData.icon !== undefined ? modelData.icon : ""
                        size: 30; color: tile.alert ? Theme.faultText : Theme.accent }
                    Text { text: modelData.title; anchors.horizontalCenter: parent.horizontalCenter
                        color: Theme.text; font.pixelSize: 15
                        font.weight: tile.alert ? Font.DemiBold : Font.Medium } }
                PinTag { visible: modelData.locked === true
                    anchors.top: parent.top; anchors.right: parent.right; anchors.margins: 10 }
                Text { visible: tile.alert; text: tile.n + " active"
                    color: Theme.faultText; font.pixelSize: Theme.fsCaption; font.weight: Font.Bold
                    anchors.top: parent.top; anchors.right: parent.right; anchors.margins: 10 }
                TapHandler { id: tap; gesturePolicy: TapHandler.ReleaseWithinBounds
                    onTapped: grid.opened(modelData.target) }
            }
        }
    }
}
