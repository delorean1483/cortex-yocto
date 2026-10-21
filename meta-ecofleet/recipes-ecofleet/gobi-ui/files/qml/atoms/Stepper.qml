import QtQuick
import QtQuick.Layouts
import ".."
// [ − ]  value  [ + ]  — the one stepper used for every adjustable number.
RowLayout {
    id: st
    property string text: ""
    property color textColor: Theme.text
    property int textSize: Theme.fsHero
    property int textWidth: 88
    signal decrement()
    signal increment()
    property int buttonW: Theme.touch + 4
    property int buttonH: Theme.touch
    property color buttonFill: Theme.surface
    property bool buttonBorder: true
    property int buttonRadius: Theme.radius
    property int iconSize: 22
    property real iconStroke: 2.4
    property real textLetterSpacing: 0
    spacing: 8
    StepButton { icon: "minus"; w: st.buttonW; h: st.buttonH; fill: st.buttonFill; showBorder: st.buttonBorder; radius: st.buttonRadius; iconSize: st.iconSize; iconStroke: st.iconStroke; onActivated: st.decrement() }
    Text {
        Layout.preferredWidth: st.textWidth
        horizontalAlignment: Text.AlignHCenter
        text: st.text; color: st.textColor
        font.pixelSize: st.textSize; font.letterSpacing: st.textLetterSpacing; font.weight: Font.DemiBold
    }
    StepButton { icon: "plus"; w: st.buttonW; h: st.buttonH; fill: st.buttonFill; showBorder: st.buttonBorder; radius: st.buttonRadius; iconSize: st.iconSize; iconStroke: st.iconStroke; onActivated: st.increment() }
}
