pragma Singleton
import QtQuick
// Design tokens for the 800x480 cab panel.
//
// Colour: the panel lifts blacks and adds a strong blue cast, so near-black
// steps that differ by a few percent collapse into one flat blue. Surfaces are
// spaced ~8% apart in lightness so cards, controls and background stay distinct
// on the real glass, and state is shown with fills rather than hairlines.
// `accent` is the ONE interactive/selected colour; ok/warn/fault/info are
// status-only and never mark a selection.
QtObject {
    // ── surfaces ──
    readonly property color bg:        "#0E1116"
    readonly property color surface:   "#1A1F27"   // cards, idle controls
    readonly property color surface2:  "#262C36"   // pressed / raised / segment track
    readonly property color border:    "#363E4A"
    // ── text ──
    readonly property color text:      "#F0F3F6"
    readonly property color textDim:   "#C9D1D9"
    readonly property color textMute:  "#9AA4B0"   // labels; ≥6:1 on surface
    readonly property color textLabel: "#9AA4B0"
    readonly property color textOnAccent: "#04221B"   // text on an accent fill
    // ── interactive ──
    readonly property color accent:    "#00C49A"
    // ── status ──
    readonly property color info:      "#58A6FF"
    readonly property color accentBlue: info       // legacy alias: status/info only
    readonly property color ok:        "#3FB950"
    readonly property color warn:      "#E3B341"
    readonly property color fault:     "#F85149"
    function tint(c, a) { return Qt.rgba(c.r, c.g, c.b, a) }

    // ── type scale (px on the 800x480 canvas) ──
    readonly property int fsDisplay: 112   // the one hero reading per screen
    readonly property int fsHero:    44    // secondary big value (setpoints)
    readonly property int fsTitle:   20    // screen titles, card headlines
    readonly property int fsBody:    16    // buttons, values, paragraphs
    readonly property int fsLabel:   13    // field labels, secondary values
    readonly property int fsCaption: 12    // smallest text anywhere in the UI
    readonly property real lsCaps:   1.2   // letter-spacing for ALL-CAPS labels

    // ── shape & rhythm ──
    readonly property int radiusSm: 8
    readonly property int radius:   12
    readonly property int radiusLg: 16
    readonly property int pad:      16     // screen edge padding
    readonly property int gap:      12     // between cards / controls
    readonly property int touch:    48     // minimum touch target
}
