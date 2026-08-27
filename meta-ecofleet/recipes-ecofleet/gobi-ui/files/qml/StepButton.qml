import QtQuick
import QtQuick.Layouts

// Square +/- stepper for gloved-finger taps (sized for the 800x480 panel).
Rectangle {
    id: btn
    property string glyph: "+"
    property int    side: 56
    signal tapped()

    implicitWidth: side
    implicitHeight: side
    Layout.preferredWidth: side
    Layout.preferredHeight: side
    radius: 14
    color: ma.pressed ? "#233041" : "#1C2230"
    border.color: "#30363D"; border.width: 1
    scale: ma.pressed ? 0.94 : 1.0
    Behavior on scale { NumberAnimation { duration: 80 } }

    Text {
        anchors.centerIn: parent
        anchors.verticalCenterOffset: -3
        text: btn.glyph
        color: "#E6EDF3"
        font.pixelSize: 34
        font.weight: Font.Light
    }

    MouseArea { id: ma; anchors.fill: parent; onClicked: btn.tapped() }
}
