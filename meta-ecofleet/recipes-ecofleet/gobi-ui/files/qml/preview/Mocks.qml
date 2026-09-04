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
        // heater (VEVOR XMZ-F-D5) read-API mock, mirrors TelemetryModel's heater* Q_PROPERTYs
        property bool   heaterPresent: true;   property string heaterState: "running"
        property int    heaterTargetLevel: 5;  property int    heaterActiveLevel: 5
        property int    heaterError: 0;        property int    heaterFanRpm: 2600
        property real   heaterSupplyV: 12.6;   property int    heaterExchanger: 180
        property int    heaterStateSeconds: 0; property int    heaterAgeMs: 0
        property bool   heaterSafeOff: false;  property bool   heaterCommsOk: true
        property int    heaterFlags: 0
        function setMode(m) { mode = m }
        function setSetpoint(f) { clmtSetpointF = f }
        function setFan(p) { fanSpeed = p }
        function resetOil() { oilHrs = 0 }
        function setHeaterOn(v) {}
        function setHeaterLevel(v) {}
    }
    property QtObject devinfo: QtObject {
        property string serial: "APU-DEMO-0001"; property string hostname: "gobi-apu"
        property string fwVersion: "v1.2.32";    property bool   ethLinked: true
        property string ipAddress: "192.168.0.85"; property string macAddress: "00:11:22:33:44:55"
    }
}
