import QtQuick
import QtQuick.Controls
import QtTest
import "../../qml"

Item {
    id: root
    width: 800; height: 480

    // Stand-ins for the context properties AppShell's header, rail and the
    // Alerts screen read.
    QtObject {
        id: telemetry
        signal dataChanged()
        property bool hasError: true
        property bool stale: false
        property string error: "low_oil"
    }
    QtObject { id: eventlog; property var events: []; property int activeCount: 0 }
    QtObject {
        id: wifi
        property string state: "connected"; property int signalBars: 3; property int signalDbm: -58
        property string ssid: "Yard"; property string ip: "192.168.0.211"; property string internet: "online"
        property string lastError: ""; property string pendingSsid: ""; property bool scanning: false
        property var networks: []; property var saved: []
        function scan() {} function clearError() {} function join(s, p) {} function joinSaved(id) {}
        function forget(id) {}
    }

    Component { id: homeC; Item { readonly property string tag: "home" } }
    Component { id: battC; Item { readonly property string tag: "batt" } }
    Component { id: menuC; Item { readonly property string tag: "menu" } }
    Component {
        id: shellC
        AppShell {
            railModel: [ {key:"home",label:"Home",icon:"home"}, {key:"batt",label:"Battery",icon:"battery"},
                         {key:"menu",label:"Menu",icon:"menu"} ]
            railScreens: [ homeC, battC, menuC ]
        }
    }

    TestCase {
        name: "AppShell"
        when: windowShown

        function stackOf(shell) {
            for (var i = 0; i < shell.children.length; i++)
                if (shell.children[i] instanceof StackView) return shell.children[i]
            return null
        }

        // Home fault strip / header pill: Alerts opens over the screen you were
        // on, and Back returns there instead of to Menu.
        function test_alertsBackReturnsToOrigin_data() {
            return [ { tag: "from Home", rail: 0, origin: "home" },
                     { tag: "from Battery", rail: 1, origin: "batt" } ]
        }
        function test_alertsBackReturnsToOrigin(data) {
            var shell = createTemporaryObject(shellC, root)
            var stack = stackOf(shell)
            shell.selectRail(data.rail)
            tryCompare(stack, "busy", false)

            shell.openAlerts()
            tryCompare(stack, "busy", false)
            compare(stack.currentItem.isAlertsScreen, true)
            compare(shell.railIndex, data.rail)

            shell.openAlerts()   // already there: no second copy
            compare(stack.depth, 2)

            stack.pop()
            tryCompare(stack, "busy", false)
            compare(stack.currentItem.tag, data.origin)
        }

        // Header WiFi icon: same rule, WiFi opens over the screen you were on.
        function test_wifiBackReturnsToOrigin_data() {
            return [ { tag: "from Home", rail: 0, origin: "home" },
                     { tag: "from Battery", rail: 1, origin: "batt" } ]
        }
        function test_wifiBackReturnsToOrigin(data) {
            var shell = createTemporaryObject(shellC, root)
            var stack = stackOf(shell)
            shell.selectRail(data.rail)
            tryCompare(stack, "busy", false)

            shell.openWifi()
            tryCompare(stack, "busy", false)
            compare(stack.currentItem.isWifiScreen, true)
            compare(shell.railIndex, data.rail)

            shell.openWifi()     // already there: no second copy
            compare(stack.depth, 2)

            stack.pop()
            tryCompare(stack, "busy", false)
            compare(stack.currentItem.tag, data.origin)
        }
    }
}
