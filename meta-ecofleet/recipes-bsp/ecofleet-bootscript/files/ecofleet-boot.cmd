# EcoFleet A/B slot boot script
# Compiled to boot.scr by mkimage; picked up by Variscite BSP bootcmd.
#
# u-boot env var: slot_active = "a" | "b"  (default "a" on first boot)
# devnum: standard distro_bootcmd sets this; Variscite BSP uses mmcdev instead.
# Fall back through both and default to 1 (SD card) if neither is set.
if test -z "${devnum}"; then setenv devnum "${mmcdev}"; fi
if test -z "${devnum}"; then setenv devnum 1; fi

if test -z "${slot_active}"; then
    setenv slot_active a
    saveenv
fi

# A/B rollback trial defaults (RAM-only; persisted values from fw_setenv win).
# See ecofleet-boot-confirm.service (clears the trial on a healthy boot) and the
# swupdate post-install (arms it). bootlimit is a constant; upgrade_available=0
# means "no trial pending" so a never-OTA'd device skips the guard entirely.
if test -z "${bootlimit}";         then setenv bootlimit 3;         fi
if test -z "${upgrade_available}"; then setenv upgrade_available 0; fi
if test -z "${bootcount}";         then setenv bootcount 0;         fi

# Rollback guard: while a freshly-installed slot is on trial, count boot attempts
# and revert to the previous slot once the count exceeds bootlimit. Runs only
# when a trial is armed, so normal boots are untouched. The increment + saveenv
# happen before booti, so a hang/panic after handoff still counts next power-cycle.
if test "${upgrade_available}" = "1"; then
    setexpr bootcount ${bootcount} + 1
    saveenv
    if test ${bootcount} -gt ${bootlimit}; then
        echo "==> EcoFleet: boot trial exceeded ${bootlimit}, rolling back slot"
        if test "${slot_active}" = "a"; then setenv slot_active b; else setenv slot_active a; fi
        setenv upgrade_available 0
        setenv bootcount 0
        saveenv
    fi
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
