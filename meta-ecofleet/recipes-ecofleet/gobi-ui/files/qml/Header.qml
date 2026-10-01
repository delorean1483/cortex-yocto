import QtQuick
import "."
import "atoms"
Rectangle {
    id: hdr
    implicitHeight: 40; color: Theme.surface
    signal wifiTapped()
    Rectangle { anchors.bottom: parent.bottom; width: parent.width; height: 1; color: Theme.border }

    // Left: EcoFleet wordmark. Installed one level above qml/ (/usr/share/gobi-ui).
    Image {
        anchors.left: parent.left; anchors.leftMargin: Theme.pad
        anchors.verticalCenter: parent.verticalCenter
        source: Qt.resolvedUrl("../ecofleet_logo_topbar.png")
        height: 24; fillMode: Image.PreserveAspectFit
        mipmap: true; smooth: true
    }

    // Right: APU data link state + live clock (IP lives on Unit Information)
    Row {
        anchors.right: parent.right; anchors.rightMargin: Theme.pad
        anchors.verticalCenter: parent.verticalCenter; spacing: 16
        Item {
            anchors.verticalCenter: parent.verticalCenter
            width: wrow.width + 12; height: 32
            Row { id: wrow; anchors.centerIn: parent; spacing: 5
                readonly property bool on: wifi.state === "connected"
                Icon { name: "wifi"; size: 18; anchors.verticalCenter: parent.verticalCenter
                    color: wrow.on ? Theme.accent : Theme.textMute; opacity: wrow.on ? 1 : 0.6 }
                WifiBars { id: wbar; anchors.verticalCenter: parent.verticalCenter; unit: 3.5
                    bars: wifi.signalBars; active: wrow.on } }
            MouseArea { anchors.fill: parent; anchors.margins: -6; onClicked: hdr.wifiTapped() }
        }
        Row {
            anchors.verticalCenter: parent.verticalCenter; spacing: 6
            Rectangle { width: 8; height: 8; radius: 4; anchors.verticalCenter: parent.verticalCenter
                color: telemetry.stale ? Theme.fault : Theme.ok }
            Text { anchors.verticalCenter: parent.verticalCenter
                text: telemetry.stale ? "No APU data" : "APU live"
                color: telemetry.stale ? Theme.fault : Theme.textMute; font.pixelSize: Theme.fsCaption }
        }
        Text {
            id: clock
            anchors.verticalCenter: parent.verticalCenter
            property var now: new Date()
            text: Qt.formatDateTime(now, "ddd MMM d  h:mm AP"); color: Theme.textDim
            font.pixelSize: Theme.fsLabel; font.weight: Font.Medium
            Timer { interval: 1000; running: true; repeat: true; onTriggered: clock.now = new Date() }
        }
    }
}
