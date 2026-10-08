# EcoFleet stable boot script — lives ALONE on the eMMC "boot" partition (p1).
# Compiled to boot.scr by mkimage. u-boot's built-in bsp_bootcmd sources
# ${bootdir}/${bsp_script} from mmc ${mmcdev}:${mmcpart} = 2:1, so this runs
# even with a wiped/default u-boot environment. Updates never write p1.
#
# Layout: p1 boot, p2 rootfs-a, p3 rootfs-b, p4 data.
# u-boot env: slot_active = "a" | "b" (default a); A/B rollback trial =
# upgrade_available / bootcount / bootlimit (armed by swupdate post-install,
# cleared by ecofleet-boot-confirm on a healthy boot).
#
# A slot can only break itself: its optional /boot/ecofleet-bootargs.env may
# set ecofleet_extra_args and nothing else (env import whitelist). If a slot's
# kernel/DTB won't load or booti returns, the other slot is tried in this same
# pass. Never `reset` here: u-boot's reset is the WDOG path that hangs this board.

if test -z "${devnum}"; then setenv devnum "${mmcdev}"; fi
if test -z "${devnum}"; then setenv devnum 1; fi

if test -z "${slot_active}"; then
    setenv slot_active a
    saveenv
fi

# A/B rollback trial defaults (RAM-only; persisted values from fw_setenv win).
if test -z "${bootlimit}";         then setenv bootlimit 3;         fi
if test -z "${upgrade_available}"; then setenv upgrade_available 0; fi
if test -z "${bootcount}";         then setenv bootcount 0;         fi

# Rollback guard: while a freshly-installed slot is on trial, count boot attempts
# and revert to the previous slot once the count exceeds bootlimit. The increment
# + saveenv happen before booti, so a hang/panic after handoff still counts.
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

# Required by booti when the kernel is compressed (Image.gz)
setenv kernel_comp_addr_r 0x44000000
setenv kernel_comp_size   0x4000000

for _try in 1 2; do
    if test "${slot_active}" = "a"; then
        setenv _part 2
        setenv _other b
    else
        setenv _part 3
        setenv _other a
    fi
    echo "==> EcoFleet: booting slot ${slot_active} (mmc ${devnum} p${_part})"

    # Optional per-slot kernel arguments; only ecofleet_extra_args is imported.
    setenv ecofleet_extra_args
    if ext4load mmc ${devnum}:${_part} ${loadaddr} /boot/ecofleet-bootargs.env; then
        env import -t ${loadaddr} ${filesize} ecofleet_extra_args
    fi

    if ext4load mmc ${devnum}:${_part} ${loadaddr} /boot/Image.gz; then
        if ext4load mmc ${devnum}:${_part} ${fdt_addr} /boot/imx8mm-var-dart-dt8mcustomboard.dtb; then
            setenv bootargs "console=ttymxc0,115200 root=/dev/mmcblk${devnum}p${_part} rootwait rw quiet ${ecofleet_extra_args}"
            booti ${loadaddr} - ${fdt_addr}
        fi
    fi

    # Only reached if this slot could not be loaded or booti returned.
    if test "${_try}" = "1"; then
        echo "==> EcoFleet: slot ${slot_active} did not boot, trying slot ${_other}"
        setenv slot_active ${_other}
        setenv upgrade_available 0
        setenv bootcount 0
        saveenv
    fi
done

echo "==> EcoFleet: neither slot could be booted; reflash required"
