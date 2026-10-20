import QtQuick
import QtQuick.Layouts
import ".."
import "../atoms"
Item {
    id: home
    property var appShell
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
    // fault strip: elapsed time refreshes every 10 s while a fault is active
    property real now: Date.now()
    Timer { interval: 10000; repeat: true; running: telemetry.hasError; onTriggered: home.now = Date.now() }
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
        // 1. fault strip (only while a fault is active; tap -> Alerts)
        Rectangle {
            id: strip
            readonly property var ev: StatusLabels.activeEvent(eventlog.events)
            Layout.fillWidth: true; Layout.preferredHeight: 48; radius: 10; visible: telemetry.hasError
            color: Theme.tint(Theme.fault, 0.18)
            RowLayout {
                anchors.fill: parent; anchors.leftMargin: 14; anchors.rightMargin: 14; spacing: 12
                Icon { name: "alert"; size: 22; stroke: 2.4; color: Theme.fault }
                Text { Layout.maximumWidth: 260; text: StatusLabels.error(telemetry.error); elide: Text.ElideRight
                    color: Theme.faultText; font.pixelSize: 17; font.weight: Font.Bold }
                Text { Layout.fillWidth: true; text: StatusLabels.activeFor(strip.ev ? strip.ev.startMs : 0, home.now)
                    elide: Text.ElideRight; color: Theme.textDim; font.pixelSize: 14 }
                Text { text: "Details"; color: Theme.text; font.pixelSize: 15; font.weight: Font.DemiBold }
                Icon { name: "chevron-right"; size: 20; stroke: 2.4; color: Theme.text }
            }
            MouseArea { anchors.fill: parent; onClicked: home.appShell.openAlerts() }
        }
        // 2. body: cabin reading + stats list | climate card
        RowLayout {
            Layout.fillWidth: true; Layout.fillHeight: true; spacing: Theme.gap
            ColumnLayout { Layout.preferredWidth: 220; Layout.maximumWidth: 220; Layout.fillHeight: true; spacing: 0
                Item { Layout.fillHeight: true }
                Text { Layout.alignment: Qt.AlignHCenter; text: telemetry.cabinTempF.toFixed(0) + "°"
                    color: Theme.text; font.pixelSize: 100; font.weight: Font.DemiBold
                    font.letterSpacing: -2; lineHeight: 0.9 }
                Text { Layout.alignment: Qt.AlignHCenter; Layout.topMargin: 8; text: "CABIN"; color: Theme.textMute
                    font.pixelSize: Theme.fsCaption; font.letterSpacing: 1.4; font.weight: Font.DemiBold }
                Item { Layout.fillHeight: true }
                ColumnLayout { Layout.fillWidth: true; Layout.leftMargin: 8; Layout.rightMargin: 8; spacing: 0
                    Repeater { model: [ {l:"Coolant", v: telemetry.extTempF.toFixed(0)+"°F"},
                                        {l:"Battery", v: telemetry.battV.toFixed(1)+" V"},
                                        {l:"Engine", v: StatusLabels.thousands(telemetry.engineHrs)+" h"} ]
                        Item { Layout.fillWidth: true; Layout.preferredHeight: 30
                            Text { anchors.left: parent.left; anchors.verticalCenter: parent.verticalCenter
                                text: modelData.l; color: Theme.textMute; font.pixelSize: 14 }
                            Text { anchors.right: parent.right; anchors.verticalCenter: parent.verticalCenter
                                text: modelData.v; color: Theme.text; font.pixelSize: 16; font.weight: Font.DemiBold }
                            Rectangle { visible: index < 2; anchors.left: parent.left; anchors.right: parent.right
                                anchors.bottom: parent.bottom; height: 1; color: Theme.surface2 } } } }
            }
            // climate card: mode, setpoint, fan
            Rectangle {
                Layout.fillWidth: true; Layout.fillHeight: true
                radius: Theme.radius; color: Theme.surface
                ColumnLayout {
                    anchors.fill: parent; anchors.margins: 16; spacing: 8
                    RowLayout { Layout.fillWidth: true; spacing: Theme.gap
                        Item { Layout.fillWidth: true; Layout.preferredHeight: hdr.implicitHeight
                          ColumnLayout { id: hdr; anchors.fill: parent; spacing: 2
                            Text { Layout.fillWidth: true; text: "CLIMATE"; color: Theme.textMute; font.pixelSize: Theme.fsCaption
                                font.letterSpacing: Theme.lsCaps; font.weight: Font.DemiBold }
                            RowLayout { spacing: 8
                                Rectangle { visible: home.on; Layout.preferredWidth: 10; Layout.preferredHeight: 10; radius: 5
                                    color: StatusLabels.controlHue(telemetry.controlStatus) }
                                Text { text: home.on ? StatusLabels.control(telemetry.controlStatus) : "Off"
                                    color: home.on ? Theme.text : Theme.textMute; font.pixelSize: 18; font.weight: Font.DemiBold } } }
                          // 48px tap area: grows vertically only, so it never reaches the ON/OFF control beside it
                          MouseArea { anchors.left: parent.left; anchors.right: parent.right; anchors.verticalCenter: parent.verticalCenter
                              height: Math.max(48, parent.height); onClicked: home.appShell.openMode() } }
                        SegmentedControl { Layout.preferredWidth: 168; Layout.preferredHeight: 48; trackColor: Theme.bg
                            options: [{label:"ON", value:true}, {label:"OFF", value:false}]
                            current: home.on
                            onPicked: function(v) { home.setAuto(v) } }
                    }
                    Item { Layout.fillHeight: true }
                    Text { Layout.fillWidth: true; horizontalAlignment: Text.AlignHCenter; text: "SETPOINT"; color: Theme.textMute
                        font.pixelSize: Theme.fsCaption; font.letterSpacing: Theme.lsCaps; font.weight: Font.DemiBold }
                    Stepper { Layout.alignment: Qt.AlignHCenter; Layout.fillWidth: false; spacing: 10
                        text: home.haveSetpoint || home.dirty ? home.target + "°" : "—"
                        textColor: home.on ? Theme.text : Theme.textMute; textWidth: 124
                        textSize: 56; textLetterSpacing: -1
                        buttonW: 64; buttonH: 56; buttonRadius: 12; buttonFill: Theme.surface2; buttonBorder: false
                        iconSize: 26; iconStroke: 2.6
                        onDecrement: home.bump(-1); onIncrement: home.bump(1) }
                    Item { Layout.fillHeight: true }
                    RowLayout { Layout.fillWidth: true; spacing: Theme.gap
                        ColumnLayout { Layout.fillWidth: false; Layout.preferredWidth: 46; spacing: 0
                            Text { text: "FAN"; color: Theme.textMute; font.pixelSize: Theme.fsCaption
                                font.letterSpacing: Theme.lsCaps; font.weight: Font.DemiBold }
                            Text { text: telemetry.fanSpeed + "%"; color: Theme.textDim; font.pixelSize: 15; font.weight: Font.DemiBold } }
                        SegmentedControl { Layout.fillWidth: true; Layout.preferredHeight: 52; fontSize: 15; trackColor: Theme.bg
                            options: [{label:"Auto",value:"AUTO"},{label:"Low",value:"LOW"},{label:"Med",value:"MED"},{label:"High",value:"HIGH"}]
                            current: home.activeFan()
                            onPicked: function(v) { home.pickFan(v) } }
                    }
                }
            }
        }
        // 3. heater card — hidden entirely on firmware without the heater block
        // (heaterPresent:false), height-capped so it can never steal the body
        // RowLayout's fillHeight space.
        HeaterCard { Layout.fillWidth: true; Layout.preferredHeight: 60; Layout.maximumHeight: 60 }
    }
}
