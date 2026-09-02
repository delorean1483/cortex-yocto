pragma Singleton
import QtQuick
// Maintenance passcode gate for Component Test — SEPARATE from the user Screen
// Lock (LockController). In-memory with a build-time default; a changed PIN
// clears on restart. verify() is the single check the UI calls.
QtObject {
    readonly property string defaultPin: "7913"   // build-time default; change per deployment
    property string pin: defaultPin
    function verify(code) { return code === pin }
    function setPin(p) { if (p && p.length >= 4) pin = p }
}
