#!/usr/bin/env bash
# Generate the RSA-4096 key pair used to sign OTA bundles.
#
# Outputs (keep sign.key SECRET — never commit):
#   ota-keys/sign.key   — private signing key (CI secret / offline HSM)
#   ota-keys/sign.crt   — self-signed public certificate baked into the image
#
# The certificate is baked into the image by the swupdate-keys recipe and
# swupdate verifies every bundle against it before flashing.
#
# Run once; re-running rotates the key (all existing signed bundles become invalid).

set -euo pipefail

OUTDIR="${1:-ota-keys}"
mkdir -p "$OUTDIR"

echo "==> Generating RSA-4096 private key..."
openssl genrsa -out "$OUTDIR/sign.key" 4096

echo "==> Generating self-signed certificate (10 years)..."
openssl req -new -x509 -days 3650 \
    -key "$OUTDIR/sign.key" \
    -out "$OUTDIR/sign.crt" \
    -subj "/CN=EcoFleet OTA Signing/O=EcoFleet/C=US"

echo ""
echo "Done."
echo "  Private key : $OUTDIR/sign.key  ← KEEP SECRET, add to CI as SWUPDATE_SIGN_KEY"
echo "  Certificate : $OUTDIR/sign.crt  ← commit this; bake into image via swupdate-keys recipe"
echo ""
echo "Sign bundles:  SWUPDATE_SIGN_KEY=$OUTDIR/sign.key scripts/make-swu.sh <deploy> <ver>"
