import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
Item {
    id: page
    readonly property bool isAlertsScreen: true
    property real now: Date.now()
    readonly property int n: StatusLabels.faultCount(telemetry.hasError, eventlog.activeCount)
    readonly property var rawEv: StatusLabels.activeEvent(eventlog.events)
    // Ignore a stale active event until the log catches up with the current code.
    readonly property var ev: (rawEv && rawEv.error === telemetry.error) ? rawEv : null
    readonly property var recent: StatusLabels.recentCleared(eventlog.events, 2)
    Timer { interval: 10000; repeat: true; running: true; onTriggered: page.now = Date.now() }
    Component { id: logC; ErrorLogScreen {} }

    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: Theme.gap
        ScreenHeader { title: "Alerts"; subtitle: page.n > 0 ? page.n + " active" : ""
            onBack: if (page.StackView.view) page.StackView.view.pop() }

        // Active fault card (red) or all-clear card (green)
        Rectangle {
            id: card
            Layout.fillWidth: true
            Layout.preferredHeight: cardRow.implicitHeight + 36
            radius: Theme.radius
            property color hue: telemetry.hasError ? Theme.fault : Theme.ok
            color: Theme.tint(hue, 0.18)
            RowLayout {
                id: cardRow
                anchors.fill: parent; anchors.leftMargin: 20; anchors.rightMargin: 20
                anchors.topMargin: 18; anchors.bottomMargin: 18; spacing: 18
                Icon { name: telemetry.hasError ? "alert" : "check-circle"
                    size: 36; stroke: 2.2; color: card.hue; Layout.alignment: Qt.AlignTop }
                ColumnLayout { Layout.fillWidth: true; spacing: 6
                    TextMetrics { id: titleMetrics; font.pixelSize: 24; font.weight: Font.Bold
                        text: telemetry.hasError ? StatusLabels.error(telemetry.error) : "No active alerts" }
                    RowLayout { Layout.fillWidth: true; spacing: 14
                        Text { Layout.preferredWidth: Math.min(titleMetrics.advanceWidth, Math.max(0, (card.width - 94) - (startedTxt.visible ? startedTxt.contentWidth + 14 : 0)))
                            elide: Text.ElideRight; textFormat: Text.PlainText
                            text: telemetry.hasError ? StatusLabels.error(telemetry.error) : "No active alerts"
                            color: telemetry.hasError ? Theme.faultText : Theme.okText
                            font.pixelSize: 24; font.weight: Font.Bold }
                        Text { id: startedTxt; visible: telemetry.hasError && page.ev !== null
                            text: page.ev ? "Started " + StatusLabels.ago(page.ev.startMs, page.now) : ""
                            color: Theme.textDim; font.pixelSize: 15; Layout.alignment: Qt.AlignBaseline }
                        Item { Layout.fillWidth: true }
                    }
                    Text { Layout.fillWidth: true; wrapMode: Text.WordWrap
                        color: Theme.text; font.pixelSize: 15
                        text: telemetry.hasError
                              ? "The APU reported an active fault. Resolve it before running the unit."
                              : "The APU is operating normally. Active faults are shown here as they occur." }
                    Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; textFormat: Text.PlainText
                        text: telemetry.hasError ? StatusLabels.faultSnapshot(page.ev) : ""
                        visible: text !== ""
                        color: Theme.textMute; font.pixelSize: 14 }
                }
            }
        }

        // RECENT header + link to the full error log
        RowLayout { Layout.fillWidth: true; spacing: 8
            Text { text: "RECENT"; color: Theme.textMute; font.pixelSize: Theme.fsCaption
                font.weight: Font.DemiBold; font.letterSpacing: Theme.lsCaps }
            Item { Layout.fillWidth: true }
            Item {
                Layout.preferredHeight: Theme.touch; Layout.preferredWidth: logRow.implicitWidth + 16
                Row { id: logRow; anchors.centerIn: parent; spacing: 6
                    Text { anchors.verticalCenter: parent.verticalCenter; text: "Error log"
                        color: Theme.accent; font.pixelSize: 15; font.weight: Font.DemiBold }
                    Icon { anchors.verticalCenter: parent.verticalCenter; name: "chevron-right"
                        size: 18; stroke: 2.4; color: Theme.accent }
                }
                MouseArea { anchors.fill: parent
                    onClicked: if (page.StackView.view) page.StackView.view.push(logC) }
            }
        }

        Repeater {
            model: page.recent
            delegate: Rectangle {
                required property var modelData
                Layout.fillWidth: true; Layout.preferredHeight: 52
                radius: 10; color: Theme.surface
                RowLayout { anchors.fill: parent; anchors.leftMargin: 16; anchors.rightMargin: 16; spacing: 14
                    Rectangle { Layout.preferredWidth: 8; Layout.preferredHeight: 8; radius: 4; color: Theme.textMute }
                    Text { Layout.fillWidth: true; elide: Text.ElideRight; textFormat: Text.PlainText
                        text: StatusLabels.error(modelData.error)
                        color: Theme.text; font.pixelSize: 16; font.weight: Font.DemiBold }
                    Text { color: Theme.textDim; font.pixelSize: 14
                        text: StatusLabels.ago(modelData.startMs, page.now) + " · lasted "
                              + StatusLabels.duration(modelData.endMs - modelData.startMs) }
                }
            }
        }
        Text { visible: page.recent.length === 0; text: "No earlier alerts"
            color: Theme.textDim; font.pixelSize: 15; Layout.leftMargin: 4 }
        Item { Layout.fillHeight: true }
    }
}
