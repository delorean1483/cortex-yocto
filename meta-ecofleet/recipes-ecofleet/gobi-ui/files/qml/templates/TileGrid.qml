import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
Item {
    id: grid
    property var pages: []
    signal opened(string target)
    ColumnLayout {
        anchors.fill: parent; anchors.margins: 16; spacing: 8
        SwipeView {
            id: sv; Layout.fillWidth: true; Layout.fillHeight: true; clip: true
            Repeater {
                model: grid.pages
                GridLayout {
                    columns: 3; rows: 2; columnSpacing: 12; rowSpacing: 12
                    Repeater {
                        model: modelData
                        Rectangle {
                            Layout.fillWidth: true; Layout.fillHeight: true; radius: 12
                            color: ma.pressed ? Theme.surface2 : Theme.surface
                            border.color: Theme.border; border.width: 1
                            Column { anchors.centerIn: parent; spacing: 8
                                Rectangle { width: 40; height: 40; radius: 10; anchors.horizontalCenter: parent.horizontalCenter
                                    color: "transparent"; border.color: Theme.textMute; border.width: 2 }
                                Text { text: modelData.title; anchors.horizontalCenter: parent.horizontalCenter
                                    color: Theme.text; font.pixelSize: 15 } }
                            Text { visible: modelData.locked === true; text: "\u{1F512}"
                                anchors.top: parent.top; anchors.right: parent.right; anchors.margins: 8; font.pixelSize: 14 }
                            MouseArea { id: ma; anchors.fill: parent; onClicked: grid.opened(modelData.target) }
                        }
                    }
                }
            }
        }
        Row {
            Layout.alignment: Qt.AlignHCenter; spacing: 8; visible: grid.pages.length > 1
            Repeater { model: grid.pages.length
                Rectangle { width: 8; height: 8; radius: 4
                    color: index === sv.currentIndex ? Theme.accent : Theme.border } }
        }
    }
}
