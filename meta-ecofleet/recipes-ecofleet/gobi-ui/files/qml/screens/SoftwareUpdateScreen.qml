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
    Connections {
        target: telemetry
        function onDataChanged() {
            if (page.checking && telemetry.otaCheckTs !== page.checkStartTs) page.checking = false
        }
    }
    Component.onCompleted: check()

    readonly property bool busy: telemetry.updateKind === "busy"
    readonly property bool available: telemetry.otaAvailable !== ""

    function ago(ts) {
        if (!ts) return ""
        var m = Math.max(0, Math.round((Date.now() - ts) / 60000))
        return m < 1 ? "just now" : (m === 1 ? "1 min ago" : (m < 60 ? m + " min ago" : Math.round(m / 60) + " h ago"))
    }
    function statusText() {
        if (page.checking) return "Checking for updates…"
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
        if (page.checking) return Theme.info
        if (telemetry.otaCheckState.indexOf("failed") === 0) return Theme.warn
        if (page.available) return Theme.accent
        return Theme.ok
    }

    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: 12
        ScreenHeader { title: "Software Update"; subtitle: "Unit software"
            onBack: if (page.StackView.view) page.StackView.view.pop() }

        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 150
            radius: Theme.radius; color: Theme.surface
            ColumnLayout {
                anchors.fill: parent; anchors.margins: Theme.pad; spacing: 8
                RowLayout { spacing: 10
                    Text { text: "INSTALLED"; color: Theme.textMute; font.pixelSize: Theme.fsCaption
                        font.letterSpacing: Theme.lsCaps; font.weight: Font.DemiBold }
                    Text { text: telemetry.otaRunning || "—"; color: Theme.text
                        font.pixelSize: Theme.fsBody + 6; font.weight: Font.DemiBold }
                }
                Text { Layout.fillWidth: true; text: page.statusText(); color: page.statusColor()
                    font.pixelSize: Theme.fsBody + 1; font.weight: Font.DemiBold; elide: Text.ElideRight }
                Item { Layout.fillHeight: true }
                RowLayout { spacing: 12
                    Rectangle { Layout.preferredWidth: 190; Layout.preferredHeight: 44; radius: Theme.radiusSm
                        color: cka.pressed ? Theme.surface2 : Theme.bg; border.color: Theme.border
                        opacity: page.checking ? 0.5 : 1
                        Text { anchors.centerIn: parent; text: "Check for updates"
                            color: Theme.accent; font.pixelSize: Theme.fsLabel + 1; font.weight: Font.DemiBold }
                        MouseArea { id: cka; anchors.fill: parent; enabled: !page.checking; onClicked: page.check() } }
                    ConfirmButton {
                        visible: page.available && !page.busy && !page.checking
                        label: "Install " + telemetry.otaAvailable
                        confirmLabel: "Tap again to install"
                        Layout.preferredWidth: armed ? 190 : 170; Layout.preferredHeight: 44
                        tone: Theme.accent
                        onConfirmed: telemetry.installUpdate(telemetry.otaAvailable)
                    }
                }
            }
        }

        Text {
            Layout.fillWidth: true; wrapMode: Text.WordWrap
            visible: page.available || page.busy
            text: page.busy ? "An update is in progress — keep the unit powered."
                            : "The unit restarts after installing (about 3 minutes). The APU and heater keep running."
            color: Theme.textMute; font.pixelSize: Theme.fsLabel
        }
        Item { Layout.fillHeight: true }
    }
}
