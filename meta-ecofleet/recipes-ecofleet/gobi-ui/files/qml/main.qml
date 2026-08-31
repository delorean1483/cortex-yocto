import QtQuick
import QtQuick.Controls
import "screens"

ApplicationWindow {
    id: root
    visible: true
    visibility: Window.FullScreen
    width: 1280
    height: 800
    title: "EcoFleet"

    background: Rectangle { color: "#0D1117" }

    // ── Rail IA on a fixed 800x480 canvas that letterbox-scales to the panel ──
    ScaleRoot {
        anchors.fill: parent
        AppShell {
            id: shell
            anchors.centerIn: parent   // AppShell is fixed 800x480; ScaleRoot scales it
            railModel: [ {key:"home",label:"Home"}, {key:"mode",label:"Mode"},
                         {key:"batt",label:"Battery"}, {key:"menu",label:"Menu"} ]
            railScreens: [ homeC, modeC, battC, menuC ]
        }
    }
    Component { id: homeC; HomeScreen {} }
    Component { id: modeC; ModeScreen {} }
    Component { id: battC; BatteryScreen {} }
    Component { id: menuC; MenuScreen { shell: shell } }

    // ── Splash overlay ────────────────────────────────────────────────────────
    Rectangle {
        id: splash
        anchors.fill: parent
        color: "#0D1117"
        z: 10

        Column {
            anchors.centerIn: parent
            spacing: 16

            Image {
                anchors.horizontalCenter: parent.horizontalCenter
                source: "/usr/share/gobi-ui/ecofleet_logo.png"
                height: 72
                fillMode: Image.PreserveAspectFit
            }

            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                text: "FLEET APU MONITOR"
                color: "#6E7681"
                font.pixelSize: 12
                font.letterSpacing: 3
            }

            Rectangle {
                anchors.horizontalCenter: parent.horizontalCenter
                width: 120; height: 3; radius: 2; color: "#21262D"
                Rectangle {
                    width: parent.width * 0.7; height: parent.height; radius: parent.radius
                    color: "#00C49A"
                }
            }
        }

        SequentialAnimation on opacity {
            running: true
            PauseAnimation   { duration: 2500 }
            NumberAnimation  { to: 0; duration: 300; easing.type: Easing.InQuad }
            ScriptAction     { script: splash.visible = false }
        }
    }
}
