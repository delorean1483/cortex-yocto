import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
Item {
    id: page
    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: Theme.gap
        ScreenHeader { title: "Support"; onBack: if (page.StackView.view) page.StackView.view.pop() }

        // nested layouts default to fillHeight — size the row to its cards instead
        RowLayout {
            Layout.fillWidth: true; Layout.fillHeight: false; spacing: Theme.gap
            Rectangle {
                Layout.fillWidth: true; Layout.preferredWidth: 1; Layout.fillHeight: true
                radius: Theme.radius; color: Theme.surface
                ColumnLayout {
                    anchors.fill: parent; anchors.margins: Theme.pad; spacing: 8
                    RowLayout { spacing: 10
                        Icon { name: "support"; size: 24; color: Theme.accent }
                        Text { text: "Need help?"; color: Theme.text; font.pixelSize: Theme.fsTitle; font.weight: Font.Bold } }
                    Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.textDim; font.pixelSize: Theme.fsLabel + 1
                        text: "Contact your fleet administrator or EcoFleet support. Have these unit details ready so support can look up your unit." }
                    Item { Layout.fillHeight: true }
                }
            }
            InfoCard { Layout.fillWidth: true; Layout.preferredWidth: 1; Layout.alignment: Qt.AlignTop
                title: "Unit details"
                rows: [ {k: "Serial",     v: devinfo.serial},
                        {k: "Firmware",   v: devinfo.fwVersion},
                        {k: "IP address", v: devinfo.ipAddress} ] }
        }
        Item { Layout.fillHeight: true }
    }
}
