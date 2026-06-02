# EcoFleet A/B slot boot script
# Compiled to boot.scr by mkimage; picked up by Variscite distro_bootcmd.
#
# u-boot env var: slot_active = "a" | "b"  (default "a" on first boot)
# Partitions:  mmcblk2p1 = rootfs-a,  mmcblk2p2 = rootfs-b

if test -z "${slot_active}"; then
    setenv slot_active a
    saveenv
fi

if test "${slot_active}" = "a"; then
    setenv _root_part 1
else
    setenv _root_part 2
fi

echo "==> EcoFleet: booting slot ${slot_active} (mmcblk2p${_root_part})"

ext4load mmc 2:${_root_part} ${loadaddr}  /boot/Image.gz
ext4load mmc 2:${_root_part} ${fdt_addr}  /boot/imx8mm-var-dart-dt8mcustomboard.dtb

setenv bootargs "console=ttymxc3,115200 root=/dev/mmcblk2p${_root_part} rootwait rw quiet"

booti ${loadaddr} - ${fdt_addr}
