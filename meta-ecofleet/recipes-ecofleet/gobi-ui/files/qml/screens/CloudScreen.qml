import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
Item {
    id: page
    property real now: Date.now()
    Timer { interval: 5000; running: true; repeat: true; onTriggered: page.now = Date.now() }

    // Real link to EcoFleet (AWS IoT): the agent reports whether its MQTT link
    // is up and when AWS last acknowledged a message (cloud_last_ack_ms).
    readonly property var cs: StatusLabels.cloud(telemetry.stale, telemetry.cloudConnected,
                                                 telemetry.cloudLastAckMs, page.now)
    readonly property string lastContact: telemetry.cloudLastAckMs > 0
        ? StatusLabels.ago(telemetry.cloudLastAckMs, page.now) : "not since startup"

    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: Theme.gap
        ScreenHeader { title: "Cloud Connection"; onBack: if (page.StackView.view) page.StackView.view.pop() }

        // nested layouts default to fillHeight — size the row to its cards instead
        RowLayout {
            Layout.fillWidth: true; Layout.fillHeight: false; spacing: Theme.gap
            Rectangle {
                id: status
                Layout.fillWidth: true; Layout.preferredWidth: 1; Layout.fillHeight: true
                property color hue: page.cs.state === "connected" ? Theme.ok
                                  : page.cs.state === "connecting" ? Theme.warn : Theme.fault
                radius: Theme.radius; color: Theme.tint(hue, 0.10); border.color: hue; border.width: 1
                ColumnLayout {
                    anchors.fill: parent; anchors.margins: Theme.pad; spacing: 8
                    RowLayout { spacing: 10
                        Icon { name: "cloud"; size: 26; stroke: 2.2; color: status.hue }
                        Text { text: page.cs.title
                            color: status.hue; font.pixelSize: Theme.fsTitle; font.weight: Font.DemiBold } }
                    Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.textDim; font.pixelSize: Theme.fsLabel + 1
                        text: page.cs.state === "connected"
                              ? "Telemetry is reaching EcoFleet. Last data sent " + page.lastContact + "."
                              : page.cs.state === "connecting"
                              ? "Online, waiting for EcoFleet to confirm data. Last confirmed " + page.lastContact + "."
                              : page.cs.state === "offline"
                              ? "Telemetry is saved on the unit and sent when the connection returns. Last contact " + page.lastContact + "."
                              : "The unit's telemetry service isn't reporting, so the cloud status can't be shown." }
                    Item { Layout.fillHeight: true }
                }
            }
            InfoCard { Layout.fillWidth: true; Layout.preferredWidth: 1; Layout.alignment: Qt.AlignTop
                title: "Network"
                rows: [ {k: "Link",        v: devinfo.ethLinked ? "Linked" : "No link",
                                           hue: devinfo.ethLinked ? Theme.ok : Theme.fault},
                        {k: "IP address",  v: devinfo.ipAddress},
                        {k: "MAC address", v: devinfo.macAddress} ] }
        }
        Item { Layout.fillHeight: true }
    }
}
