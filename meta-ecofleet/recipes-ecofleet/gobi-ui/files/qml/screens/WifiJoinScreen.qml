import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
// Password entry for a secured network, or name + security + password for a
// hidden one. The network is saved only after it connects; on success this
// screen closes, on failure the error shows and the entry is kept.
Item {
    id: page
    property string ssid: ""
    property bool hidden: false
    property bool secured: true
    onSecuredChanged: if (!secured && hidden) kb.target = nameField   // password field is gone
    property string error: ""
    property alias kbSymbols: kb.symbols   // preview hook
    readonly property bool busy: wifi.state === "connecting" && wifi.pendingSsid === (hidden ? nameField.text : ssid)
    readonly property bool valid: (hidden ? nameField.text.length > 0 : true)
                                  && (!secured || pwField.text.length >= 8)

    function submit() {
        if (!valid || busy) return
        page.error = ""
        wifi.clearError()
        if (hidden) wifi.addHidden(nameField.text, secured, pwField.text)
        else wifi.join(ssid, pwField.text)
        if (wifi.lastError !== "") page.error = wifi.lastError   // immediate validation error
    }

    Connections { target: wifi
        function onJoined(s) { if (s === (page.hidden ? nameField.text : page.ssid) && page.StackView.view) page.StackView.view.pop() }
        function onJoinFailed(s, e) { if (s === (page.hidden ? nameField.text : page.ssid)) page.error = e } }

    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: 8
        ScreenHeader { title: page.hidden ? "Add hidden network" : page.ssid
            // Error/hint live in the subtitle slot so they cost no layout height (keyboard stays on screen).
            subtitle: page.error
            subtitleColor: Theme.fault
            onBack: if (page.StackView.view) page.StackView.view.pop() }

        RowLayout { Layout.fillWidth: true; spacing: 10; visible: page.hidden
            TextField { id: nameField; Layout.fillWidth: true; Layout.preferredHeight: 52
                placeholderText: "Network name"; font.pixelSize: 18; color: Theme.text
                leftPadding: 16; rightPadding: 16
                background: Rectangle { radius: 10; color: Theme.surface
                    Rectangle { anchors.fill: parent; radius: parent.radius; color: "transparent"
                        border.width: nameField.activeFocus ? 2 : 0; border.color: Theme.accent } }
                onActiveFocusChanged: if (activeFocus) kb.target = nameField }
            SegmentedControl { Layout.preferredWidth: 220
                options: [ {label: "WPA2", value: 1}, {label: "None", value: 0} ]
                current: page.secured ? 1 : 0
                onPicked: (value) => page.secured = value === 1 }
            // Open hidden network: no password row, so Connect lives here.
            Rectangle { visible: !page.secured; Layout.preferredWidth: 140; Layout.preferredHeight: 52; radius: 10
                color: page.valid && !page.busy ? Theme.accent : Theme.surface2
                Text { anchors.centerIn: parent; textFormat: Text.PlainText; text: page.busy ? "Connecting…" : "Connect"
                    color: page.valid && !page.busy ? Theme.textOnAccent : Theme.textMute
                    font.pixelSize: 17; font.weight: Font.DemiBold }
                MouseArea { anchors.fill: parent; onClicked: page.submit() } } }

        RowLayout { Layout.fillWidth: true; spacing: 10; visible: page.secured
            TextField { id: pwField; Layout.fillWidth: true; Layout.preferredHeight: 52
                placeholderText: "Password"; font.pixelSize: 18; font.letterSpacing: 3; color: Theme.text
                leftPadding: 16; rightPadding: 6 + 56 + (hint.visible ? hint.implicitWidth + 12 : 0)
                echoMode: show.checked ? TextInput.Normal : TextInput.Password
                background: Rectangle { radius: 10; color: Theme.surface
                    // 2px inset focus ring (drawn inside the field), fault on error.
                    Rectangle { anchors.fill: parent; radius: parent.radius; color: "transparent"
                        border.width: (pwField.activeFocus || page.error !== "") ? 2 : 0
                        border.color: page.error !== "" ? Theme.fault : Theme.accent } }
                onActiveFocusChanged: if (activeFocus) kb.target = pwField
                Component.onCompleted: if (!page.hidden) forceActiveFocus()
                Text { id: hint; visible: page.secured && pwField.text.length > 0 && pwField.text.length < 8
                    anchors.right: show.left; anchors.rightMargin: 12; anchors.verticalCenter: parent.verticalCenter
                    text: pwField.text.length + " / 8 min"; color: Theme.warn
                    font.pixelSize: 14; font.features: { "tnum": 1 } }
                Item { id: show; property bool checked: false
                    anchors.right: parent.right; anchors.rightMargin: 6; anchors.verticalCenter: parent.verticalCenter
                    width: 56; height: 40
                    Text { anchors.centerIn: parent; text: show.checked ? "Hide" : "Show"; color: Theme.accent
                        font.pixelSize: 15; font.weight: Font.DemiBold }
                    MouseArea { anchors.fill: parent; anchors.topMargin: -4; anchors.bottomMargin: -4   // 48px tap area, inside the 52px field
                        onClicked: show.checked = !show.checked } } }
            Rectangle { Layout.preferredWidth: 140; Layout.preferredHeight: 52; radius: 10
                color: page.valid && !page.busy ? Theme.accent : Theme.surface2
                Text { anchors.centerIn: parent; textFormat: Text.PlainText; text: page.busy ? "Connecting…" : "Connect"
                    color: page.valid && !page.busy ? Theme.textOnAccent : Theme.textMute
                    font.pixelSize: 17; font.weight: Font.DemiBold }
                MouseArea { anchors.fill: parent; onClicked: page.submit() } } }

        Item { Layout.fillHeight: true }
        TextKeyboard { id: kb; Layout.fillWidth: true; target: page.hidden ? nameField : pwField
            onDone: page.submit() }
    }
}
