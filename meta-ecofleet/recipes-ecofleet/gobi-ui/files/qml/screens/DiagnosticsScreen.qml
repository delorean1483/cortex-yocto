import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
Item {
    id: page

    // ── Fan test: optimistic control over telemetry.setFan (reg 12, 0-100%). A
    //    drag updates uiFan instantly and debounces the write; telemetry echoes
    //    back within ~1 s and we defer to it. Relays are NOT controllable here —
    //    the fan is the only actuator with a write path today (see Phase-3). ──
    property int uiFan: -1
    readonly property int effFan: uiFan >= 0 ? uiFan : telemetry.fanSpeed
    Timer { id: fanSend; interval: 350; onTriggered: telemetry.setFan(page.uiFan) }
    function pickFan(n) { page.uiFan = Math.round(n); fanSend.restart() }
    Connections {
        target: telemetry
        function onDataChanged() {
            if (page.uiFan >= 0 && telemetry.fanSpeed === page.uiFan) page.uiFan = -1
        }
    }

    // Rebuilt on every telemetry change (property bindings inside).
    property var sections: [
        { name: "STATUS", tiles: [
            ["Mode", telemetry.mode, false], ["Control Status", telemetry.controlStatus, false],
            ["Engine Status", telemetry.engineStatus, false], ["Error", telemetry.error, telemetry.hasError] ] },
        { name: "CLIMATE", tiles: [
            ["Cabin Temp", telemetry.cabinTempF.toFixed(0)+" °F", false], ["Setpoint", telemetry.clmtSetpointF.toFixed(0)+" °F", false],
            ["External Temp", telemetry.extTempF.toFixed(0)+" °F", false], ["Fan Speed", telemetry.fanSpeed>0?telemetry.fanSpeed+"%":"Off", false] ] },
        { name: "POWER & ENGINE", tiles: [
            ["Battery", telemetry.battV.toFixed(2)+" V", false], ["Engine RPM", telemetry.rpm+"", false],
            ["Oil Pressure", telemetry.oilOk?"OK":"LOW", !telemetry.oilOk], ["Ignition", telemetry.ignition?"On":"Off", false] ] },
        { name: "SERVICE", tiles: [
            ["Engine Hours", telemetry.engineHrs+" h", false], ["Oil Hours", telemetry.oilHrs+" h", false],
            ["Machine Hours", telemetry.machineHrs+" h", false], ["Oil Change", telemetry.oilChange, telemetry.oilChange!=="good"] ] }
    ]

    ColumnLayout {
        anchors.fill: parent; anchors.margins: 12; spacing: 6

        RowLayout { Layout.fillWidth: true
            Text { text: "‹"; color: Theme.accentBlue; font.pixelSize: 26
                MouseArea { anchors.fill: parent; anchors.margins: -10; onClicked: if (page.StackView.view) page.StackView.view.pop() } }
            Text { text: "Live Diagnostics"; color: Theme.textDim; font.pixelSize: 18; font.weight: Font.DemiBold } }

        Repeater { model: page.sections
            ColumnLayout { Layout.fillWidth: true; Layout.fillHeight: true; spacing: 3
                Text { text: modelData.name; color: Theme.textMute; font.pixelSize: 11; font.letterSpacing: 2; font.weight: Font.DemiBold }
                RowLayout { Layout.fillWidth: true; Layout.fillHeight: true; spacing: 8
                    Repeater { model: modelData.tiles
                        Rectangle { Layout.fillWidth: true; Layout.fillHeight: true; radius: 10; color: Theme.surface
                            border.color: modelData[2] ? Theme.fault : "transparent"; border.width: modelData[2] ? 1 : 0
                            Column { anchors.left: parent.left; anchors.leftMargin: 14; anchors.right: parent.right; anchors.rightMargin: 10
                                     anchors.verticalCenter: parent.verticalCenter; spacing: 2
                                Text { text: modelData[0]; color: Theme.textMute; font.pixelSize: 12; elide: Text.ElideRight; width: parent.width }
                                Text { text: modelData[1]; color: modelData[2] ? Theme.fault : Theme.text; font.pixelSize: 22
                                       font.weight: Font.DemiBold; elide: Text.ElideRight; width: parent.width } } } } } } }

        // ── Fan test control (writes telemetry.setFan → reg 12) ──────────────────
        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 78
            radius: 10; color: Theme.surface; border.color: Theme.border; border.width: 1
            RowLayout {
                anchors.fill: parent; anchors.leftMargin: 14; anchors.rightMargin: 14; spacing: 14
                Column {
                    Layout.preferredWidth: 150; spacing: 2
                    Text { text: "FAN TEST"; color: Theme.textMute; font.pixelSize: 11; font.letterSpacing: 2; font.weight: Font.DemiBold }
                    Text { text: "Drives evap fan · reg 12"; color: Theme.textMute; font.pixelSize: 11 }
                }
                Slider {
                    id: fanSlider
                    Layout.fillWidth: true; Layout.preferredHeight: 40
                    from: 0; to: 100; stepSize: 1; live: true
                    Component.onCompleted: value = page.effFan
                    onMoved: page.pickFan(value)
                    Connections {
                        target: telemetry
                        function onDataChanged() {
                            if (!fanSlider.pressed && page.uiFan < 0) fanSlider.value = telemetry.fanSpeed
                        }
                    }
                    background: Rectangle {
                        x: fanSlider.leftPadding
                        y: fanSlider.topPadding + fanSlider.availableHeight / 2 - height / 2
                        width: fanSlider.availableWidth; height: 10; radius: 5
                        color: Theme.surface2; border.color: Theme.border; border.width: 1
                        Rectangle {
                            width: fanSlider.visualPosition * parent.width
                            height: parent.height; radius: 5; color: Theme.accentBlue
                        }
                    }
                    handle: Rectangle {
                        x: fanSlider.leftPadding + fanSlider.visualPosition * (fanSlider.availableWidth - width)
                        y: fanSlider.topPadding + fanSlider.availableHeight / 2 - height / 2
                        implicitWidth: 30; implicitHeight: 30; radius: 15
                        color: fanSlider.pressed ? Theme.surface2 : "#1D3A57"
                        border.color: Theme.accentBlue; border.width: 2
                    }
                }
                Text {
                    Layout.preferredWidth: 56; horizontalAlignment: Text.AlignRight
                    text: page.effFan <= 0 ? "OFF" : page.effFan + "%"
                    color: page.effFan <= 0 ? Theme.textMute : Theme.accentBlue
                    font.pixelSize: 18; font.weight: Font.Bold
                }
            }
        }
    }
}
