import QtQuick
import ".."
// Renders the build-time boot images from SplashArt.qml so psplash and the
// Weston background match gobi-ui's splash exactly. Run with runner/ (see
// runner/README.md), then copy the PNGs from <out dir> to:
//   psplash-ecofleet.png, psplash-ecofleet-bar.png → meta-ecofleet/recipes-core/psplash/files/
//   ecofleet-boot-bg.png                           → meta-ecofleet/recipes-graphics/wayland/files/
Item {
    id: root
    width: 800; height: 480

    // psplash draws this full-frame image, then its own bar image + fill on top
    SplashArt { id: frame; width: 800; height: 480; showTrack: false }
    // psplash bar image: the empty track on the background (psplash doesn't
    // alpha-blend, so corners are baked onto the background colour)
    Rectangle { id: bar; y: 480; width: 240; height: 12; color: Theme.bg
        Rectangle { anchors.fill: parent; radius: 6; color: Theme.surface2 } }
    // Weston background while gobi-ui starts: frame + bar at gobi-ui's start fill
    SplashArt { id: westonBg; y: 492; width: 800; height: 480; progress: 0.6 }

    property var jobs: [ [frame, "psplash-ecofleet.png"], [bar, "psplash-ecofleet-bar.png"],
                         [westonBg, "ecofleet-boot-bg.png"] ]
    property int idx: 0
    function next() {
        if (idx >= jobs.length) { Qt.quit(); return }
        var j = jobs[idx]
        j[0].grabToImage(function(r) { r.saveToFile(shotDir + "/" + j[1]); root.idx++; root.next() })
    }
    Timer { interval: 400; running: true; onTriggered: root.next() }
}
