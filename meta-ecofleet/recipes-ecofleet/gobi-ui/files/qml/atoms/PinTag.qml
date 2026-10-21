import QtQuick
import ".."
// Neutral "PIN" badge for PIN-gated rows. Callers anchor it (top-right, 10px inset).
Rectangle {
    implicitWidth: lbl.implicitWidth + 12; implicitHeight: lbl.implicitHeight + 4
    radius: 5; color: Theme.surface2
    Text {
        id: lbl; anchors.centerIn: parent; text: "PIN"; color: Theme.textDim
        font.pixelSize: 12; font.weight: Font.Bold; font.letterSpacing: 0.8
    }
}
