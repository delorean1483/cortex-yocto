import QtQuick
import QtQuick.Layouts
import ".."
import "../atoms"
Item {
    id: home
    // optimistic mode (climate/off) + setpoint, mirroring the old HomeScreen
    property string uiMode: ""
    readonly property string effMode: uiMode !== "" ? uiMode : telemetry.mode
    readonly property bool on: effMode !== "off"
    // Setpoint: optimistic + debounced, reconciled on dataChanged (same idiom as
    // BatteryScreen). The page is built before the first telemetry snapshot lands,
    // so a one-shot copy at load would stick at 0 — follow telemetry until the
    // user touches the stepper, then until the device echoes their value back.
    property int target: Math.round(telemetry.clmtSetpointF)
    property bool dirty: false
    readonly property bool haveSetpoint: telemetry.clmtSetpointF > 0
    Timer { id: spSend; interval: 350; onTriggered: telemetry.setSetpoint(home.target) }
    function bump(d) {
        var base = home.haveSetpoint || home.dirty ? home.target : 70
        home.dirty = true; home.target = Math.max(55, Math.min(85, base + d)); spSend.restart()
    }
    // AUTO turns climate on AND puts fan in auto (spec §2); OFF stops.
    function setAuto(a) { home.uiMode = a ? "climate" : "off"; telemetry.setMode(home.uiMode); if (a) telemetry.setFanAuto(true) }
    // fan presets
    readonly property var presets: [{k:"LOW",v:40},{k:"MED",v:70},{k:"HIGH",v:100}]
    function pickFan(k) {
        if (k === "AUTO") { telemetry.setFanAuto(true); return }
        for (var i = 0; i < home.presets.length; i++)
            if (home.presets[i].k === k) { telemetry.setFanAuto(false); telemetry.setFan(home.presets[i].v) }
    }
    function activeFan() { return telemetry.fanAuto ? "AUTO" : (function(){ for (var i=0;i<home.presets.length;i++) if (home.presets[i].v===telemetry.fanSpeed) return home.presets[i].k; return "" })() }
    // glow bar color + label from control_status
    function glowColor(s){ return s==="cooling"?"#2F81F7": (s==="warming_up"||s==="starting")?"#F0883E": s==="chillin"?"#39B0C4": s==="charging"?Theme.ok: (s==="running"||s==="defrost")?Theme.textDim: "transparent" }
    readonly property bool glowOn: telemetry.controlStatus !== "off" && home.on
    // setpoint caption from control_status
    function caption(){ var s=telemetry.controlStatus; if(!home.on)return "SETPOINT"; if(s==="cooling")return "COOLING TO"; if(s==="warming_up"||s==="starting")return "WARMING UP"; if(s==="chillin")return "AT TARGET"; if(s==="charging")return "CHARGING"; return StatusLabels.control(s,true) }
    Connections {
        target: telemetry
        function onDataChanged() {
            if (home.uiMode !== "" && telemetry.mode === home.uiMode) home.uiMode = ""
            if (home.dirty && Math.round(telemetry.clmtSetpointF) === home.target) home.dirty = false
            if (!home.dirty) home.target = Math.round(telemetry.clmtSetpointF)
        }
    }

    ColumnLayout {
        anchors.fill: parent; anchors.margins: Theme.pad; spacing: Theme.gap
        // 1. glow bar
        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 28; radius: Theme.radiusSm; visible: home.glowOn
            color: Theme.tint(home.glowColor(telemetry.controlStatus), 0.12)
            border.color: home.glowColor(telemetry.controlStatus); border.width: 1
            // soft pulse
            SequentialAnimation on opacity { running: home.glowOn; loops: Animation.Infinite
                NumberAnimation { to: 0.55; duration: 1200 } NumberAnimation { to: 1.0; duration: 1200 } }
            Text { anchors.centerIn: parent; text: StatusLabels.control(telemetry.controlStatus, true)
                color: home.glowColor(telemetry.controlStatus); font.pixelSize: Theme.fsCaption
                font.letterSpacing: 2; font.weight: Font.Bold }
        }
        // 2. body: cabin reading (+ passive stats) | climate card
        RowLayout {
            Layout.fillWidth: true; Layout.fillHeight: true; spacing: Theme.gap
            ColumnLayout { Layout.preferredWidth: 236; Layout.maximumWidth: 236; Layout.fillHeight: true; spacing: 0
                Item { Layout.fillHeight: true }
                Text { Layout.alignment: Qt.AlignHCenter; text: telemetry.cabinTempF.toFixed(0) + "°"
                    color: Theme.text; font.pixelSize: Theme.fsDisplay; font.weight: Font.DemiBold
                    lineHeight: 0.9 }
                Text { Layout.alignment: Qt.AlignHCenter; text: "CABIN"; color: Theme.textMute
                    font.pixelSize: Theme.fsCaption; font.letterSpacing: 2; font.weight: Font.DemiBold }
                Item { Layout.fillHeight: true }
                RowLayout { Layout.fillWidth: true; Layout.bottomMargin: 4; spacing: 0
                    Repeater { model: [ {l:"COOLANT", v: telemetry.extTempF.toFixed(0)+"°F"},
                                        {l:"BATTERY", v: telemetry.battV.toFixed(1)+" V"},
                                        {l:"ENGINE", v: telemetry.engineHrs+" h"} ]
                        ColumnLayout { Layout.fillWidth: true; spacing: 1
                            Text { Layout.fillWidth: true; horizontalAlignment: Text.AlignHCenter; text: modelData.v; color: Theme.text
                                font.pixelSize: Theme.fsBody; font.weight: Font.DemiBold }
                            Text { Layout.fillWidth: true; horizontalAlignment: Text.AlignHCenter; text: modelData.l; color: Theme.textMute
                                font.pixelSize: Theme.fsCaption - 1; font.letterSpacing: Theme.lsCaps; font.weight: Font.DemiBold } } } }
            }
            // climate card: mode, setpoint, fan
            Rectangle {
                Layout.fillWidth: true; Layout.fillHeight: true
                radius: Theme.radius; color: Theme.surface
                ColumnLayout {
                    anchors.fill: parent; anchors.margins: 14; spacing: 8
                    RowLayout { Layout.fillWidth: true; spacing: Theme.gap
                        ColumnLayout { Layout.fillWidth: true; spacing: 0
                            Text { Layout.fillWidth: true; text: "CLIMATE"; color: Theme.textMute; font.pixelSize: Theme.fsCaption
                                font.letterSpacing: Theme.lsCaps; font.weight: Font.DemiBold }
                            Text { text: home.on ? StatusLabels.control(telemetry.controlStatus) : "Off"
                                color: home.on ? Theme.text : Theme.textMute; font.pixelSize: Theme.fsBody; font.weight: Font.DemiBold } }
                        SegmentedControl { Layout.preferredWidth: 176; Layout.preferredHeight: 44
                            options: [{label:"AUTO", value:true}, {label:"OFF", value:false}]
                            current: home.on
                            onPicked: function(v) { home.setAuto(v) } }
                    }
                    Item { Layout.fillHeight: true }
                    Text { Layout.fillWidth: true; horizontalAlignment: Text.AlignHCenter; text: home.caption(); color: Theme.textMute
                        font.pixelSize: Theme.fsCaption; font.letterSpacing: Theme.lsCaps; font.weight: Font.DemiBold }
                    Stepper { Layout.alignment: Qt.AlignHCenter; Layout.fillWidth: false
                        text: home.haveSetpoint || home.dirty ? home.target + "°" : "—"
                        textColor: home.on ? Theme.text : Theme.textMute; textWidth: 104
                        onDecrement: home.bump(-1); onIncrement: home.bump(1) }
                    Item { Layout.fillHeight: true }
                    RowLayout { Layout.fillWidth: true; spacing: Theme.gap
                        ColumnLayout { Layout.fillWidth: false; Layout.preferredWidth: 44; spacing: 0
                            Text { text: "FAN"; color: Theme.textMute; font.pixelSize: Theme.fsCaption
                                font.letterSpacing: Theme.lsCaps; font.weight: Font.DemiBold }
                            Text { text: telemetry.fanSpeed + "%"; color: Theme.textDim; font.pixelSize: Theme.fsLabel + 1; font.weight: Font.DemiBold } }
                        SegmentedControl { Layout.fillWidth: true; Layout.preferredHeight: 48; fontSize: Theme.fsLabel + 1
                            options: [{label:"AUTO",value:"AUTO"},{label:"LOW",value:"LOW"},{label:"MED",value:"MED"},{label:"HIGH",value:"HIGH"}]
                            current: home.activeFan()
                            onPicked: function(v) { home.pickFan(v) } }
                    }
                }
            }
        }
        // 3. heater card — hidden entirely on firmware without the heater block
        // (heaterPresent:false), height-capped so it can never steal the body
        // RowLayout's fillHeight space.
        HeaterCard { Layout.fillWidth: true; Layout.preferredHeight: 68; Layout.maximumHeight: 68 }
    }
}
