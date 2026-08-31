import QtQuick
import "../templates"
ChoiceList {
    current: telemetry.mode
    model: [
        { value: "climate", title: "Climate", help: "Runs the APU to heat or cool the cab to your setpoint." },
        { value: "battery", title: "Battery",  help: "Runs the APU only to keep the truck battery charged." },
        { value: "off",     title: "Off",      help: "APU stays off. Cab climate and battery support are unavailable." }
    ]
    onPicked: telemetry.setMode(value)
}
