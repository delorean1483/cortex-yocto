import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
Item {
    id: page

    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: 10

        ScreenHeader { title: "User Maintenance"; onBack: if (page.StackView.view) page.StackView.view.pop() }

        // nested layouts default to fillHeight — size the row to its cards instead
        RowLayout {
            Layout.fillWidth: true; Layout.fillHeight: false; spacing: Theme.gap
            InfoCard { Layout.fillWidth: true; Layout.preferredWidth: 1; Layout.alignment: Qt.AlignTop
                title: "Service hours"
                rows: [ {k: "Engine",  v: telemetry.engineHrs + " h"},
                        {k: "Machine", v: telemetry.machineHrs + " h"},
                        {k: "Serial",  v: devinfo.serial} ] }
            // Engine oil + hold-to-reset
            InfoCard { Layout.fillWidth: true; Layout.preferredWidth: 1; Layout.alignment: Qt.AlignTop
                title: "Engine oil"
                rows: [ {k: "Since last change", v: telemetry.oilHrs + " h"},
                        {k: "Status", v: StatusLabels.title(telemetry.oilChange),
                         hue: telemetry.oilChange === "good" ? Theme.ok : Theme.warn} ]
                Item { Layout.preferredHeight: 4 }
                Rectangle {
                    id: oilBtn
                    Layout.fillWidth: true; Layout.preferredHeight: 48
                    radius: Theme.radiusSm; color: Theme.bg; border.color: Theme.border; border.width: 1
                    clip: true
                    property bool done: false
                    Rectangle {
                        id: holdFill
                        height: parent.height; radius: parent.radius; width: 0
                        color: Theme.tint(Theme.warn, 0.22)
                        Behavior on width { NumberAnimation { duration: 1500; easing.type: Easing.Linear } }
                    }
                    Text { anchors.centerIn: parent
                           text: oilBtn.done ? "OIL TIMER RESET" : "HOLD TO RESET OIL TIMER"
                           color: oilBtn.done ? Theme.ok : Theme.warn
                           font.pixelSize: 13; font.weight: Font.DemiBold; font.letterSpacing: 1 }
                    Timer { id: oilHold; interval: 1500
                            onTriggered: { telemetry.resetOil(); oilBtn.done = true; oilClear.restart() } }
                    Timer { id: oilClear; interval: 2500; onTriggered: oilBtn.done = false }
                    MouseArea {
                        anchors.fill: parent
                        onPressed:  { oilBtn.done = false; oilHold.restart(); holdFill.width = oilBtn.width }
                        onReleased: { oilHold.stop(); holdFill.width = 0 }
                    }
                }
            }
        }

        Item { Layout.fillHeight: true }
    }
}
