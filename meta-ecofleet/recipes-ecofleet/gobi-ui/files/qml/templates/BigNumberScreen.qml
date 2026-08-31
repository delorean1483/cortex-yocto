import QtQuick
import QtQuick.Layouts
import ".."
import "../atoms"
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

    ColumnLayout {
        anchors.fill: parent; anchors.margins: 16; spacing: 10
        FaultBanner { Layout.fillWidth: true; text: scr.faultText; onClicked: scr.faultTapped() }
        Item { Layout.fillWidth: true; Layout.fillHeight: true
            RowLayout {
                anchors.centerIn: parent; spacing: 16
                Text { text: scr.value; color: scr.valueColor; font.pixelSize: 140; font.weight: Font.Light }
                ColumnLayout {
                    visible: scr.showSteppers; spacing: 8
                    Repeater { model: [{t:"▲",inc:true},{t:"▼",inc:false}]
                        Rectangle { Layout.preferredWidth: 56; Layout.preferredHeight: 44; radius: 10
                            color: ma.pressed ? Theme.surface2 : Theme.surface; border.color: Theme.border; border.width: 1
                            Text { anchors.centerIn: parent; text: modelData.t; color: Theme.accentBlue; font.pixelSize: 20 }
                            MouseArea { id: ma; anchors.fill: parent
                                onClicked: modelData.inc ? scr.incremented() : scr.decremented() } } }
                }
                Text { text: scr.statusText; color: Theme.textDim; font.pixelSize: 20; Layout.alignment: Qt.AlignVCenter }
            }
        }
        StatusPill { Layout.alignment: Qt.AlignHCenter; label: scr.pillText; hue: scr.pillHue; visible: scr.pillText !== "" }
        RowLayout {
            Layout.fillWidth: true; Layout.preferredHeight: 64; spacing: 10; visible: scr.footerStats.length > 0
            Repeater { model: scr.footerStats
                StatCard { Layout.fillWidth: true; Layout.fillHeight: true
                    label: modelData.label; value: modelData.value } }
        }
    }
}
