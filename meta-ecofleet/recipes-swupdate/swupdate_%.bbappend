FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

# swupdate.cfg = runtime config; signing.cfg = Kconfig fragment that compiles
# in bundle signature verification (merged into the swupdate defconfig by
# meta-swupdate's fragment handling).
SRC_URI += "file://swupdate.cfg"
SRC_URI += "file://signing.cfg"

# Fail the build loudly if the signing fragment did not take effect, rather
# than silently shipping a swupdate that skips verification (a mistake only
# discoverable on a real device otherwise).
do_configure:append() {
    cfg="${B}/.config"
    if [ -f "$cfg" ]; then
        grep -q "^CONFIG_SIGNED_IMAGES=y" "$cfg" || \
            bbfatal "swupdate: CONFIG_SIGNED_IMAGES not enabled — signing.cfg fragment did not apply"
        grep -q "^CONFIG_SIGALG_RAWRSA=y" "$cfg" || \
            bbfatal "swupdate: CONFIG_SIGALG_RAWRSA not enabled — check signing.cfg"
        bbnote "swupdate: bundle signature verification (RAWRSA) confirmed enabled"
    else
        bbwarn "swupdate: ${B}/.config not found — cannot verify signing is enabled"
    fi
}

do_install:append() {
    install -d ${D}${sysconfdir}
    install -m 0644 ${WORKDIR}/swupdate.cfg ${D}${sysconfdir}/swupdate.cfg
}

FILES:${PN} += "${sysconfdir}/swupdate.cfg"
