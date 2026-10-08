SUMMARY = "Reboot via BD71847 PMIC cold reset (warm reset hangs this board)"
DESCRIPTION = "Kernel restart handler that reboots the DART-MX8M-MINI through \
the BD71847 PMIC's own cold reset, ahead of PSCI, plus kernel.panic=10 so a \
panic reboots instead of hanging."
LICENSE = "GPL-2.0-only"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/GPL-2.0-only;md5=801f80980d171dd6425610833a22dbe6"

inherit module

SRC_URI = " \
    file://Makefile \
    file://ecofleet-pmic-restart.c \
    file://ecofleet-panic.conf \
"
S = "${WORKDIR}"

RPROVIDES:${PN} += "kernel-module-ecofleet-pmic-restart"
KERNEL_MODULE_AUTOLOAD += "ecofleet-pmic-restart"

do_install:append() {
    install -D -m 0644 ${WORKDIR}/ecofleet-panic.conf \
        ${D}${sysconfdir}/sysctl.d/90-ecofleet-panic.conf
}

FILES:${PN} += "${sysconfdir}/sysctl.d/90-ecofleet-panic.conf"
