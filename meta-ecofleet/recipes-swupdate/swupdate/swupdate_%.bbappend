FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

# swupdate.cfg = runtime config (globals: public-key-file); signing.cfg =
# Kconfig fragment that should compile in bundle signature verification.
# NOTE: this bbappend previously lived one directory too shallow
# (recipes-swupdate/swupdate_%.bbappend) so BitBake's recipes-*/*/*.bbappend
# glob never matched it and NONE of this applied — the device shipped the stock
# swupdate.cfg with no signing. Now under recipes-swupdate/swupdate/ it applies.
SRC_URI += "file://swupdate.cfg"
SRC_URI += "file://signing.cfg"

# HARD GATE: whether meta-swupdate actually merges the .cfg fragment is only
# provable by inspecting the resulting .config. Fail the build loudly if signing
# did not compile in, rather than silently shipping a swupdate that skips
# verification (a mistake only discoverable on a real device otherwise — which
# is exactly how the earlier "enforcement" turned out to be a no-op).
do_configure:append() {
    cfg="${B}/.config"
    [ -f "$cfg" ] || cfg=$(find "${B}" "${S}" -maxdepth 3 -name .config 2>/dev/null | head -1)
    if [ -n "$cfg" ] && [ -f "$cfg" ]; then
        grep -q "^CONFIG_SIGNED_IMAGES=y" "$cfg" || \
            bbfatal "swupdate: CONFIG_SIGNED_IMAGES not enabled in $cfg — signing.cfg fragment did not apply"
        grep -q "^CONFIG_SIGALG_RAWRSA=y" "$cfg" || \
            bbfatal "swupdate: CONFIG_SIGALG_RAWRSA not enabled in $cfg — check signing.cfg"
        bbnote "swupdate: bundle signature verification (RAWRSA) confirmed enabled in $cfg"
    else
        bbfatal "swupdate: no .config found under ${B} or ${S} — cannot prove signing compiled in; refusing to ship unverified"
    fi
}

do_install:append() {
    install -d ${D}${sysconfdir}
    install -m 0644 ${WORKDIR}/swupdate.cfg ${D}${sysconfdir}/swupdate.cfg
}

FILES:${PN} += "${sysconfdir}/swupdate.cfg"
