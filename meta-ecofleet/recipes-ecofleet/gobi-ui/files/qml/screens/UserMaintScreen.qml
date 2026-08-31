import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
Item {
    id: page

    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: 10

        RowLayout { Layout.fillWidth: true
            Text { text: "‹"; color: Theme.accentBlue; font.pixelSize: 26
                MouseArea { anchors.fill: parent; anchors.margins: -10; onClicked: if (page.StackView.view) page.StackView.view.pop() } }
            Text { text: "User Maintenance"; color: Theme.textDim; font.pixelSize: 18; font.weight: Font.DemiBold } }

        // ── Hours + serial card ───────────────────────────────────────────────
        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 132
            radius: 12; color: Theme.surface
            ColumnLayout {
                anchors.fill: parent; anchors.margins: 14; spacing: 8
                Text { text: "Service Hours"; color: Theme.textLabel; font.pixelSize: 12; font.weight: Font.Medium }
                GridLayout {
                    columns: 2; columnSpacing: 16; rowSpacing: 6
                    Text { text: "Engine Hours";  color: Theme.textMute; font.pixelSize: 13 }
                    Text { text: telemetry.engineHrs + " h";  color: Theme.textDim; font.pixelSize: 13; font.weight: Font.Medium }
                    Text { text: "Machine Hours"; color: Theme.textMute; font.pixelSize: 13 }
                    Text { text: telemetry.machineHrs + " h"; color: Theme.textDim; font.pixelSize: 13; font.weight: Font.Medium }
                    Text { text: "Oil Hours";     color: Theme.textMute; font.pixelSize: 13 }
                    Text { text: telemetry.oilHrs + " h";     color: Theme.textDim; font.pixelSize: 13; font.weight: Font.Medium }
                    Text { text: "Serial";        color: Theme.textMute; font.pixelSize: 13 }
                    Text { text: devinfo.serial;              color: Theme.textDim; font.pixelSize: 13; font.weight: Font.Medium }
                }
            }
        }

        // ── Maintenance card (hold-to-reset oil timer) ────────────────────────
        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 92
            radius: 12; color: Theme.surface
            ColumnLayout {
                anchors.fill: parent; anchors.margins: 12; spacing: 8
                RowLayout { Layout.fillWidth: true
                    Text { text: "Engine Oil"; color: Theme.textLabel; font.pixelSize: 12; font.weight: Font.Medium }
                    Item { Layout.fillWidth: true }
                    Text { text: telemetry.oilHrs + " hrs"; color: Theme.textDim; font.pixelSize: 13; font.weight: Font.Medium } }
                Rectangle {
                    id: oilBtn
                    Layout.fillWidth: true; Layout.preferredHeight: 40
                    radius: 10; color: Theme.bg; border.color: Theme.border; border.width: 1
                    clip: true
                    property bool done: false
                    Rectangle {
                        id: holdFill
                        height: parent.height; radius: parent.radius; width: 0
                        color: "#33E3B341"
                        Behavior on width { NumberAnimation { duration: 1500; easing.type: Easing.Linear } }
                    }
                    Text { anchors.centerIn: parent
                           text: oilBtn.done ? "OIL TIMER RESET" : "HOLD TO RESET OIL TIMER"
                           color: oilBtn.done ? Theme.ok : Theme.warn
                           font.pixelSize: 13; font.weight: Font.DemiBold; font.letterSpacing: 1 }
                    Timer { id: oilHold; interval: 1500
                            onTriggered: { telemetry.resetOil(); oilBtn.done = true; oilClear.restart() } }
                    Timer { id: oilClear; interval: 2500; onTriggered: oilBtn.done = false }
                    MouseArea {
                        anchors.fill: parent
                        onPressed:  { oilBtn.done = false; oilHold.restart(); holdFill.width = oilBtn.width }
                        onReleased: { oilHold.stop(); holdFill.width = 0 }
                    }
                }
            }
        }

        Item { Layout.fillHeight: true }
    }
}
