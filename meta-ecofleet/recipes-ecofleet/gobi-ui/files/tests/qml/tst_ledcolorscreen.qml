import QtQuick
import QtTest
import "../../qml/screens"

Item {
    id: root
    width: 800; height: 480

    // Stand-ins for the context properties the screens bind.
    QtObject {
        id: telemetry
        signal dataChanged()
        property bool stale: false
        property bool ledPresent: true
        property bool ledOk: true
        property int  ledR: 255
        property int  ledG: 0
        property int  ledB: 0
        property string otaAvailable: ""
    }
    QtObject {
        id: led
        property real hue: 0
        property real saturation: 1
        property real brightness: 1
        property int  r: 255
        property int  g: 0
        property int  b: 0
        property bool hasColor: true
        property int  flushes: 0
        function pickAt(dx, dy, radius) {}
        function release() {}
        function flush() { flushes++ }
    }
    QtObject {
        id: display
        property int brightness: 80
        property int sleepMinutes: 10
    }
    QtObject {
        id: devinfo
        property string fwVersion: "v1.2.90"
        property string serial: "TRUCK-001"
    }

    Component { id: ledC; LedColorScreen { anchors.fill: parent } }
    Component { id: settingsC; SettingsScreen { anchors.fill: parent } }

    TestCase {
        name: "LedColorScreen"
        when: windowShown

        function find(item, pred) {
            if (pred(item)) return item
            for (var i = 0; i < item.children.length; i++) {
                var hit = find(item.children[i], pred)
                if (hit) return hit
            }
            return null
        }
        function reset() {
            telemetry.stale = false; telemetry.ledPresent = true; telemetry.ledOk = true
            telemetry.ledR = 255; telemetry.ledG = 0; telemetry.ledB = 0
            led.r = 255; led.g = 0; led.b = 0; led.hasColor = true
        }

        function test_status_priority() {
            reset()
            var s = createTemporaryObject(ledC, root)
            // stale wins even when the colors match
            telemetry.stale = true
            compare(s.statusText(), "G0B1 offline, will apply when it reconnects")
            // light gone: offline even when applied == requested
            telemetry.stale = false; telemetry.ledPresent = false
            compare(s.statusText(), "Light offline, will apply when it reconnects")
            telemetry.ledPresent = true
            // not stale, nothing chosen yet
            led.hasColor = false
            compare(s.statusText(), "Not set. Tap the wheel to choose a color")
            // light fitted but not answering
            led.hasColor = true; telemetry.ledOk = false
            compare(s.statusText(), "Light not responding")
            // applied == requested
            telemetry.ledOk = true
            compare(s.statusText(), "Applied")
            // applied differs from requested
            led.g = 128
            compare(s.statusText(), "Sending…")
        }

        function test_row_hidden_without_light() {
            reset()
            telemetry.ledPresent = false
            var s = createTemporaryObject(settingsC, root)
            var row = find(s, function(o) { return o.objectName === "ledRow" })
            verify(row !== null)
            compare(row.visible, false)
            telemetry.ledPresent = true
            compare(row.visible, true)
        }
    }
}
