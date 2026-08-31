import QtQuick
import QtQuick.Layouts
import ".."
// PIN keypad: dot indicator + 0-9 + backspace. Emits entered(code) when `length`
// digits are collected, then clears. `hue` tints the filled dots.
ColumnLayout {
    id: kp
    property int length: 4
    property color hue: Theme.accent
    property string code: ""
    signal entered(string code)
    spacing: 16

    function press(d) {
        if (code.length >= length) return
        code += d
        if (code.length === length) { var c = code; code = ""; kp.entered(c) }
    }
    function back() { if (code.length > 0) code = code.slice(0, -1) }

    Row {
        Layout.alignment: Qt.AlignHCenter; spacing: 16
        Repeater { model: kp.length
            Rectangle { width: 16; height: 16; radius: 8
                border.color: kp.hue; border.width: 2
                color: index < kp.code.length ? kp.hue : "transparent" } }
    }

    GridLayout {
        Layout.alignment: Qt.AlignHCenter
        columns: 3; rowSpacing: 12; columnSpacing: 12
        Repeater {
            model: ["1","2","3","4","5","6","7","8","9","","0","back"]
            Rectangle {
                Layout.preferredWidth: 76; Layout.preferredHeight: 56; radius: 12
                visible: modelData !== ""
                color: modelData === "" ? "transparent" : (kma.pressed ? Theme.surface2 : Theme.surface)
                border.color: Theme.border; border.width: modelData === "" ? 0 : 1
                Text { anchors.centerIn: parent
                    text: modelData === "back" ? "⌫" : modelData
                    color: Theme.text; font.pixelSize: modelData === "back" ? 22 : 24 }
                MouseArea { id: kma; anchors.fill: parent; enabled: modelData !== ""
                    onClicked: modelData === "back" ? kp.back() : kp.press(modelData) }
            }
        }
    }
}
