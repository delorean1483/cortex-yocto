SUMMARY = "EcoFleet minimal production image for Gobi APU telemetry"
LICENSE = "MIT"

require recipes-fsl/images/fsl-image-validation-imx.bb

WKS_FILE:mx8-nxp-bsp = "ecofleet-emmc.wks.in"

# Allow root SSH login with empty password for dev/field access
EXTRA_IMAGE_FEATURES += "debug-tweaks"

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
