import QtQuick
import QtQuick.Shapes
import ".."
// Single-stroke line icons (24x24 viewBox, Feather-style) drawn with QtQuick.Shapes
// so they stay crisp at any ScaleRoot scale. `name` selects the glyph.
Item {
    id: ic
    property string name: ""
    property color color: Theme.textMute
    property real size: 28
    property real stroke: 2
    implicitWidth: size; implicitHeight: size

    readonly property var _paths: ({
        "home":    "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10",
        "mode":    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 12V6 M12 12h.01",
        "battery": "M3 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z M23 13v-2 M5 10v4",
        "menu":    "M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z",
        "diag":    "M22 12h-4l-3 9L9 3l-3 9H2",
        "wrench":  "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
        "info":    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 16v-4 M12 8h.01",
        "bell":    "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0",
        "list":    "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
        "settings":"M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
        "cloud":   "M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 .26-10z",
        "lock":    "M4 11h16v11H4z M7 11V7a5 5 0 0 1 10 0v4",
        "cpu":     "M6 4h12v16H6z M9 9h6v6H9z M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3",
        "support": "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M4.93 4.93l4.24 4.24M14.83 14.83l4.24 4.24M14.83 9.17l4.24-4.24M4.93 19.07l4.24-4.24",
        "backspace":"M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z M18 9l-6 6 M12 9l6 6"
    })

    // 24x24 art scaled up to `size`, top-left anchored.
    Item {
        width: 24; height: 24
        anchors.centerIn: parent
        scale: ic.size / 24
        Shape {
            anchors.fill: parent
            ShapePath {
                strokeColor: ic.color
                strokeWidth: ic.stroke
                fillColor: "transparent"
                capStyle: ShapePath.RoundCap
                joinStyle: ShapePath.RoundJoin
                PathSvg { path: ic._paths[ic.name] !== undefined ? ic._paths[ic.name] : "" }
            }
        }
    }
}
