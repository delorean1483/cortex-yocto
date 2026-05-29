SUMMARY = "EcoFleet minimal production image for Gobi APU telemetry"
LICENSE = "MIT"

require recipes-fsl/images/fsl-image-validation-imx.bb

WKS_FILE = "ecofleet-emmc.wks"

# Allow root SSH login with empty password for dev/field access
EXTRA_IMAGE_FEATURES += "debug-tweaks"

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
"
