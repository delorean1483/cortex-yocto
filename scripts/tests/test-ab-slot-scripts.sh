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
set -e
SCRIPTS_DIR=$(cd "$(dirname "$0")/.." && pwd)   # -> scripts/
TMP=$(mktemp -d)
trap 'rm -rf "$TMP" /tmp/next-slot' EXIT
mkdir "$TMP/bin"

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
export PATH="$TMP/bin:$PATH" STATE="$TMP/state" LNLOG="$TMP/lnlog"

# Replay swupdate's call sequence for one OTA; echo "<image_target> <final_slot>".
replay() {
    printf '%s' "$1" > "$STATE"; : > "$LNLOG"; rm -f /tmp/next-slot
    sh "$SCRIPTS_DIR/pre-install.sh"  preinst  >/dev/null 2>&1
    sh "$SCRIPTS_DIR/post-install.sh" preinst  >/dev/null 2>&1
    img=$(cat "$LNLOG")                       # symlink target when image is written
    sh "$SCRIPTS_DIR/pre-install.sh"  postinst >/dev/null 2>&1
    sh "$SCRIPTS_DIR/post-install.sh" postinst >/dev/null 2>&1
    printf '%s %s' "$img" "$(cat "$STATE")"
}

fail=0
check() { # desc  got  want
    if [ "$2" = "$3" ]; then echo "ok   - $1"; else echo "FAIL - $1: got '$2' want '$3'"; fail=1; fi
}
check "from slot a: image->p2, activate b" "$(replay a)" "/dev/mmcblk2p2 b"
check "from slot b: image->p1, activate a" "$(replay b)" "/dev/mmcblk2p1 a"

if [ "$fail" = 0 ]; then echo "PASS"; exit 0; else echo "FAILED"; exit 1; fi
