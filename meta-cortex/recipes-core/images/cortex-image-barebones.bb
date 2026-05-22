SUMMARY = "Minimal EcoFleet image for DART-MX8M-Mini"
LICENSE = "MIT"

inherit core-image

IMAGE_FEATURES += "ssh-server-openssh"

IMAGE_INSTALL:append = " \
    packagegroup-core-boot \
    kernel-modules \
"
