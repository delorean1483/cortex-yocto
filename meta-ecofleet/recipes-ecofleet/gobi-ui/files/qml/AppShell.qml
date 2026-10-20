import QtQuick
import QtQuick.Controls
import "."
import "screens"
Item {
    id: shell
    width: 800; height: 480
    property var railModel: []
    property var railScreens: []     // Component[] aligned with railModel
    property int railIndex: 0
    function pushScreen(comp) { return stack.push(comp) }
    function popScreen() { if (stack.depth > 1) stack.pop() }
    function selectRail(i) {
        shell.railIndex = i
        stack.clear()
        stack.push(railScreens[i])
    }
    Header { id: hdr; anchors.top: parent.top; anchors.left: parent.left; anchors.right: parent.right
             onWifiTapped: shell.openWifi(); onFaultTapped: shell.openAlerts() }
    Component { id: wifiC; WifiScreen {} }
    function openWifi() {
        if (stack.currentItem && stack.currentItem.isWifiScreen === true) return   // already there
        selectRail(2); stack.push(wifiC)
    }
    Component { id: alertsC; AlertsScreen {} }
    Component { id: modeC; ModeScreen {} }
    function openAlerts() {
        if (stack.currentItem && stack.currentItem.isAlertsScreen === true) return
        selectRail(2); stack.push(alertsC)
    }
    function openMode() {
        if (stack.currentItem && stack.currentItem.isModeScreen === true) return
        stack.push(modeC)
    }
    Rail {
        id: rail
        anchors.top: hdr.bottom; anchors.bottom: parent.bottom; anchors.left: parent.left
        model: shell.railModel; currentIndex: shell.railIndex
        badgeCount: StatusLabels.faultCount(telemetry.hasError, eventlog.activeCount)
        onPicked: shell.selectRail(index)
    }
    StackView {
        id: stack
        anchors.top: hdr.bottom; anchors.bottom: parent.bottom
        anchors.left: rail.right; anchors.right: parent.right
        clip: true
        Component.onCompleted: if (shell.railScreens.length) push(shell.railScreens[0])
    }
}
