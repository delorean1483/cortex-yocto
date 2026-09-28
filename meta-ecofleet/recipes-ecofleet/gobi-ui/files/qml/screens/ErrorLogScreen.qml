import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
// APU fault history kept on the unit (eventlog: gobi-agent's events.json on
// the slot-shared /data partition). Newest first; an active fault is marked.
Item {
    id: page
    property real now: Date.now()
    Timer { interval: 30000; running: true; repeat: true; onTriggered: page.now = Date.now() }
    readonly property var events: eventlog.events

    function when(ms) { return Qt.formatDateTime(new Date(ms), "MMM d, h:mm AP") }
    function conditions(e) {
        var parts = [StatusLabels.mode(e.mode)]
        if (e.controlStatus && e.controlStatus !== "off") parts.push(StatusLabels.control(e.controlStatus))
        parts.push(e.rpm > 0 ? e.rpm.toLocaleString(Qt.locale(), "f", 0) + " RPM" : "Engine off")
        parts.push(e.battV.toFixed(1) + " V")
        parts.push("Coolant " + e.coolantF.toFixed(0) + "°F")
        return parts.join("  ·  ")
    }

    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: Theme.gap
        ScreenHeader { title: "Error Log"
            subtitle: page.events.length === 0 ? ""
                    : page.events.length + (page.events.length === 1 ? " fault recorded" : " faults recorded")
                      + (eventlog.activeCount > 0 ? " · " + eventlog.activeCount + " active" : "")
            subtitleColor: eventlog.activeCount > 0 ? Theme.fault : Theme.textMute
            onBack: if (page.StackView.view) page.StackView.view.pop() }

        // Empty state
        Rectangle {
            visible: page.events.length === 0
            Layout.fillWidth: true; Layout.fillHeight: true
            radius: Theme.radius; color: Theme.surface
            ColumnLayout {
                anchors.centerIn: parent; width: Math.min(parent.width - 48, 440); spacing: 10
                Icon { name: "list"; size: 44; color: Theme.textMute; Layout.alignment: Qt.AlignHCenter }
                Text { Layout.alignment: Qt.AlignHCenter; text: "No faults recorded"
                    color: Theme.text; font.pixelSize: Theme.fsTitle; font.weight: Font.DemiBold }
                Text { Layout.fillWidth: true; horizontalAlignment: Text.AlignHCenter; wrapMode: Text.WordWrap
                    color: Theme.textMute; font.pixelSize: Theme.fsLabel + 1
                    text: "APU faults are recorded here with when they happened, how long they lasted and the conditions at the time." }
            }
        }

        // History
        ListView {
            id: list
            visible: page.events.length > 0
            Layout.fillWidth: true; Layout.fillHeight: true
            clip: true; spacing: 8
            boundsBehavior: Flickable.StopAtBounds
            ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }
            model: page.events
            delegate: Rectangle {
                id: row
                required property var modelData
                readonly property bool active: modelData.endMs === 0
                width: list.width; height: 72
                radius: Theme.radius
                color: active ? Theme.tint(Theme.fault, 0.10) : Theme.surface
                border.color: active ? Theme.fault : "transparent"; border.width: 1
                RowLayout {
                    anchors.fill: parent; anchors.leftMargin: 16; anchors.rightMargin: 16; spacing: 14
                    Icon { name: "alert"; size: 26; color: row.active ? Theme.fault : Theme.textMute }
                    ColumnLayout { Layout.fillWidth: true; spacing: 3
                        RowLayout { Layout.fillWidth: true; spacing: 10
                            Text { text: StatusLabels.error(row.modelData.error || "")
                                color: row.active ? Theme.fault : Theme.text
                                font.pixelSize: Theme.fsBody + 1; font.weight: Font.DemiBold }
                            Item { Layout.fillWidth: true }
                            Text { text: page.when(row.modelData.startMs); color: Theme.textMute; font.pixelSize: Theme.fsLabel }
                        }
                        RowLayout { Layout.fillWidth: true; spacing: 10
                            Text { Layout.fillWidth: true; text: page.conditions(row.modelData); elide: Text.ElideRight
                                color: Theme.textMute; font.pixelSize: Theme.fsCaption + 1 }
                            Text { text: row.active ? "Active now"
                                                    : "Lasted " + StatusLabels.duration(row.modelData.endMs - row.modelData.startMs)
                                color: row.active ? Theme.fault : Theme.textDim
                                font.pixelSize: Theme.fsLabel; font.weight: Font.Medium }
                        }
                    }
                }
            }
        }
    }
}
