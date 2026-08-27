import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// Interactive control home, tuned for the 800x480 LVDS panel
// (usable content area ~800 x 388 after the top and tab bars).
Page {
    id: page
    background: Rectangle { color: "#0D1117" }

    readonly property int minF: 60
    readonly property int maxF: 85
    property int  targetF: 70
    property bool seeded:  false

    // Optimistic control state: a tap updates these instantly (button highlights
    // now), then telemetry echoes back within a few seconds and we defer to it.
    property string uiMode: ""
    property int    uiFan:  -1
    readonly property string effMode:   uiMode !== "" ? uiMode : telemetry.mode
    readonly property int    effFan:    uiFan  >= 0   ? uiFan  : telemetry.fanSpeed
    readonly property bool   isRunning: effMode !== "off"

    Connections {
        target: telemetry
        function onDataChanged() {
            if (!page.seeded && !telemetry.stale) {
                page.targetF = Math.max(page.minF, Math.min(page.maxF,
                                        Math.round(telemetry.clmtSetpointF)))
                page.seeded = true
            }
            if (page.uiMode !== "" && telemetry.mode === page.uiMode)    page.uiMode = ""
            if (page.uiFan  >= 0   && telemetry.fanSpeed === page.uiFan) page.uiFan  = -1
        }
    }
    Timer { id: sendTimer; interval: 350; onTriggered: telemetry.setSetpoint(page.targetF) }
    function bumpTarget(d) {
        page.targetF = Math.max(page.minF, Math.min(page.maxF, page.targetF + d)); sendTimer.restart()
    }
    function pickMode(m) { page.uiMode = m; telemetry.setMode(m) }
    function pickFan(n)  { page.uiFan  = n; telemetry.setFan(n) }

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
        anchors.margins: 10
        spacing: 8

        // ── Status banner ──────────────────────────────────────────────────────
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 54
            radius: 12; color: "#161B22"
            border.color: page.statusColor(telemetry.controlStatus); border.width: 2

            RowLayout {
                anchors.fill: parent; anchors.leftMargin: 14; anchors.rightMargin: 14
                spacing: 12

                Rectangle {
                    width: 12; height: 12; radius: 6
                    color: page.statusColor(telemetry.controlStatus)
                    SequentialAnimation on opacity {
                        running: telemetry.controlStatus !== "off"; loops: Animation.Infinite
                        NumberAnimation { to: 0.35; duration: 700 }
                        NumberAnimation { to: 1.0;  duration: 700 }
                    }
                }
                Text {
                    text: telemetry.controlStatus.toUpperCase().replace("_", " ")
                    color: page.statusColor(telemetry.controlStatus)
                    font.pixelSize: 20; font.weight: Font.Bold
                }
                Text { text: "· " + telemetry.mode.toUpperCase()
                       color: "#8B949E"; font.pixelSize: 13 }

                Item { Layout.fillWidth: true }

                Row {
                    spacing: 8
                    Repeater {
                        model: [ telemetry.battV.toFixed(1) + " V",
                                 telemetry.rpm + " RPM",
                                 telemetry.oilOk ? "OIL OK" : "OIL LOW",
                                 telemetry.engineHrs + " hrs" ]
                        Rectangle {
                            height: 28; radius: 14; color: "#0D1117"
                            border.color: "#30363D"; border.width: 1
                            width: cTxt.width + 20
                            Text { id: cTxt; anchors.centerIn: parent; text: modelData
                                   color: (modelData === "OIL LOW") ? "#F85149" : "#C9D1D9"
                                   font.pixelSize: 13; font.weight: Font.Medium }
                        }
                    }
                }
            }
        }

        // ── Weather outlook (hidden until a location is configured) ───────────────
        WeatherStrip {
            visible: weather.valid
            Layout.fillWidth: true
            Layout.preferredHeight: 74
        }

        // ── Control row ──────────────────────────────────────────────────────────
        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 10

            // ── LEFT: climate target (signature) ─────────────────────────────────
            Rectangle {
                Layout.fillHeight: true
                Layout.fillWidth: true
                radius: 14; color: "#161B22"

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 14
                    spacing: 6

                    Text { text: "TARGET TEMPERATURE"; color: "#6E7681"
                           font.pixelSize: 11; font.letterSpacing: 2; font.weight: Font.DemiBold }

                    RowLayout {
                        Layout.fillWidth: true
                        StepButton { glyph: "−"; side: 54; onTapped: page.bumpTarget(-1) }
                        Item { Layout.fillWidth: true
                            RowLayout {
                                anchors.centerIn: parent; spacing: 0
                                Text { text: page.targetF; color: page.tempColor(page.targetF)
                                       font.pixelSize: 64; font.weight: Font.Bold }
                                Text { text: "°F"; color: page.tempColor(page.targetF)
                                       font.pixelSize: 26; font.weight: Font.Light
                                       Layout.alignment: Qt.AlignTop; topPadding: 8 }
                            }
                        }
                        StepButton { glyph: "+"; side: 54; onTapped: page.bumpTarget(1) }
                    }

                    Slider {
                        id: tempSlider
                        Layout.fillWidth: true
                        Layout.preferredHeight: 40
                        from: page.minF; to: page.maxF; stepSize: 1
                        value: page.targetF
                        onMoved: { page.targetF = Math.round(value); sendTimer.restart() }
                        background: Rectangle {
                            x: tempSlider.leftPadding
                            y: tempSlider.topPadding + tempSlider.availableHeight/2 - height/2
                            width: tempSlider.availableWidth; height: 10; radius: 5
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
                            width: 38; height: 38; radius: 19
                            color: "#E6EDF3"
                            border.color: page.tempColor(page.targetF); border.width: 4
                        }
                    }

                    Item { Layout.fillHeight: true }

                    RowLayout {
                        Layout.fillWidth: true
                        Text { text: "Cabin  " + telemetry.cabinTempF.toFixed(0) + "°F"
                               color: "#8B949E"; font.pixelSize: 14 }
                        Item { Layout.fillWidth: true }
                        Text { text: "Ext  " + telemetry.extTempF.toFixed(0) + "°F"
                               color: "#8B949E"; font.pixelSize: 14 }
                    }
                }
            }

            // ── RIGHT: mode / fan / start-stop / oil ─────────────────────────────
            ColumnLayout {
                Layout.fillHeight: true
                Layout.alignment: Qt.AlignTop
                Layout.preferredWidth: 380
                Layout.fillWidth: false
                spacing: 7

                Text { text: "MODE"; color: "#6E7681"
                       font.pixelSize: 11; font.letterSpacing: 2; font.weight: Font.DemiBold }
                RowLayout {
                    Layout.fillWidth: true; Layout.fillHeight: false
                    Layout.preferredHeight: 46; Layout.maximumHeight: 46; spacing: 8
                    Repeater {
                        model: [ { t: "OFF",     m: "off",     c: "#8B949E" },
                                 { t: "CLIMATE", m: "climate", c: "#2F81F7" },
                                 { t: "BATTERY", m: "battery", c: "#00C49A" } ]
                        Rectangle {
                            Layout.fillWidth: true; Layout.fillHeight: true
                            radius: 10
                            property bool on: page.effMode === modelData.m
                            property color accent: modelData.c
                            color: on ? Qt.rgba(accent.r, accent.g, accent.b, 0.20)
                                      : (mma.pressed ? "#233041" : "#1C2230")
                            border.color: on ? accent : "#30363D"; border.width: on ? 2 : 1
                            Text { anchors.centerIn: parent; text: modelData.t
                                   color: parent.on ? accent : "#C9D1D9"
                                   font.pixelSize: 16; font.letterSpacing: 1
                                   font.weight: parent.on ? Font.Bold : Font.Medium }
                            MouseArea { id: mma; anchors.fill: parent
                                        onClicked: page.pickMode(modelData.m) }
                        }
                    }
                }

                Text { text: "FAN SPEED"; color: "#6E7681"
                       font.pixelSize: 11; font.letterSpacing: 2; font.weight: Font.DemiBold }
                RowLayout {
                    Layout.fillWidth: true; Layout.fillHeight: false
                    Layout.preferredHeight: 46; Layout.maximumHeight: 46; spacing: 8
                    Repeater {
                        model: [ { t: "LOW", n: 0 }, { t: "MED", n: 1 }, { t: "HIGH", n: 2 } ]
                        Rectangle {
                            Layout.fillWidth: true; Layout.fillHeight: true
                            radius: 10
                            property bool on: page.effFan === modelData.n
                            color: on ? "#1D3A57" : (fma.pressed ? "#233041" : "#1C2230")
                            border.color: on ? "#58A6FF" : "#30363D"; border.width: on ? 2 : 1
                            Text { anchors.centerIn: parent; text: modelData.t
                                   color: parent.on ? "#58A6FF" : "#C9D1D9"
                                   font.pixelSize: 16; font.letterSpacing: 1
                                   font.weight: parent.on ? Font.Bold : Font.Medium }
                            MouseArea { id: fma; anchors.fill: parent
                                        onClicked: page.pickFan(modelData.n) }
                        }
                    }
                }

                // Contextual primary: START when off, STOP when running
                Rectangle {
                    Layout.fillWidth: true; Layout.preferredHeight: 56; Layout.topMargin: 4
                    radius: 12
                    property color hue: page.isRunning ? "#F85149" : "#3FB950"
                    color: goMa.pressed ? Qt.rgba(hue.r, hue.g, hue.b, 0.30)
                                        : Qt.rgba(hue.r, hue.g, hue.b, 0.15)
                    border.color: hue; border.width: 2
                    Row {
                        anchors.centerIn: parent; spacing: 12
                        Rectangle { visible: page.isRunning
                                    width: 20; height: 20; radius: 4; color: parent.parent.hue
                                    anchors.verticalCenter: parent.verticalCenter }
                        Text { text: page.isRunning ? "STOP" : "START"
                               color: parent.parent.hue; font.pixelSize: 28; font.weight: Font.Bold
                               anchors.verticalCenter: parent.verticalCenter }
                    }
                    MouseArea { id: goMa; anchors.fill: parent
                                onClicked: page.pickMode(page.isRunning ? "off" : "climate") }
                }

                Item { Layout.fillHeight: true }
            }
        }
    }
}
