import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Page {
    id: page
    background: Rectangle { color: "#0D1117" }

    // ── State color map ───────────────────────────────────────────────────────
    function stateColor(s) {
        if (s === "running")  return "#3FB950"
        if (s === "starting") return "#E3B341"
        if (s === "stopping") return "#E3B341"
        if (s === "fault")    return "#F85149"
        return "#8B949E"  // off / unknown
    }

    // ── Battery bar color ─────────────────────────────────────────────────────
    function socColor(soc) {
        if (soc >= 50) return "#3FB950"
        if (soc >= 20) return "#E3B341"
        return "#F85149"
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 20
        spacing: 14

        // ── Header ────────────────────────────────────────────────────────────
        RowLayout {
            Layout.fillWidth: true
            height: 40
            spacing: 12

            Text {
                text: "EcoFleet Gobi APU"
                color: "#C9D1D9"
                font.pixelSize: 18
                font.weight: Font.SemiBold
            }

            Item { Layout.fillWidth: true }

            // No-data badge
            Rectangle {
                visible: telemetry.stale
                width: noDataRow.width + 20; height: 28; radius: 14
                color: "#2D1B1B"; border.color: "#F85149"; border.width: 1
                Row {
                    id: noDataRow
                    anchors.centerIn: parent
                    spacing: 6
                    Rectangle { width: 6; height: 6; radius: 3; color: "#F85149"; anchors.verticalCenter: parent.verticalCenter }
                    Text { text: "NO DATA"; color: "#F85149"; font.pixelSize: 11; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                }
            }

            // Fault badge
            Rectangle {
                visible: telemetry.hasFault
                width: faultTxt.width + 20; height: 28; radius: 14
                color: "#2D1014"; border.color: "#F85149"; border.width: 1
                Text {
                    id: faultTxt
                    anchors.centerIn: parent
                    text: "FAULT " + telemetry.fault
                    color: "#F85149"; font.pixelSize: 11; font.weight: Font.Bold
                }
            }
        }

        // ── APU State card ────────────────────────────────────────────────────
        Rectangle {
            Layout.fillWidth: true
            height: 90
            radius: 12; color: "#161B22"
            border.color: page.stateColor(telemetry.apuState); border.width: 2

            RowLayout {
                anchors.fill: parent; anchors.margins: 18; spacing: 14

                Rectangle {
                    width: 14; height: 14; radius: 7
                    color: page.stateColor(telemetry.apuState)
                }

                Text {
                    text: telemetry.apuState.toUpperCase()
                    color: page.stateColor(telemetry.apuState)
                    font.pixelSize: 32; font.weight: Font.Bold
                }

                Item { Layout.fillWidth: true }

                Column {
                    spacing: 2
                    Text {
                        text: telemetry.runtimeHrs + " hrs"
                        color: "#C9D1D9"; font.pixelSize: 22; font.weight: Font.Medium
                    }
                    Text {
                        text: "Runtime"
                        color: "#6E7681"; font.pixelSize: 12
                    }
                }
            }
        }

        // ── Metrics row ───────────────────────────────────────────────────────
        RowLayout {
            Layout.fillWidth: true
            spacing: 14

            // Battery SOC
            Rectangle {
                Layout.fillWidth: true; Layout.fillHeight: true
                radius: 12; color: "#161B22"

                ColumnLayout {
                    anchors.fill: parent; anchors.margins: 18; spacing: 6

                    Text { text: "Battery"; color: "#8B949E"; font.pixelSize: 12 }

                    Text {
                        text: telemetry.battSoc.toFixed(0) + "%"
                        color: page.socColor(telemetry.battSoc)
                        font.pixelSize: 46; font.weight: Font.Bold
                    }

                    Rectangle {
                        Layout.fillWidth: true; height: 10; radius: 5; color: "#21262D"
                        Rectangle {
                            width: Math.max(parent.radius * 2, parent.width * (telemetry.battSoc / 100))
                            height: parent.height; radius: parent.radius
                            color: page.socColor(telemetry.battSoc)
                        }
                    }

                    Item { Layout.fillHeight: true }

                    Text {
                        text: telemetry.battV.toFixed(1) + " V   " + telemetry.battT.toFixed(1) + " °C"
                        color: "#6E7681"; font.pixelSize: 13
                    }
                }
            }

            // DC Bus
            Rectangle {
                Layout.fillWidth: true; Layout.fillHeight: true
                radius: 12; color: "#161B22"

                ColumnLayout {
                    anchors.fill: parent; anchors.margins: 18; spacing: 4

                    Text { text: "DC Bus"; color: "#8B949E"; font.pixelSize: 12 }

                    RowLayout {
                        spacing: 6
                        Text {
                            text: telemetry.dcV.toFixed(1)
                            color: "#C9D1D9"; font.pixelSize: 42; font.weight: Font.Bold
                        }
                        Text {
                            text: "V"; color: "#8B949E"; font.pixelSize: 22
                            Layout.alignment: Qt.AlignBottom; bottomPadding: 8
                        }
                    }

                    Text {
                        text: telemetry.dcA.toFixed(1) + " A"
                        color: "#8B949E"; font.pixelSize: 18
                    }

                    Item { Layout.fillHeight: true }

                    Text {
                        text: telemetry.watts + " W"
                        color: "#00C49A"; font.pixelSize: 26; font.weight: Font.SemiBold
                    }
                    Text { text: "Power Output"; color: "#6E7681"; font.pixelSize: 12 }
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
                            color: "#C9D1D9"; font.pixelSize: 42; font.weight: Font.Bold
                        }
                        Text {
                            text: "RPM"; color: "#8B949E"; font.pixelSize: 18
                            Layout.alignment: Qt.AlignBottom; bottomPadding: 10
                        }
                    }

                    Item { Layout.fillHeight: true }

                    Text {
                        text: telemetry.oilPsi.toFixed(1) + " PSI"
                        color: telemetry.oilPsi > 0 && telemetry.oilPsi < 20 ? "#F85149" : "#8B949E"
                        font.pixelSize: 18
                    }
                    Text { text: "Oil Pressure"; color: "#6E7681"; font.pixelSize: 12 }
                }
            }
        }
    }
}
