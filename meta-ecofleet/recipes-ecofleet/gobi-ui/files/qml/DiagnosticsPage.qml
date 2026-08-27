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
        anchors.margins: 16
        spacing: 12

        Text {
            text: "Live Diagnostics"
            color: "#C9D1D9"; font.pixelSize: 20; font.weight: Font.DemiBold
        }

        // Scrollable so tiles can never be clipped by the tab bar; sized to fit
        // the viewport for the common case (no scroll needed).
        Flickable {
            id: flick
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            contentWidth: width
            contentHeight: grid.height
            boundsBehavior: Flickable.StopAtBounds
            ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

            readonly property int cols: 3
            readonly property int rowSpacing: 12
            readonly property int rows: Math.ceil(page.items.length / cols)
            // Fit all rows in the viewport when possible, but never below a
            // comfortable touch height (then it scrolls).
            readonly property real cellH: Math.max(96,
                (flick.height - (rows - 1) * rowSpacing) / rows)

            Grid {
                id: grid
                width: parent.width
                columns: flick.cols
                rowSpacing: flick.rowSpacing
                columnSpacing: 12
                property real cellW: (width - columnSpacing * (columns - 1)) / columns

                Repeater {
                    model: page.items
                    Rectangle {
                        width: grid.cellW
                        height: flick.cellH
                        radius: 12
                        color: "#161B22"

                        Column {
                            anchors.left: parent.left; anchors.leftMargin: 18
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: 5
                            Text { text: modelData[0]; color: "#6E7681"
                                   font.pixelSize: 13; font.letterSpacing: 1 }
                            Text {
                                text: modelData[1]
                                color: (modelData[0] === "Error" && telemetry.hasError) ||
                                       (modelData[0] === "Oil Pressure" && !telemetry.oilOk)
                                       ? "#F85149" : "#E6EDF3"
                                font.pixelSize: 24; font.weight: Font.DemiBold
                            }
                        }
                    }
                }
            }
        }
    }
}
