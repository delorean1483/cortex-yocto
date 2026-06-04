#!/bin/bash
set -e

# Step 1: KAS checkout — clones/updates all repos, generates bblayers.conf
# and local.conf. Does NOT run bitbake, so we can patch bblayers.conf first.
kas checkout kas/dev.yml:kas-version.yml

# Step 2: Force meta-ecofleet to the workspace checkout.
# The runner has a stale permanent clone; the sed replaces whatever path KAS
# wrote with /work/meta-ecofleet (the checked-out tag from the workflow).
BBLAYERS=/home/rsmith/yocto-cache/build/conf/bblayers.conf

if grep -q 'meta-ecofleet' "$BBLAYERS" 2>/dev/null; then
    sed -i 's|^\( *\)[^ ]*meta-ecofleet[^ ]*|\1/work/meta-ecofleet|g' "$BBLAYERS"
    echo "=== patched meta-ecofleet path ==="
    grep 'meta-ecofleet' "$BBLAYERS"
else
    echo "=== meta-ecofleet not in bblayers.conf — appending ==="
    sed -i 's|^BBLAYERS ?= "\(.*\)"|BBLAYERS ?= "\1\n    /work/meta-ecofleet \\"|' "$BBLAYERS"
    grep 'meta-ecofleet' "$BBLAYERS" || echo "WARNING: append failed"
fi

# Step 3: Source OE environment (sets PATH for bitbake, sets BUILDDIR, cds in)
POKY_INIT=$(find /home/rsmith/yocto-cache -maxdepth 3 -name 'oe-init-build-env' | head -1)
echo "=== OE init: $POKY_INIT ==="
source "$POKY_INIT" /home/rsmith/yocto-cache/build

# Step 4: Build
bitbake ecofleet-image
