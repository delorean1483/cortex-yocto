import QtQuick
import QtQuick.Layouts
import "."
import "atoms"

// Compact Heater control card for the Home screen. Reads telemetry.heater*
// (Modbus regs 53-75 via the heater coprocessor: VEVOR level 1-10 or AUTOTERM
// setpoint) and issues an optimistic On/Off toggle + a debounced level or
// setpoint stepper, mirroring HomeScreen's uiMode/target idioms. On firmware
// without the coprocessor block (heaterExt false) it behaves exactly as before.
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
    readonly property bool useSetpoint: telemetry.heaterExt && telemetry.heaterControl === "setpoint"
    readonly property bool faulted: telemetry.heaterExt && telemetry.heaterFault
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

    // ---- Setpoint 41-86 degF (AUTOTERM): same follow/debounce/reconcile idiom.
    // The firmware stores whole degC, so the echo may differ by 1 degF.
    function clampSp(v) { return Math.max(41, Math.min(86, v || 68)) }
    property int setpoint: clampSp(telemetry.heaterSetpointF)
    property bool spDirty: false
    Timer { id: spSend; interval: 350; onTriggered: telemetry.setHeaterSetpointF(card.setpoint) }
    function bumpSp(d) { card.spDirty = true; card.setpoint = clampSp(card.setpoint + d); spSend.restart() }

    // ---- Clear fault: BUSY (1) means the heater is not in standby yet.
    property bool clearTried: false

    Connections {
        target: telemetry
        function onDataChanged() {
            if (card.uiOn !== null && (telemetry.heaterState !== "off") === card.uiOn) card.uiOn = null
            if (card.levelDirty && telemetry.heaterTargetLevel === card.level) card.levelDirty = false
            if (!card.levelDirty) card.level = card.clampLevel(telemetry.heaterTargetLevel)
            if (card.spDirty && Math.abs(telemetry.heaterSetpointF - card.setpoint) <= 1) card.spDirty = false
            if (!card.spDirty) card.setpoint = card.clampSp(telemetry.heaterSetpointF)
            if (!telemetry.heaterFault) card.clearTried = false
        }
    }

    // ---- State line ----
    // Phase names (coprocessor firmware) extend the legacy state names.
    function stateLabel(s) {
        if (s === "detecting") return "Detecting…"
        if (s === "starting") return "Starting"
        if (s === "stopping") return "Stopping…"
        if (s === "fault") return "FAULT"
        if (s === "off") return "Off"
        if (s === "preheat") return "Preheat"
        if (s === "ignition") return "Ignition"
        if (s === "running") return "Running"
        if (s === "cooldown") return "Cooling down…"
        return s || "—"
    }
    function stateColor(s) {
        if (s === "fault") return Theme.fault
        if (s === "running") return Theme.ok
        if (s === "stopping") return Theme.warn
        if (s === "starting" || s === "detecting") return Theme.info
        if (s === "cooldown") return Theme.warn
        if (s === "preheat" || s === "ignition") return Theme.info
        return Theme.textMute   // off / unknown
    }

    readonly property string curState: telemetry.heaterExt ? telemetry.heaterPhase : telemetry.heaterState
    // Badge: NO COMMS, or a real vendor error code. A coprocessor fault with no
    // code (255) is already spelled out by the FAULT state label.
    readonly property bool hasCode: telemetry.heaterError !== 0 && telemetry.heaterError !== 255
    readonly property bool showFault: card.faulted ? card.hasCode
                                                   : (telemetry.heaterError !== 0 || !telemetry.heaterCommsOk)
    function faultLabel() {
        if (!telemetry.heaterCommsOk && !card.faulted) return "NO COMMS"
        return "ERR " + telemetry.heaterError
    }
    function typeTag(t) { return t === "vevor" ? "VEVOR" : (t === "autoterm" ? "AUTOTERM" : "") }

    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: 14; anchors.rightMargin: 10
        spacing: Theme.gap

        // label + live state (or the fault badge in its place)
        ColumnLayout {
            Layout.fillWidth: true; spacing: 2
            Text { Layout.fillWidth: true
                text: "HEATER" + (card.typeTag(telemetry.heaterType) ? " · " + card.typeTag(telemetry.heaterType) : "")
                color: Theme.textMute; font.pixelSize: Theme.fsCaption
                font.letterSpacing: Theme.lsCaps; font.weight: Font.DemiBold }
            RowLayout { spacing: 8
                Text { text: (card.faulted && card.clearTried && telemetry.heaterCmdResult === 1)
                             ? "Still cooling — retry" : card.stateLabel(card.curState)
                    color: card.stateColor(card.curState)
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
                        text: card.faultLabel()
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

        // level (VEVOR / legacy) or setpoint (AUTOTERM) stepper
        RowLayout { Layout.fillWidth: false; spacing: 6
            Text { text: card.useSetpoint ? "SET" : "LEVEL"; color: Theme.textMute; font.pixelSize: Theme.fsCaption
                font.letterSpacing: Theme.lsCaps; font.weight: Font.DemiBold }
            Stepper { Layout.fillWidth: false
                text: card.useSetpoint ? (card.setpoint + "°") : card.level
                textSize: 22; textWidth: card.useSetpoint ? 52 : 32
                onDecrement: card.useSetpoint ? card.bumpSp(-2) : card.bumpLevel(-1)
                onIncrement: card.useSetpoint ? card.bumpSp(2) : card.bumpLevel(1) }
        }

        // on / off — replaced by a two-tap CLEAR FAULT while faulted (clearing
        // never starts the heater; ON is a separate, later tap)
        SegmentedControl {
            visible: !card.faulted
            Layout.preferredWidth: 132
            options: [{label:"ON", value:true}, {label:"OFF", value:false}]
            current: card.effOn
            onPicked: function(v) { if (v !== card.effOn) card.setOn(v) }
        }
        ConfirmButton {
            visible: card.faulted
            label: "CLEAR FAULT"; confirmLabel: "Tap again to clear"
            Layout.preferredWidth: armed ? 168 : 132
            onConfirmed: { card.clearTried = true; card.uiOn = null; telemetry.clearHeaterFault() }
        }
    }
}
