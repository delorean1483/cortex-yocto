import QtQuick
import QtTest
import "../../qml/screens"

Item {
    id: root
    width: 800; height: 480

    // Stand-in for the TelemetryModel context property the screen reads.
    QtObject {
        id: telemetry
        signal dataChanged()
        property string otaRunning: "1.2.79"
        property string otaAvailable: "1.2.80"
        property string otaCheckState: "ok"
        property real   otaCheckTs: 1
        property string updateKind: "none"
        property int    installs: 0
        function checkForUpdate() {}
        function installUpdate(v) { installs++ }
    }

    Component { id: screenC; SoftwareUpdateScreen { anchors.fill: parent } }

    TestCase {
        name: "SoftwareUpdate"
        when: windowShown

        function find(item, pred) {
            if (pred(item)) return item
            for (var i = 0; i < item.children.length; i++) {
                var hit = find(item.children[i], pred)
                if (hit) return hit
            }
            return null
        }
        function installButton(s) { return find(s, function(o) { return o.confirmLabel === "Tap again to install" }) }

        // Fresh screen with its opening check already answered, Install on offer.
        function offered() {
            telemetry.otaCheckState = "ok"; telemetry.updateKind = "none"; telemetry.installs = 0
            var s = createTemporaryObject(screenC, root)
            telemetry.otaCheckTs += 1; telemetry.dataChanged()
            verify(installButton(s).visible)
            return s
        }
        function confirmInstall(s) {
            var b = installButton(s)
            mouseClick(b); mouseClick(b)
            compare(telemetry.installs, 1)
            return b
        }

        // The bug: after the confirming tap the button came straight back as
        // "Install 1.2.80" until the agent's snapshot said busy, so a second
        // pair of taps sent a second install.
        function test_confirmHidesInstallUntilAgentAnswers() {
            var s = offered()
            var b = confirmInstall(s)
            verify(!b.visible)
            verify(s.statusText().indexOf("Starting update") === 0)
            mouseClick(b); mouseClick(b)        // impatient taps where it was land nowhere
            compare(telemetry.installs, 1)
        }

        function test_busySnapshotHandsOverToOverlay() {
            var s = offered()
            var b = confirmInstall(s)
            telemetry.updateKind = "busy"; telemetry.dataChanged()
            compare(s.starting, false)
            verify(!b.visible)                  // busy keeps it hidden
        }

        function test_refusalShowsReasonAndOffersInstallAgain() {
            var s = offered()
            var b = confirmInstall(s)
            telemetry.otaCheckState = "failed: busy"; telemetry.dataChanged()
            compare(s.starting, false)
            verify(b.visible)
            compare(s.statusText(), "An update is already in progress")
        }
    }
}
