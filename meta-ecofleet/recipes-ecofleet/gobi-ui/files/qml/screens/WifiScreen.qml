import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
// WiFi: status card (network in use, signal, IP, internet) + nearby networks.
// Open to anyone. Tap: saved/open → join now; secured → password screen.
Item {
    id: page
    Component { id: joinC;  WifiJoinScreen {} }
    Component { id: savedC; WifiSavedScreen {} }
    function push(c, props) { if (page.StackView.view) page.StackView.view.push(c, props || {}) }
    Component.onCompleted: wifi.scan()

    readonly property string netText: wifi.internet === "online" ? "Online"
        : wifi.internet === "portal" ? "Sign-in required"
        : wifi.internet === "no_internet" ? "No internet" : "Checking…"
    readonly property color netHue: wifi.internet === "online" ? Theme.ok
        : wifi.internet === "unknown" ? Theme.textMute : Theme.warn

    function tap(n) {
        if (n.inUse || !n.supported || wifi.state === "connecting") return
        wifi.clearError()
        if (n.saved) wifi.joinSaved(n.savedId)
        else if (!n.secured) wifi.join(n.ssid, "")
        else page.push(joinC, { ssid: n.ssid })
    }

    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: 10
        RowLayout { Layout.fillWidth: true
            ScreenHeader { title: "WiFi"; onBack: if (page.StackView.view) page.StackView.view.pop() }
            Rectangle { Layout.preferredWidth: 104; Layout.preferredHeight: 40; radius: Theme.radiusSm
                visible: wifi.state !== "unavailable"
                color: rsa.pressed ? Theme.surface2 : Theme.surface; border.color: Theme.border
                Text { anchors.centerIn: parent; text: wifi.scanning ? "Scanning…" : "Rescan"
                    color: Theme.accent; font.pixelSize: Theme.fsLabel + 1; font.weight: Font.DemiBold }
                MouseArea { id: rsa; anchors.fill: parent; onClicked: wifi.scan() } } }

        // ── status card ──
        Rectangle {
            id: card; Layout.fillWidth: true; Layout.preferredHeight: Math.max(84, cardRow.implicitHeight + 24); radius: Theme.radius
            readonly property bool on: wifi.state === "connected"
            color: on ? Theme.tint(Theme.accent, 0.10) : Theme.surface
            border.color: on ? Theme.accent : "transparent"; border.width: 1
            RowLayout {
                id: cardRow
                anchors.fill: parent; anchors.leftMargin: Theme.pad; anchors.rightMargin: Theme.pad; spacing: 14
                Icon { name: wifi.state === "connected" ? "check-circle" : "wifi"; size: 30
                    color: wifi.state === "connected" ? Theme.accent : Theme.textMute }
                ColumnLayout { Layout.fillWidth: true; spacing: 2
                    Text { Layout.fillWidth: true; elide: Text.ElideRight
                        text: wifi.state === "connected" ? wifi.ssid
                            : wifi.state === "connecting" ? "Connecting to " + wifi.pendingSsid + "…"
                            : wifi.state === "unavailable" ? "WiFi unavailable" : "Not connected"
                        color: Theme.text; font.pixelSize: Theme.fsTitle; font.weight: Font.DemiBold }
                    Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; maximumLineCount: 2
                        visible: wifi.lastError !== "" || wifi.state === "connected"
                        text: wifi.lastError !== "" ? wifi.lastError
                            : (wifi.internet === "portal" ? "This network needs a web sign-in, which isn't supported. Try another network or a phone hotspot."
                            : wifi.internet === "no_internet" ? "Connected, but this network isn't reaching the internet."
                            : "In use · " + wifi.ip)
                        color: wifi.lastError !== "" ? Theme.fault : Theme.textMute; font.pixelSize: Theme.fsLabel }
                }
                ColumnLayout { visible: wifi.state === "connected"; spacing: 4
                    RowLayout { Layout.alignment: Qt.AlignRight; spacing: 8
                        WifiBars { bars: wifi.signalBars; unit: 5 }
                        Text { text: wifi.signalDbm + " dBm"; color: Theme.textMute; font.pixelSize: Theme.fsLabel } }
                    Text { Layout.alignment: Qt.AlignRight; text: page.netText; color: page.netHue
                        font.pixelSize: Theme.fsLabel + 1; font.weight: Font.DemiBold } }
            }
        }

        Text { text: "NETWORKS"; color: Theme.textMute; font.pixelSize: Theme.fsCaption
            font.letterSpacing: Theme.lsCaps; font.weight: Font.DemiBold }

        Item {
            Layout.fillWidth: true; Layout.fillHeight: true
            ListView { id: netList; anchors.fill: parent; clip: true; spacing: 6
            model: wifi.networks
            boundsBehavior: Flickable.StopAtBounds
            delegate: Rectangle {
                width: ListView.view.width; height: 48; radius: Theme.radiusSm
                color: modelData.inUse ? Theme.tint(Theme.accent, 0.12) : (nma.pressed ? Theme.surface2 : Theme.surface)
                border.color: modelData.inUse ? Theme.accent : "transparent"; border.width: 1
                opacity: modelData.supported ? 1 : 0.55
                RowLayout {
                    anchors.fill: parent; anchors.leftMargin: 14; anchors.rightMargin: 14; spacing: 12
                    WifiBars { bars: modelData.bars; unit: 4 }
                    Icon { name: "lock"; size: 16; color: Theme.textMute; opacity: modelData.secured ? 1 : 0 }
                    Text { Layout.fillWidth: true; elide: Text.ElideRight; text: modelData.ssid
                        color: Theme.text; font.pixelSize: Theme.fsBody; font.weight: modelData.inUse ? Font.DemiBold : Font.Normal }
                    Text { text: !modelData.supported ? "Not supported"
                               : wifi.pendingSsid === modelData.ssid ? "Connecting…"
                               : modelData.inUse ? "✓ In use" : modelData.saved ? "Saved" : ""
                        color: modelData.inUse ? Theme.accent : Theme.textMute
                        font.pixelSize: Theme.fsLabel; font.weight: modelData.inUse ? Font.DemiBold : Font.Normal }
                }
                MouseArea { id: nma; anchors.fill: parent; onClicked: page.tap(modelData) }
            }
            }
            Text { anchors.centerIn: parent; visible: netList.count === 0
                text: wifi.state === "unavailable" ? "WiFi unavailable" : wifi.scanning ? "Scanning…" : "No networks found"
                color: Theme.textMute; font.pixelSize: Theme.fsBody }
        }

        RowLayout { Layout.fillWidth: true; spacing: 10; visible: wifi.state !== "unavailable"
            Repeater {
                model: [ { t: "Saved networks", c: savedC }, { t: "Add hidden network", c: joinC, hidden: true } ]
                Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 44; radius: Theme.radiusSm
                    color: bma.pressed ? Theme.surface2 : Theme.surface; border.color: Theme.border
                    Text { anchors.centerIn: parent; text: modelData.t; color: Theme.accent
                        font.pixelSize: Theme.fsLabel + 1; font.weight: Font.DemiBold }
                    MouseArea { id: bma; anchors.fill: parent
                        onClicked: page.push(modelData.c, modelData.hidden ? { hidden: true } : {}) } } } }
    }
}
