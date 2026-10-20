import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
Item {
    id: page

    // Read-only live monitoring. All APU actuation (START/STOP, evap fan, the
    // passcode-gated relay test) lives on its own ComponentTestScreen now.

    property real now: Date.now()
    Timer { interval: 1000; running: true; repeat: true; onTriggered: page.now = Date.now() }
    readonly property string freshness: StatusLabels.ago(telemetry.tsMs, page.now)

    property var sections: [
        { name: "STATUS", tiles: [
            ["Mode", StatusLabels.mode(telemetry.mode), false], ["Control Status", StatusLabels.control(telemetry.controlStatus), false],
            ["Engine Status", StatusLabels.control(telemetry.engineStatus), false], ["Error", StatusLabels.error(telemetry.error), telemetry.hasError, 2] ] },
        // Cabin and Enclosure are the same APU-enclosure PTC (reg 1), a stand-in
        // until the cortex has its own cab sensor, so one merged tile shows it.
        // Coolant is the PA4 sender (reg 51).
        { name: "CLIMATE", tiles: [
            ["Cabin (enclosure sensor)", telemetry.cabinTempF.toFixed(0)+"°F", false, 2], ["Setpoint", telemetry.clmtSetpointF.toFixed(0)+"°F", false],
            ["Coolant", telemetry.extTempF.toFixed(0)+"°F", false],
            ["Fan Speed", telemetry.fanSpeed>0?telemetry.fanSpeed+"%":"Off", false] ] },
        { name: "POWER & ENGINE", tiles: [
            ["Battery", telemetry.battV.toFixed(2)+" V", false], ["Engine RPM", telemetry.rpm+"", false],
            ["Oil Pressure", telemetry.oilOk?"OK":"LOW", !telemetry.oilOk], ["Ignition", telemetry.ignition?"On":"Off", false],
            ["Batt Target", telemetry.battSetpointV.toFixed(1)+" V", false] ] },
        { name: "SERVICE", tiles: [
            ["Engine Hours", telemetry.engineHrs+" h", false], ["Oil Hours", telemetry.oilHrs+" h", false],
            ["Machine Hours", telemetry.machineHrs+" h", false], ["Oil Change", StatusLabels.title(telemetry.oilChange), telemetry.oilChange!=="good", 2] ] }
    ]
    // Five columns keeps every section on one row so the page fits without
    // scrolling; the 4-tile sections give one tile a 2-column span (optional
    // 4th field) so the row fills instead of leaving an empty slot.
    ColumnLayout {
        anchors.fill: parent; anchors.margins: 12; spacing: 8

        RowLayout { Layout.fillWidth: true; spacing: 8
            ScreenHeader { title: "Live Diagnostics"; onBack: if (page.StackView.view) page.StackView.view.pop() }
            RowLayout { visible: page.freshness !== ""; spacing: 8
                Rectangle { Layout.preferredWidth: 8; Layout.preferredHeight: 8; radius: 4; color: telemetry.stale ? Theme.fault : Theme.ok }
                Text { text: "Updated " + page.freshness; color: Theme.textDim; font.pixelSize: 14 } }
        }

        Flickable {
            id: flick
            Layout.fillWidth: true; Layout.fillHeight: true
            contentHeight: content.height; clip: true
            boundsBehavior: Flickable.StopAtBounds
            ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

            ColumnLayout {
                id: content
                width: flick.width; spacing: 8

                // ── Live readings ────────────────────────────────────────────────
                Repeater { model: page.sections
                    ColumnLayout { Layout.fillWidth: true; spacing: 5
                        Text { text: modelData.name; color: Theme.textMute; font.pixelSize: Theme.fsCaption; font.letterSpacing: 1.2; font.weight: Font.DemiBold }
                        GridLayout { id: grid; Layout.fillWidth: true; columns: 5; columnSpacing: 8; rowSpacing: 8
                            Repeater { model: modelData.tiles
                                Rectangle { readonly property int span: modelData[3] || 1
                                    Layout.columnSpan: span; Layout.preferredHeight: 60
                                    Layout.preferredWidth: (content.width - 4 * grid.columnSpacing) / 5 * span + (span - 1) * grid.columnSpacing
                                    radius: 12; color: modelData[2] ? Theme.tint(Theme.fault, 0.18) : Theme.surface
                                    Column { anchors.left: parent.left; anchors.leftMargin: 14; anchors.right: parent.right; anchors.rightMargin: 10
                                             anchors.verticalCenter: parent.verticalCenter; spacing: 2
                                        Text { text: modelData[0]; color: modelData[2] ? Theme.text : Theme.textDim; font.pixelSize: Theme.fsCaption; elide: Text.ElideRight; width: parent.width }
                                        Text { text: modelData[1]; color: modelData[2] ? Theme.faultText : Theme.text; font.pixelSize: 20
                                               font.weight: Font.DemiBold; elide: Text.ElideRight; width: parent.width } } } } } } }

                Item { Layout.preferredHeight: 4 }
            }
        }
    }
}
