import QtQuick
import QtQuick.Layouts
import ".."
// On-screen text keyboard for passwords and network names. Types into
// `target` (any item with text/cursorPosition, e.g. TextField). Letters page
// with Shift (one-shot; double-tap locks), numbers/symbols page, space,
// backspace, Done. Keys ~60x52 for gloved fingers.
Rectangle {
    id: kb
    property Item target: null
    property bool shift: false
    property bool caps: false
    property bool symbols: false
    signal done()
    color: Theme.bg
    implicitHeight: 4 * 52 + 3 * 6 + 12

    readonly property var letters: [ "qwertyuiop", "asdfghjkl", "zxcvbnm" ]
    readonly property var syms:    [ "1234567890", "-/:;()$&@\"", ".,?!'#%*+=" , "_\\|~<>[]{}^`" ]

    function insert(s) {
        if (!target) return
        const t = target.text, p = target.cursorPosition
        target.text = t.slice(0, p) + s + t.slice(p)
        target.cursorPosition = p + s.length
        if (shift && !caps) shift = false
    }
    function backspace() {
        if (!target || target.cursorPosition === 0) return
        const t = target.text, p = target.cursorPosition
        target.text = t.slice(0, p - 1) + t.slice(p)
        target.cursorPosition = p - 1
    }

    component Key: Rectangle {
        property string label: ""
        property string glyph: ""
        property real units: 1
        property bool accent: false
        signal tapped()
        Layout.preferredWidth: 58 * units + 6 * (units - 1); Layout.preferredHeight: 52
        radius: Theme.radiusSm
        color: ka.pressed ? Theme.surface2 : (accent ? Theme.accent : Theme.surface)
        border.color: Theme.border; border.width: accent ? 0 : 1
        Text { visible: parent.glyph === ""; anchors.centerIn: parent; text: parent.label
            color: parent.accent ? Theme.textOnAccent : Theme.text
            font.pixelSize: parent.label.length > 1 ? Theme.fsLabel + 1 : 22; font.weight: Font.Medium }
        Icon { visible: parent.glyph !== ""; anchors.centerIn: parent; name: parent.glyph; size: 24; color: Theme.textDim }
        MouseArea { id: ka; anchors.fill: parent; onClicked: parent.tapped() }
    }

    ColumnLayout {
        anchors.centerIn: parent; spacing: 6
        Repeater {
            model: kb.symbols ? kb.syms.slice(0, 3) : kb.letters
            RowLayout { Layout.alignment: Qt.AlignHCenter; spacing: 6
                Key { visible: !kb.symbols && index === 2; glyph: ""; label: kb.caps ? "⇪" : "⇧"; units: 1.5
                      accent: kb.shift
                      onTapped: { if (kb.shift && !kb.caps) kb.caps = true; else { kb.caps = false; kb.shift = !kb.shift } } }
                Repeater { model: modelData.split("")
                    Key { label: (kb.shift && !kb.symbols) ? modelData.toUpperCase() : modelData
                          onTapped: kb.insert(label) } }
                Key { visible: index === 2; glyph: "backspace"; units: 1.5; onTapped: kb.backspace() }
            }
        }
        RowLayout { visible: kb.symbols; Layout.alignment: Qt.AlignHCenter; spacing: 6
            Repeater { model: kb.syms[3].split("")
                Key { label: modelData; onTapped: kb.insert(modelData) } } }
        RowLayout { Layout.alignment: Qt.AlignHCenter; spacing: 6
            Key { label: kb.symbols ? "ABC" : "123"; units: 1.5; onTapped: kb.symbols = !kb.symbols }
            Key { label: "space"; units: 5; onTapped: kb.insert(" ") }
            Key { label: "Done"; units: 2; accent: true; onTapped: kb.done() }
        }
    }
}
