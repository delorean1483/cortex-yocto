import QtQuick
import QtQuick.Controls

ApplicationWindow {
    id: root
    visible: true
    visibility: Window.FullScreen
    width: 1280
    height: 800
    title: "EcoFleet"

    background: Rectangle { color: "#0D1117" }

    // ── Top bar ───────────────────────────────────────────────────────────────
    Rectangle {
        id: topBar
        anchors.top: parent.top
        anchors.left: parent.left
        anchors.right: parent.right
        height: 40
        color: "#161B22"

        Rectangle {
            anchors.bottom: parent.bottom
            width: parent.width; height: 1
            color: "#21262D"
        }

        Image {
            anchors.left: parent.left
            anchors.leftMargin: 14
            anchors.verticalCenter: parent.verticalCenter
            source: "/usr/share/gobi-ui/ecofleet_logo_topbar.png"
            height: 28
            fillMode: Image.PreserveAspectFit
        }

        Row {
            anchors.right: parent.right
            anchors.rightMargin: 14
            anchors.verticalCenter: parent.verticalCenter
            spacing: 8

            // No-data badge
            Rectangle {
                visible: telemetry.stale
                width: noDataRow.width + 20; height: 24; radius: 12
                color: "#2D1B1B"; border.color: "#F85149"; border.width: 1
                Row {
                    id: noDataRow
                    anchors.centerIn: parent
                    spacing: 6
                    Rectangle { width: 6; height: 6; radius: 3; color: "#F85149"; anchors.verticalCenter: parent.verticalCenter }
                    Text { text: "NO DATA"; color: "#F85149"; font.pixelSize: 11; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                }
            }

            // Fault badge
            Rectangle {
                visible: telemetry.hasFault
                width: faultTxt.width + 20; height: 24; radius: 12
                color: "#2D1014"; border.color: "#F85149"; border.width: 1
                Text {
                    id: faultTxt
                    anchors.centerIn: parent
                    text: "FAULT " + telemetry.fault
                    color: "#F85149"; font.pixelSize: 11; font.weight: Font.Bold
                }
            }
        }
    }

    SwipeView {
        id: view
        anchors.top: topBar.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: tabBar.top
        clip: true

        DashboardPage  {}
        DiagnosticsPage {}
        DevicePage {}
    }

    // ── Tab bar ───────────────────────────────────────────────────────────────
    Rectangle {
        id: tabBar
        height: 52
        anchors.bottom: parent.bottom
        width: parent.width
        color: "#161B22"

        Row {
            anchors.fill: parent

            Repeater {
                model: ["Dashboard", "Diagnostics", "Device"]

                Item {
                    width: root.width / 3
                    height: tabBar.height

                    Rectangle {
                        anchors.top: parent.top
                        width: parent.width; height: 2
                        color: view.currentIndex === index ? "#00C49A" : "transparent"
                        Behavior on color { ColorAnimation { duration: 150 } }
                    }

                    Text {
                        anchors.centerIn: parent
                        text: modelData
                        color: view.currentIndex === index ? "#00C49A" : "#8B949E"
                        font.pixelSize: 16
                        font.weight: Font.Medium
                        Behavior on color { ColorAnimation { duration: 150 } }
                    }

                    MouseArea {
                        anchors.fill: parent
                        onClicked: view.currentIndex = index
                    }
                }
            }
        }
    }

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
