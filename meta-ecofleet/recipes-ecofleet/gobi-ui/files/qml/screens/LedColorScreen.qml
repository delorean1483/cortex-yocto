import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
// External LED color: HSV wheel (hue = angle clockwise from 12 o'clock,
// saturation = distance from the center) plus a brightness slider. LedModel does
// the throttled sending and saving; the status line compares what the G0B1
// reports applied (telemetry.ledR/G/B) with what was asked for.
Item {
    id: page

    StackView.onRemoved: led.flush()

    function statusText() {
        if (telemetry.stale) return "G0B1 offline, will apply when it reconnects"
        if (!led.hasColor) return "Not set. Tap the wheel to choose a color"
        if (telemetry.ledPresent && !telemetry.ledOk) return "Light not responding"
        if (telemetry.ledR === led.r && telemetry.ledG === led.g && telemetry.ledB === led.b) return "Applied"
        return "Sending…"
    }

    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: Theme.gap
        ScreenHeader { title: "External LED Color"; onBack: if (page.StackView.view) page.StackView.view.pop() }

        RowLayout { Layout.fillWidth: true; Layout.fillHeight: true; spacing: 24
            // ---- wheel ----
            Item { id: wheel
                Layout.preferredWidth: 340; Layout.preferredHeight: 340
                Layout.alignment: Qt.AlignVCenter
                readonly property real rad: width / 2

                Canvas { id: disc; anchors.fill: parent
                    onWidthChanged: requestPaint()
                    onHeightChanged: requestPaint()
                    onPaint: {
                        var ctx = getContext("2d")
                        ctx.reset()
                        var c = width / 2
                        // 1-degree wedges; red (h = 0) is drawn at -90 deg, i.e. 12 o'clock,
                        // and hue runs clockwise. A hair of overlap hides the seams.
                        for (var h = 0; h < 360; h++) {
                            ctx.beginPath()
                            ctx.moveTo(c, c)
                            ctx.arc(c, c, c, (h - 90) * Math.PI / 180, (h - 88.5) * Math.PI / 180)
                            ctx.closePath()
                            ctx.fillStyle = "hsl(" + h + ",100%,50%)"
                            ctx.fill()
                        }
                        var g = ctx.createRadialGradient(c, c, 0, c, c, c)
                        g.addColorStop(0, "rgba(255,255,255,1)")
                        g.addColorStop(1, "rgba(255,255,255,0)")
                        ctx.fillStyle = g
                        ctx.beginPath(); ctx.arc(c, c, c, 0, 2 * Math.PI); ctx.fill()
                    }
                }
                // brightness dims the wheel
                Rectangle { anchors.fill: parent; radius: width / 2; color: "black"
                    opacity: 1 - led.brightness }

                Rectangle { id: marker
                    readonly property real a: led.hue * Math.PI / 180
                    x: wheel.rad + Math.sin(a) * led.saturation * wheel.rad - width / 2
                    y: wheel.rad - Math.cos(a) * led.saturation * wheel.rad - height / 2
                    width: 28; height: 28; radius: 14
                    color: "transparent"; border.width: 3; border.color: "white"
                    Rectangle { anchors.fill: parent; anchors.margins: -1; radius: width / 2
                        color: "transparent"; border.width: 1; border.color: "#80000000" }
                }

                MouseArea { id: wheelMouse; anchors.fill: parent
                    function pick(m) { led.pickAt(m.x - wheel.rad, m.y - wheel.rad, wheel.rad) }
                    onPressed: (m) => {
                        var dx = m.x - wheel.rad, dy = m.y - wheel.rad
                        if (dx * dx + dy * dy <= wheel.rad * wheel.rad) pick(m)
                        else m.accepted = false
                    }
                    onPositionChanged: (m) => { if (pressed) pick(m) }
                    onReleased: led.release()
                }
            }

            // ---- preview, brightness, status ----
            ColumnLayout { Layout.fillWidth: true; Layout.fillHeight: true; spacing: Theme.gap
                Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 96
                    radius: Theme.radius
                    color: Qt.rgba(led.r / 255, led.g / 255, led.b / 255, 1)
                    border.width: 1; border.color: Theme.border }

                Text { Layout.topMargin: 8; text: "Brightness"; color: Theme.text; font.pixelSize: Theme.fsBody }
                RowLayout { Layout.fillWidth: true; spacing: 12
                    Slider { id: bright
                        Layout.fillWidth: true; Layout.preferredHeight: 48
                        from: 0; to: 100; stepSize: 1; live: true
                        value: led.brightness * 100
                        onMoved: led.brightness = value / 100
                        onPressedChanged: if (!pressed) led.release()
                        background: Rectangle { x: bright.leftPadding; y: bright.topPadding + bright.availableHeight/2 - height/2
                            width: bright.availableWidth; height: 14; radius: 7; color: Theme.bg
                            Rectangle { width: bright.visualPosition * parent.width; height: parent.height; radius: 7; color: Theme.accent } }
                        handle: Rectangle { x: bright.leftPadding + bright.visualPosition * (bright.availableWidth - width)
                            y: bright.topPadding + bright.availableHeight/2 - height/2
                            implicitWidth: 36; implicitHeight: 36; radius: 18
                            color: Theme.text; border.width: 0 } }
                    Text { Layout.preferredWidth: 50; horizontalAlignment: Text.AlignRight
                        text: Math.round(led.brightness * 100) + "%"; color: Theme.text
                        font.pixelSize: 18; font.weight: Font.DemiBold }
                }

                Text { Layout.fillWidth: true; Layout.topMargin: 8; wrapMode: Text.WordWrap
                    text: page.statusText(); color: Theme.textDim; font.pixelSize: Theme.fsBody }
                Item { Layout.fillHeight: true }
            }
        }
    }
}
