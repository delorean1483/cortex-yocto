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
    spacing: 8
    StepButton { icon: "minus"; onActivated: st.decrement() }
    Text {
        Layout.preferredWidth: st.textWidth
        horizontalAlignment: Text.AlignHCenter
        text: st.text; color: st.textColor
        font.pixelSize: st.textSize; font.weight: Font.DemiBold
    }
    StepButton { icon: "plus"; onActivated: st.increment() }
}
