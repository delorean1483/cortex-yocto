# EF-MX8MM (R1) carrier device tree, built next to Variscite's DTBs so one
# image boots both the dev kit and R1 (the boot script picks the DTB).
# Host check: scripts/tests/check-r1-dts.sh
FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

SRC_URI:append = " file://imx8mm-ecofleet-ef-mx8mm.dts"

# Kernel config fragment (kernel-yocto merges it over imx8_var_defconfig).
# Host check: scripts/tests/test-kernel-config.sh
SRC_URI:append = " file://ilitek-touch-module.cfg"

KERNEL_DEVICETREE:append = " freescale/imx8mm-ecofleet-ef-mx8mm.dtb"

do_configure:append() {
    dtsdir=${S}/arch/arm64/boot/dts/freescale
    install -m 0644 ${WORKDIR}/imx8mm-ecofleet-ef-mx8mm.dts $dtsdir/
    grep -q 'imx8mm-ecofleet-ef-mx8mm.dtb' $dtsdir/Makefile || \
        echo 'dtb-$(CONFIG_ARCH_MXC) += imx8mm-ecofleet-ef-mx8mm.dtb' >> $dtsdir/Makefile
}
