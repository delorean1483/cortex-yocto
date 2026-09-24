# EcoFleet kiosk look for Weston's desktop-shell: no panel/clock, and the
# EcoFleet boot frame (rendered from gobi-ui's SplashArt.qml) as the background,
# so the moment between psplash quitting and gobi-ui mapping its window shows
# the same loading screen instead of the default wallpaper.
#
# weston.ini itself comes from meta-variscite-sdk-imx (higher layer priority, so
# its file wins the FILESPATH lookup); edit the installed copy instead.
FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

SRC_URI:append = " file://ecofleet-boot-bg.png"

do_install:append() {
    install -D -m 0644 ${WORKDIR}/ecofleet-boot-bg.png ${D}${datadir}/ecofleet/boot-bg.png

    ini=${D}${sysconfdir}/xdg/weston/weston.ini
    grep -q '^\[shell\]' $ini || bbfatal "no [shell] section in $ini"
    sed -i -e '/^\[shell\]/a panel-position=none\nbackground-image=${datadir}/ecofleet/boot-bg.png\nbackground-type=scale-crop\nbackground-color=0xff0e1116' $ini
}

FILES:${PN} += "${datadir}/ecofleet/boot-bg.png"
