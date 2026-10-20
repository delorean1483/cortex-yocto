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
            RowLayout { Layout.fillWidth: true; Layout.preferredHeight: 60; spacing: 12
                Text { Layout.preferredWidth: 104; text: "Brightness"; color: Theme.text; font.pixelSize: Theme.fsBody + 2 }
                StepButton { icon: "minus"; w: 52; h: 52; fill: Theme.surface2; showBorder: false
                    onActivated: display.brightness = Math.max(10, display.brightness - 5) }
                Slider { id: bright
                    Layout.fillWidth: true; Layout.preferredHeight: 48
                    from: 10; to: 100; stepSize: 1; live: true
                    value: display.brightness
                    onMoved: display.brightness = value
                    background: Rectangle { x: bright.leftPadding; y: bright.topPadding + bright.availableHeight/2 - height/2
                        width: bright.availableWidth; height: 14; radius: 7; color: Theme.bg
                        Rectangle { width: bright.visualPosition * parent.width; height: parent.height; radius: 7; color: Theme.accent } }
                    handle: Rectangle { x: bright.leftPadding + bright.visualPosition * (bright.availableWidth - width)
                        y: bright.topPadding + bright.availableHeight/2 - height/2
                        implicitWidth: 36; implicitHeight: 36; radius: 18
                        color: Theme.text; border.width: 0 } }
                StepButton { icon: "plus"; w: 52; h: 52; fill: Theme.surface2; showBorder: false
                    onActivated: display.brightness = Math.min(100, display.brightness + 5) }
                Text { Layout.preferredWidth: 50; horizontalAlignment: Text.AlignRight
                    text: display.brightness + "%"; color: Theme.text; font.pixelSize: 18; font.weight: Font.DemiBold }
            }
            RowLayout { Layout.fillWidth: true; spacing: 12
                Text { Layout.preferredWidth: 104; text: "Sleep after"; color: Theme.text; font.pixelSize: Theme.fsBody + 2 }
                SegmentedControl { Layout.fillWidth: true; Layout.preferredHeight: 52
                    trackColor: Theme.bg
                    options: [ {label: "Never", value: 0}, {label: "1 min", value: 1}, {label: "5 min", value: 5},
                               {label: "10 min", value: 10}, {label: "30 min", value: 30} ]
                    current: display.sleepMinutes
                    onPicked: (value) => display.sleepMinutes = value }
            }
            Text { Layout.fillWidth: true; Layout.leftMargin: 116; Layout.bottomMargin: 4; wrapMode: Text.WordWrap
                text: "Dims 30 s before sleeping. Tap to wake. Stays on while a fault is active."
                color: Theme.textMute; font.pixelSize: Theme.fsCaption }
        }

        Rectangle { Layout.fillWidth: true; implicitHeight: 2 * 44 + 2 * 4
            radius: Theme.radius; color: Theme.surface
            ColumnLayout { anchors.fill: parent; anchors.leftMargin: Theme.pad; anchors.rightMargin: Theme.pad
                anchors.topMargin: 4; anchors.bottomMargin: 4; spacing: 0
                Repeater {
                    model: [ {k: "Firmware", v: devinfo.fwVersion}, {k: "Serial", v: devinfo.serial} ]
                    Item { Layout.fillWidth: true; Layout.preferredHeight: 44
                        Rectangle { visible: index > 0; width: parent.width; height: 1; color: Theme.border; opacity: 0.6 }
                        Text { anchors.left: parent.left; anchors.verticalCenter: parent.verticalCenter
                            text: modelData.k; color: Theme.textMute; font.pixelSize: 15 }
                        Text { anchors.right: parent.right; anchors.verticalCenter: parent.verticalCenter
                            text: modelData.v; color: Theme.text; font.pixelSize: 15; font.weight: Font.Medium }
                    }
                }
            }
        }
        Item { Layout.fillHeight: true }
    }
}
