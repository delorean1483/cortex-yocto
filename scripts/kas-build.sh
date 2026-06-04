#!/bin/bash
set -e

# Called by kas shell -- which sets up $BUILDDIR and the OE environment.
# Patches bblayers.conf to use the workspace meta-ecofleet layer, then
# runs bitbake. This ensures CI always builds from the checked-out tag,
# not from a stale KAS-managed clone on the runner.

BBLAYERS="$BUILDDIR/conf/bblayers.conf"

if grep -q 'meta-ecofleet' "$BBLAYERS" 2>/dev/null; then
    sed -i 's|[^ ]*/meta-ecofleet[^ ]*|/work/meta-ecofleet|g' "$BBLAYERS"
else
    # meta-ecofleet not in bblayers.conf yet — append it
    sed -i 's|^\(BBLAYERS ?= ".*\)$|\1\n    /work/meta-ecofleet \\|' "$BBLAYERS"
fi

echo "=== meta-ecofleet layer path ==="
grep -i ecofleet "$BBLAYERS" || echo "WARNING: meta-ecofleet not found in bblayers.conf"

bitbake ecofleet-image
