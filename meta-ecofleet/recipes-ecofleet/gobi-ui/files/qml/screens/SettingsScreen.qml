import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
Item {
    id: page
    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: Theme.gap
        ScreenHeader { title: "Settings"; onBack: if (page.StackView.view) page.StackView.view.pop() }

        // Display: brightness applies live (DisplayModel writes the backlight and
        // saves after the drag settles); sleep = dim for 30 s, then backlight off.
        InfoCard { Layout.fillWidth: true
            title: "Display"
            RowLayout { Layout.fillWidth: true; Layout.preferredHeight: 48; spacing: 14
                Text { Layout.preferredWidth: 110; text: "Brightness"; color: Theme.textMute; font.pixelSize: Theme.fsLabel + 1 }
                Slider { id: bright
                    Layout.fillWidth: true; Layout.preferredHeight: 40
                    from: 10; to: 100; stepSize: 1; live: true
                    value: display.brightness
                    onMoved: display.brightness = value
                    background: Rectangle { x: bright.leftPadding; y: bright.topPadding + bright.availableHeight/2 - height/2
                        width: bright.availableWidth; height: 10; radius: 5; color: Theme.surface2
                        Rectangle { width: bright.visualPosition * parent.width; height: parent.height; radius: 5; color: Theme.accent } }
                    handle: Rectangle { x: bright.leftPadding + bright.visualPosition * (bright.availableWidth - width)
                        y: bright.topPadding + bright.availableHeight/2 - height/2
                        implicitWidth: 30; implicitHeight: 30; radius: 15
                        color: bright.pressed ? Theme.accent : Theme.text; border.color: Theme.accent; border.width: 3 } }
                Text { Layout.preferredWidth: 52; horizontalAlignment: Text.AlignRight
                    text: display.brightness + "%"; color: Theme.text; font.pixelSize: Theme.fsBody; font.weight: Font.DemiBold }
            }
            RowLayout { Layout.fillWidth: true; spacing: 14
                Text { Layout.preferredWidth: 110; text: "Sleep after"; color: Theme.textMute; font.pixelSize: Theme.fsLabel + 1 }
                SegmentedControl { Layout.fillWidth: true
                    options: [ {label: "Never", value: 0}, {label: "1 min", value: 1}, {label: "5 min", value: 5},
                               {label: "10 min", value: 10}, {label: "30 min", value: 30} ]
                    current: display.sleepMinutes
                    onPicked: (value) => display.sleepMinutes = value }
            }
            Text { Layout.fillWidth: true; Layout.bottomMargin: 4; wrapMode: Text.WordWrap
                text: "The screen dims 30 seconds before it sleeps. Tap to wake. It stays on while a fault is active."
                color: Theme.textMute; font.pixelSize: Theme.fsCaption }
        }

        InfoCard { Layout.fillWidth: true
            title: "About this unit"
            rows: [ {k: "Firmware", v: devinfo.fwVersion},
                    {k: "Serial",   v: devinfo.serial},
                    {k: "Hostname", v: devinfo.hostname} ] }
        Item { Layout.fillHeight: true }
    }
}
