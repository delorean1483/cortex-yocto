SUMMARY = "EcoFleet minimal production image for Gobi APU telemetry"
LICENSE = "MIT"

require recipes-fsl/images/fsl-image-validation-imx.bb

IMAGE_INSTALL:append = " \
    gobi-agent \
    mosquitto \
    sqlite3 \
    libmodbus \
    cjson \
"
