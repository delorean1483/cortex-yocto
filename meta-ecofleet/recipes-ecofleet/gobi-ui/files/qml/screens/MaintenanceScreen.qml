import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
// Technician hub: one row per tool, each opening its own screen.
Item {
    id: page
    Component { id: comptestC;  ComponentTestScreen {} }
    Component { id: diagC;      DiagnosticsScreen {} }
    Component { id: usermaintC; UserMaintScreen {} }
    Component { id: swupdC;     SoftwareUpdateScreen {} }
    function open(c) { if (page.StackView.view) page.StackView.view.push(c) }

    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: 10
        ScreenHeader { title: "Maintenance"; subtitle: "Technician tools"
            onBack: if (page.StackView.view) page.StackView.view.pop() }

        Repeater {
            model: [
                { icon: "mode", title: "Component Test", desc: "Actuate relays one at a time", c: comptestC, locked: true },
                { icon: "cpu",  title: "Software Update", desc: "Check for and install new unit software", c: swupdC, locked: false }
            ]
            Rectangle {
                Layout.fillWidth: true; Layout.preferredHeight: 80
                radius: Theme.radius; color: rma.pressed ? Theme.surface2 : Theme.surface
                RowLayout {
                    anchors.fill: parent; anchors.leftMargin: 18; anchors.rightMargin: 14; spacing: 16
                    Icon { name: modelData.icon; size: 30; color: Theme.accent }
                    ColumnLayout { Layout.fillWidth: true; spacing: 2
                        RowLayout { spacing: 10
                            Text { text: modelData.title; color: Theme.text; font.pixelSize: 18; font.weight: Font.DemiBold }
                            PinTag { visible: modelData.locked }
                            Text { visible: !modelData.locked && telemetry.otaAvailable !== ""
                                text: telemetry.otaAvailable + " available"; color: Theme.accent
                                font.pixelSize: 13; font.weight: Font.DemiBold } }
                        Text { Layout.fillWidth: true; text: modelData.desc; color: Theme.textDim
                            font.pixelSize: 14; elide: Text.ElideRight } }
                    Icon { name: "chevron-right"; size: 22; color: Theme.textDim }
                }
                MouseArea { id: rma; anchors.fill: parent; onClicked: page.open(modelData.c) }
            }
        }

        Text { Layout.topMargin: 6; text: "ALSO IN MENU"; color: Theme.textMute
            font.pixelSize: Theme.fsCaption; font.letterSpacing: Theme.lsCaps; font.weight: Font.DemiBold }
        RowLayout { Layout.fillWidth: true; spacing: 10
            Repeater {
                model: [
                    { icon: "diag",   title: "Live Diagnostics", c: diagC },
                    { icon: "wrench", title: "User Maintenance", c: usermaintC }
                ]
                Rectangle {
                    Layout.fillWidth: true; Layout.preferredWidth: 1; Layout.preferredHeight: 60
                    radius: Theme.radius; color: cma.pressed ? Theme.surface2 : Theme.surface
                    RowLayout {
                        anchors.fill: parent; anchors.leftMargin: 16; anchors.rightMargin: 14; spacing: 14
                        Icon { name: modelData.icon; size: 24; color: Theme.accent }
                        Text { Layout.fillWidth: true; text: modelData.title; color: Theme.text
                            font.pixelSize: Theme.fsBody; font.weight: Font.DemiBold; elide: Text.ElideRight }
                        Icon { name: "chevron-right"; size: 20; color: Theme.textDim }
                    }
                    MouseArea { id: cma; anchors.fill: parent; onClicked: page.open(modelData.c) }
                }
            }
        }
        Item { Layout.fillHeight: true }
    }
}
