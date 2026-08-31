import QtQuick
QtObject {
    // telemetry mock — mirrors TelemetryModel's read API + no-op writes
    property QtObject telemetry: QtObject {
        signal dataChanged()   // real TelemetryModel emits this; here so Connections resolve
        property real   cabinTempF: 74;   property real extTempF: 88
        property real   battV: 12.9;      property real clmtSetpointF: 70
        property real   battSetpointV: 12.0
        property int    rpm: 2200;        property int  fanSpeed: 55
        property int    engineHrs: 1342;  property int  machineHrs: 5210
        property int    oilHrs: 96
        property bool   oilOk: true;      property bool ignition: true
        property string mode: "climate";  property string engineStatus: "Running"
        property string controlStatus: "Cooling"
        property string error: "";        property bool   hasError: false
        property string oilChange: "good"; property bool  stale: false
        function setMode(m) { mode = m }
        function setSetpoint(f) { clmtSetpointF = f }
        function setFan(p) { fanSpeed = p }
        function resetOil() { oilHrs = 0 }
    }
    property QtObject devinfo: QtObject {
        property string serial: "APU-DEMO-0001"; property string hostname: "gobi-apu"
        property string fwVersion: "v1.2.32";    property bool   ethLinked: true
        property string ipAddress: "192.168.0.85"; property string macAddress: "00:11:22:33:44:55"
    }
}
