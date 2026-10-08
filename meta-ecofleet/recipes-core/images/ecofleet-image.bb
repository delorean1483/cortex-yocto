SUMMARY = "EcoFleet minimal production image for Gobi APU telemetry"
LICENSE = "MIT"

# imx-image-core: core-image + Weston + GPU drivers + SSH. No GStreamer, no
# NXP demo apps, no ML packages, no Docker, no full compiler toolchain.
# fsl-image-validation-imx (previous base) includes all of the above and is
# explicitly marked "NOT suitable for production" in the NXP layer.
require recipes-fsl/images/imx-image-core.bb

IMAGE_BASENAME = "${PN}"

# SWUpdate bundles are built from the raw ext4 rootfs; ensure it's produced.
IMAGE_FSTYPES:append = " ext4"

WKS_FILE:mx8-nxp-bsp = "ecofleet-emmc.wks.in"

# The wic "boot" partition (p1) carries only the stable boot script, deployed
# by ecofleet-bootscript; it is never part of the root filesystem.
IMAGE_BOOT_FILES = "ecofleet-boot.scr;boot/boot.scr"
do_image_wic[depends] += "ecofleet-bootscript:do_deploy"

# Allow root SSH login with empty password for dev/field access
EXTRA_IMAGE_FEATURES += "debug-tweaks"

# Drop build toolchain and profiling — not needed at runtime
IMAGE_FEATURES:remove = "tools-sdk tools-profile package-management"

# Drop heavy packages imx-image-core adds that we don't need
IMAGE_INSTALL:remove = "docker imx-test firmwared packagegroup-imx-core-tools packagegroup-imx-security"

# var-resize-flash assumes a single rootfs partition and would corrupt rootfs-b.
BAD_RECOMMENDATIONS += "var-resize-flash"

ECOFLEET_FW_VERSION ?= "dev"

write_ecofleet_version() {
    install -d ${IMAGE_ROOTFS}/etc/ecofleet
    echo "${ECOFLEET_FW_VERSION}" > ${IMAGE_ROOTFS}/etc/ecofleet/firmware-version
}
ROOTFS_POSTPROCESS_COMMAND:append = " write_ecofleet_version;"

# swupdate hardware revision = eMMC layout generation. 2.0 = boot partition
# (p1 boot, p2/p3 slots, p4 data). Bundles say hardware-compatibility = ["2.0"]
# (scripts/sw-description), so swupdate itself refuses an old-layout bundle on
# this image and this image's bundle on an old-layout unit. Written after all
# packages so it wins over the BSP's /etc/hwrevision.
write_ecofleet_hwrevision() {
    echo "imx8mm-var-dart 2.0" > ${IMAGE_ROOTFS}${sysconfdir}/hwrevision
}
ROOTFS_POSTPROCESS_COMMAND:append = " write_ecofleet_hwrevision;"

# Units that must never run on this A/B layout, masked so a boot is clean:
# - var-expand-partition: Variscite's "grow the root partition on first boot".
#   Here the root partition is an A/B slot; growing it would run into the next
#   slot and /data. It only failed so far because findmnt isn't in the image.
#   (Same reason var-resize-flash is in BAD_RECOMMENDATIONS above.)
# - swupdate.service: the stock suricatta/hawkBit daemon. OTA runs one-shot
#   `swupdate -i`; the daemon only failed at boot ("provide a public key
#   file"). A preset "disable" doesn't help: the image build runs preset-all
#   in enable-only mode, so mask it here.
# - swupdate.socket: the daemon's socket activation. With the service masked
#   it failed at every boot ("Socket service swupdate.service not loaded,
#   refusing"); it would also listen on /tmp/sockinstctrl + /tmp/swupdateprog,
#   the same paths the one-shot `swupdate -i` creates.
# A mask on a name that isn't installed (typo, upstream rename) does nothing,
# and the failed unit would only show up again on hardware, so fail the build.
mask_unused_units() {
    install -d ${IMAGE_ROOTFS}${sysconfdir}/systemd/system
    for u in var-expand-partition.service swupdate.service swupdate.socket; do
        [ -e ${IMAGE_ROOTFS}${systemd_system_unitdir}/$u ] || \
            bbfatal "mask_unused_units: $u is not in ${systemd_system_unitdir} (renamed or dropped upstream?) — the mask would do nothing; update the list"
        ln -sf /dev/null ${IMAGE_ROOTFS}${sysconfdir}/systemd/system/$u
    done
}
ROOTFS_POSTPROCESS_COMMAND:append = " mask_unused_units;"

IMAGE_INSTALL:append = " \
    gobi-agent \
    mosquitto \
    sqlite3 \
    libmodbus \
    cjson \
    curl \
    ca-certificates \
    gobi-ui \
    qtbase \
    qtdeclarative \
    qtshadertools \
    qtwayland \
    swupdate \
    libubootenv \
    libubootenv-bin \
    ecofleet-boot-confirm \
    swupdate-keys \
    tzdata \
    ecofleet-data \
    ecofleet-wifi \
    ecofleet-pmic-restart \
"

# STM32 (g0b1/APU) firmware delivery — GO-LIVE 2026-09-18.
# Ships the real g0b1-apu-1.1.2-slot{A,B}.bin + manifest.json (from the fixed
# CubeIDE Release build: linker/_estack fix + RPM fix, bench-validated Cases
# A/B). The blobs ride the signed .swu; the agent flashes the STM32 inactive
# slot on an operator dashboard request (APU_OTA_ENABLED + apu_firmware_target).
IMAGE_INSTALL:append = " g0b1-apu-firmware"
