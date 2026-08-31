import QtQuick
import "../templates"
ChoiceList {
    id: list
    // Optimistic: a tap highlights instantly; telemetry echoes back within ~1s and
    // we defer to it. Without this the selection lags a full agent round-trip.
    property string uiMode: ""
    current: uiMode !== "" ? uiMode : telemetry.mode
    model: [
        { value: "climate", title: "Climate", help: "Runs the APU to heat or cool the cab to your setpoint." },
        { value: "battery", title: "Battery",  help: "Runs the APU only to keep the truck battery charged." },
        { value: "off",     title: "Off",      help: "APU stays off. Cab climate and battery support are unavailable." }
    ]
    onPicked: { list.uiMode = value; telemetry.setMode(value) }
    Connections {
        target: telemetry
        function onDataChanged() {
            if (list.uiMode !== "" && telemetry.mode === list.uiMode) list.uiMode = ""
        }
    }
}
