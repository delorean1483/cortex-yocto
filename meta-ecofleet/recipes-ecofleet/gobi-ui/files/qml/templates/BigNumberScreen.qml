import QtQuick
import QtQuick.Layouts
import ".."
import "../atoms"
// One oversized value, optional steppers + status, a status pill, and a footer
// row of stat cards. Laid out with explicit anchors (footer pinned bottom, pill
// above it, value centered in the remaining space) so the big number can never
// overflow into the header.
Item {
    id: scr
    property string value: ""
    property color valueColor: Theme.text
    property bool showSteppers: false
    property string statusText: ""
    property string pillText: ""
    property color pillHue: Theme.accent
    property string faultText: ""
    property var footerStats: []
    signal incremented(); signal decremented(); signal faultTapped()

    FaultBanner {
        id: fault
        anchors.top: parent.top; anchors.left: parent.left; anchors.right: parent.right
        anchors.topMargin: 14; anchors.leftMargin: 16; anchors.rightMargin: 16
        text: scr.faultText; onClicked: scr.faultTapped()
    }

    // Footer stat cards, pinned to the bottom
    RowLayout {
        id: footer
        anchors.bottom: parent.bottom; anchors.left: parent.left; anchors.right: parent.right
        anchors.bottomMargin: 16; anchors.leftMargin: 16; anchors.rightMargin: 16
        height: 72
        visible: scr.footerStats.length > 0
        spacing: 10
        Repeater { model: scr.footerStats
            StatCard { Layout.fillWidth: true; Layout.fillHeight: true
                label: modelData.label; value: modelData.value } }
    }

    // Status pill, just above the footer
    StatusPill {
        id: pill
        visible: scr.pillText !== ""
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottom: footer.visible ? footer.top : parent.bottom
        anchors.bottomMargin: footer.visible ? 14 : 22
        label: scr.pillText; hue: scr.pillHue
    }

    // Big value + optional steppers + status, centered in the space that's left
    Item {
        anchors.top: fault.visible ? fault.bottom : parent.top
        anchors.topMargin: fault.visible ? 8 : 8
        anchors.bottom: pill.visible ? pill.top : (footer.visible ? footer.top : parent.bottom)
        anchors.bottomMargin: 8
        anchors.left: parent.left; anchors.right: parent.right
        anchors.leftMargin: 16; anchors.rightMargin: 16

        RowLayout {
            anchors.centerIn: parent; spacing: 16
            Text { text: scr.value; color: scr.valueColor; font.pixelSize: 120; font.weight: Font.Light }
            ColumnLayout {
                visible: scr.showSteppers; spacing: 8
                Repeater { model: [{t:"▲",inc:true},{t:"▼",inc:false}]
                    Rectangle { Layout.preferredWidth: 56; Layout.preferredHeight: 44; radius: 10
                        color: ma.pressed ? Theme.surface2 : Theme.surface; border.color: Theme.border; border.width: 1
                        Text { anchors.centerIn: parent; text: modelData.t; color: Theme.accentBlue; font.pixelSize: 20 }
                        MouseArea { id: ma; anchors.fill: parent
                            onClicked: modelData.inc ? scr.incremented() : scr.decremented() } } }
            }
            Text { text: scr.statusText; color: Theme.textDim; font.pixelSize: 18
                   Layout.alignment: Qt.AlignVCenter; Layout.maximumWidth: 200; wrapMode: Text.WordWrap }
        }
    }
}
