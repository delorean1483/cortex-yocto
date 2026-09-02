pragma Singleton
import QtQuick
// Maps raw firmware enum strings (control_status_t / engine_status_t / error)
// to friendly display labels, so the UI never shows raw snake_case strings.
QtObject {
    readonly property var _control: ({
        "off":"Off","warming_up":"Warming Up","starting":"Starting","running":"Running",
        "defrost":"Defrost","charging":"Charging","cooling":"Cooling","chillin":"At Target","unknown":"—" })
    readonly property var _error: ({
        "none":"None","low_oil":"Low Oil","high_engine_temp":"High Engine Temp","low_battery":"Low Battery",
        "ac_low_pressure":"AC Low Pressure","ac_high_pressure":"AC High Pressure","starting_failure":"Starting Failure",
        "standby":"Standby","engine_stalled":"Engine Stalled","no_rpm":"No RPM","high_ac_pressure":"High AC Pressure","unknown":"—" })
    function control(s, upper) { var v = _control[s] !== undefined ? _control[s] : (s || "—"); return upper ? v.toUpperCase() : v }
    function engine(s, upper)  { return control(s, upper) }   // same enum family (control_status_t)
    function error(s)          { return _error[s] !== undefined ? _error[s] : (s || "—") }
}
