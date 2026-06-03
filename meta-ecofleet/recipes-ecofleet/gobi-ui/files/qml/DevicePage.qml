import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Page {
    id: page
    background: Rectangle { color: "#0D1117" }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 20
        spacing: 14

        Text {
            text: "Device Info"
            color: "#C9D1D9"; font.pixelSize: 18; font.weight: Font.SemiBold
        }

        // ── Identity card ─────────────────────────────────────────────────────
        Rectangle {
            Layout.fillWidth: true
            height: 130
            radius: 12; color: "#161B22"

            ColumnLayout {
                anchors.fill: parent; anchors.margins: 18; spacing: 10

                Text {
                    text: "Identity"
                    color: "#8B949E"; font.pixelSize: 12; font.weight: Font.Medium
                }

                GridLayout {
                    columns: 2
                    columnSpacing: 16
                    rowSpacing: 6

                    Text { text: "Serial";   color: "#6E7681"; font.pixelSize: 13 }
                    Text { text: devinfo.serial;    color: "#C9D1D9"; font.pixelSize: 13; font.weight: Font.Medium }

                    Text { text: "Hostname"; color: "#6E7681"; font.pixelSize: 13 }
                    Text { text: devinfo.hostname;  color: "#C9D1D9"; font.pixelSize: 13; font.weight: Font.Medium }

                    Text { text: "Firmware"; color: "#6E7681"; font.pixelSize: 13 }
                    Text { text: devinfo.fwVersion; color: "#C9D1D9"; font.pixelSize: 13; font.weight: Font.Medium }
                }
            }
        }

        // ── Network card ──────────────────────────────────────────────────────
        Rectangle {
            Layout.fillWidth: true
            height: 120
            radius: 12; color: "#161B22"

            ColumnLayout {
                anchors.fill: parent; anchors.margins: 18; spacing: 10

                RowLayout {
                    spacing: 8

                    Text {
                        text: "Network"
                        color: "#8B949E"; font.pixelSize: 12; font.weight: Font.Medium
                    }

                    Rectangle {
                        width: 8; height: 8; radius: 4
                        color: devinfo.ethLinked ? "#3FB950" : "#F85149"
                        anchors.verticalCenter: parent.verticalCenter
                    }

                    Text {
                        text: devinfo.ethLinked ? "Linked" : "No Link"
                        color: devinfo.ethLinked ? "#3FB950" : "#F85149"
                        font.pixelSize: 12
                        anchors.verticalCenter: parent.verticalCenter
                    }
                }

                GridLayout {
                    columns: 2
                    columnSpacing: 16
                    rowSpacing: 6

                    Text { text: "IP Address"; color: "#6E7681"; font.pixelSize: 13 }
                    Text { text: devinfo.ipAddress;  color: "#C9D1D9"; font.pixelSize: 13; font.weight: Font.Medium }

                    Text { text: "MAC Address"; color: "#6E7681"; font.pixelSize: 13 }
                    Text { text: devinfo.macAddress; color: "#C9D1D9"; font.pixelSize: 13; font.weight: Font.Medium }
                }
            }
        }

        Item { Layout.fillHeight: true }
    }
}
