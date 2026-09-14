import QtQuick
import QtQuick.Layouts
import "."

// Compact Heater control card for the Home screen. Reads telemetry.heater*
// (VEVOR XMZ-F-D5 diesel air heater, Modbus regs 53-67) and issues an
// optimistic On/Off toggle + a debounced 1-10 level stepper, mirroring
// HomeScreen's uiMode/target idioms (HomeScreen.qml:8-9,13-14,16,27).
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

    radius: 10
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
    Connections {
        target: telemetry
        function onDataChanged() {
            if (card.uiOn !== null && (telemetry.heaterState !== "off") === card.uiOn) card.uiOn = null
        }
    }

    // ---- Level 1-10 (debounced, mirrors HomeScreen's bump/spSend) ----
    property int level: 1
    Component.onCompleted: card.level = Math.max(1, Math.min(10, telemetry.heaterTargetLevel || 1))
    Timer { id: lvlSend; interval: 350; onTriggered: telemetry.setHeaterLevel(card.level) }
    function bumpLevel(d) { card.level = Math.max(1, Math.min(10, card.level + d)); lvlSend.restart() }

    // ---- State line ----
    function stateLabel(s) {
        if (s === "off") return "OFF"
        if (s === "preheat") return "PREHEAT"
        if (s === "ignition") return "IGNITION"
        if (s === "running") return "RUNNING"
        if (s === "cooldown") return "COOLING DOWN…"
        return (s || "—").toUpperCase()
    }
    function stateColor(s) {
        if (s === "running") return Theme.ok
        if (s === "cooldown") return Theme.warn
        if (s === "preheat" || s === "ignition") return Theme.accentBlue
        return Theme.textMute   // off / unknown
    }

    readonly property bool showFault: telemetry.heaterError !== 0 || !telemetry.heaterCommsOk

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 8
        spacing: 4

        // row 1: label + on/off toggle + live state + fault badge
        RowLayout {
            Layout.fillWidth: true
            Layout.preferredHeight: 24
            spacing: 8
            Text { text: "HEATER"; color: Theme.textMute; font.pixelSize: 12; font.letterSpacing: 1; font.weight: Font.Bold }
            Rectangle {
                Layout.preferredWidth: 52; Layout.preferredHeight: 24; radius: 12
                color: card.effOn ? Qt.rgba(0.25,0.72,0.31,0.18) : Theme.surface2
                border.color: card.effOn ? Theme.ok : Theme.border; border.width: 1
                Text {
                    anchors.centerIn: parent
                    text: card.effOn ? "ON" : "OFF"
                    font.pixelSize: 11; font.weight: Font.Bold
                    color: card.effOn ? Theme.ok : Theme.textMute
                }
                MouseArea { anchors.fill: parent; onClicked: card.setOn(!card.effOn) }
            }
            Item { Layout.fillWidth: true }
            Text {
                text: card.stateLabel(telemetry.heaterState)
                color: card.stateColor(telemetry.heaterState)
                font.pixelSize: 12; font.weight: Font.Bold; font.letterSpacing: 1
            }
            Rectangle {
                visible: card.showFault
                Layout.preferredHeight: 18
                Layout.preferredWidth: faultText.implicitWidth + 14
                radius: 9
                color: Qt.rgba(Theme.fault.r, Theme.fault.g, Theme.fault.b, 0.15)
                border.color: Theme.fault; border.width: 1
                Text {
                    id: faultText
                    anchors.centerIn: parent
                    text: !telemetry.heaterCommsOk ? "NO COMMS" : ("ERR " + telemetry.heaterError)
                    color: Theme.fault; font.pixelSize: 10; font.weight: Font.Bold
                }
            }
        }

        // row 2: level stepper + fan RPM / exchanger readout
        RowLayout {
            Layout.fillWidth: true
            Layout.preferredHeight: 24
            spacing: 8
            Text { text: "LEVEL"; color: Theme.textMute; font.pixelSize: 11; Layout.preferredWidth: 38 }
            Rectangle {
                Layout.preferredWidth: 22; Layout.preferredHeight: 22; radius: 6
                color: Theme.surface2; border.color: Theme.border; border.width: 1
                Text { anchors.centerIn: parent; text: "▼"; color: Theme.accentBlue; font.pixelSize: 11 }
                MouseArea { anchors.fill: parent; onClicked: card.bumpLevel(-1) }
            }
            Text {
                text: card.level
                color: Theme.accentBlue; font.pixelSize: 16; font.weight: Font.Bold
                Layout.preferredWidth: 18; horizontalAlignment: Text.AlignHCenter
            }
            Rectangle {
                Layout.preferredWidth: 22; Layout.preferredHeight: 22; radius: 6
                color: Theme.surface2; border.color: Theme.border; border.width: 1
                Text { anchors.centerIn: parent; text: "▲"; color: Theme.accentBlue; font.pixelSize: 11 }
                MouseArea { anchors.fill: parent; onClicked: card.bumpLevel(1) }
            }
            Item { Layout.fillWidth: true }
            RowLayout {
                spacing: 4
                Text { text: telemetry.heaterFanRpm + ""; color: Theme.textDim; font.pixelSize: 12; font.weight: Font.DemiBold }
                Text { text: "RPM"; color: Theme.textMute; font.pixelSize: 10 }
            }
            RowLayout {
                spacing: 4
                Text { text: telemetry.heaterExchanger + ""; color: Theme.textDim; font.pixelSize: 12; font.weight: Font.DemiBold }
                Text { text: "EXCH"; color: Theme.textMute; font.pixelSize: 10 }
            }
        }
    }
}
