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
    readonly property var _mode: ({ "off":"Off", "climate":"Climate", "battery":"Battery" })
    function mode(s)           { return _mode[s] !== undefined ? _mode[s] : title(s) }
    // "good" -> "Good", "needs_change" -> "Needs change"; "—" for empty
    // "12 s ago" / "5 min ago" / "3 h ago" / "2 days ago" for an epoch-ms time.
    function ago(ms, nowMs) {
        if (!ms || ms <= 0) return ""
        var s = Math.max(0, Math.floor((nowMs - ms) / 1000))
        if (s < 60)    return s + " s ago"
        if (s < 3600)  return Math.floor(s / 60) + " min ago"
        if (s < 86400) return Math.floor(s / 3600) + " h ago"
        var d = Math.floor(s / 86400); return d + (d === 1 ? " day ago" : " days ago")
    }
    // Cloud link state for the Cloud screen. `stale` = the agent itself isn't
    // updating latest.json, so its cloud fields can't be trusted. An ack is
    // "fresh" within 2 minutes (the default telemetry cadence is 20 s).
    function cloud(stale, connected, lastAckMs, nowMs) {
        var fresh = lastAckMs > 0 && (nowMs - lastAckMs) <= 120000
        if (stale)               return { state: "unknown",    title: "Status unknown" }
        if (connected && fresh)  return { state: "connected",  title: "Connected to EcoFleet" }
        if (connected)           return { state: "connecting", title: "Connecting…" }
        return                          { state: "offline",    title: "Not connected" }
    }
    function title(s)          { if (!s) return "—"; var t = String(s).replace(/_/g, " "); return t.charAt(0).toUpperCase() + t.slice(1) }
}
