import QtQuick
import QtQuick.Layouts

/* Full-width forecast band shown above the climate controls. Reads the
 * `weather` context model (WeatherModel). The parent is expected to bind
 * visibility to weather.valid so the band disappears when no forecast exists. */
Rectangle {
    id: strip
    radius: 12
    color: "#161B22"
    border.color: "#21262D"
    border.width: 1

    // Grey the whole band out when the forecast has gone stale.
    opacity: weather.stale ? 0.45 : 1.0
    Behavior on opacity { NumberAnimation { duration: 200 } }

    RowLayout {
        anchors.fill: parent
        anchors.margins: 4
        spacing: 4

        Repeater {
            model: weather.days

            delegate: Item {
                Layout.fillWidth: true
                Layout.fillHeight: true

                // Faint divider between cards (not before the first)
                Rectangle {
                    visible: index > 0
                    anchors.left: parent.left
                    anchors.verticalCenter: parent.verticalCenter
                    width: 1; height: parent.height * 0.6
                    color: "#21262D"
                }

                ColumnLayout {
                    anchors.centerIn: parent
                    spacing: 1

                    Text {
                        Layout.alignment: Qt.AlignHCenter
                        text: modelData.label || ""
                        color: "#8B949E"
                        font.pixelSize: 12
                        font.weight: Font.Medium
                    }

                    WeatherIcon {
                        Layout.alignment: Qt.AlignHCenter
                        cat: modelData.cat || "unknown"
                        dim: 20
                    }

                    RowLayout {
                        Layout.alignment: Qt.AlignHCenter
                        spacing: 4
                        Text {
                            text: (modelData.hi !== undefined ? modelData.hi : "--") + "°"
                            color: "#C9D1D9"
                            font.pixelSize: 13
                            font.weight: Font.Bold
                        }
                        Text {
                            text: (modelData.lo !== undefined ? modelData.lo : "--") + "°"
                            color: "#6E7681"
                            font.pixelSize: 12
                        }
                    }

                    Text {
                        Layout.alignment: Qt.AlignHCenter
                        visible: (modelData.precip || 0) > 0
                        text: (modelData.precip || 0) + "%"
                        color: "#58A6FF"
                        font.pixelSize: 10
                    }
                }
            }
        }
    }
}
