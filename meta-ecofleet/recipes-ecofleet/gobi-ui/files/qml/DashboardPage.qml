import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Page {
    id: page
    background: Rectangle { color: "#0D1117" }

    // ── Local control state ───────────────────────────────────────────────────
    readonly property int minF: 60
    readonly property int maxF: 85
    property int  targetF: 70
    property bool seeded:  false

    // Seed the target once from the device, then the UI owns it (our own writes
    // keep reg 14 in sync, so they stay agreed).
    Connections {
        target: telemetry
        function onDataChanged() {
            if (!page.seeded && !telemetry.stale) {
                page.targetF = Math.max(page.minF, Math.min(page.maxF,
                                        Math.round(telemetry.clmtSetpointF)))
                page.seeded = true
            }
        }
    }

    Timer { id: sendTimer; interval: 350; onTriggered: telemetry.setSetpoint(page.targetF) }
    function bumpTarget(d) {
        page.targetF = Math.max(page.minF, Math.min(page.maxF, page.targetF + d))
        sendTimer.restart()
    }

    // Cool→warm color for the target (blue below comfort, teal in band, amber above)
    function tempColor(f) {
        if (f <= 64) return "#2F81F7"
        if (f <= 68) return "#39B0C4"
        if (f <= 74) return "#00C49A"
        if (f <= 78) return "#E3B341"
        return "#F0883E"
    }
    function statusColor(s) {
        if (s === "running")                        return "#3FB950"
        if (s === "cooling" || s === "chillin")     return "#2F81F7"
        if (s === "defrost")                        return "#58A6FF"
        if (s === "charging")                       return "#00C49A"
        if (s === "warming_up" || s === "starting") return "#E3B341"
        return "#8B949E"
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 16
        spacing: 14

        // ── Status banner ──────────────────────────────────────────────────────
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 92
            radius: 14; color: "#161B22"
            border.color: page.statusColor(telemetry.controlStatus); border.width: 2

            RowLayout {
                anchors.fill: parent; anchors.leftMargin: 22; anchors.rightMargin: 22
                spacing: 16

                Rectangle {
                    width: 16; height: 16; radius: 8
                    color: page.statusColor(telemetry.controlStatus)
                    SequentialAnimation on opacity {
                        running: telemetry.controlStatus !== "off"
                        loops: Animation.Infinite
                        NumberAnimation { to: 0.35; duration: 700 }
                        NumberAnimation { to: 1.0;  duration: 700 }
                    }
                }
                Column {
                    spacing: 0
                    Text {
                        text: telemetry.controlStatus.toUpperCase().replace("_", " ")
                        color: page.statusColor(telemetry.controlStatus)
                        font.pixelSize: 30; font.weight: Font.Bold
                    }
                    Text { text: "Mode: " + telemetry.mode.toUpperCase()
                           color: "#8B949E"; font.pixelSize: 13; font.letterSpacing: 1 }
                }

                Item { Layout.fillWidth: true }

                // quick stat chips
                Row {
                    spacing: 10
                    Repeater {
                        model: [
                            telemetry.battV.toFixed(1) + " V",
                            telemetry.rpm + " RPM",
                            telemetry.oilOk ? "OIL OK" : "OIL LOW"
                        ]
                        Rectangle {
                            height: 34; radius: 17; color: "#0D1117"
                            border.color: "#30363D"; border.width: 1
                            width: chipTxt.width + 26
                            Text { id: chipTxt; anchors.centerIn: parent; text: modelData
                                   color: (modelData === "OIL LOW") ? "#F85149" : "#C9D1D9"
                                   font.pixelSize: 14; font.weight: Font.Medium }
                        }
                    }
                }

                Column {
                    spacing: 0
                    Text { text: telemetry.engineHrs + " hrs"; color: "#C9D1D9"
                           font.pixelSize: 22; font.weight: Font.Medium
                           horizontalAlignment: Text.AlignRight; width: parent.width }
                    Text { text: "Engine Runtime"; color: "#6E7681"; font.pixelSize: 12
                           horizontalAlignment: Text.AlignRight; width: parent.width }
                }
            }
        }

        // ── Control row ──────────────────────────────────────────────────────────
        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 14

            // ── LEFT: climate target (the signature) ─────────────────────────────
            Rectangle {
                Layout.fillHeight: true
                Layout.fillWidth: true
                radius: 16; color: "#161B22"

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 24
                    spacing: 10

                    Text { text: "TARGET TEMPERATURE"; color: "#6E7681"
                           font.pixelSize: 13; font.letterSpacing: 2; font.weight: Font.DemiBold }

                    Item {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 150
                        RowLayout {
                            anchors.centerIn: parent
                            spacing: 0
                            Text { text: page.targetF; color: page.tempColor(page.targetF)
                                   font.pixelSize: 150; font.weight: Font.Bold }
                            Text { text: "°F"; color: page.tempColor(page.targetF)
                                   font.pixelSize: 52; font.weight: Font.Light
                                   Layout.alignment: Qt.AlignTop; topPadding: 22 }
                        }
                    }

                    // gradient slider
                    Slider {
                        id: tempSlider
                        Layout.fillWidth: true
                        Layout.preferredHeight: 56
                        from: page.minF; to: page.maxF; stepSize: 1
                        value: page.targetF
                        onMoved: { page.targetF = Math.round(value); sendTimer.restart() }

                        background: Rectangle {
                            x: tempSlider.leftPadding
                            y: tempSlider.topPadding + tempSlider.availableHeight/2 - height/2
                            width: tempSlider.availableWidth; height: 12; radius: 6
                            gradient: Gradient {
                                orientation: Gradient.Horizontal
                                GradientStop { position: 0.0; color: "#2F81F7" }
                                GradientStop { position: 0.5; color: "#00C49A" }
                                GradientStop { position: 1.0; color: "#F0883E" }
                            }
                        }
                        handle: Rectangle {
                            x: tempSlider.leftPadding + tempSlider.visualPosition * (tempSlider.availableWidth - width)
                            y: tempSlider.topPadding + tempSlider.availableHeight/2 - height/2
                            width: 44; height: 44; radius: 22
                            color: "#E6EDF3"
                            border.color: page.tempColor(page.targetF); border.width: 4
                        }
                    }

                    // big steppers
                    RowLayout {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 96
                        spacing: 16
                        StepButton { glyph: "−"; onTapped: page.bumpTarget(-1) }
                        Item { Layout.fillWidth: true
                            Text { anchors.centerIn: parent
                                   text: page.seeded ? "" : "reading…"
                                   color: "#6E7681"; font.pixelSize: 14 } }
                        StepButton { glyph: "+"; onTapped: page.bumpTarget(1) }
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        Text { text: "Cabin  " + telemetry.cabinTempF.toFixed(0) + " °F"
                               color: "#8B949E"; font.pixelSize: 16 }
                        Item { Layout.fillWidth: true }
                        Text { text: "External  " + telemetry.extTempF.toFixed(0) + " °F"
                               color: "#8B949E"; font.pixelSize: 16 }
                    }
                }
            }

            // ── RIGHT: mode / fan / stop / oil ───────────────────────────────────
            ColumnLayout {
                Layout.fillHeight: true
                Layout.preferredWidth: 460
                Layout.fillWidth: false
                spacing: 12

                Text { text: "MODE"; color: "#6E7681"
                       font.pixelSize: 13; font.letterSpacing: 2; font.weight: Font.DemiBold }
                RowLayout {
                    Layout.fillWidth: true; Layout.preferredHeight: 64; spacing: 10
                    SegButton { label: "OFF";     active: telemetry.mode === "off"
                                accent: "#8B949E"; onTapped: telemetry.setMode("off") }
                    SegButton { label: "CLIMATE"; active: telemetry.mode === "climate"
                                accent: "#2F81F7"; onTapped: telemetry.setMode("climate") }
                    SegButton { label: "BATTERY"; active: telemetry.mode === "battery"
                                accent: "#00C49A"; onTapped: telemetry.setMode("battery") }
                }

                Text { text: "FAN SPEED"; color: "#6E7681"; topPadding: 4
                       font.pixelSize: 13; font.letterSpacing: 2; font.weight: Font.DemiBold }
                RowLayout {
                    Layout.fillWidth: true; Layout.preferredHeight: 64; spacing: 10
                    SegButton { label: "LOW";  active: telemetry.fanSpeed === 0
                                accent: "#58A6FF"; onTapped: telemetry.setFan(0) }
                    SegButton { label: "MED";  active: telemetry.fanSpeed === 1
                                accent: "#58A6FF"; onTapped: telemetry.setFan(1) }
                    SegButton { label: "HIGH"; active: telemetry.fanSpeed === 2
                                accent: "#58A6FF"; onTapped: telemetry.setFan(2) }
                }

                Item { Layout.fillHeight: true }

                // big STOP
                Rectangle {
                    Layout.fillWidth: true; Layout.preferredHeight: 96
                    radius: 14
                    color: stopMa.pressed ? "#3D1418" : "#2D1014"
                    border.color: "#F85149"; border.width: 2
                    Row {
                        anchors.centerIn: parent; spacing: 14
                        Rectangle { width: 26; height: 26; radius: 5; color: "#F85149"
                                    anchors.verticalCenter: parent.verticalCenter }
                        Text { text: "STOP"; color: "#F85149"; font.pixelSize: 34
                               font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                    }
                    MouseArea { id: stopMa; anchors.fill: parent
                                onClicked: telemetry.setMode("off") }
                }

                // hold-to-reset oil
                Rectangle {
                    id: oilBtn
                    Layout.fillWidth: true; Layout.preferredHeight: 58
                    radius: 12; color: "#161B22"; border.color: "#30363D"; border.width: 1
                    clip: true
                    property bool done: false

                    Rectangle {   // fill that grows across the button during the hold
                        id: holdFill
                        height: parent.height; radius: parent.radius
                        color: "#33E3B341"
                        width: 0
                        Behavior on width { NumberAnimation { duration: 1500; easing.type: Easing.Linear } }
                    }
                    Text {
                        anchors.centerIn: parent
                        text: oilBtn.done ? "OIL TIMER RESET" : "HOLD TO RESET OIL TIMER"
                        color: oilBtn.done ? "#3FB950" : "#E3B341"
                        font.pixelSize: 16; font.weight: Font.DemiBold; font.letterSpacing: 1
                    }
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
    }
}
