import QtQuick
import QtQuick.Layouts
import ".."
import "../atoms"
Item {
    id: batt

    // ── Battery ON/OFF, mirroring HomeScreen's optimistic AUTO/OFF pattern ──
    property string uiMode: ""
    readonly property string effMode: uiMode !== "" ? uiMode : telemetry.mode
    readonly property bool on: effMode === "battery"
    function setOn(a) { batt.uiMode = a ? "battery" : "off"; telemetry.setMode(batt.uiMode) }

    // ── CHARGE BELOW threshold, optimistic + debounced, reconciled on dataChanged
    //    (same Timer/Connections idiom HomeScreen uses for its climate setpoint) ──
    property real target: telemetry.battSetpointV
    property bool dirty: false
    Component.onCompleted: batt.target = telemetry.battSetpointV
    Timer { id: spSend; interval: 350; onTriggered: telemetry.setBattSetpoint(batt.target) }
    function round1(v) { return Math.round(v * 10) / 10 }
    function bump(d) { batt.dirty = true; batt.target = round1(Math.max(11.0, Math.min(13.0, batt.target + d))); spSend.restart() }

    Connections {
        target: telemetry
        function onDataChanged() {
            if (batt.uiMode !== "" && telemetry.mode === batt.uiMode) batt.uiMode = ""
            if (batt.dirty && Math.abs(telemetry.battSetpointV - batt.target) < 0.05) batt.dirty = false
            if (!batt.dirty) batt.target = telemetry.battSetpointV
        }
    }

    // status chip: Charging replaces the health chip while the APU is charging
    readonly property bool charging: telemetry.controlStatus === "charging"
    readonly property var health: StatusLabels.battHealth(telemetry.battV)
    readonly property color chipFill: charging || health.key === "healthy" ? Theme.tint(Theme.ok, 0.16)
                                    : health.key === "low" ? Theme.tint(Theme.warn, 0.16) : Theme.surface2
    readonly property color chipText: charging || health.key === "healthy" ? Theme.okText
                                    : health.key === "low" ? Theme.warn : Theme.textDim

    ColumnLayout {
        anchors.fill: parent; anchors.margins: Theme.pad; spacing: Theme.gap

        // 1. hero: current battery voltage + status row
        ColumnLayout {
            Layout.fillWidth: true; Layout.maximumWidth: 100000; Layout.fillHeight: true; spacing: 10
            Item { Layout.fillHeight: true }
            Text { Layout.alignment: Qt.AlignHCenter; text: "TRUCK BATTERY"; color: Theme.textMute; font.pixelSize: Theme.fsCaption
                font.letterSpacing: Theme.lsCaps; font.weight: Font.DemiBold }
            RowLayout { Layout.alignment: Qt.AlignHCenter; spacing: 0
                Text { text: telemetry.battV.toFixed(1); color: Theme.text; font.pixelSize: 88
                    font.weight: Font.DemiBold; font.letterSpacing: -1.5 }
                Text { Layout.alignment: Qt.AlignBottom; Layout.bottomMargin: 11; text: " V"; color: Theme.textDim; font.pixelSize: 44; font.weight: Font.Medium } }
            RowLayout { Layout.alignment: Qt.AlignHCenter; spacing: 12
                Rectangle { Layout.preferredHeight: 30; Layout.preferredWidth: chipRow.implicitWidth + 24; radius: 15; color: batt.chipFill
                    Row { id: chipRow; anchors.centerIn: parent; spacing: 8
                        Rectangle { width: 8; height: 8; radius: 4; anchors.verticalCenter: parent.verticalCenter; color: batt.chipText }
                        Text { text: batt.charging ? "Charging" : batt.health.label; color: batt.chipText
                            font.pixelSize: 15; font.weight: Font.DemiBold } } }
                Text { text: telemetry.ignition ? "Ignition on" : "Ignition off"; color: Theme.textDim; font.pixelSize: 15 }
            }
            Item { Layout.fillHeight: true }
        }

        // 2. auto-charge threshold
        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 84; radius: Theme.radius; color: Theme.surface
            RowLayout {
                anchors.fill: parent; anchors.leftMargin: 18; anchors.rightMargin: 12; spacing: Theme.gap
                ColumnLayout { Layout.fillWidth: true; spacing: 2
                    Text { text: "Auto-charge below"; color: Theme.text; font.pixelSize: 17; font.weight: Font.DemiBold }
                    Text { Layout.fillWidth: true; text: "APU starts to recharge when the battery drops below this"
                        color: Theme.textDim; font.pixelSize: 14; wrapMode: Text.WordWrap } }
                Stepper { text: batt.target.toFixed(1) + " V"; textSize: 32; textWidth: 108
                    buttonW: 60; buttonH: 56; buttonRadius: 12; buttonFill: Theme.surface2; buttonBorder: false
                    onDecrement: batt.bump(-0.1); onIncrement: batt.bump(0.1) }
            }
        }

        // 3. battery mode
        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 84; radius: Theme.radius; color: Theme.surface
            RowLayout {
                anchors.fill: parent; anchors.leftMargin: 18; anchors.rightMargin: 12; spacing: Theme.gap
                ColumnLayout { Layout.fillWidth: true; spacing: 2
                    Text { text: "Battery mode"; color: Theme.text; font.pixelSize: 17; font.weight: Font.DemiBold }
                    Text { Layout.fillWidth: true; text: StatusLabels.battModeHelp(batt.effMode)
                        color: Theme.textDim; font.pixelSize: 14; wrapMode: Text.WordWrap } }
                SegmentedControl { Layout.preferredWidth: 220; Layout.preferredHeight: 56; trackColor: Theme.bg
                    options: [{label:"On", value:true}, {label:"Off", value:false}]
                    current: batt.on
                    onPicked: function(v) { batt.setOn(v) } }
            }
        }
    }
}
