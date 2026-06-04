# EcoFleet A/B slot boot script
# Compiled to boot.scr by mkimage; picked up by Variscite distro_bootcmd.
#
# u-boot env var: slot_active = "a" | "b"  (default "a" on first boot)
# devnum is set by distro_bootcmd to whichever MMC device U-Boot found this
# script on — works for both eMMC (mmc 2) and SD card (mmc 1) without changes.

if test -z "${slot_active}"; then
    setenv slot_active a
    saveenv
fi

if test "${slot_active}" = "a"; then
    setenv _root_part 1
else
    setenv _root_part 2
fi

# Required by booti when kernel is compressed (Image.gz)
setenv kernel_comp_addr_r 0x44000000
setenv kernel_comp_size   0x4000000

echo "==> EcoFleet: booting slot ${slot_active} (mmc ${devnum} p${_root_part})"

ext4load mmc ${devnum}:${_root_part} ${loadaddr} /boot/Image.gz
ext4load mmc ${devnum}:${_root_part} ${fdt_addr} /boot/imx8mm-var-dart-dt8mcustomboard.dtb

# mmcblk device number matches U-Boot devnum on i.MX8MM (devnum 1 = mmcblk1, etc.)
setenv bootargs "console=ttymxc3,115200 root=/dev/mmcblk${devnum}p${_root_part} rootwait rw quiet"

booti ${loadaddr} - ${fdt_addr}
