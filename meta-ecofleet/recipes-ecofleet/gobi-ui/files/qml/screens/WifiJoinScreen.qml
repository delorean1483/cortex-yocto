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
            subtitle: page.hidden ? "" : "Enter the WiFi password"
            onBack: if (page.StackView.view) page.StackView.view.pop() }

        RowLayout { Layout.fillWidth: true; spacing: 10; visible: page.hidden
            TextField { id: nameField; Layout.fillWidth: true; Layout.preferredHeight: 44
                placeholderText: "Network name"; font.pixelSize: Theme.fsBody; color: Theme.text
                background: Rectangle { radius: Theme.radiusSm; color: Theme.surface
                    border.color: nameField.activeFocus ? Theme.accent : Theme.border }
                onActiveFocusChanged: if (activeFocus) kb.target = nameField }
            SegmentedControl { Layout.preferredWidth: 220
                options: [ {label: "WPA2", value: 1}, {label: "None", value: 0} ]
                current: page.secured ? 1 : 0
                onPicked: (value) => page.secured = value === 1 }
            // Open hidden network: no password row, so Connect lives here.
            Rectangle { visible: !page.secured; Layout.preferredWidth: 120; Layout.preferredHeight: 44; radius: Theme.radiusSm
                color: page.valid && !page.busy ? Theme.accent : Theme.surface2
                Text { anchors.centerIn: parent; text: page.busy ? "Connecting…" : "Connect"
                    color: page.valid && !page.busy ? Theme.textOnAccent : Theme.textMute
                    font.pixelSize: Theme.fsBody; font.weight: Font.DemiBold }
                MouseArea { anchors.fill: parent; onClicked: page.submit() } } }

        RowLayout { Layout.fillWidth: true; spacing: 10; visible: page.secured
            TextField { id: pwField; Layout.fillWidth: true; Layout.preferredHeight: 44
                placeholderText: "Password"; font.pixelSize: Theme.fsBody; color: Theme.text
                echoMode: show.checked ? TextInput.Normal : TextInput.Password
                background: Rectangle { radius: Theme.radiusSm; color: Theme.surface
                    border.color: page.error !== "" ? Theme.fault : (pwField.activeFocus ? Theme.accent : Theme.border) }
                onActiveFocusChanged: if (activeFocus) kb.target = pwField
                Component.onCompleted: if (!page.hidden) forceActiveFocus() }
            Rectangle { id: show; property bool checked: false
                Layout.preferredWidth: 72; Layout.preferredHeight: 44; radius: Theme.radiusSm
                color: Theme.surface; border.color: Theme.border
                Text { anchors.centerIn: parent; text: show.checked ? "Hide" : "Show"; color: Theme.accent
                    font.pixelSize: Theme.fsLabel + 1; font.weight: Font.DemiBold }
                MouseArea { anchors.fill: parent; onClicked: show.checked = !show.checked } }
            Rectangle { Layout.preferredWidth: 120; Layout.preferredHeight: 44; radius: Theme.radiusSm
                color: page.valid && !page.busy ? Theme.accent : Theme.surface2
                Text { anchors.centerIn: parent; text: page.busy ? "Connecting…" : "Connect"
                    color: page.valid && !page.busy ? Theme.textOnAccent : Theme.textMute
                    font.pixelSize: Theme.fsBody; font.weight: Font.DemiBold }
                MouseArea { anchors.fill: parent; onClicked: page.submit() } } }

        Text { Layout.fillWidth: true; visible: page.error !== "" || (page.secured && pwField.text.length > 0 && pwField.text.length < 8)
            text: page.error !== "" ? page.error : "Password must be at least 8 characters."
            color: page.error !== "" ? Theme.fault : Theme.textMute; font.pixelSize: Theme.fsLabel }

        Item { Layout.fillHeight: true }
        TextKeyboard { id: kb; Layout.fillWidth: true; target: page.hidden ? nameField : pwField
            onDone: page.submit() }
    }
}
