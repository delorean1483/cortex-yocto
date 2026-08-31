import QtQuick
import "../templates"
import ".."
Item {
    id: home
    property int target: Math.round(telemetry.clmtSetpointF)
    Component.onCompleted: target = Math.round(telemetry.clmtSetpointF)
    Timer { id: send; interval: 350; onTriggered: telemetry.setSetpoint(home.target) }
    function bump(d) { target = Math.max(55, Math.min(85, target + d)); send.restart() }
    function tempColor(f) {
        if (f <= 64) return "#2F81F7";
        if (f <= 68) return "#39B0C4";
        if (f <= 74) return Theme.accent;
        if (f <= 78) return Theme.warn;
        return "#F0883E";
    }
    BigNumberScreen {
        anchors.fill: parent
        value: home.target + "°"
        valueColor: home.tempColor(home.target)
        showSteppers: true
        statusText: telemetry.controlStatus
        pillText: telemetry.mode === "off" ? "OFF"
                  : (telemetry.engineStatus.length ? telemetry.engineStatus.toUpperCase() : "STANDBY")
        pillHue: telemetry.mode === "off" ? Theme.textMute : Theme.accent
        faultText: telemetry.hasError ? "Fault: " + telemetry.error : ""
        footerStats: [ { label: "CABIN", value: telemetry.cabinTempF.toFixed(0) + "°F" },
                       { label: "OUTSIDE", value: telemetry.extTempF.toFixed(0) + "°F" },
                       { label: "BATTERY", value: telemetry.battV.toFixed(1) + " V" },
                       { label: "ENGINE HRS", value: telemetry.engineHrs + "" } ]
        onIncremented: home.bump(1)
        onDecremented: home.bump(-1)
    }
}
