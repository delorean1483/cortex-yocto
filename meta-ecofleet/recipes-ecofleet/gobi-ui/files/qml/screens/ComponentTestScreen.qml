import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
Item {
    id: page

    // Resolve the `telemetry` context property at page scope (no shadow) so the
    // ComponentTestPanel binding below references it WITHOUT a self-binding loop:
    // the panel has its own `property var telemetry`, which shadows the context
    // property inside its scope, so a plain `telemetry: telemetry` binds to itself.
    property var telemetryRef: telemetry

    // Whole-screen maintenance-passcode gate: START/STOP, the evap fan, and the
    // relay grid are ALL hidden until the passcode is entered. Leaving the screen
    // re-locks it (next visit prompts again).
    property bool unlocked: false
    property bool badpin: false
    function tryUnlock(code) {
        if (MaintController.verify(code)) {
            page.unlocked = true; page.badpin = false
            // Already on the Component Test screen with the passcode accepted — go
            // straight into OP_DIAG (preAuthed panel enters directly, no extra tap).
            ctp.requestEnter()
        } else page.badpin = true
    }

    // Leaving this screen tears down any OP_DIAG entry and re-locks the gate.
    StackView.onDeactivating: { ctp.leave(); page.unlocked = false; page.badpin = false }
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

    ColumnLayout {
        anchors.fill: parent; anchors.margins: 12; spacing: 8

        ScreenHeader { title: "Component Test"; subtitle: "Commands the APU directly — use with care"
            subtitleColor: Theme.warn
            onBack: if (page.StackView.view) page.StackView.view.pop() }

        // ── LOCKED: whole-screen passcode prompt ──
        ColumnLayout {
            visible: !page.unlocked
            Layout.fillWidth: true; Layout.fillHeight: true; spacing: 10
            Item { Layout.fillHeight: true }
            // fillWidth lifts the column's max width off the fixed-size keypad so
            // the keypad centers instead of packing left
            Text { Layout.fillWidth: true; horizontalAlignment: Text.AlignHCenter; text: "Enter maintenance passcode"; color: Theme.text; font.pixelSize: Theme.fsBody + 1; font.weight: Font.Medium }
            Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; horizontalAlignment: Text.AlignHCenter
                text: page.badpin ? "Wrong passcode — try again." : "Technician access only"
                color: page.badpin ? Theme.fault : Theme.textMute; font.pixelSize: Theme.fsLabel }
            Keypad { Layout.alignment: Qt.AlignHCenter; hue: Theme.warn
                onEntered: function(code) { page.tryUnlock(code) } }
            Item { Layout.fillHeight: true }
        }

        // ── UNLOCKED: actuation content ──
        ColumnLayout {
            visible: page.unlocked
            Layout.fillWidth: true; Layout.fillHeight: true; spacing: 8

            // START / STOP (real, via mode)
            Rectangle {
                Layout.fillWidth: true; Layout.preferredHeight: 56; radius: Theme.radius
                property color hue: page.running ? Theme.fault : Theme.ok
                color: goMa.pressed ? Theme.tint(hue, 0.30) : Theme.tint(hue, 0.16)
                border.color: hue; border.width: 2
                Row { anchors.centerIn: parent; spacing: 10
                    Rectangle { visible: page.running; width: 16; height: 16; radius: 3; color: parent.parent.hue; anchors.verticalCenter: parent.verticalCenter }
                    Text { text: page.running ? "STOP" : "START"; color: parent.parent.hue
                        font.pixelSize: 22; font.weight: Font.Bold; font.letterSpacing: 1; anchors.verticalCenter: parent.verticalCenter } }
                MouseArea { id: goMa; anchors.fill: parent; enabled: !ctp.guarding; onClicked: page.startStop() }
            }

            // Evap fan slider (real)
            Rectangle {
                Layout.fillWidth: true; Layout.preferredHeight: 64; radius: Theme.radius; color: Theme.surface
                RowLayout { anchors.fill: parent; anchors.leftMargin: 14; anchors.rightMargin: 14; spacing: 14
                    Text { Layout.preferredWidth: 120; text: "Evap fan speed"; color: Theme.text; font.pixelSize: Theme.fsLabel + 1; font.weight: Font.Medium }
                    Slider { id: fanSlider; enabled: !ctp.guarding
                        Layout.fillWidth: true; Layout.preferredHeight: 40
                        from: 0; to: 100; stepSize: 1; live: true
                        Component.onCompleted: value = page.effFan
                        onMoved: page.pickFan(value)
                        Connections { target: telemetry; function onDataChanged() { if (!fanSlider.pressed && page.uiFan < 0) fanSlider.value = telemetry.fanSpeed } }
                        background: Rectangle { x: fanSlider.leftPadding; y: fanSlider.topPadding + fanSlider.availableHeight/2 - height/2
                            width: fanSlider.availableWidth; height: 10; radius: 5; color: Theme.surface2
                            Rectangle { width: fanSlider.visualPosition * parent.width; height: parent.height; radius: 5; color: Theme.accent } }
                        handle: Rectangle { x: fanSlider.leftPadding + fanSlider.visualPosition * (fanSlider.availableWidth - width)
                            y: fanSlider.topPadding + fanSlider.availableHeight/2 - height/2
                            implicitWidth: 30; implicitHeight: 30; radius: 15
                            color: fanSlider.pressed ? Theme.accent : Theme.text; border.color: Theme.accent; border.width: 3 } }
                    Text { Layout.preferredWidth: 52; horizontalAlignment: Text.AlignRight
                        text: page.effFan <= 0 ? "OFF" : page.effFan + "%"
                        color: page.effFan <= 0 ? Theme.textMute : Theme.text; font.pixelSize: Theme.fsBody; font.weight: Font.DemiBold } }
            }

            // Passcode already collected at the screen level → panel skips its own keypad.
            ComponentTestPanel {
                id: ctp
                preAuthed: true
                Layout.fillWidth: true; Layout.fillHeight: true
                telemetry: page.telemetryRef
            }
        }
    }
}
