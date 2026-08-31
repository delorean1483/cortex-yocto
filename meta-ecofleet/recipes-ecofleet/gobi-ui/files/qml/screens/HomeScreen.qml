import QtQuick
import "../templates"
import ".."
Item {
    id: home
    property int target: Math.round(telemetry.clmtSetpointF)
    Component.onCompleted: target = Math.round(telemetry.clmtSetpointF)
    Timer { id: send; interval: 350; onTriggered: telemetry.setSetpoint(home.target) }
    function bump(d) { target = Math.max(55, Math.min(85, target + d)); send.restart() }
    BigNumberScreen {
        anchors.fill: parent
        value: home.target + "°"
        showSteppers: true
        statusText: telemetry.controlStatus
        pillText: telemetry.mode === "off" ? "OFF"
                  : (telemetry.engineStatus.length ? telemetry.engineStatus.toUpperCase() : "STANDBY")
        pillHue: telemetry.mode === "off" ? Theme.textMute : Theme.accent
        faultText: telemetry.hasError ? "Fault: " + telemetry.error : ""
        footerStats: [ { label: "BATTERY", value: telemetry.battV.toFixed(1) + " V" },
                       { label: "ENGINE HRS", value: telemetry.engineHrs + "" } ]
        onIncremented: home.bump(1)
        onDecremented: home.bump(-1)
    }
}
