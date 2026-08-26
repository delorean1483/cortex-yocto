import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Page {
    id: page
    background: Rectangle { color: "#0D1117" }

    // ── Control-status color map (climate APU) ────────────────────────────────
    function statusColor(s) {
        if (s === "running")                     return "#3FB950"  // green
        if (s === "cooling" || s === "chillin")  return "#2F81F7"  // blue
        if (s === "defrost")                     return "#58A6FF"
        if (s === "charging")                    return "#00C49A"  // teal
        if (s === "warming_up" || s === "starting") return "#E3B341" // amber
        return "#8B949E"  // off / unknown
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 20
        spacing: 14

        // ── Status card ───────────────────────────────────────────────────────
        Rectangle {
            Layout.fillWidth: true
            height: 90
            radius: 12; color: "#161B22"
            border.color: page.statusColor(telemetry.controlStatus); border.width: 2

            RowLayout {
                anchors.fill: parent; anchors.margins: 18; spacing: 14

                Rectangle {
                    width: 14; height: 14; radius: 7
                    color: page.statusColor(telemetry.controlStatus)
                }

                Column {
                    spacing: 0
                    Text {
                        text: telemetry.controlStatus.toUpperCase().replace("_", " ")
                        color: page.statusColor(telemetry.controlStatus)
                        font.pixelSize: 30; font.weight: Font.Bold
                    }
                    Text {
                        text: "Mode: " + telemetry.mode.toUpperCase()
                        color: "#6E7681"; font.pixelSize: 13
                    }
                }

                Item { Layout.fillWidth: true }

                Column {
                    spacing: 2
                    Text {
                        text: telemetry.engineHrs + " hrs"
                        color: "#C9D1D9"; font.pixelSize: 22; font.weight: Font.Medium
                    }
                    Text { text: "Engine Runtime"; color: "#6E7681"; font.pixelSize: 12 }
                }
            }
        }

        // ── Metrics row ───────────────────────────────────────────────────────
        RowLayout {
            Layout.fillWidth: true
            spacing: 14

            // Cabin temperature + setpoint
            Rectangle {
                Layout.fillWidth: true; Layout.fillHeight: true
                radius: 12; color: "#161B22"

                ColumnLayout {
                    anchors.fill: parent; anchors.margins: 18; spacing: 4

                    Text { text: "Cabin Temp"; color: "#8B949E"; font.pixelSize: 12 }

                    RowLayout {
                        spacing: 6
                        Text {
                            text: telemetry.cabinTempF.toFixed(0)
                            color: "#C9D1D9"; font.pixelSize: 46; font.weight: Font.Bold
                        }
                        Text {
                            text: "°F"; color: "#8B949E"; font.pixelSize: 22
                            Layout.alignment: Qt.AlignBottom; bottomPadding: 10
                        }
                    }

                    Item { Layout.fillHeight: true }

                    Text {
                        text: "Setpoint " + telemetry.clmtSetpointF.toFixed(0) + " °F"
                        color: "#6E7681"; font.pixelSize: 14
                    }
                }
            }

            // Battery + external temp
            Rectangle {
                Layout.fillWidth: true; Layout.fillHeight: true
                radius: 12; color: "#161B22"

                ColumnLayout {
                    anchors.fill: parent; anchors.margins: 18; spacing: 4

                    Text { text: "Battery"; color: "#8B949E"; font.pixelSize: 12 }

                    RowLayout {
                        spacing: 6
                        Text {
                            text: telemetry.battV.toFixed(1)
                            color: telemetry.battV > 0 && telemetry.battV < 11.8 ? "#F85149" : "#C9D1D9"
                            font.pixelSize: 46; font.weight: Font.Bold
                        }
                        Text {
                            text: "V"; color: "#8B949E"; font.pixelSize: 22
                            Layout.alignment: Qt.AlignBottom; bottomPadding: 10
                        }
                    }

                    Item { Layout.fillHeight: true }

                    Text {
                        text: "External " + telemetry.extTempF.toFixed(0) + " °F"
                        color: "#6E7681"; font.pixelSize: 14
                    }
                }
            }

            // Engine
            Rectangle {
                Layout.fillWidth: true; Layout.fillHeight: true
                radius: 12; color: "#161B22"

                ColumnLayout {
                    anchors.fill: parent; anchors.margins: 18; spacing: 4

                    Text { text: "Engine"; color: "#8B949E"; font.pixelSize: 12 }

                    RowLayout {
                        spacing: 6
                        Text {
                            text: telemetry.rpm
                            color: "#C9D1D9"; font.pixelSize: 46; font.weight: Font.Bold
                        }
                        Text {
                            text: "RPM"; color: "#8B949E"; font.pixelSize: 18
                            Layout.alignment: Qt.AlignBottom; bottomPadding: 12
                        }
                    }

                    Item { Layout.fillHeight: true }

                    Text {
                        text: "Oil Pressure  " + (telemetry.oilOk ? "OK" : "LOW")
                        color: telemetry.oilOk ? "#3FB950" : "#F85149"
                        font.pixelSize: 16; font.weight: Font.DemiBold
                    }
                    Text {
                        text: "Ignition " + (telemetry.ignition ? "On" : "Off")
                        color: "#6E7681"; font.pixelSize: 13
                    }
                }
            }
        }
    }
}
