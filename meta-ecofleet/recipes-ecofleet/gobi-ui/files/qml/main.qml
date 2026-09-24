import QtQuick
import QtQuick.Controls
import "."
import "screens"

ApplicationWindow {
    id: root
    visible: true
    visibility: Window.FullScreen
    width: 1280
    height: 800
    title: "EcoFleet"

    background: Rectangle { color: Theme.bg }

    // ── Rail IA on a fixed 800x480 canvas that letterbox-scales to the panel ──
    ScaleRoot {
        anchors.fill: parent
        AppShell {
            id: shell
            anchors.centerIn: parent   // AppShell is fixed 800x480; ScaleRoot scales it
            railModel: [ {key:"home",label:"Home",icon:"home"}, {key:"batt",label:"Battery",icon:"battery"},
                         {key:"menu",label:"Menu",icon:"menu"} ]
            railScreens: [ homeC, battC, menuC ]
        }
        LockOverlay { anchors.fill: parent }   // covers the rail too when locked
    }
    Component { id: homeC; HomeScreen {} }
    Component { id: modeC; ModeScreen {} }
    Component { id: battC; BatteryScreen {} }
    Component { id: menuC; MenuScreen { appShell: shell } }

    // ── Splash overlay ────────────────────────────────────────────────────────
    // Same artwork psplash and the Weston background show during boot
    // (SplashArt.qml), so boot reads as one EcoFleet loading screen. The bar picks
    // up where the boot splash left off and fills; the splash then fades to Home
    // once the first telemetry snapshot has been read (so Home never flashes
    // empty readings) — at least minMs on screen, never longer than maxMs.
    SplashArt {
        id: splash
        anchors.fill: parent
        z: 10
        property int minMs: 1000
        property int maxMs: 5000
        property bool minElapsed: false
        readonly property bool haveData: telemetry.tsMs > 0
        progress: 0.6
        NumberAnimation on progress { id: fillAnim; to: 0.95; duration: splash.maxMs; easing.type: Easing.OutCubic }
        Timer { interval: splash.minMs; running: true; onTriggered: splash.minElapsed = true }
        Timer { interval: splash.maxMs; running: true; onTriggered: splash.finish() }
        onMinElapsedChanged: if (minElapsed && haveData) finish()
        onHaveDataChanged: if (minElapsed && haveData) finish()
        function finish() { if (!done.running && splash.visible) { fillAnim.stop(); done.start() } }
        SequentialAnimation {
            id: done
            NumberAnimation { target: splash; property: "progress"; to: 1; duration: 200 }
            NumberAnimation { target: splash; property: "opacity"; to: 0; duration: 250; easing.type: Easing.InQuad }
            ScriptAction { script: splash.visible = false }
        }
    }
}
