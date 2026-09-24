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
    function open(c) { if (page.StackView.view) page.StackView.view.push(c) }

    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: 10
        ScreenHeader { title: "Maintenance"; subtitle: "Technician tools"
            onBack: if (page.StackView.view) page.StackView.view.pop() }

        Repeater {
            model: [
                { icon: "mode",   title: "Component Test",   desc: "Actuate relays one at a time — maintenance passcode required", c: comptestC, locked: true },
                { icon: "diag",   title: "Live Diagnostics", desc: "Live sensor, engine and service readings", c: diagC, locked: false },
                { icon: "wrench", title: "User Maintenance", desc: "Service hours and oil-timer reset", c: usermaintC, locked: false }
            ]
            Rectangle {
                Layout.fillWidth: true; Layout.preferredHeight: 76
                radius: Theme.radius; color: rma.pressed ? Theme.surface2 : Theme.surface
                RowLayout {
                    anchors.fill: parent; anchors.leftMargin: 18; anchors.rightMargin: 14; spacing: 16
                    Icon { name: modelData.icon; size: 30; color: Theme.accent }
                    ColumnLayout { Layout.fillWidth: true; spacing: 2
                        RowLayout { spacing: 8
                            Text { text: modelData.title; color: Theme.text; font.pixelSize: Theme.fsBody + 1; font.weight: Font.DemiBold }
                            Icon { visible: modelData.locked; name: "lock"; size: 15; color: Theme.warn } }
                        Text { Layout.fillWidth: true; text: modelData.desc; color: Theme.textMute
                            font.pixelSize: Theme.fsLabel; elide: Text.ElideRight } }
                    Icon { name: "chevron-right"; size: 22; color: Theme.textMute }
                }
                MouseArea { id: rma; anchors.fill: parent; onClicked: page.open(modelData.c) }
            }
        }
        Item { Layout.fillHeight: true }
    }
}
