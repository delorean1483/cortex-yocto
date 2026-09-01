import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
Item {
    id: page

    // Read-only live monitoring. All APU actuation (START/STOP, evap fan, the
    // passcode-gated relay test) lives on its own ComponentTestScreen now.

    property var sections: [
        { name: "STATUS", tiles: [
            ["Mode", telemetry.mode, false], ["Control Status", telemetry.controlStatus, false],
            ["Engine Status", telemetry.engineStatus, false], ["Error", telemetry.error, telemetry.hasError] ] },
        { name: "CLIMATE", tiles: [
            ["Cabin Temp", telemetry.cabinTempF.toFixed(0)+" °F", false], ["Setpoint", telemetry.clmtSetpointF.toFixed(0)+" °F", false],
            ["External Temp", telemetry.extTempF.toFixed(0)+" °F", false], ["Fan Speed", telemetry.fanSpeed>0?telemetry.fanSpeed+"%":"Off", false] ] },
        { name: "POWER & ENGINE", tiles: [
            ["Battery", telemetry.battV.toFixed(2)+" V", false], ["Engine RPM", telemetry.rpm+"", false],
            ["Oil Pressure", telemetry.oilOk?"OK":"LOW", !telemetry.oilOk], ["Ignition", telemetry.ignition?"On":"Off", false] ] },
        { name: "SERVICE", tiles: [
            ["Engine Hours", telemetry.engineHrs+" h", false], ["Oil Hours", telemetry.oilHrs+" h", false],
            ["Machine Hours", telemetry.machineHrs+" h", false], ["Oil Change", telemetry.oilChange, telemetry.oilChange!=="good"] ] }
    ]
    ColumnLayout {
        anchors.fill: parent; anchors.margins: 12; spacing: 8

        RowLayout { Layout.fillWidth: true
            Text { text: "‹"; color: Theme.accentBlue; font.pixelSize: 26
                MouseArea { anchors.fill: parent; anchors.margins: -12; onClicked: if (page.StackView.view) page.StackView.view.pop() } }
            Text { text: "Live Diagnostics"; color: Theme.textDim; font.pixelSize: 18; font.weight: Font.DemiBold } }

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
                    ColumnLayout { Layout.fillWidth: true; spacing: 3
                        Text { text: modelData.name; color: Theme.textMute; font.pixelSize: 11; font.letterSpacing: 2; font.weight: Font.DemiBold }
                        RowLayout { Layout.fillWidth: true; Layout.preferredHeight: 56; spacing: 8
                            Repeater { model: modelData.tiles
                                Rectangle { Layout.fillWidth: true; Layout.fillHeight: true; radius: 10; color: Theme.surface
                                    border.color: modelData[2] ? Theme.fault : "transparent"; border.width: modelData[2] ? 1 : 0
                                    Column { anchors.left: parent.left; anchors.leftMargin: 14; anchors.right: parent.right; anchors.rightMargin: 10
                                             anchors.verticalCenter: parent.verticalCenter; spacing: 2
                                        Text { text: modelData[0]; color: Theme.textMute; font.pixelSize: 12; elide: Text.ElideRight; width: parent.width }
                                        Text { text: modelData[1]; color: modelData[2] ? Theme.fault : Theme.text; font.pixelSize: 20
                                               font.weight: Font.DemiBold; elide: Text.ElideRight; width: parent.width } } } } } } }

                Item { Layout.preferredHeight: 4 }
            }
        }
    }
}
