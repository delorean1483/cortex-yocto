import QtQuick
import QtQuick.Layouts
import "."
import "atoms"
Item {
    id: panel
    property var telemetry                 // injected; the TelemetryModel (or a mock)
    // gate: locked -> keypad -> entering -> active ; back to locked on leave/refuse
    property string gate: "locked"
    // when true, the hosting screen already collected the maintenance passcode, so
    // the panel skips its own keypad and the locked affordance enters OP_DIAG directly.
    property bool preAuthed: false
    readonly property bool active: gate === "active"
    // exposed so screens hosting this panel can disable their own mode/fan
    // controls while an OP_DIAG entry is in flight, not just once it's live —
    // a tap during "entering" would race the firmware's entry transition.
    readonly property bool guarding: gate === "entering" || gate === "active"

    property int heartbeatMs: 3000
    readonly property var relays: [
        { name: "Fuel Pump", i: 0, engine: true }, { name: "Starter", i: 1, engine: true },
        { name: "Glow Plug", i: 2, engine: true }, { name: "Compressor Clutch", i: 3, engine: false },
        { name: "Heat Reverser", i: 4, engine: false }, { name: "Evap Fan", i: 5, engine: false },
        { name: "Condenser Fan", i: 6, engine: false }
    ]
    // index of the currently-energized LOW-RISK output we heartbeat (-1 = none)
    property int heldIndex: -1
    // Optimistic display for LOW-RISK single-active outputs. diagOutputs read-back
    // only refreshes each ~5s Modbus poll (the poll floor is 5s, hard-clamped in
    // shadow.c — not lowerable), so a freshly-tapped tile wouldn't light for up to
    // 5s. Paint the commanded state at once and reconcile when the real read-back
    // lands (onDataChanged below) or a fallback timeout fires. Engine relays are
    // NEVER optimistic — they can be interlock-refused and they auto-pulse, so
    // their tiles stay truth-only (honest about a refusal or a spent pulse).
    property int optimIdx: -2   // -2 = show truth; -1 = optimistic all-off; 0..6 = that idx optimistically ON
    function isOn(i) { return (telemetry.diagOutputs & (1 << i)) !== 0 }               // firmware truth
    function shownOn(i) { return panel.optimIdx !== -2 ? i === panel.optimIdx : isOn(i) }  // what the tile paints
    function toggle(r) {
        if (panel.shownOn(r.i)) {   // turn OFF what the operator currently sees as on
            telemetry.setTestRelay(r.i, false)
            if (heldIndex === r.i) heldIndex = -1
            if (!r.engine) { panel.optimIdx = -1; optimClear.restart() } else panel.optimIdx = -2
            return
        }
        // single-active: releasing any previous is enforced by firmware; drop our heartbeat target
        heldIndex = r.engine ? -1 : r.i
        telemetry.setTestRelay(r.i, true)
        if (!r.engine) { panel.optimIdx = r.i; optimClear.restart() } else panel.optimIdx = -2
    }
    Timer { id: optimClear; interval: 8000; onTriggered: panel.optimIdx = -2 }  // fall back to truth if a read-back never confirms
    Timer {  // deadman heartbeat: re-assert the held low-risk output well within the fw ~10s timeout
        interval: panel.heartbeatMs; repeat: true; running: panel.active && panel.heldIndex >= 0
        onTriggered: if (panel.heldIndex >= 0) panel.telemetry.setTestRelay(panel.heldIndex, true)
    }
    // MODE keepalive: the firmware's ~10s inactivity failsafe drops OP_DIAG unless it
    // sees a fresh DIAG_MODE=1 or DIAG_OUT write. The heartbeat above only refreshes it
    // while an output is HELD — so an operator idly looking at the tiles (nothing tapped)
    // would get auto-dropped mid-session ("tiles show then kick back to Enter"). Re-send
    // DIAG_MODE=1 (firmware treats a repeat while already in OP_DIAG as a timer refresh,
    // NOT a re-enter) every 4s the whole time we're entering||active. This keeps the mode
    // alive exactly as long as the UI is alive and on this panel; the instant the panel
    // leaves (guarding→false, leave(), or the process dies) the keepalive stops and the
    // firmware failsafe deenergizes everything within ~10s. Safety property intact.
    Timer {
        interval: 4000; repeat: true; running: panel.guarding && panel.telemetry
        onTriggered: if (panel.telemetry) panel.telemetry.enterComponentTest()
    }
    // TelemetryModel has no per-property diagOutputsChanged signal (all Q_PROPERTYs
    // share NOTIFY dataChanged) — same adaptation as the gate Connections below: if
    // firmware auto-dropped the held output (bitmask cleared), stop heartbeating it.
    Connections {
        target: panel.telemetry
        function onDataChanged() {
            if (panel.heldIndex >= 0 && !panel.isOn(panel.heldIndex)) panel.heldIndex = -1
            // reconcile optimism: as soon as the real read-back reflects the command, drop to truth
            if (panel.optimIdx !== -2) {
                var realIdx = -1
                for (var b = 0; b < 7; b++) { if (panel.isOn(b)) { realIdx = b; break } }
                if (realIdx === panel.optimIdx || (panel.optimIdx === -1 && realIdx === -1)) panel.optimIdx = -2
            }
        }
    }
    // Firmware confirms entry by driving diagActive true; a refused entry never does.
    // TelemetryModel's Q_PROPERTYs all share one NOTIFY (dataChanged) — there is no
    // per-property diagActiveChanged signal on the real model — so this hooks
    // onDataChanged, same as DiagnosticsScreen.qml / ModeScreen.qml already do.
    //
    // Refusal is snapshot-based, NOT wall-clock. diag_active confirmation only
    // reaches the UI once per firmware telemetry cycle (poll_interval_s, default
    // 5s, up to 60s) — a fixed short timer false-refuses (and tears down, via the
    // compensating exit) a perfectly legitimate slow-polling entry. Instead, count
    // FRESH telemetry snapshots (telemetry.tsMs changing) that land while entering
    // and still show diagActive false: the confirmation lands on the very FIRST
    // fresh snapshot after firmware accepts entry, so 3 fresh snapshots without it
    // means genuine refusal — this never false-refuses regardless of poll interval.
    property var lastEnterTs: 0
    property int freshSnapshots: 0
    Connections {
        target: panel.telemetry
        function onDataChanged() {
            if (panel.gate === "entering") {
                if (panel.telemetry.diagActive) { panel.gate = "active"; return }
                if (panel.telemetry.stale) {
                    // agent/link is dead — no data is ever coming, refuse now.
                    panel.gate = "refused"
                    if (panel.telemetry) panel.telemetry.exitComponentTest()
                    return
                }
                if (panel.telemetry.tsMs !== panel.lastEnterTs) {
                    panel.lastEnterTs = panel.telemetry.tsMs
                    panel.freshSnapshots++
                    if (panel.freshSnapshots >= 3) {
                        panel.gate = "refused"
                        // Compensating exit so a late-accepting firmware doesn't
                        // strand in OP_DIAG; a no-op if it truly never entered.
                        if (panel.telemetry) panel.telemetry.exitComponentTest()
                    }
                }
                return
            }
            if (panel.gate === "active" && !panel.telemetry.diagActive) panel.gate = "locked"
        }
    }

    // When preAuthed (the hosting screen already collected the maintenance
    // passcode), the panel's own keypad is bypassed: the entry affordance drives
    // the firmware OP_DIAG entry directly. Otherwise it runs its own passcode gate.
    function requestEnter() { if (panel.preAuthed) panel.doEnter(); else gate = "keypad" }
    function submitPin(code) {
        if (!MaintController.verify(code)) { gate = "badpin"; return }
        panel.doEnter()
    }
    function doEnter() {
        if (!telemetry) return
        // Live-telemetry guard: the "entering" gate is closed purely by the
        // NEXT onDataChanged (see below), but TelemetryModel only emits that
        // NOTIFY on the stale false->true TRANSITION (TelemetryModel.cpp:47/55)
        // — not on every poll while already stale. If telemetry is already
        // stale right now (first boot before the agent's first write, a
        // deleted/corrupt latest.json), no dataChanged will ever fire during
        // "entering" and the gate would hang on "Entering test mode…"
        // forever. Refuse up front instead — there's nothing to compensate,
        // we never actually entered.
        if (telemetry.stale) { gate = "refused"; return }
        freshSnapshots = 0
        lastEnterTs = telemetry.tsMs
        gate = "entering"; telemetry.enterComponentTest()
    }
    function leave() {
        if (telemetry && (gate === "active" || gate === "entering")) telemetry.exitComponentTest()
        panel.optimIdx = -2
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
                      : (panel.preAuthed ? "Enter test mode to actuate individual relays one at a time."
                      : "Relay tests require a maintenance passcode.")) }
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

        // Shown while the firmware is still confirming OP_DIAG entry — the grid is
        // already visible/tappable below (relays arm the instant the APU confirms,
        // ~1s); if the interlock refuses (engine/ignition on) this yields to the
        // refused affordance. Hidden once active.
        Text { visible: panel.gate === "entering"; text: "Arming test mode…"; color: Theme.textMute; font.pixelSize: 12 }

        // Live relay grid — one-at-a-time component test. Visible during entry too
        // so it "just shows" right after the passcode instead of waiting a poll cycle.
        Flickable {
            id: gridSlot; Layout.fillWidth: true; Layout.fillHeight: true; visible: panel.active || panel.gate === "entering"
            contentHeight: grid.height; clip: true
            ColumnLayout {
                id: grid; width: gridSlot.width; spacing: 8
                RowLayout { Layout.fillWidth: true
                    Text { text: "COMPONENT TEST — one at a time"; color: Theme.textMute
                        font.pixelSize: 11; font.letterSpacing: 2; font.weight: Font.DemiBold }
                    Item { Layout.fillWidth: true }
                    Text { text: "Exit"; color: Theme.accentBlue; font.pixelSize: 14
                        MouseArea { anchors.fill: parent; anchors.margins: -10; onClicked: panel.leave() } } }
                GridLayout {
                    Layout.fillWidth: true; columns: 2; columnSpacing: 8; rowSpacing: 8
                    Repeater { model: panel.relays
                        Rectangle {
                            Layout.fillWidth: true; Layout.preferredHeight: 52; radius: 10
                            property bool on: panel.shownOn(modelData.i)
                            color: on ? Qt.rgba(Theme.ok.r, Theme.ok.g, Theme.ok.b, 0.20) : Theme.surface
                            border.color: on ? Theme.ok : (modelData.engine ? Theme.warn : Theme.border); border.width: 1
                            RowLayout { anchors.fill: parent; anchors.leftMargin: 12; anchors.rightMargin: 10; spacing: 6
                                Text { Layout.fillWidth: true; text: modelData.name; color: Theme.textDim
                                    font.pixelSize: 13; elide: Text.ElideRight }
                                Text { visible: modelData.engine; text: "⚠"; color: Theme.warn; font.pixelSize: 13 }
                                Text { text: parent.parent.on ? "ON" : "OFF"
                                    color: parent.parent.on ? Theme.ok : Theme.textMute; font.pixelSize: 12; font.weight: Font.Bold } }
                            MouseArea { anchors.fill: parent
                                onClicked: {
                                    if (modelData.engine && !parent.on) { confirm.pending = modelData; confirm.open = true }
                                    else panel.toggle(modelData)
                                } }
                        }
                    }
                }
            }
        }

        // Engine-relay confirm strip (crank/prime hazard)
        Rectangle {
            id: confirm
            Layout.fillWidth: true; Layout.preferredHeight: 56; radius: 10; visible: confirm.open
            color: Qt.rgba(Theme.warn.r, Theme.warn.g, Theme.warn.b, 0.12); border.color: Theme.warn; border.width: 1
            property var pending: null; property bool open: false
            RowLayout { anchors.fill: parent; anchors.margins: 10; spacing: 10
                Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.warn; font.pixelSize: 12
                    text: confirm.pending ? ("Energize " + confirm.pending.name + "? This can crank/prime the engine.") : "" }
                Text { text: "Confirm"; color: Theme.warn; font.pixelSize: 14; font.weight: Font.Bold
                    MouseArea { anchors.fill: parent; anchors.margins: -8
                        onClicked: { panel.toggle(confirm.pending); confirm.open = false; confirm.pending = null } } }
                Text { text: "Cancel"; color: Theme.textMute; font.pixelSize: 14
                    MouseArea { anchors.fill: parent; anchors.margins: -8; onClicked: { confirm.open = false; confirm.pending = null } } } }
        }
    }
}
