import QtQuick
QtObject {
    // telemetry mock — mirrors TelemetryModel's read API + no-op writes.
    // Values mirror the bench unit (idle APU, heater fitted but no comms). The
    // climate setpoint starts at 0 like the real model does before its first
    // latest.json read; call load() to deliver the "first snapshot".
    property QtObject telemetry: QtObject {
        signal dataChanged()   // real TelemetryModel emits this; here so Connections resolve
        property real   cabinTempF: 76;   property real extTempF: 76
        property real   battV: 12.2;      property real clmtSetpointF: 0
        property real   battSetpointV: 12.0
        property int    rpm: 0;           property int  fanSpeed: 70
        property bool   fanAuto: false
        property int    engineHrs: 4;     property int  machineHrs: 120
        property int    oilHrs: 0
        property bool   oilOk: true;      property bool ignition: false
        property string mode: "off";      property string engineStatus: "off"
        property string controlStatus: "off"
        property string error: "none";    property bool   hasError: false
        property string oilChange: "good"; property bool  stale: false
        property real   tsMs: 1
        property bool   diagActive: false; property int   diagOutputs: 0
        property int    apuFwVersion: 10104
        // heater (VEVOR XMZ-F-D5) read-API mock, mirrors TelemetryModel's heater* Q_PROPERTYs
        property bool   heaterPresent: true;   property string heaterState: "off"
        property int    heaterTargetLevel: 3;  property int    heaterActiveLevel: 0
        property int    heaterError: 0;        property int    heaterFanRpm: 0
        property real   heaterSupplyV: 12.2;   property int    heaterExchanger: 0
        property int    heaterStateSeconds: 0; property int    heaterAgeMs: 0
        property bool   heaterSafeOff: false;  property bool   heaterCommsOk: false
        property int    heaterFlags: 16
        function load() { clmtSetpointF = 67; tsMs += 1; dataChanged() }
        function setMode(m) { mode = m; dataChanged() }
        function setSetpoint(f) { clmtSetpointF = f; dataChanged() }
        function setFan(p) { fanSpeed = p; dataChanged() }
        function setFanAuto(on) { fanAuto = on; dataChanged() }
        function setBattSetpoint(v) { battSetpointV = v; dataChanged() }
        function resetOil() { oilHrs = 0 }
        function enterComponentTest() {}
        function exitComponentTest() {}
        function setTestRelay(i, on) {}
        function setHeaterOn(v) {}
        function setHeaterLevel(v) {}
    }
    property QtObject devinfo: QtObject {
        property string serial: "TRUCK-001";     property string hostname: "imx8mm-var-dart"
        property string fwVersion: "v1.2.57";    property bool   ethLinked: true
        property string ipAddress: "192.168.0.86"; property string macAddress: "54:0B:B6:05:89:CD"
    }
}
