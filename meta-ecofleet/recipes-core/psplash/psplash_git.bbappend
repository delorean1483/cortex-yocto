# EcoFleet boot splash: replaces the Variscite/Yocto artwork with the EcoFleet
# frame rendered from gobi-ui's SplashArt.qml (see gobi-ui qml/preview/BootArt.qml),
# so psplash → Weston background → gobi-ui splash read as one loading screen.
#
# meta-variscite-sdk-common (layer priority 16, ours is 6) also appends psplash:
# it sets SPLASH_IMAGES, patches psplash-colors.h and copies its own
# psplash-bar.png into base-images in do_configure:prepend. Its bbappend parses
# after ours, so we win with :forcevariable for the image and by overwriting the
# colours header + bar image in do_configure:append (which runs after both its
# prepend and do_patch).
FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

SRC_URI:append = " \
    file://psplash-colors-ecofleet.h \
    file://psplash-ecofleet-bar.png \
"

SPLASH_IMAGES:forcevariable = "file://psplash-ecofleet.png;outsuffix=default"

# The frame is a full 800x480 image: centre it on screen, not in the top 5/6.
PACKAGECONFIG:append = " fullscreen"

do_configure:append() {
    cp ${WORKDIR}/psplash-colors-ecofleet.h ${S}/psplash-colors.h
    cp ${WORKDIR}/psplash-ecofleet-bar.png ${S}/base-images/psplash-bar.png
}
