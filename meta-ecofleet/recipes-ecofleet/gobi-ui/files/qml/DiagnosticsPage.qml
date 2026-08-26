import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Page {
    id: page
    background: Rectangle { color: "#0D1117" }

    // Evaluated every time telemetry emits dataChanged
    property var items: [
        ["Mode",            telemetry.mode],
        ["Control Status",  telemetry.controlStatus],
        ["Engine Status",   telemetry.engineStatus],
        ["Cabin Temp",      telemetry.cabinTempF.toFixed(0) + " °F"],
        ["Setpoint",        telemetry.clmtSetpointF.toFixed(0) + " °F"],
        ["External Temp",   telemetry.extTempF.toFixed(0) + " °F"],
        ["Battery",         telemetry.battV.toFixed(2) + " V"],
        ["Engine RPM",      telemetry.rpm + ""],
        ["Fan Speed",       telemetry.fanSpeed + ""],
        ["Oil Pressure",    telemetry.oilOk ? "OK" : "LOW"],
        ["Ignition",        telemetry.ignition ? "On" : "Off"],
        ["Error",           telemetry.error],
        ["Oil Change",      telemetry.oilChange],
        ["Engine Hrs",      telemetry.engineHrs + " hrs"],
        ["Machine Hrs",     telemetry.machineHrs + " hrs"],
    ]

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 12
        spacing: 10

        Text {
            text: "Live Diagnostics"
            color: "#C9D1D9"; font.pixelSize: 18; font.weight: Font.DemiBold
        }

        // 3-column grid via a Flow
        Item {
            Layout.fillWidth: true
            Layout.fillHeight: true

            Grid {
                id: grid
                anchors.top: parent.top
                anchors.left: parent.left
                width: parent.width
                columns: 3
                rowSpacing: 8
                columnSpacing: 10

                property real cellW: (width - columnSpacing * (columns - 1)) / columns

                Repeater {
                    model: page.items

                    Rectangle {
                        width: grid.cellW
                        height: 68
                        radius: 10
                        color: "#161B22"

                        Column {
                            anchors.left: parent.left; anchors.leftMargin: 16
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: 4

                            Text {
                                text: modelData[0]
                                color: "#6E7681"; font.pixelSize: 12
                            }
                            Text {
                                text: modelData[1]
                                color: (modelData[0] === "Error" && telemetry.hasError) ||
                                       (modelData[0] === "Oil Pressure" && !telemetry.oilOk)
                                       ? "#F85149" : "#C9D1D9"
                                font.pixelSize: 20; font.weight: Font.DemiBold
                            }
                        }
                    }
                }
            }
        }
    }
}
