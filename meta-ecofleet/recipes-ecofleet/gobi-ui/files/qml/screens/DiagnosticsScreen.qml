import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
Item {
    id: page

    StackView.onDeactivating: ctp.leave()
    Component.onDestruction: ctp.leave()

    // ── Evap fan: real control (telemetry.setFan → reg 12), optimistic + debounced ──
    property int uiFan: -1
    readonly property int effFan: uiFan >= 0 ? uiFan : telemetry.fanSpeed
    Timer { id: fanSend; interval: 350; onTriggered: telemetry.setFan(page.uiFan) }
    function pickFan(n) { page.uiFan = Math.round(n); fanSend.restart() }

    // ── START/STOP: real control via mode (climate/off), optimistic ──
    property string uiMode: ""
    readonly property string effMode: uiMode !== "" ? uiMode : telemetry.mode
    readonly property bool running: effMode !== "off"
    function startStop() { var m = page.running ? "off" : "climate"; page.uiMode = m; telemetry.setMode(m) }

    Connections {
        target: telemetry
        function onDataChanged() {
            if (page.uiFan >= 0 && telemetry.fanSpeed === page.uiFan) page.uiFan = -1
            if (page.uiMode !== "" && telemetry.mode === page.uiMode) page.uiMode = ""
        }
    }

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
        anchors.fill: parent; anchors.margins: 12; spacing: 8

        RowLayout { Layout.fillWidth: true
            Text { text: "‹"; color: Theme.accentBlue; font.pixelSize: 26
                MouseArea { anchors.fill: parent; anchors.margins: -12; onClicked: if (page.StackView.view) page.StackView.view.pop() } }
            Text { text: "Live Diagnostics"; color: Theme.textDim; font.pixelSize: 18; font.weight: Font.DemiBold } }

        Flickable {
            id: flick
            Layout.fillWidth: true; Layout.fillHeight: true
            contentHeight: content.height; clip: true
            boundsBehavior: Flickable.StopAtBounds
            ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

            ColumnLayout {
                id: content
                width: flick.width; spacing: 8

                // ── Live readings ────────────────────────────────────────────────
                Repeater { model: page.sections
                    ColumnLayout { Layout.fillWidth: true; spacing: 3
                        Text { text: modelData.name; color: Theme.textMute; font.pixelSize: 11; font.letterSpacing: 2; font.weight: Font.DemiBold }
                        RowLayout { Layout.fillWidth: true; Layout.preferredHeight: 56; spacing: 8
                            Repeater { model: modelData.tiles
                                Rectangle { Layout.fillWidth: true; Layout.fillHeight: true; radius: 10; color: Theme.surface
                                    border.color: modelData[2] ? Theme.fault : "transparent"; border.width: modelData[2] ? 1 : 0
                                    Column { anchors.left: parent.left; anchors.leftMargin: 14; anchors.right: parent.right; anchors.rightMargin: 10
                                             anchors.verticalCenter: parent.verticalCenter; spacing: 2
                                        Text { text: modelData[0]; color: Theme.textMute; font.pixelSize: 12; elide: Text.ElideRight; width: parent.width }
                                        Text { text: modelData[1]; color: modelData[2] ? Theme.fault : Theme.text; font.pixelSize: 20
                                               font.weight: Font.DemiBold; elide: Text.ElideRight; width: parent.width } } } } } } }

                // ── Component test ───────────────────────────────────────────────
                Rectangle { Layout.fillWidth: true; height: 1; color: Theme.border; Layout.topMargin: 4 }
                RowLayout { Layout.fillWidth: true
                    Text { text: "COMPONENT TEST"; color: Theme.textMute; font.pixelSize: 11; font.letterSpacing: 2; font.weight: Font.DemiBold }
                    Item { Layout.fillWidth: true }
                    Text { text: "commands the APU — use with care"; color: Theme.textMute; font.pixelSize: 11 } }

                // START / STOP (real, via mode)
                Rectangle {
                    Layout.fillWidth: true; Layout.preferredHeight: 56; radius: 12
                    property color hue: page.running ? Theme.fault : Theme.ok
                    color: goMa.pressed ? Qt.rgba(hue.r,hue.g,hue.b,0.30) : Qt.rgba(hue.r,hue.g,hue.b,0.15)
                    border.color: hue; border.width: 2
                    Row { anchors.centerIn: parent; spacing: 10
                        Rectangle { visible: page.running; width: 16; height: 16; radius: 3; color: parent.parent.hue; anchors.verticalCenter: parent.verticalCenter }
                        Text { text: page.running ? "STOP" : "START"; color: parent.parent.hue
                            font.pixelSize: 24; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter } }
                    MouseArea { id: goMa; anchors.fill: parent; enabled: !ctp.guarding; onClicked: page.startStop() }
                }

                // Evap fan slider (real)
                Rectangle {
                    Layout.fillWidth: true; Layout.preferredHeight: 66; radius: 10; color: Theme.surface; border.color: Theme.border; border.width: 1
                    RowLayout { anchors.fill: parent; anchors.leftMargin: 14; anchors.rightMargin: 14; spacing: 14
                        Text { Layout.preferredWidth: 110; text: "Evap Fan"; color: Theme.textDim; font.pixelSize: 14; font.weight: Font.Medium }
                        Slider { id: fanSlider; enabled: !ctp.guarding
                            Layout.fillWidth: true; Layout.preferredHeight: 40
                            from: 0; to: 100; stepSize: 1; live: true
                            Component.onCompleted: value = page.effFan
                            onMoved: page.pickFan(value)
                            Connections { target: telemetry; function onDataChanged() { if (!fanSlider.pressed && page.uiFan < 0) fanSlider.value = telemetry.fanSpeed } }
                            background: Rectangle { x: fanSlider.leftPadding; y: fanSlider.topPadding + fanSlider.availableHeight/2 - height/2
                                width: fanSlider.availableWidth; height: 10; radius: 5; color: Theme.surface2; border.color: Theme.border; border.width: 1
                                Rectangle { width: fanSlider.visualPosition * parent.width; height: parent.height; radius: 5; color: Theme.accentBlue } }
                            handle: Rectangle { x: fanSlider.leftPadding + fanSlider.visualPosition * (fanSlider.availableWidth - width)
                                y: fanSlider.topPadding + fanSlider.availableHeight/2 - height/2
                                implicitWidth: 30; implicitHeight: 30; radius: 15
                                color: fanSlider.pressed ? Theme.surface2 : "#1D3A57"; border.color: Theme.accentBlue; border.width: 2 } }
                        Text { Layout.preferredWidth: 52; horizontalAlignment: Text.AlignRight
                            text: page.effFan <= 0 ? "OFF" : page.effFan + "%"
                            color: page.effFan <= 0 ? Theme.textMute : Theme.accentBlue; font.pixelSize: 16; font.weight: Font.Bold } }
                }

                // ── Component Test (guarded) ─────────────────────────────────
                ComponentTestPanel {
                    id: ctp
                    Layout.fillWidth: true; Layout.preferredHeight: 320
                    telemetry: telemetry
                }
                Item { Layout.preferredHeight: 4 }
            }
        }
    }
}
