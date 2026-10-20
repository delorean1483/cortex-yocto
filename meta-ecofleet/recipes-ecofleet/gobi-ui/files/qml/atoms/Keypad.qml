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
    // Layout knobs; defaults are the original look (ComponentTest / ScreenLock callers).
    property int keyW: 84
    property int keyH: 56
    property color keyFill: Theme.surface
    property bool showBorder: true
    property color backFill: keyFill
    property int digitSize: 26
    property int dotSize: 14
    property int dotSpacing: 16
    property bool dotFilledStyle: false   // true: filled discs (hue entered / border empty), no ring
    signal entered(string code)
    spacing: 16

    // One-shot wrong-PIN shake of the dot row: +-8 px, 3 cycles, 300 ms total.
    function shake() { shakeAnim.restart() }

    function press(d) {
        if (code.length >= length) return
        code += d
        if (code.length === length) { var c = code; code = ""; kp.entered(c) }
    }
    function back() { if (code.length > 0) code = code.slice(0, -1) }

    Row {
        id: dotRow
        Layout.alignment: Qt.AlignHCenter; spacing: kp.dotSpacing
        property real shakeX: 0
        transform: Translate { x: dotRow.shakeX }
        SequentialAnimation {
            id: shakeAnim
            loops: 3
            NumberAnimation { target: dotRow; property: "shakeX"; to: 8;  duration: 25 }
            NumberAnimation { target: dotRow; property: "shakeX"; to: -8; duration: 50 }
            NumberAnimation { target: dotRow; property: "shakeX"; to: 0;  duration: 25 }
        }
        Repeater { model: kp.length
            Rectangle { width: kp.dotSize; height: kp.dotSize; radius: kp.dotSize / 2
                border.color: kp.hue; border.width: kp.dotFilledStyle ? 0 : 2
                color: index < kp.code.length ? kp.hue
                       : (kp.dotFilledStyle ? Theme.border : "transparent") } }
    }

    GridLayout {
        Layout.alignment: Qt.AlignHCenter
        columns: 3; rowSpacing: 10; columnSpacing: 10
        Repeater {
            model: ["1","2","3","4","5","6","7","8","9","","0","back"]
            Rectangle {
                Layout.preferredWidth: kp.keyW; Layout.preferredHeight: kp.keyH; radius: Theme.radius
                // the blank key keeps its grid cell (invisible items are dropped
                // from layouts, which would shift 0 and ⌫ one column left)
                opacity: modelData === "" ? 0 : 1
                color: kma.pressed ? Theme.surface2 : (modelData === "back" ? kp.backFill : kp.keyFill)
                border.color: Theme.border; border.width: kp.showBorder ? 1 : 0
                Text { visible: modelData !== "back"; anchors.centerIn: parent
                    text: modelData; color: Theme.text; font.pixelSize: kp.digitSize; font.weight: Font.Medium }
                Icon { visible: modelData === "back"; anchors.centerIn: parent
                    name: "backspace"; size: kp.digitSize; color: Theme.textDim }
                MouseArea { id: kma; anchors.fill: parent; enabled: modelData !== ""
                    onClicked: modelData === "back" ? kp.back() : kp.press(modelData) }
            }
        }
    }
}
