import QtQuick
import QtQuick.Layouts
import "."
import "atoms"
Item {
    id: panel
    property var telemetry                 // injected; the TelemetryModel (or a mock)
    // gate: locked -> keypad -> entering -> active ; back to locked on leave/refuse
    property string gate: "locked"
    readonly property bool active: gate === "active"

    // Firmware confirms entry by driving diagActive true; a refused entry never does.
    // TelemetryModel's Q_PROPERTYs all share one NOTIFY (dataChanged) — there is no
    // per-property diagActiveChanged signal on the real model — so this hooks
    // onDataChanged, same as DiagnosticsScreen.qml / ModeScreen.qml already do.
    Connections {
        target: panel.telemetry
        function onDataChanged() {
            if (panel.gate === "entering" && panel.telemetry.diagActive) panel.gate = "active"
            if (panel.gate === "active" && !panel.telemetry.diagActive) panel.gate = "locked"
        }
    }
    Timer {   // entry watchdog: if firmware doesn't confirm, treat as refused/unsupported
        id: entryTimeout; interval: 5000; repeat: false
        onTriggered: if (panel.gate === "entering") {
            panel.gate = "refused"
            // A late-accepting firmware may have entered diag mode after the watchdog
            // fired (poll ~2s + apply ~1s can approach the window). Send the
            // compensating exit so it doesn't strand in OP_DIAG; a no-op if it truly
            // never entered.
            if (panel.telemetry) panel.telemetry.exitComponentTest()
        }
    }

    function requestEnter() { gate = "keypad" }
    function submitPin(code) {
        if (!MaintController.verify(code)) { gate = "badpin"; return }
        if (!telemetry) return
        gate = "entering"; telemetry.enterComponentTest(); entryTimeout.restart()
    }
    function leave() {
        if (telemetry && (gate === "active" || gate === "entering")) telemetry.exitComponentTest()
        gate = "locked"
    }

    ColumnLayout {
        anchors.fill: parent; spacing: 8

        // Locked / refused / unsupported entry affordance
        ColumnLayout {
            Layout.fillWidth: true; spacing: 6
            visible: panel.gate === "locked" || panel.gate === "refused" || panel.gate === "badpin"
            Text { text: "Component Test"; color: Theme.textDim; font.pixelSize: 15; font.weight: Font.DemiBold }
            Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; font.pixelSize: 12
                color: panel.gate === "refused" ? Theme.warn : Theme.textMute
                text: panel.gate === "refused"
                      ? "Component test needs the engine off and ignition off (or unsupported firmware)."
                      : (panel.gate === "badpin" ? "Wrong passcode — try again."
                      : "Relay tests require a maintenance passcode.") }
            Rectangle {
                Layout.preferredWidth: 200; Layout.preferredHeight: 44; radius: 10
                color: ema.pressed ? Theme.surface2 : Theme.surface; border.color: Theme.border; border.width: 1
                Text { anchors.centerIn: parent; text: "Enter Component Test"; color: Theme.accentBlue; font.pixelSize: 14 }
                MouseArea { id: ema; anchors.fill: parent; onClicked: panel.requestEnter() }
            }
        }

        // Passcode keypad
        ColumnLayout {
            Layout.fillWidth: true; spacing: 8; visible: panel.gate === "keypad"
            Text { text: "Maintenance passcode"; color: Theme.textDim; font.pixelSize: 14 }
            Keypad { Layout.alignment: Qt.AlignHCenter; hue: Theme.warn
                onEntered: function(code) { panel.submitPin(code) } }
        }

        Text { visible: panel.gate === "entering"; text: "Entering test mode…"; color: Theme.textMute; font.pixelSize: 13 }

        // Grid placeholder — filled in Task 7
        Item { id: gridSlot; Layout.fillWidth: true; Layout.fillHeight: true; visible: panel.active }
    }
}
