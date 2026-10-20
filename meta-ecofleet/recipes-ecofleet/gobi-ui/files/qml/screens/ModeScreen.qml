import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
import "../templates"
Item {
    id: page
    // Optimistic: a tap highlights instantly; telemetry echoes back within ~1s and
    // we defer to it. Without this the selection lags a full agent round-trip.
    property string uiMode: ""
    ColumnLayout {
        anchors.fill: parent; anchors.margins: 16; spacing: Theme.gap
        ScreenHeader { title: "APU mode"; onBack: if (page.StackView.view) page.StackView.view.pop() }
        ChoiceList {
            id: list
            Layout.fillWidth: true; Layout.fillHeight: true
            current: page.uiMode !== "" ? page.uiMode : telemetry.mode
            model: [
                { value: "climate", title: "Climate", help: "Runs the APU to heat or cool the cab to your setpoint." },
                { value: "battery", title: "Battery",  help: "Runs the APU only to keep the truck battery charged." },
                { value: "off",     title: "Off",      help: "APU stays off. Cab climate and battery support are unavailable." }
            ]
            onPicked: function(value) { page.uiMode = value; telemetry.setMode(value) }
        }
    }
    Connections {
        target: telemetry
        function onDataChanged() {
            if (page.uiMode !== "" && telemetry.mode === page.uiMode) page.uiMode = ""
        }
    }
}
