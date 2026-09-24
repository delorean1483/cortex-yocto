import QtQuick
import QtQuick.Layouts
import ".."
import "../atoms"
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
    function healthColor(v) { return v < 11.8 ? Theme.warn : (v >= 12.4 ? Theme.ok : Theme.text) }
    function statusText(v) {
        if (v < 11.8) return "Low — APU will start to recharge"
        if (v >= 12.4) return "Battery healthy"
        return "Battery OK"
    }

    ColumnLayout {
        anchors.fill: parent; anchors.margins: Theme.pad; spacing: Theme.gap

        // 1. big current battery voltage + status
        ColumnLayout {
            Layout.fillWidth: true; Layout.fillHeight: true; spacing: 2
            Item { Layout.fillHeight: true }
            Text { Layout.fillWidth: true; horizontalAlignment: Text.AlignHCenter; text: telemetry.battV.toFixed(1) + " V"
                color: batt.healthColor(telemetry.battV); font.pixelSize: 96; font.weight: Font.DemiBold }
            Text { Layout.alignment: Qt.AlignHCenter; text: batt.statusText(telemetry.battV)
                color: Theme.textDim; font.pixelSize: Theme.fsBody; Layout.maximumWidth: 420; horizontalAlignment: Text.AlignHCenter; wrapMode: Text.WordWrap }
            Text { Layout.alignment: Qt.AlignHCenter; Layout.topMargin: 4; visible: telemetry.controlStatus === "charging"
                text: "CHARGING"; color: Theme.ok; font.pixelSize: Theme.fsCaption; font.letterSpacing: 2; font.weight: Font.Bold }
            Item { Layout.fillHeight: true }
        }

        // 2. CHARGE BELOW threshold
        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 76; radius: Theme.radius; color: Theme.surface
            RowLayout {
                anchors.fill: parent; anchors.leftMargin: Theme.pad; anchors.rightMargin: 12; spacing: Theme.gap
                ColumnLayout { Layout.fillWidth: true; spacing: 2
                    Text { text: "AUTO-CHARGE BELOW"; color: Theme.textMute; font.pixelSize: Theme.fsCaption
                        font.letterSpacing: Theme.lsCaps; font.weight: Font.DemiBold }
                    Text { text: "APU starts to recharge when the battery drops below this"
                        color: Theme.textMute; font.pixelSize: Theme.fsCaption } }
                Stepper { text: batt.target.toFixed(1) + " V"; textSize: 30; textWidth: 104
                    onDecrement: batt.bump(-0.1); onIncrement: batt.bump(0.1) }
            }
        }

        // 3. Battery mode ON/OFF + passive stats
        RowLayout {
            Layout.fillWidth: true; spacing: Theme.gap
            SegmentedControl { Layout.fillWidth: true; Layout.preferredHeight: 56
                options: [{label:"BATTERY ON", value:true}, {label:"OFF", value:false}]
                current: batt.on
                onPicked: function(v) { batt.setOn(v) } }
            ColumnLayout { Layout.preferredWidth: 96; spacing: 0
                Text { text: "IGNITION"; color: Theme.textMute; font.pixelSize: Theme.fsCaption
                    font.letterSpacing: Theme.lsCaps; font.weight: Font.DemiBold }
                Text { text: telemetry.ignition ? "On" : "Off"; color: Theme.textDim
                    font.pixelSize: Theme.fsBody; font.weight: Font.DemiBold } }
        }
    }
}
