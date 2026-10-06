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
        property bool   cloudConnected: true
        property real   cloudLastAckMs: Date.now() - 12000
        // heater (VEVOR XMZ-F-D5) read-API mock, mirrors TelemetryModel's heater* Q_PROPERTYs
        property bool   heaterPresent: true;   property string heaterState: "off"
        property int    heaterTargetLevel: 3;  property int    heaterActiveLevel: 0
        property int    heaterError: 0;        property int    heaterFanRpm: 0
        property real   heaterSupplyV: 12.2;   property int    heaterExchanger: 0
        property int    heaterStateSeconds: 0; property int    heaterAgeMs: 0
        property bool   heaterSafeOff: false;  property bool   heaterCommsOk: false
        property int    heaterFlags: 16
        property bool   heaterExt: false;      property string heaterType: "none"
        property string heaterPhase: "off";    property string heaterControl: "level"
        property int    heaterSetpointF: 72;   property string heaterVendorState: ""
        property bool   heaterFault: false;    property int    heaterCmdResult: 0
        // firmware update notice (TelemetryModel.update*: kind none|busy|failed)
        property string updateKind: "none";   property string updateTitle: ""
        property string updateDetail: "";     property string updateKey: ""
        property int    updateProgress: -1
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
        function setHeaterSetpointF(v) {}
        function clearHeaterFault() {}
    }
    // eventlog mock — mirrors EventLogModel (newest first; endMs 0 = active)
    property QtObject eventlog: QtObject {
        property var events: []
        property int activeCount: 0
        function sample() {
            var t = Date.now()
            events = [
                { code: 1, error: "low_oil", startMs: t - 4 * 60000, endMs: 0, mode: "climate", controlStatus: "cooling",
                  engineStatus: "running", rpm: 2440, battV: 13.9, cabinF: 81, coolantF: 188 },
                { code: 2, error: "high_engine_temp", startMs: t - 26 * 3600000, endMs: t - 26 * 3600000 + 7 * 60000,
                  mode: "climate", controlStatus: "cooling", engineStatus: "running", rpm: 2470, battV: 14.1,
                  cabinF: 84, coolantF: 231 },
                { code: 3, error: "low_battery", startMs: t - 3 * 86400000, endMs: t - 3 * 86400000 + 40000,
                  mode: "battery", controlStatus: "charging", engineStatus: "off", rpm: 0, battV: 11.6,
                  cabinF: 70, coolantF: 72 } ]
            activeCount = 1
        }
    }
    // display mock — mirrors DisplayModel (brightness 10-100, sleepMinutes 0 = never)
    property QtObject display: QtObject {
        property int    brightness: 80;   property int  sleepMinutes: 10
        property bool   keepAwake: false; property string state: "on"
    }
    property QtObject devinfo: QtObject {
        property string serial: "TRUCK-001";     property string hostname: "imx8mm-var-dart"
        property string fwVersion: "v1.2.57";    property bool   ethLinked: true
        property string ipAddress: "192.168.0.86"; property string macAddress: "54:0B:B6:05:89:CD"
    }
    // wifi mock — mirrors WifiModel (state unavailable|idle|connecting|connected)
    property QtObject wifi: QtObject {
        signal joined(string ssid)
        signal joinFailed(string ssid, string error)
        property string state: "connected";   property bool scanning: false
        property string ssid: "EcoFleet-Staff"; property int signalDbm: -47; property int signalBars: 4
        property string ip: "192.168.0.206";  property string internet: "online"
        property string lastError: "";        property string pendingSsid: ""
        property var networks: [
            { ssid: "EcoFleet-Staff", bars: 4, secured: true,  supported: true,  saved: true,  savedId: 0, inUse: true },
            { ssid: "Shop-Guest",     bars: 3, secured: true,  supported: true,  saved: true,  savedId: 1, inUse: false },
            { ssid: "Pilot-Travel-Center", bars: 2, secured: true, supported: true, saved: false, savedId: -1, inUse: false },
            { ssid: "FreeTruckStopWiFi",   bars: 1, secured: false, supported: true, saved: false, savedId: -1, inUse: false },
            { ssid: "Corp-Secure",    bars: 2, secured: true,  supported: false, saved: false, savedId: -1, inUse: false } ]
        property var saved: [ { id: 0, ssid: "EcoFleet-Staff", inUse: true }, { id: 1, ssid: "Shop-Guest", inUse: false } ]
        function scan() {}
        function join(s, p) {}
        function joinSaved(id) {}
        function forget(id) {}
        function addHidden(s, sec, p) {}
        function clearError() { lastError = "" }
    }
}
