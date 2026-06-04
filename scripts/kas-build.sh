#!/bin/bash
set -e

# KAS_WORK_DIR=/home/rsmith/yocto-cache means repos are cloned to:
#   /home/rsmith/yocto-cache/meta-ecofleet/   (cortex-yocto clone)
#   /home/rsmith/yocto-cache/poky/            (poky clone)
#   etc.
# The meta-ecofleet Yocto layer is the meta-ecofleet/ subdirectory inside that clone.

KAS_LAYER=/home/rsmith/yocto-cache/meta-ecofleet/meta-ecofleet
KAS_GOBI_AGENT_FILES=$KAS_LAYER/recipes-ecofleet/gobi-agent/files

# Step 1: KAS checkout — clones/updates all repos, generates bblayers.conf + local.conf
kas checkout kas/dev.yml:kas-version.yml

# Step 2: Inject device certificates into the KAS-managed clone
# (The workflow already injected them into /work, but Yocto reads from the KAS clone)
if [ -f /work/meta-ecofleet/recipes-ecofleet/gobi-agent/files/device.crt ]; then
    cp /work/meta-ecofleet/recipes-ecofleet/gobi-agent/files/device.crt "$KAS_GOBI_AGENT_FILES/device.crt"
    cp /work/meta-ecofleet/recipes-ecofleet/gobi-agent/files/device.key "$KAS_GOBI_AGENT_FILES/device.key"
    echo "=== device certs injected into KAS clone ==="
else
    echo "WARNING: device.crt not found in workspace — gobi-agent build may fail"
fi

# Step 3: Source OE environment (poky is at KAS_WORK_DIR/poky/)
source /home/rsmith/yocto-cache/poky/oe-init-build-env /home/rsmith/yocto-cache/build

# Step 4: Build
bitbake ecofleet-image
