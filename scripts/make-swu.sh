#!/usr/bin/env bash
# Build an SWUpdate bundle (.swu) from the Yocto deploy directory.
#
# Usage:
#   make-swu.sh <deploy-dir> <version> [output.swu]
#
# <deploy-dir>  Path to tmp/deploy/images/imx8mm-var-dart/
# <version>     Semver string embedded in the bundle name, e.g. "1.2.0"
# [output.swu]  Default: ecofleet-<version>.swu in the current directory
#
# The script:
#   1. Compresses rootfs.ext4 to rootfs.ext4.gz
#   2. Computes sha256 for the image file
#   3. Patches sw-description with the real sha256 and version
#   4. Packs sw-description first (required by swupdate), then all other files
#
# Signing: set SWUPDATE_SIGN_KEY=/path/to/sign.key to RSA-sign the bundle
# (requires openssl; swupdate must be built with CONFIG_SIGALG_RAWRSA=y).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="${1:?Usage: make-swu.sh <deploy-dir> <version> [output.swu]}"
VERSION="${2:?}"
OUTPUT="${3:-ecofleet-${VERSION}.swu}"

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

# Resolve OUTPUT to absolute so the cd into TMPDIR doesn't corrupt the path
case "$OUTPUT" in
    /*) ;;
    *)  OUTPUT="$(pwd)/$OUTPUT" ;;
esac

# ── 1. Locate rootfs image ────────────────────────────────────────────────────
ROOTFS_EXT4=$(find "$DEPLOY_DIR" -maxdepth 1 -name '*.rootfs.ext4' | head -1)
if [ -z "$ROOTFS_EXT4" ]; then
    echo "ERROR: no .rootfs.ext4 found in $DEPLOY_DIR" >&2
    exit 1
fi
echo "==> rootfs: $ROOTFS_EXT4"

# ── 2. Compress ───────────────────────────────────────────────────────────────
ROOTFS_GZ="$TMPDIR/rootfs.ext4.gz"
echo "==> compressing rootfs (this takes a minute)..."
gzip -c "$ROOTFS_EXT4" > "$ROOTFS_GZ"

# ── 3. SHA256 ─────────────────────────────────────────────────────────────────
SHA256=$(sha256sum "$ROOTFS_GZ" | awk '{print $1}')
echo "==> sha256: $SHA256"

# ── 4. Patch sw-description ───────────────────────────────────────────────────
SW_DESC="$TMPDIR/sw-description"
sed \
    -e "s|version = \"0.1.0\"|version = \"${VERSION}\"|" \
    -e "s|sha256   = \"@rootfs.ext4.gz\"|sha256   = \"${SHA256}\"|" \
    "$SCRIPT_DIR/sw-description" > "$SW_DESC"

# ── 5. Copy scripts ───────────────────────────────────────────────────────────
cp "$SCRIPT_DIR/pre-install.sh"  "$TMPDIR/"
cp "$SCRIPT_DIR/post-install.sh" "$TMPDIR/"
chmod +x "$TMPDIR/pre-install.sh" "$TMPDIR/post-install.sh"

# ── 6. Optional RSA signing ───────────────────────────────────────────────────
if [ -n "${SWUPDATE_SIGN_KEY:-}" ]; then
    echo "==> signing sw-description with $SWUPDATE_SIGN_KEY"
    openssl dgst -sha256 -sign "$SWUPDATE_SIGN_KEY" \
        -out "$TMPDIR/sw-description.sig" "$SW_DESC"
fi

# ── 7. Pack .swu (cpio, sw-description MUST be first) ────────────────────────
echo "==> packing $OUTPUT"
(
    cd "$TMPDIR"
    FILES="sw-description"
    [ -f sw-description.sig ] && FILES="$FILES sw-description.sig"
    FILES="$FILES rootfs.ext4.gz pre-install.sh post-install.sh"
    # shellcheck disable=SC2086
    echo $FILES | tr ' ' '\n' | cpio -o -H newc > "$OUTPUT"
)

SIZE=$(du -sh "$OUTPUT" | awk '{print $1}')
echo "==> done: $OUTPUT ($SIZE)"
