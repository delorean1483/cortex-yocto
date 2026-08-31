import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
Item {
    id: page
    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: 12
        ScreenHeader { title: "Settings"; onBack: if (page.StackView.view) page.StackView.view.pop() }

        // About / system (real data)
        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 132
            radius: 12; color: Theme.surface
            ColumnLayout {
                anchors.fill: parent; anchors.margins: 14; spacing: 6
                Text { text: "About this unit"; color: Theme.textLabel; font.pixelSize: 12; font.weight: Font.Medium }
                GridLayout { columns: 2; columnSpacing: 16; rowSpacing: 5
                    Text { text: "Firmware"; color: Theme.textMute; font.pixelSize: 13 }
                    Text { text: devinfo.fwVersion; color: Theme.textDim; font.pixelSize: 13; font.weight: Font.Medium }
                    Text { text: "Serial";   color: Theme.textMute; font.pixelSize: 13 }
                    Text { text: devinfo.serial; color: Theme.textDim; font.pixelSize: 13; font.weight: Font.Medium }
                    Text { text: "Hostname"; color: Theme.textMute; font.pixelSize: 13 }
                    Text { text: devinfo.hostname; color: Theme.textDim; font.pixelSize: 13; font.weight: Font.Medium }
                }
            }
        }

        // Display & preferences (not yet wired)
        Rectangle {
            Layout.fillWidth: true; Layout.fillHeight: true
            radius: 12; color: Theme.surface
            ColumnLayout {
                anchors.fill: parent; anchors.margins: 14; spacing: 8
                Text { text: "Display & preferences"; color: Theme.textLabel; font.pixelSize: 12; font.weight: Font.Medium }
                Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.textMute; font.pixelSize: 14
                    text: "Screen brightness, sleep timeout, and units are a later update — they need panel backlight controls that aren't wired yet." }
                Item { Layout.fillHeight: true }
            }
        }
    }
}
