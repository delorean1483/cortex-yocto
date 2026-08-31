import QtQuick
import "../templates"
import ".."
Item {
    function statusText(v) {
        if (v < 11.8) return "Low — APU will start to recharge";
        if (v >= 12.4) return "Battery healthy";
        return "Battery OK";
    }
    BigNumberScreen {
        anchors.fill: parent
        value: telemetry.battV.toFixed(1) + " V"
        showSteppers: false
        statusText: parent.statusText(telemetry.battV)
        pillText: telemetry.battV < 11.8 ? "LOW" : "OK"
        pillHue: telemetry.battV < 11.8 ? Theme.warn : Theme.ok
        footerStats: [ { label: "TARGET", value: telemetry.battSetpointV.toFixed(1) + " V" },
                       { label: "IGNITION", value: telemetry.ignition ? "On" : "Off" } ]
    }
}
