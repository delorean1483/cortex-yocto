FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

# ecofleet-swupdate.cfg = runtime config (globals: public-key-file); signing.cfg
# = Kconfig fragment that should compile in bundle signature verification.
# NOTE: this bbappend previously lived one directory too shallow
# (recipes-swupdate/swupdate_%.bbappend) so BitBake's recipes-*/*/*.bbappend
# glob never matched it and NONE of this applied — the device shipped the stock
# swupdate.cfg with no signing. Now under recipes-swupdate/swupdate/ it applies.
# Our config MUST NOT be named swupdate.cfg: meta-swupdate's base recipe ships
# its own files/swupdate.cfg, and the basename collision means the stock file
# wins in ${WORKDIR} regardless of FILESEXTRAPATHS — which is how the keyless
# config shipped to the device. A unique name (ecofleet-swupdate.cfg) is the fix.
SRC_URI += "file://ecofleet-swupdate.cfg"
SRC_URI += "file://signing.cfg"
SRC_URI += "file://10-ecofleet-swupdate.preset"

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

# Install our OTA config at a path WE own, NOT /etc/swupdate.cfg — Variscite's
# BSP also ships /etc/swupdate.cfg at higher layer priority and clobbers ours
# (the device kept the stock suricatta config with public-key-file commented).
# ota_trigger passes `-f /etc/swupdate/ecofleet.cfg`, which sets public-key-file
# to the baked-in /etc/swupdate/sign.pub for signature verification.
do_install:append() {
    install -d ${D}${sysconfdir}/swupdate
    install -m 0644 ${WORKDIR}/ecofleet-swupdate.cfg ${D}${sysconfdir}/swupdate/ecofleet.cfg

    # HARD GATE on the installed config's CONTENT, not just its presence. Twice
    # now a broken ecofleet.cfg reached a device and silently killed OTA, each
    # only discoverable on real hardware:
    #   1. the stock keyless config shipped  -> swupdate aborts every update with
    #      "SWUpdate is built for signed images, provide a public key file";
    #   2. identify written as an array "[ ]" instead of a list "( )" -> swupdate
    #      fails to parse the file at all ("Error reading configuration file").
    # gobi-agent passes this exact file via `swupdate -i <bundle> -f`, so a wrong
    # file here means no OTA can ever run. Fail the build instead of shipping it.
    cfg=${D}${sysconfdir}/swupdate/ecofleet.cfg
    grep -qE '^[[:space:]]*public-key-file[[:space:]]*=[[:space:]]*"/etc/swupdate/sign.pub"[[:space:]]*;' "$cfg" || \
        bbfatal "swupdate ecofleet.cfg has no uncommented public-key-file=/etc/swupdate/sign.pub — signed-images OTA would abort 'provide a public key file'"
    if grep -q '\[' "$cfg"; then
        bbfatal "swupdate ecofleet.cfg contains '[' — libconfig groups need a list '( )', an array '[ ]' makes swupdate fail to parse the whole file"
    fi

    # Disable the stock suricatta daemon (swupdate.service) in the shipped image
    # via a higher-priority preset than the recipe's 98-swupdate.preset. ecofleet
    # OTA is gobi-agent's one-shot `swupdate -i`; the daemon is unused and only
    # ever appears as a failed unit at boot. swupdate.socket is left untouched.
    install -d ${D}${systemd_unitdir}/system-preset
    install -m 0644 ${WORKDIR}/10-ecofleet-swupdate.preset ${D}${systemd_unitdir}/system-preset/
}

FILES:${PN} += "${sysconfdir}/swupdate/ecofleet.cfg"
FILES:${PN} += "${systemd_unitdir}/system-preset/10-ecofleet-swupdate.preset"
