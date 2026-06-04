#!/bin/bash
set -e

# KAS_WORK_DIR=/home/rsmith/yocto-cache — repos cloned to persistent cache.
# However, KAS does not reliably fetch the latest commit when branch: main
# is specified. We override the meta-ecofleet path in bblayers.conf to use
# /work/meta-ecofleet (the workspace, checked out at the correct tag) instead
# of the potentially stale KAS-managed clone.
# Device certs are already in /work/meta-ecofleet/ (injected before this script).

# Step 1: KAS checkout — sets up all BSP/BSP-vendor/poky repos, generates
# bblayers.conf and local.conf. meta-ecofleet will point to KAS clone (stale)
# but we replace that path in step 2.
kas checkout kas/dev.yml:kas-version.yml

# Step 2: Replace meta-ecofleet layer path with workspace
BBLAYERS=/home/rsmith/yocto-cache/build/conf/bblayers.conf
echo "=== bblayers.conf before patch ==="
grep -i ecofleet "$BBLAYERS" || echo "(not found)"

if grep -q 'meta-ecofleet' "$BBLAYERS" 2>/dev/null; then
    sed -i 's|^\( *\)[^ ]*meta-ecofleet[^ ]*|\1/work/meta-ecofleet|g' "$BBLAYERS"
else
    # meta-ecofleet not present — append before closing quote
    sed -i 's|^\(BBLAYERS.*\)"$|\1\n    /work/meta-ecofleet \\"|' "$BBLAYERS"
fi

echo "=== bblayers.conf after patch ==="
grep -i ecofleet "$BBLAYERS" || echo "WARNING: meta-ecofleet still not found"

# Verify the workspace layer exists
if [ ! -f /work/meta-ecofleet/conf/layer.conf ]; then
    echo "ERROR: /work/meta-ecofleet/conf/layer.conf not found"
    exit 1
fi
echo "=== workspace meta-ecofleet OK ($(head -1 /work/meta-ecofleet/conf/layer.conf)) ==="

# Step 3: Source OE environment (poky at KAS_WORK_DIR/poky/)
source /home/rsmith/yocto-cache/poky/oe-init-build-env /home/rsmith/yocto-cache/build

# Step 4: Build
bitbake ecofleet-image
