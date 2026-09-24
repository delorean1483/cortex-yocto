import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
Item {
    id: grid
    property var pages: []
    signal opened(string target)
    ColumnLayout {
        anchors.fill: parent; anchors.margins: Theme.pad; spacing: 10
        SwipeView {
            id: sv; Layout.fillWidth: true; Layout.fillHeight: true; clip: true
            Repeater {
                model: grid.pages
                GridLayout {
                    columns: 3; rows: 2; columnSpacing: 12; rowSpacing: 12
                    Repeater {
                        model: modelData
                        Rectangle {
                            Layout.fillWidth: true; Layout.fillHeight: true; radius: Theme.radiusLg
                            color: tap.pressed ? Theme.surface2 : Theme.surface
                            border.color: tap.pressed ? Theme.accent : "transparent"; border.width: 1
                            Column { anchors.centerIn: parent; spacing: 10
                                Icon { anchors.horizontalCenter: parent.horizontalCenter
                                    name: modelData.icon !== undefined ? modelData.icon : ""
                                    size: 36; color: Theme.accent }
                                Text { text: modelData.title; anchors.horizontalCenter: parent.horizontalCenter
                                    color: Theme.text; font.pixelSize: Theme.fsBody; font.weight: Font.Medium } }
                            Icon { visible: modelData.locked === true; name: "lock"; size: 16
                                color: Theme.warn
                                anchors.top: parent.top; anchors.right: parent.right; anchors.margins: 12 }
                            // TapHandler (not MouseArea) so taps register inside the SwipeView's flickable
                            TapHandler { id: tap; gesturePolicy: TapHandler.ReleaseWithinBounds
                                onTapped: grid.opened(modelData.target) }
                        }
                    }
                }
            }
        }
        Row {
            Layout.alignment: Qt.AlignHCenter; spacing: 8; visible: grid.pages.length > 1
            Repeater { model: grid.pages.length
                Rectangle { width: index === sv.currentIndex ? 20 : 8; height: 8; radius: 4
                    color: index === sv.currentIndex ? Theme.accent : Theme.border
                    Behavior on width { NumberAnimation { duration: 150 } } } }
        }
    }
}
