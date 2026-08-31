pragma Singleton
import QtQuick
// Client-side screen lock (spec §8: a light PIN to stop accidental driver input).
// In-memory only — a reboot / service restart clears it, which is also the escape
// hatch if a PIN is forgotten.
QtObject {
    property string pin: ""      // empty ⇒ no PIN set
    property bool   locked: false
    readonly property bool hasPin: pin.length > 0
    function setPin(p) { pin = p }
    function removePin() { pin = ""; locked = false }
    function lock() { if (pin.length > 0) locked = true }
    function tryUnlock(code) { if (code === pin) { locked = false; return true } return false }
}
