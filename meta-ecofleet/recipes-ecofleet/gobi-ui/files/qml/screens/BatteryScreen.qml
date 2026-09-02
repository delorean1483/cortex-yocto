import QtQuick
import QtQuick.Layouts
import ".."
Item {
    id: batt

    // ── Battery ON/OFF, mirroring HomeScreen's optimistic AUTO/OFF pattern ──
    property string uiMode: ""
    readonly property string effMode: uiMode !== "" ? uiMode : telemetry.mode
    readonly property bool on: effMode === "battery"
    function setOn(a) { batt.uiMode = a ? "battery" : "off"; telemetry.setMode(batt.uiMode) }

    // ── CHARGE BELOW threshold, optimistic + debounced, reconciled on dataChanged
    //    (same Timer/Connections idiom HomeScreen uses for its climate setpoint) ──
    property real target: telemetry.battSetpointV
    property bool dirty: false
    Component.onCompleted: batt.target = telemetry.battSetpointV
    Timer { id: spSend; interval: 350; onTriggered: telemetry.setBattSetpoint(batt.target) }
    function round1(v) { return Math.round(v * 10) / 10 }
    function bump(d) { batt.dirty = true; batt.target = round1(Math.max(11.0, Math.min(13.0, batt.target + d))); spSend.restart() }

    Connections {
        target: telemetry
        function onDataChanged() {
            if (batt.uiMode !== "" && telemetry.mode === batt.uiMode) batt.uiMode = ""
            if (batt.dirty && Math.abs(telemetry.battSetpointV - batt.target) < 0.05) batt.dirty = false
            if (!batt.dirty) batt.target = telemetry.battSetpointV
        }
    }

    // health color + status text for the live voltage reading
    function healthColor(v) { return v < 11.8 ? Theme.warn : (v >= 12.4 ? Theme.ok : Theme.accentBlue) }
    function statusText(v) {
        if (v < 11.8) return "Low — APU will start to recharge"
        if (v >= 12.4) return "Battery healthy"
        return "Battery OK"
    }

    ColumnLayout {
        anchors.fill: parent; anchors.margins: 12; spacing: 10

        // 1. big current battery voltage + status
        ColumnLayout {
            Layout.fillWidth: true; spacing: 4
            Text { Layout.alignment: Qt.AlignHCenter; text: telemetry.battV.toFixed(1) + " V"
                color: batt.healthColor(telemetry.battV); font.pixelSize: 96; font.weight: Font.Bold }
            Text { Layout.alignment: Qt.AlignHCenter; text: batt.statusText(telemetry.battV)
                color: Theme.textDim; font.pixelSize: 15; Layout.maximumWidth: 420; horizontalAlignment: Text.AlignHCenter; wrapMode: Text.WordWrap }
            Text { Layout.alignment: Qt.AlignHCenter; visible: telemetry.controlStatus === "charging"
                text: "CHARGING"; color: Theme.ok; font.pixelSize: 12; font.letterSpacing: 2; font.weight: Font.Bold }
        }

        Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 1; color: Theme.border }

        // 2. CHARGE BELOW threshold
        RowLayout {
            Layout.fillWidth: true; Layout.preferredHeight: 56; spacing: 10
            Text { text: "CHARGE BELOW"; color: Theme.textMute; font.pixelSize: 12; font.letterSpacing: 1; Layout.preferredWidth: 140 }
            Text { text: batt.target.toFixed(1) + " V"; color: Theme.accentBlue; font.pixelSize: 34; font.weight: Font.Bold; Layout.fillWidth: true }
            RowLayout { spacing: 8
                Rectangle { Layout.preferredWidth: 48; Layout.preferredHeight: 40; radius: 8; color: Theme.surface; border.color: Theme.border; border.width: 1
                    Text { anchors.centerIn: parent; text: "▲"; color: Theme.accentBlue }
                    MouseArea { anchors.fill: parent; onClicked: batt.bump(0.1) } }
                Rectangle { Layout.preferredWidth: 48; Layout.preferredHeight: 40; radius: 8; color: Theme.surface; border.color: Theme.border; border.width: 1
                    Text { anchors.centerIn: parent; text: "▼"; color: Theme.accentBlue }
                    MouseArea { anchors.fill: parent; onClicked: batt.bump(-0.1) } }
            }
        }

        // 3. Battery ON/OFF
        RowLayout {
            Layout.fillWidth: true; Layout.preferredHeight: 48; spacing: 0
            Repeater { model: [{t:"BATTERY ON",on:true},{t:"OFF",on:false}]
                Rectangle { Layout.fillWidth: true; Layout.fillHeight: true; radius: 9
                    property bool sel: modelData.on === batt.on
                    color: sel ? (modelData.on?Qt.rgba(0.25,0.72,0.31,0.18):Theme.surface2) : "transparent"
                    border.color: sel ? (modelData.on?Theme.ok:Theme.border) : Theme.border; border.width: 1
                    Text { anchors.centerIn: parent; text: modelData.t; font.pixelSize: 14; font.weight: Font.Bold
                        color: sel ? (modelData.on?Theme.ok:Theme.text) : Theme.textMute }
                    MouseArea { anchors.fill: parent; onClicked: batt.setOn(modelData.on) } } }
        }

        // 4. divider + passive stats
        Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 1; color: Theme.border }
        RowLayout { Layout.fillWidth: true; spacing: 16
            Repeater { model: [ {l:"IGNITION", v: telemetry.ignition ? "On" : "Off"} ]
                RowLayout { spacing: 6
                    Text { text: modelData.v; color: Theme.textDim; font.pixelSize: 13; font.weight: Font.DemiBold }
                    Text { text: modelData.l; color: Theme.textMute; font.pixelSize: 11 } } }
        }
    }
}
