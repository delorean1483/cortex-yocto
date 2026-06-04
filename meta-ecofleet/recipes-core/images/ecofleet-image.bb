SUMMARY = "EcoFleet minimal production image for Gobi APU telemetry"
LICENSE = "MIT"

# imx-image-core: core-image + Weston + GPU drivers + SSH. No GStreamer, no
# NXP demo apps, no ML packages, no Docker, no full compiler toolchain.
# fsl-image-validation-imx (previous base) includes all of the above and is
# explicitly marked "NOT suitable for production" in the NXP layer.
require recipes-fsl/images/imx-image-core.bb

IMAGE_BASENAME = "${PN}"

WKS_FILE:mx8-nxp-bsp = "ecofleet-emmc.wks.in"

# Allow root SSH login with empty password for dev/field access
EXTRA_IMAGE_FEATURES += "debug-tweaks"

# Drop build toolchain and profiling — not needed at runtime
IMAGE_FEATURES:remove = "tools-sdk tools-profile package-management"

# Drop heavy packages imx-image-core adds that we don't need
IMAGE_INSTALL:remove = "docker imx-test firmwared packagegroup-imx-core-tools packagegroup-imx-security"

# var-resize-flash assumes a single rootfs partition and would corrupt rootfs-b.
BAD_RECOMMENDATIONS += "var-resize-flash"

IMAGE_INSTALL:append = " \
    gobi-agent \
    mosquitto \
    sqlite3 \
    libmodbus \
    cjson \
    gobi-ui \
    qtbase \
    qtdeclarative \
    qtshadertools \
    qtwayland \
    swupdate \
    libubootenv \
    libubootenv-bin \
    ecofleet-bootscript \
    swupdate-keys \
"
