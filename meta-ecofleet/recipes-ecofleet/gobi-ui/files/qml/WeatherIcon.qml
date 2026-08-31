import QtQuick

/* Tiny vector weather glyph drawn on a Canvas, keyed by the coarse category
 * slug the fetcher emits ("clear","partly","cloudy","fog","rain","snow",
 * "storm","unknown"). Vector-drawn so there are no PNG assets to ship or scale. */
Canvas {
    id: root
    property string cat: "unknown"
    property real   dim: 26
    width: dim
    height: dim
    onCatChanged: requestPaint()
    onWidthChanged: requestPaint()

    readonly property color cSun:   "#F0B429"
    readonly property color cCloud: "#C9D1D9"
    readonly property color cRain:  "#58A6FF"
    readonly property color cMuted: "#8B949E"

    onPaint: {
        var ctx = getContext("2d")
        ctx.reset()
        var s = Math.min(width, height)
        ctx.lineWidth = Math.max(1.5, s * 0.07)
        ctx.lineCap = "round"
        ctx.lineJoin = "round"

        function drawSun(cx, cy, r) {
            ctx.strokeStyle = root.cSun
            ctx.fillStyle = root.cSun
            for (var i = 0; i < 8; i++) {
                var a = i * Math.PI / 4
                ctx.beginPath()
                ctx.moveTo(cx + Math.cos(a) * r * 1.5, cy + Math.sin(a) * r * 1.5)
                ctx.lineTo(cx + Math.cos(a) * r * 2.15, cy + Math.sin(a) * r * 2.15)
                ctx.stroke()
            }
            ctx.beginPath()
            ctx.arc(cx, cy, r, 0, 2 * Math.PI)
            ctx.fill()
        }

        function drawCloud(cx, cy, w, color) {
            ctx.fillStyle = color
            var r = w * 0.22
            ctx.beginPath(); ctx.arc(cx - r * 1.1, cy, r, 0, 2 * Math.PI); ctx.fill()
            ctx.beginPath(); ctx.arc(cx + r * 1.0, cy, r * 0.95, 0, 2 * Math.PI); ctx.fill()
            ctx.beginPath(); ctx.arc(cx, cy - r * 0.75, r * 1.2, 0, 2 * Math.PI); ctx.fill()
            ctx.beginPath(); ctx.rect(cx - r * 1.9, cy - r * 0.15, r * 3.8, r * 1.15); ctx.fill()
        }

        function drawDrops(cx, cy, color) {
            ctx.strokeStyle = color
            for (var i = -1; i <= 1; i++) {
                var x = cx + i * s * 0.16
                ctx.beginPath()
                ctx.moveTo(x, cy)
                ctx.lineTo(x - s * 0.05, cy + s * 0.14)
                ctx.stroke()
            }
        }

        function drawFlakes(cx, cy, color) {
            ctx.fillStyle = color
            for (var i = -1; i <= 1; i++) {
                var x = cx + i * s * 0.16
                ctx.beginPath()
                ctx.arc(x, cy + s * 0.06, Math.max(1.3, s * 0.05), 0, 2 * Math.PI)
                ctx.fill()
            }
        }

        function drawBolt(cx, cy) {
            ctx.fillStyle = root.cSun
            ctx.beginPath()
            ctx.moveTo(cx + s * 0.04, cy - s * 0.02)
            ctx.lineTo(cx - s * 0.08, cy + s * 0.14)
            ctx.lineTo(cx - s * 0.01, cy + s * 0.14)
            ctx.lineTo(cx - s * 0.06, cy + s * 0.28)
            ctx.lineTo(cx + s * 0.10, cy + s * 0.08)
            ctx.lineTo(cx + s * 0.02, cy + s * 0.08)
            ctx.closePath()
            ctx.fill()
        }

        var cx = s / 2
        switch (cat) {
        case "clear":
            drawSun(cx, s * 0.5, s * 0.18)
            break
        case "partly":
            drawSun(s * 0.36, s * 0.36, s * 0.14)
            drawCloud(cx + s * 0.06, s * 0.6, s * 0.9, root.cCloud)
            break
        case "cloudy":
            drawCloud(cx, s * 0.5, s, root.cCloud)
            break
        case "fog":
            drawCloud(cx, s * 0.38, s * 0.9, root.cMuted)
            ctx.strokeStyle = root.cMuted
            for (var k = 0; k < 3; k++) {
                var y = s * 0.66 + k * s * 0.12
                ctx.beginPath()
                ctx.moveTo(s * 0.22, y)
                ctx.lineTo(s * 0.78, y)
                ctx.stroke()
            }
            break
        case "rain":
            drawCloud(cx, s * 0.42, s, root.cCloud)
            drawDrops(cx, s * 0.68, root.cRain)
            break
        case "snow":
            drawCloud(cx, s * 0.42, s, root.cCloud)
            drawFlakes(cx, s * 0.66, root.cCloud)
            break
        case "storm":
            drawCloud(cx, s * 0.4, s, root.cCloud)
            drawBolt(cx, s * 0.5)
            break
        default:
            ctx.strokeStyle = root.cMuted
            ctx.beginPath()
            ctx.moveTo(s * 0.32, s * 0.5)
            ctx.lineTo(s * 0.68, s * 0.5)
            ctx.stroke()
            break
        }
    }
}
