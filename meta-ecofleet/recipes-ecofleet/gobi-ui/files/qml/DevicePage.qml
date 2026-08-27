import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Page {
    id: page
    background: Rectangle { color: "#0D1117" }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 14
        spacing: 8

        Text {
            text: "Device Info"
            color: "#C9D1D9"; font.pixelSize: 18; font.weight: Font.DemiBold
        }

        // ── Identity card ─────────────────────────────────────────────────────
        Rectangle {
            Layout.fillWidth: true
            height: 108
            radius: 12; color: "#161B22"

            ColumnLayout {
                anchors.fill: parent; anchors.margins: 12; spacing: 6

                Text {
                    text: "Identity"
                    color: "#8B949E"; font.pixelSize: 12; font.weight: Font.Medium
                }

                GridLayout {
                    columns: 2
                    columnSpacing: 16
                    rowSpacing: 5

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
            height: 100
            radius: 12; color: "#161B22"

            ColumnLayout {
                anchors.fill: parent; anchors.margins: 12; spacing: 6

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
                    rowSpacing: 5

                    Text { text: "IP Address"; color: "#6E7681"; font.pixelSize: 13 }
                    Text { text: devinfo.ipAddress;  color: "#C9D1D9"; font.pixelSize: 13; font.weight: Font.Medium }

                    Text { text: "MAC Address"; color: "#6E7681"; font.pixelSize: 13 }
                    Text { text: devinfo.macAddress; color: "#C9D1D9"; font.pixelSize: 13; font.weight: Font.Medium }
                }
            }
        }

        // ── Maintenance card (hold-to-reset oil timer) ────────────────────────
        Rectangle {
            Layout.fillWidth: true
            height: 92
            radius: 12; color: "#161B22"

            ColumnLayout {
                anchors.fill: parent; anchors.margins: 12; spacing: 8

                RowLayout {
                    Layout.fillWidth: true
                    Text { text: "Engine Oil"; color: "#8B949E"; font.pixelSize: 12; font.weight: Font.Medium }
                    Item { Layout.fillWidth: true }
                    Text { text: telemetry.oilHrs + " hrs"; color: "#C9D1D9"
                           font.pixelSize: 13; font.weight: Font.Medium }
                }

                // hold-to-reset oil
                Rectangle {
                    id: oilBtn
                    Layout.fillWidth: true; Layout.preferredHeight: 40
                    radius: 10; color: "#0D1117"; border.color: "#30363D"; border.width: 1
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
                           color: oilBtn.done ? "#3FB950" : "#E3B341"
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
