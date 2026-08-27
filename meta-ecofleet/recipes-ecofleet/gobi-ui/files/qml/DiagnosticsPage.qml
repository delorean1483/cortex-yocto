import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// Live diagnostics, grouped by category into four labelled sections that fill
// the 800x480 panel exactly (no scrolling).
Page {
    id: page
    background: Rectangle { color: "#0D1117" }

    // Rebuilt on every telemetry change (property bindings inside).
    property var sections: [
        { name: "STATUS", tiles: [
            ["Mode",           telemetry.mode,                                false],
            ["Control Status", telemetry.controlStatus,                       false],
            ["Engine Status",  telemetry.engineStatus,                        false],
            ["Error",          telemetry.error,                               telemetry.hasError] ] },
        { name: "CLIMATE", tiles: [
            ["Cabin Temp",     telemetry.cabinTempF.toFixed(0) + " °F",       false],
            ["Setpoint",       telemetry.clmtSetpointF.toFixed(0) + " °F",    false],
            ["External Temp",  telemetry.extTempF.toFixed(0) + " °F",         false],
            ["Fan Speed",      ["Low","Med","High"][telemetry.fanSpeed] || "—", false] ] },
        { name: "POWER & ENGINE", tiles: [
            ["Battery",        telemetry.battV.toFixed(2) + " V",             false],
            ["Engine RPM",     telemetry.rpm + "",                            false],
            ["Oil Pressure",   telemetry.oilOk ? "OK" : "LOW",                !telemetry.oilOk],
            ["Ignition",       telemetry.ignition ? "On" : "Off",             false] ] },
        { name: "SERVICE", tiles: [
            ["Engine Hours",   telemetry.engineHrs + " h",                    false],
            ["Oil Hours",      telemetry.oilHrs + " h",                       false],
            ["Machine Hours",  telemetry.machineHrs + " h",                   false],
            ["Oil Change",     telemetry.oilChange,                           telemetry.oilChange !== "good"] ] }
    ]

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 12
        spacing: 6

        Text { text: "Live Diagnostics"; color: "#C9D1D9"
               font.pixelSize: 18; font.weight: Font.DemiBold }

        // Four equal-height category sections.
        Repeater {
            model: page.sections
            ColumnLayout {
                Layout.fillWidth: true
                Layout.fillHeight: true
                spacing: 3

                Text { text: modelData.name; color: "#6E7681"
                       font.pixelSize: 11; font.letterSpacing: 2; font.weight: Font.DemiBold }

                RowLayout {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    spacing: 8

                    Repeater {
                        model: modelData.tiles
                        Rectangle {
                            Layout.fillWidth: true
                            Layout.fillHeight: true
                            radius: 10
                            color: "#161B22"
                            border.color: modelData[2] ? "#F85149" : "transparent"
                            border.width: modelData[2] ? 1 : 0

                            Column {
                                anchors.left: parent.left;  anchors.leftMargin: 14
                                anchors.right: parent.right; anchors.rightMargin: 10
                                anchors.verticalCenter: parent.verticalCenter
                                spacing: 2
                                Text { text: modelData[0]; color: "#6E7681"
                                       font.pixelSize: 12; elide: Text.ElideRight; width: parent.width }
                                Text { text: modelData[1]
                                       color: modelData[2] ? "#F85149" : "#E6EDF3"
                                       font.pixelSize: 22; font.weight: Font.DemiBold
                                       elide: Text.ElideRight; width: parent.width }
                            }
                        }
                    }
                }
            }
        }
    }
}
