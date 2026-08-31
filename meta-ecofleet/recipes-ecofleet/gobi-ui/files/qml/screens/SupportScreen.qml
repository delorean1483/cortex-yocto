import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
Item {
    id: page
    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: 12
        ScreenHeader { title: "Support"; onBack: if (page.StackView.view) page.StackView.view.pop() }

        Rectangle {
            Layout.fillWidth: true; Layout.fillHeight: true
            radius: 12; color: Theme.surface
            ColumnLayout {
                anchors.fill: parent; anchors.margins: 16; spacing: 12
                Text { text: "Need help?"; color: Theme.text; font.pixelSize: 20; font.weight: Font.Bold }
                Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.textDim; font.pixelSize: 14
                    text: "Contact your fleet administrator or EcoFleet support for help with this APU. Have the unit details below ready so support can look up your unit." }

                Rectangle { Layout.fillWidth: true; height: 1; color: Theme.border }

                GridLayout { columns: 2; columnSpacing: 20; rowSpacing: 8
                    Text { text: "Serial";   color: Theme.textMute; font.pixelSize: 14 }
                    Text { text: devinfo.serial;    color: Theme.textDim; font.pixelSize: 14; font.weight: Font.Medium }
                    Text { text: "Firmware"; color: Theme.textMute; font.pixelSize: 14 }
                    Text { text: devinfo.fwVersion; color: Theme.textDim; font.pixelSize: 14; font.weight: Font.Medium }
                    Text { text: "IP";       color: Theme.textMute; font.pixelSize: 14 }
                    Text { text: devinfo.ipAddress; color: Theme.textDim; font.pixelSize: 14; font.weight: Font.Medium }
                }
                Item { Layout.fillHeight: true }
            }
        }
    }
}
