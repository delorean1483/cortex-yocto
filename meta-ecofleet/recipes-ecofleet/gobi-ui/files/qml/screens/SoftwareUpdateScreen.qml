import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
// Technician screen (Maintenance hub, PIN-gated): check the public release
// manifest and install a newer unit software build. The agent only installs
// the exact version its last successful check offered; progress then shows on
// the global UpdateOverlay (downloading → installing → restart).
Item {
    id: page

    // UI-side "checking" between the tap and the agent's next snapshot.
    property bool checking: false
    property double checkStartTs: 0
    function check() {
        page.checking = true
        page.checkStartTs = telemetry.otaCheckTs
        telemetry.checkForUpdate()
        checkTimeout.restart()
    }
    Timer { id: checkTimeout; interval: 15000; onTriggered: page.checking = false }

    // UI-side "starting" between the confirming tap and the agent's snapshot
    // that shows the update in progress (the global UpdateOverlay then takes
    // over), so Install can't be armed and sent again meanwhile. A refusal
    // changes otaCheckState ("failed: busy" / "failed: not offered").
    property bool starting: false
    property string startState: ""
    function install() {
        page.starting = true
        page.startState = telemetry.otaCheckState
        telemetry.installUpdate(telemetry.otaAvailable)
        startTimeout.restart()
    }
    Timer { id: startTimeout; interval: 15000; onTriggered: page.starting = false }

    Connections {
        target: telemetry
        function onDataChanged() {
            if (page.checking && telemetry.otaCheckTs !== page.checkStartTs) page.checking = false
            if (page.starting && (page.busy || telemetry.otaCheckState !== page.startState)) page.starting = false
        }
    }
    Component.onCompleted: check()

    property double now: Date.now()
    Timer { interval: 30000; running: true; repeat: true; onTriggered: page.now = Date.now() }
    onVisibleChanged: if (visible) now = Date.now()
    readonly property bool busy: telemetry.updateKind === "busy"
    readonly property bool available: telemetry.otaAvailable !== ""
    // A checking/failed state must stay visible even when an update is on offer.
    readonly property bool showStatus: available && (checking || starting || telemetry.otaCheckState.indexOf("failed") === 0)

    function ago(ts) {
        if (!ts) return ""
        var m = Math.max(0, Math.round((Date.now() - ts) / 60000))
        return m < 1 ? "just now" : (m === 1 ? "1 min ago" : (m < 60 ? m + " min ago" : Math.round(m / 60) + " h ago"))
    }
    function statusText() {
        if (page.checking) return "Checking for updates…"
        if (page.starting) return "Starting update…"
        var s = telemetry.otaCheckState
        if (s === "failed: network") return "Couldn't check — no internet connection"
        if (s === "failed: bad manifest") return "Couldn't check — update service unavailable"
        if (s === "failed: busy") return "An update is already in progress"
        if (s === "failed: not offered") return "That version is no longer offered — check again"
        if (page.available) return "Update available: " + telemetry.otaAvailable
        if (s === "ok") return "Up to date (checked " + page.ago(telemetry.otaCheckTs) + ")"
        return "Not checked yet"
    }
    function statusColor() {
        if (page.checking || page.starting) return Theme.info
        if (telemetry.otaCheckState.indexOf("failed") === 0) return Theme.warn
        if (page.available) return Theme.accent
        return Theme.ok
    }

    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: 12
        ScreenHeader { title: "Software Update"; subtitle: "Unit software"
            onBack: if (page.StackView.view) page.StackView.view.pop() }

        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: cardCol.implicitHeight + 40
            radius: Theme.radius; color: Theme.surface
            ColumnLayout {
                id: cardCol
                anchors.fill: parent; anchors.margins: 20; spacing: 18
                RowLayout { Layout.fillWidth: true; spacing: 0
                    ColumnLayout { Layout.preferredWidth: 240; Layout.maximumWidth: 240; Layout.rightMargin: 24; spacing: 2
                        Text { text: "INSTALLED"; color: Theme.textMute; font.pixelSize: Theme.fsCaption
                            font.letterSpacing: Theme.lsCaps; font.weight: Font.DemiBold }
                        Text { Layout.fillWidth: true; elide: Text.ElideRight; textFormat: Text.PlainText
                            text: telemetry.otaRunning || "—"; color: Theme.text
                            font.pixelSize: 30; font.weight: Font.DemiBold }
                    }
                    ColumnLayout { Layout.fillWidth: !page.available; Layout.alignment: Qt.AlignTop; spacing: 2
                        Text { visible: page.available; text: "AVAILABLE"; color: Theme.textMute
                            font.pixelSize: Theme.fsCaption; font.letterSpacing: Theme.lsCaps; font.weight: Font.DemiBold }
                        Text { visible: page.available; text: telemetry.otaAvailable; color: Theme.accent
                            font.pixelSize: 30; font.weight: Font.DemiBold }
                        Text { Layout.fillWidth: true; visible: !page.available; text: page.statusText()
                            color: page.statusColor(); font.pixelSize: Theme.fsBody + 1
                            font.weight: Font.DemiBold; wrapMode: Text.WordWrap }
                    }
                    Item { Layout.fillWidth: true; visible: page.available && !page.showStatus; implicitHeight: 1 }
                    Text { Layout.alignment: Qt.AlignBottom; Layout.fillWidth: page.showStatus; Layout.leftMargin: page.showStatus ? 16 : 0
                        visible: page.available && (page.showStatus || telemetry.otaCheckTs > 0)
                        text: page.showStatus ? page.statusText()
                                              : "Checked " + StatusLabels.ago(telemetry.otaCheckTs, page.now)
                        color: page.showStatus ? page.statusColor() : Theme.textDim
                        font.pixelSize: page.showStatus ? Theme.fsBody : 14
                        font.weight: page.showStatus ? Font.DemiBold : Font.Normal
                        wrapMode: Text.WordWrap; horizontalAlignment: Text.AlignRight }
                }
                RowLayout { Layout.fillWidth: true; spacing: 12
                    ConfirmButton {
                        visible: page.available && !page.busy && !page.checking && !page.starting
                        label: "Install " + telemetry.otaAvailable
                        confirmLabel: "Tap again to install"
                        tone: Theme.accent; filled: true; radius: 12; fontSize: 18; fontWeight: Font.Bold
                        Layout.fillWidth: true; Layout.preferredWidth: -1; Layout.preferredHeight: 56
                        onConfirmed: page.install()
                    }
                    Rectangle { Layout.preferredWidth: 180; Layout.preferredHeight: 56; radius: 12
                        color: cka.pressed ? Theme.border : Theme.surface2
                        opacity: page.checking ? 0.5 : 1
                        Text { anchors.centerIn: parent; text: "Check again"
                            color: Theme.text; font.pixelSize: 16; font.weight: Font.DemiBold }
                        MouseArea { id: cka; anchors.fill: parent; enabled: !page.checking; onClicked: page.check() } }
                }
                Text {
                    Layout.fillWidth: true; wrapMode: Text.WordWrap
                    visible: page.available || page.busy
                    text: page.busy ? "An update is in progress — keep the unit powered."
                                    : "The unit restarts after installing (about 3 minutes). The APU and heater keep running."
                    color: Theme.textDim; font.pixelSize: 15
                }
            }
        }

        Item { Layout.fillHeight: true }
    }
}
