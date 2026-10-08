#!/bin/sh
# Regression test for the A/B slot OTA scripts (pre-install.sh / post-install.sh).
#
# swupdate runs a "shellscript" in BOTH the preinst and postinst phases, passing
# the phase name as $1. The scripts MUST guard on $1 so that:
#   - pre-install (points /dev/swupdate-inactive at the inactive slot) runs once,
#     in preinst, before the image write;
#   - post-install (commits slot_active) runs once, in postinst, after the write.
# The original scripts had no guard, so post-install ran in both phases and the
# second run reverted slot_active -> the OTA installed but never activated. That
# bug was only discoverable on real hardware; this test replays swupdate's exact
# call sequence with mocked fw_printenv/fw_setenv/ln so CI catches a regression.
#
# Layout (2026-10-07 boot-partition spec): p1 boot, p2 rootfs-a, p3 rootfs-b,
# p4 data. pre-install must also refuse a target that isn't slot-sized, so an
# old-layout unit (p3 = data) can never have /data overwritten by an update.
set -e
SCRIPTS_DIR=$(cd "$(dirname "$0")/.." && pwd)   # -> scripts/
TMP=$(mktemp -d)
trap 'rm -rf "$TMP" /tmp/next-slot' EXIT
mkdir "$TMP/bin" "$TMP/sys"

cat > "$TMP/bin/fw_printenv" <<'EOF'
#!/bin/sh
[ "$1" = "-n" ] && [ "$2" = "slot_active" ] && cat "$STATE"
exit 0
EOF
cat > "$TMP/bin/fw_setenv" <<'EOF'
#!/bin/sh
[ "$1" = "slot_active" ] && printf '%s' "$2" > "$STATE"
exit 0
EOF
cat > "$TMP/bin/ln" <<'EOF'
#!/bin/sh
for a in "$@"; do case "$a" in /dev/mmcblk*) printf '%s' "$a" > "$LNLOG";; esac; done
exit 0
EOF
chmod +x "$TMP/bin"/*
export PATH="$TMP/bin:$PATH" STATE="$TMP/state" LNLOG="$TMP/lnlog" ECOFLEET_SYS_BLOCK="$TMP/sys"

# Fake /sys/class/block/<dev>/size (512-byte sectors).
layout() { # new | old
    rm -rf "$TMP/sys"/*
    for p in 1 2 3 4; do mkdir -p "$TMP/sys/mmcblk2p$p"; done
    if [ "$1" = new ]; then
        echo 65536   > "$TMP/sys/mmcblk2p1/size"   # boot 32M
        echo 3481600 > "$TMP/sys/mmcblk2p2/size"   # rootfs-a
        echo 3481600 > "$TMP/sys/mmcblk2p3/size"   # rootfs-b
        echo 131072  > "$TMP/sys/mmcblk2p4/size"   # data
    else
        echo 3481600 > "$TMP/sys/mmcblk2p1/size"   # rootfs-a
        echo 3481600 > "$TMP/sys/mmcblk2p2/size"   # rootfs-b
        echo 131072  > "$TMP/sys/mmcblk2p3/size"   # data
    fi
}

# Replay swupdate's call sequence for one OTA; echo "<image_target> <final_slot> <preinst_rc>".
# swupdate stops (no write, no postinst) when the preinst script fails.
replay() {
    printf '%s' "$1" > "$STATE"; : > "$LNLOG"; rm -f /tmp/next-slot
    rc=0
    sh "$SCRIPTS_DIR/pre-install.sh"  preinst  >/dev/null 2>&1 || rc=$?
    if [ "$rc" = 0 ]; then
        sh "$SCRIPTS_DIR/post-install.sh" preinst  >/dev/null 2>&1
        img=$(cat "$LNLOG")                       # symlink target when image is written
        sh "$SCRIPTS_DIR/pre-install.sh"  postinst >/dev/null 2>&1
        sh "$SCRIPTS_DIR/post-install.sh" postinst >/dev/null 2>&1
    else
        img=$(cat "$LNLOG")
    fi
    printf '%s %s %s' "${img:-none}" "$(cat "$STATE")" "$rc"
}

fail=0
check() { # desc  got  want
    if [ "$2" = "$3" ]; then echo "ok   - $1"; else echo "FAIL - $1: got '$2' want '$3'"; fail=1; fi
}
layout new
check "from slot a: image->p3, activate b" "$(replay a)" "/dev/mmcblk2p3 b 0"
check "from slot b: image->p2, activate a" "$(replay b)" "/dev/mmcblk2p2 a 0"
layout old
check "old layout: refuse to write data partition" "$(replay a)" "none a 1"

if [ "$fail" = 0 ]; then echo "PASS"; exit 0; else echo "FAILED"; exit 1; fi
