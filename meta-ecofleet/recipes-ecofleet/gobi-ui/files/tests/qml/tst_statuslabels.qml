import QtQuick
import QtTest
import "../../qml"

TestCase {
    name: "StatusLabels"

    // fixture mirrors preview/Mocks.qml eventlog.sample() with t = 1e12
    function ev() {
        var t = 1e12
        return [
            { code: 1, error: "low_oil", startMs: t - 4 * 60000, endMs: 0, mode: "climate", controlStatus: "cooling",
              engineStatus: "running", rpm: 2440, battV: 13.9, cabinF: 81, coolantF: 188 },
            { code: 2, error: "high_engine_temp", startMs: t - 26 * 3600000, endMs: t - 26 * 3600000 + 7 * 60000,
              mode: "climate", controlStatus: "cooling", engineStatus: "running", rpm: 2470, battV: 14.1,
              cabinF: 84, coolantF: 231 },
            { code: 3, error: "low_battery", startMs: t - 3 * 86400000, endMs: t - 3 * 86400000 + 40000,
              mode: "battery", controlStatus: "charging", engineStatus: "off", rpm: 0, battV: 11.6,
              cabinF: 70, coolantF: 72 } ]
    }

    function test_thousands() { compare(StatusLabels.thousands(0), "0"); compare(StatusLabels.thousands(1284), "1,284")
                                compare(StatusLabels.thousands(12345), "12,345"); compare(StatusLabels.thousands(1234567), "1,234,567") }
    function test_faultCount() { compare(StatusLabels.faultCount(false, 3), 0); compare(StatusLabels.faultCount(true, 0), 1)
                                 compare(StatusLabels.faultCount(true, 2), 2) }
    function test_faultCountLabel() { compare(StatusLabels.faultCountLabel(1), "1 fault"); compare(StatusLabels.faultCountLabel(2), "2 faults") }
    function test_activeEvent() { compare(StatusLabels.activeEvent(ev()).error, "low_oil"); compare(StatusLabels.activeEvent([]), null)
                                  compare(StatusLabels.activeEvent(ev().slice(1)), null) }
    function test_recentCleared() { var r = StatusLabels.recentCleared(ev(), 2); compare(r.length, 2)
                                    compare(r[0].error, "high_engine_temp"); compare(r[1].error, "low_battery") }
    function test_activeFor() { compare(StatusLabels.activeFor(0, 1e12), ""); compare(StatusLabels.activeFor(1e12 - 4*60000, 1e12), "Active for 4 min")
                                compare(StatusLabels.activeFor(1e12 - 20000, 1e12), "Active for under a minute") }
    function test_faultSnapshot() { compare(StatusLabels.faultSnapshot(ev()[0]), "At fault: Climate · Cooling · 2,440 rpm · 13.9 V · coolant 188°F")
                                    compare(StatusLabels.faultSnapshot(null), "") }
    function test_battHealth() { compare(StatusLabels.battHealth(12.4).key, "healthy"); compare(StatusLabels.battHealth(12.39).key, "ok")
                                 compare(StatusLabels.battHealth(11.8).key, "ok"); compare(StatusLabels.battHealth(11.79).key, "low")
                                 compare(StatusLabels.battHealth(13.9).label, "Healthy") }
    function test_battModeHelp() { compare(StatusLabels.battModeHelp("off"), "APU stays off. On starts it in Battery mode.")
                                   compare(StatusLabels.battModeHelp("battery"), "Runs the APU only to keep the truck battery charged.")
                                   compare(StatusLabels.battModeHelp(""), "") }
    function test_climateLine() { compare(StatusLabels.climateLine(true, "cooling", 70), "cooling to 70°")
                                  compare(StatusLabels.climateLine(true, "chillin", 70), "at target 70°")
                                  compare(StatusLabels.climateLine(true, "warming_up", 70), "warming up")
                                  compare(StatusLabels.climateLine(false, "cooling", 70), "climate off")
                                  compare(StatusLabels.climateLine(true, "cooling", 0), "cooling") }
    function test_unknownErrorRoundTrips() { compare(StatusLabels.error("compressor_overcurrent_lockout"), "compressor_overcurrent_lockout") }
}
