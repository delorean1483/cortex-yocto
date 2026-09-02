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
    property int target: Math.round(telemetry.clmtSetpointF)
    Component.onCompleted: target = Math.round(telemetry.clmtSetpointF)
    Timer { id: spSend; interval: 350; onTriggered: telemetry.setSetpoint(home.target) }
    function bump(d) { home.target = Math.max(55, Math.min(85, home.target + d)); spSend.restart() }
    // AUTO turns climate on AND puts fan in auto (spec §2); OFF stops.
    function setAuto(a) { home.uiMode = a ? "climate" : "off"; telemetry.setMode(home.uiMode); if (a) telemetry.setFanAuto(true) }
    // fan presets
    readonly property var presets: [{k:"LOW",v:40},{k:"MED",v:70},{k:"HIGH",v:100}]
    function pickAuto() { telemetry.setFanAuto(true) }
    function pickPreset(v) { telemetry.setFanAuto(false); telemetry.setFan(v) }
    function activeFan() { return telemetry.fanAuto ? "AUTO" : (function(){ for (var i=0;i<home.presets.length;i++) if (home.presets[i].v===telemetry.fanSpeed) return home.presets[i].k; return "" })() }
    // glow bar color + label from control_status
    function glowColor(s){ return s==="cooling"?"#2F81F7": (s==="warming_up"||s==="starting")?"#F0883E": s==="chillin"?"#39B0C4": s==="charging"?Theme.ok: "transparent" }
    readonly property bool glowOn: telemetry.controlStatus !== "off" && home.on
    // setpoint caption from control_status
    function caption(){ var s=telemetry.controlStatus; if(!home.on)return "OFF"; if(s==="cooling")return "COOLING TO"; if(s==="warming_up"||s==="starting")return "WARMING UP"; if(s==="chillin")return "AT TARGET"; if(s==="charging")return "CHARGING"; return StatusLabels.control(s,true) }
    Connections { target: telemetry; function onDataChanged(){ if (home.uiMode!=="" && telemetry.mode===home.uiMode) home.uiMode="" } }

    ColumnLayout {
        anchors.fill: parent; anchors.margins: 12; spacing: 8
        // 1. glow bar
        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 26; radius: 9; visible: home.glowOn
            color: Qt.rgba(0,0,0,0)
            border.color: home.glowColor(telemetry.controlStatus); border.width: 1
            // soft pulse
            SequentialAnimation on opacity { running: home.glowOn; loops: Animation.Infinite
                NumberAnimation { to: 0.55; duration: 1200 } NumberAnimation { to: 1.0; duration: 1200 } }
            Text { anchors.centerIn: parent; text: StatusLabels.control(telemetry.controlStatus, true)
                color: home.glowColor(telemetry.controlStatus); font.pixelSize: 12; font.letterSpacing: 2; font.weight: Font.Bold }
        }
        // 2. body: big temp + control column
        RowLayout {
            Layout.fillWidth: true; Layout.fillHeight: true; spacing: 10
            ColumnLayout { Layout.fillWidth: true
                Text { Layout.alignment: Qt.AlignHCenter; text: telemetry.cabinTempF.toFixed(0)+"°"
                    color: Theme.accentBlue; font.pixelSize: 110; font.weight: Font.Bold }
                Text { Layout.alignment: Qt.AlignHCenter; text: "CABIN NOW"; color: Theme.textMute
                    font.pixelSize: 11; font.letterSpacing: 2 } }
            ColumnLayout { Layout.preferredWidth: 150; spacing: 10
                // AUTO / OFF
                RowLayout { spacing: 0
                    Repeater { model: [{t:"AUTO",on:true},{t:"OFF",on:false}]
                        Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 40; radius: 9
                            property bool sel: modelData.on === home.on
                            color: sel ? (modelData.on?Qt.rgba(0.25,0.72,0.31,0.18):Theme.surface2) : "transparent"
                            border.color: sel ? (modelData.on?Theme.ok:Theme.border) : Theme.border; border.width: 1
                            Text { anchors.centerIn: parent; text: modelData.t; font.pixelSize: 14; font.weight: Font.Bold
                                color: sel ? (modelData.on?Theme.ok:Theme.text) : Theme.textMute }
                            MouseArea { anchors.fill: parent; onClicked: home.setAuto(modelData.on) } } } }
                Text { Layout.alignment: Qt.AlignHCenter; text: home.caption(); color: Theme.textMute; font.pixelSize: 10; font.letterSpacing: 1 }
                RowLayout { Layout.alignment: Qt.AlignHCenter; spacing: 10
                    Text { text: home.target; color: Theme.accentBlue; font.pixelSize: 40; font.weight: Font.Bold }
                    ColumnLayout { spacing: 4
                        Rectangle { Layout.preferredWidth: 48; Layout.preferredHeight: 34; radius: 8; color: Theme.surface; border.color: Theme.border; border.width: 1
                            Text { anchors.centerIn: parent; text:"▲"; color: Theme.accentBlue } MouseArea { anchors.fill: parent; onClicked: home.bump(1) } }
                        Rectangle { Layout.preferredWidth: 48; Layout.preferredHeight: 34; radius: 8; color: Theme.surface; border.color: Theme.border; border.width: 1
                            Text { anchors.centerIn: parent; text:"▼"; color: Theme.accentBlue } MouseArea { anchors.fill: parent; onClicked: home.bump(-1) } } } } }
        }
        // 3. fan presets: AUTO / LOW / MED / HIGH  (AUTO hidden if firmware lacks fan_auto — see note)
        RowLayout { Layout.fillWidth: true; Layout.preferredHeight: 52; spacing: 8
            Text { text: "FAN"; color: Theme.textMute; font.pixelSize: 12; Layout.preferredWidth: 34 }
            Rectangle { id: fanAutoBtn; Layout.fillWidth: true; Layout.fillHeight: true; radius: 10
                property bool sel: home.activeFan()==="AUTO"
                color: sel?Qt.rgba(0.25,0.72,0.31,0.18):Theme.surface; border.color: sel?Theme.ok:Theme.border; border.width: 1
                Text { anchors.centerIn: parent; text:"AUTO"; color: fanAutoBtn.sel?Theme.ok:Theme.textDim; font.weight: Font.Bold }
                MouseArea { anchors.fill: parent; onClicked: home.pickAuto() } }
            Repeater { model: home.presets
                Rectangle { Layout.fillWidth: true; Layout.fillHeight: true; radius: 10
                    property bool sel: home.activeFan()===modelData.k
                    color: sel?Qt.rgba(0.18,0.5,0.9,0.18):Theme.surface; border.color: sel?Theme.accentBlue:Theme.border; border.width: 1
                    Text { anchors.centerIn: parent; text: modelData.k; color: sel?Theme.accentBlue:Theme.textDim; font.weight: Font.Bold }
                    MouseArea { anchors.fill: parent; onClicked: home.pickPreset(modelData.v) } } }
        }
        // 4. divider + passive stats
        Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 1; color: Theme.border }
        RowLayout { Layout.fillWidth: true; spacing: 16
            Repeater { model: [ {l:"OUTSIDE", v: telemetry.extTempF.toFixed(0)+"°F"},
                                {l:"BATTERY", v: telemetry.battV.toFixed(1)+" V"},
                                {l:"ENGINE HRS", v: telemetry.engineHrs+""} ]
                RowLayout { spacing: 6
                    Text { text: modelData.v; color: Theme.textDim; font.pixelSize: 13; font.weight: Font.DemiBold }
                    Text { text: modelData.l; color: Theme.textMute; font.pixelSize: 11 } } }
        }
    }
}
