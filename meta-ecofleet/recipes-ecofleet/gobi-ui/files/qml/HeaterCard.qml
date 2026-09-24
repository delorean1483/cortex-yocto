import QtQuick
import QtQuick.Layouts
import "."
import "atoms"

// Compact Heater control card for the Home screen. Reads telemetry.heater*
// (VEVOR XMZ-F-D5 diesel air heater, Modbus regs 53-67) and issues an
// optimistic On/Off toggle + a debounced 1-10 level stepper, mirroring
// HomeScreen's uiMode/target idioms.
//
// The heater runs its own state machine (off/preheat/ignition/running/
// cooldown) that is UNRELATED to the APU's control_status enum, so it gets
// its own small local label/color map here instead of StatusLabels.
Rectangle {
    id: card

    // Firmware without the heater block reports heaterPresent:false — hide
    // the whole card so heater-less units see an unchanged Home screen. In
    // a ColumnLayout an invisible item contributes zero height.
    visible: telemetry.heaterPresent

    radius: Theme.radius
    color: Theme.surface
    border.color: Theme.border
    border.width: 1

    // ---- On/Off (optimistic; cleared once telemetry reconciles) ----
    property var uiOn: null
    readonly property bool effOn: uiOn !== null ? uiOn : (telemetry.heaterState !== "off")
    function setOn(v) { card.uiOn = v; telemetry.setHeaterOn(v) }
    // NOTE: turning OFF only reconciles once heaterState actually reaches
    // "off" — the heater runs a several-minute cooldown first, so the
    // toggle stays showing the requested OFF while the state line still
    // reads "COOLING DOWN…". That's intentional: off is not instantaneous.

    // ---- Level 1-10: follows telemetry until touched, then debounced and
    // reconciled once the device echoes it back (the card is built before the
    // first snapshot, so a one-shot copy at load would stick at the default).
    function clampLevel(v) { return Math.max(1, Math.min(10, v || 1)) }
    property int level: clampLevel(telemetry.heaterTargetLevel)
    property bool levelDirty: false
    Timer { id: lvlSend; interval: 350; onTriggered: telemetry.setHeaterLevel(card.level) }
    function bumpLevel(d) { card.levelDirty = true; card.level = clampLevel(card.level + d); lvlSend.restart() }

    Connections {
        target: telemetry
        function onDataChanged() {
            if (card.uiOn !== null && (telemetry.heaterState !== "off") === card.uiOn) card.uiOn = null
            if (card.levelDirty && telemetry.heaterTargetLevel === card.level) card.levelDirty = false
            if (!card.levelDirty) card.level = card.clampLevel(telemetry.heaterTargetLevel)
        }
    }

    // ---- State line ----
    function stateLabel(s) {
        if (s === "off") return "Off"
        if (s === "preheat") return "Preheat"
        if (s === "ignition") return "Ignition"
        if (s === "running") return "Running"
        if (s === "cooldown") return "Cooling down…"
        return s || "—"
    }
    function stateColor(s) {
        if (s === "running") return Theme.ok
        if (s === "cooldown") return Theme.warn
        if (s === "preheat" || s === "ignition") return Theme.info
        return Theme.textMute   // off / unknown
    }

    readonly property bool showFault: telemetry.heaterError !== 0 || !telemetry.heaterCommsOk

    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: 14; anchors.rightMargin: 10
        spacing: Theme.gap

        // label + live state (or the fault badge in its place)
        ColumnLayout {
            Layout.fillWidth: true; spacing: 2
            Text { Layout.fillWidth: true; text: "HEATER"; color: Theme.textMute; font.pixelSize: Theme.fsCaption
                font.letterSpacing: Theme.lsCaps; font.weight: Font.DemiBold }
            RowLayout { spacing: 8
                Text { text: card.stateLabel(telemetry.heaterState); color: card.stateColor(telemetry.heaterState)
                    font.pixelSize: Theme.fsBody; font.weight: Font.DemiBold }
                Rectangle {
                    visible: card.showFault
                    Layout.preferredHeight: 22; Layout.preferredWidth: faultText.implicitWidth + 16
                    radius: 11
                    color: Theme.tint(Theme.fault, 0.16)
                    border.color: Theme.fault; border.width: 1
                    Text {
                        id: faultText
                        anchors.centerIn: parent
                        text: !telemetry.heaterCommsOk ? "NO COMMS" : ("ERR " + telemetry.heaterError)
                        color: Theme.fault; font.pixelSize: Theme.fsCaption - 1; font.weight: Font.Bold
                        font.letterSpacing: 0.6
                    }
                }
            }
        }

        // fan RPM / exchanger readout (nested layouts default to fillWidth —
        // pin them so only the label column absorbs spare width)
        ColumnLayout {
            Layout.fillWidth: false; spacing: 0
            Repeater { model: [ {v: telemetry.heaterFanRpm, l: "RPM"}, {v: telemetry.heaterExchanger, l: "EXCH"} ]
                RowLayout { Layout.alignment: Qt.AlignRight; spacing: 4
                    Text { text: modelData.v + ""; color: Theme.textDim; font.pixelSize: Theme.fsLabel; font.weight: Font.DemiBold }
                    Text { text: modelData.l; color: Theme.textMute; font.pixelSize: Theme.fsCaption - 1 } } }
        }

        // level stepper
        RowLayout { Layout.fillWidth: false; spacing: 6
            Text { text: "LEVEL"; color: Theme.textMute; font.pixelSize: Theme.fsCaption
                font.letterSpacing: Theme.lsCaps; font.weight: Font.DemiBold }
            Stepper { Layout.fillWidth: false; text: card.level; textSize: 22; textWidth: 32
                onDecrement: card.bumpLevel(-1); onIncrement: card.bumpLevel(1) }
        }

        // on / off
        SegmentedControl {
            Layout.preferredWidth: 132
            options: [{label:"ON", value:true}, {label:"OFF", value:false}]
            current: card.effOn
            onPicked: function(v) { if (v !== card.effOn) card.setOn(v) }
        }
    }
}
