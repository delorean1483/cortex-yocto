import QtQuick
import "."
import "atoms"
Rectangle {
    id: hdr
    implicitHeight: 40; color: Theme.surface
    signal wifiTapped()
    signal faultTapped()
    Rectangle { anchors.bottom: parent.bottom; width: parent.width; height: 1; color: Theme.border }

    // Left: EcoFleet wordmark. Installed one level above qml/ (/usr/share/gobi-ui).
    Image {
        anchors.left: parent.left; anchors.leftMargin: 20
        anchors.verticalCenter: parent.verticalCenter
        source: Qt.resolvedUrl("../ecofleet_logo_topbar.png")
        height: 22; fillMode: Image.PreserveAspectFit
        mipmap: true; smooth: true
    }

    // Right: fault pill, APU data link state, Wi-Fi bars, live clock (IP lives on Unit Information)
    Row {
        anchors.right: parent.right; anchors.rightMargin: 16
        anchors.verticalCenter: parent.verticalCenter; spacing: 18
        Rectangle {
            visible: telemetry.hasError
            anchors.verticalCenter: parent.verticalCenter
            width: prow.width + 24; height: 28; radius: 14; color: Theme.fault
            Row { id: prow; anchors.centerIn: parent; spacing: 6
                Icon { name: "alert"; size: 15; stroke: 2.6; color: "#2A0705"; anchors.verticalCenter: parent.verticalCenter }
                Text { anchors.verticalCenter: parent.verticalCenter; color: "#2A0705"
                    text: StatusLabels.faultCountLabel(StatusLabels.faultCount(telemetry.hasError, eventlog.activeCount))
                    font.pixelSize: Theme.fsCaption; font.weight: Font.Bold } }
            MouseArea { anchors.fill: parent; anchors.margins: -10; onClicked: hdr.faultTapped() }
        }
        Row {
            anchors.verticalCenter: parent.verticalCenter; spacing: 6
            Rectangle { width: 9; height: 9; radius: 4.5; anchors.verticalCenter: parent.verticalCenter
                color: telemetry.stale ? Theme.fault : Theme.ok }
            Text { anchors.verticalCenter: parent.verticalCenter
                text: telemetry.stale ? "No APU data" : "APU live"
                color: telemetry.stale ? Theme.fault : Theme.textDim; font.pixelSize: 14 }
        }
        Item {
            anchors.verticalCenter: parent.verticalCenter
            width: wbar.width + 12; height: 32
            WifiBars { id: wbar; anchors.centerIn: parent; unit: 4
                bars: wifi.signalBars; active: wifi.state === "connected" }
            MouseArea { anchors.fill: parent; anchors.margins: -6; onClicked: hdr.wifiTapped() }
        }
        Text {
            id: clock
            anchors.verticalCenter: parent.verticalCenter
            property var now: new Date()
            text: Qt.formatDateTime(now, "h:mm AP"); color: Theme.text
            font.pixelSize: 16; font.weight: Font.DemiBold; font.features: {"tnum": 1}
            Timer { interval: 1000; running: true; repeat: true; onTriggered: clock.now = new Date() }
        }
    }
}
