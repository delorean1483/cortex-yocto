import QtQuick
import QtQuick.Controls
ApplicationWindow {
    id: win
    visible: true; width: 1280; height: 800; title: "gobi-ui preview"
    property alias content: loader.sourceComponent
    Mocks { id: mocks }
    // expose mock models on the window root scope so `telemetry.*` resolves
    property QtObject telemetry: mocks.telemetry
    property QtObject devinfo:  mocks.devinfo
    Rectangle { anchors.fill: parent; color: "#000" }
    Loader { id: loader; anchors.fill: parent }
    // default content: a placeholder until a task sets it
    Component.onCompleted: if (!loader.sourceComponent) placeholder.active = true
    Loader { id: placeholder; active: false; anchors.centerIn: parent
        sourceComponent: Text { text: "set Preview.content"; color: "#888" } }
}
