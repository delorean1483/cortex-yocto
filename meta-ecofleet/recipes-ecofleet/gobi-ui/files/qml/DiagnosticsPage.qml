import QtQuick
import QtQuick.Layouts

Page {
    id: page
    background: Rectangle { color: "#0D1117" }

    // Evaluated every time telemetry emits dataChanged
    property var items: [
        ["APU State",       telemetry.apuState],
        ["DC Voltage",      telemetry.dcV.toFixed(2) + " V"],
        ["DC Current",      telemetry.dcA.toFixed(2) + " A"],
        ["Power Output",    telemetry.watts + " W"],
        ["Engine RPM",      telemetry.rpm + ""],
        ["Battery Voltage", telemetry.battV.toFixed(2) + " V"],
        ["Battery SOC",     telemetry.battSoc.toFixed(1) + " %"],
        ["Battery Temp",    telemetry.battT.toFixed(1) + " °C"],
        ["Oil Pressure",    telemetry.oilPsi.toFixed(1) + " PSI"],
        ["Coolant Temp",    telemetry.coolantT.toFixed(1) + " °C"],
        ["Runtime",         telemetry.runtimeHrs + " hrs"],
        ["Fault Word",      telemetry.fault],
    ]

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 20
        spacing: 14

        Text {
            text: "Live Diagnostics"
            color: "#C9D1D9"; font.pixelSize: 18; font.weight: Font.SemiBold
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
                rowSpacing: 12
                columnSpacing: 12

                property real cellW: (width - columnSpacing * (columns - 1)) / columns

                Repeater {
                    model: page.items

                    Rectangle {
                        width: grid.cellW
                        height: 80
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
                                color: modelData[0] === "Fault Word" && telemetry.hasFault
                                       ? "#F85149" : "#C9D1D9"
                                font.pixelSize: 20; font.weight: Font.SemiBold
                            }
                        }
                    }
                }
            }
        }
    }
}
