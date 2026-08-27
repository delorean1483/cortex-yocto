import QtQuick
import QtQuick.Layouts

// Segmented-control button: fills its cell, lights up with `accent` when active.
Rectangle {
    id: seg
    property string label: ""
    property bool   active: false
    property color  accent: "#00C49A"
    signal tapped()

    // Intrinsic size so the enclosing RowLayout gets a real height even when
    // fillHeight can't resolve it (attached Layout props on a component root).
    implicitWidth: 120
    implicitHeight: 64
    Layout.fillWidth: true
    Layout.fillHeight: true
    radius: 12
    color: active ? Qt.rgba(accent.r, accent.g, accent.b, 0.18)
                  : (ma.pressed ? "#233041" : "#1C2230")
    border.color: active ? accent : "#30363D"
    border.width: active ? 2 : 1

    Text {
        anchors.centerIn: parent
        text: seg.label
        color: seg.active ? seg.accent : "#C9D1D9"
        font.pixelSize: 20
        font.weight: seg.active ? Font.Bold : Font.Medium
        font.letterSpacing: 1
    }

    MouseArea { id: ma; anchors.fill: parent; onClicked: seg.tapped() }
}
