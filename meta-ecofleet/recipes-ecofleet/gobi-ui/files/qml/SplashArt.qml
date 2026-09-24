import QtQuick
import "."
// EcoFleet boot splash artwork. One source for all three boot stages so they
// line up pixel for pixel on the 800x480 panel:
//   1. psplash (kernel → userspace)  — images rendered from this file at build
//      time by preview/BootArt.qml (logo frame + progress-bar track)
//   2. Weston desktop-shell background while gobi-ui starts (same frame + track)
//   3. gobi-ui's own splash in main.qml (this component, bar animating to full)
// The bar mirrors psplash's geometry: a 240x12 track at y = height - height/6
// (psplash SPLIT_LINE_POS with the default 5/6 split), fill inset 4px.
Rectangle {
    id: art
    property bool showTrack: true
    property real progress: 0          // 0..1 fill of the bar
    color: Theme.bg

    Column {
        anchors.centerIn: parent
        spacing: 16
        Image {
            anchors.horizontalCenter: parent.horizontalCenter
            source: Qt.resolvedUrl("../ecofleet_logo.png")
            height: 72
            fillMode: Image.PreserveAspectFit
            mipmap: true; smooth: true
        }
        Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: "FLEET APU MONITOR"
            color: Theme.textMute
            font.pixelSize: 12
            font.letterSpacing: 3
            font.weight: Font.DemiBold
        }
    }

    Rectangle {
        id: track
        visible: art.showTrack
        width: 240; height: 12; radius: 6
        x: Math.floor((art.width - width) / 2)
        y: art.height - Math.floor(art.height / 6)
        color: Theme.surface2
        Rectangle {
            x: 4; y: 4; height: parent.height - 8
            width: Math.round((parent.width - 8) * Math.max(0, Math.min(1, art.progress)))
            color: Theme.accent
        }
    }
}
