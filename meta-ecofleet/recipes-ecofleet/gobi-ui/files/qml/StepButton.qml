import QtQuick
import QtQuick.Layouts

// Large square +/- stepper, sized for gloved-finger taps.
Rectangle {
    id: btn
    property string glyph: "+"
    signal tapped()

    Layout.preferredWidth: 96
    Layout.preferredHeight: 96
    radius: 18
    color: ma.pressed ? "#233041" : "#1C2230"
    border.color: "#30363D"; border.width: 1
    scale: ma.pressed ? 0.96 : 1.0
    Behavior on scale { NumberAnimation { duration: 80 } }

    Text {
        anchors.centerIn: parent
        anchors.verticalCenterOffset: -4
        text: btn.glyph
        color: "#E6EDF3"
        font.pixelSize: 56
        font.weight: Font.Light
    }

    MouseArea { id: ma; anchors.fill: parent; onClicked: btn.tapped() }
}
