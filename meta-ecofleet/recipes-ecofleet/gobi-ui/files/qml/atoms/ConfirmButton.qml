import QtQuick
import QtQuick.Layouts
import ".."
// Two-tap destructive button for gloved hands: the first tap arms it ("Tap
// again to forget", filled red) for `armMs`; a second tap while armed emits
// confirmed(). No dialog to dismiss; it disarms on its own.
Rectangle {
    id: cb
    property string label: "Forget"
    property string confirmLabel: "Tap again to forget"
    property int armMs: 3000
    property color tone: Theme.fault   // fault red for destructive actions; accent for e.g. Install
    property bool armed: false
    property bool filled: false        // solid tone fill when idle, text on accent
    property int fontSize: Theme.fsLabel + 1
    signal confirmed()

    Layout.preferredWidth: armed ? 168 : 96
    Layout.preferredHeight: 38
    radius: Theme.radiusSm
    color: filled ? (armed ? Qt.darker(cb.tone, 1.15) : cb.tone)
                  : (armed ? cb.tone : (ma.pressed ? Theme.surface2 : "transparent"))
    border.color: cb.tone
    border.width: filled ? 0 : 1
    Behavior on Layout.preferredWidth { NumberAnimation { duration: 120 } }

    Text { anchors.centerIn: parent; text: cb.armed ? cb.confirmLabel : cb.label
        color: cb.filled ? Theme.textOnAccent : (cb.armed ? Theme.text : cb.tone)
        font.pixelSize: cb.fontSize; font.weight: Font.DemiBold }

    Timer { id: disarm; interval: cb.armMs; onTriggered: cb.armed = false }
    MouseArea { id: ma; anchors.fill: parent
        onClicked: {
            if (cb.armed) { cb.armed = false; disarm.stop(); cb.confirmed() }
            else { cb.armed = true; disarm.restart() }
        } }
}
