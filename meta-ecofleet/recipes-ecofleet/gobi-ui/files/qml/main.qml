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

    SwipeView {
        id: view
        anchors.top: parent.top
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
}
