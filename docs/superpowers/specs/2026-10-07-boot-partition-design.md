# Stable boot partition (boot script outside both A/B slots) — design

**Date:** 2026-10-07 · **Status:** approved in chat, awaiting spec review
**Scope:** cortex-yocto image layout, boot script, A/B update scripts. No u-boot rebuild.

## Problem

u-boot always sources `boot.scr` from mmc 2 partition 1 (`mmcpart=1`, `bsp_script=boot.scr`,
Variscite's built-in `bsp_bootcmd`), whichever slot is active. Today partition 1 is
**rootfs-a**, so:

- The logic that picks a slot and rolls back a bad one lives *inside slot A*. An update that
  writes slot A rewrites it. A bad `boot.scr` in slot A breaks **both** slots, and rollback
  cannot help, because rollback is that script.
- Boot-script changes only take effect when an update happens to land on slot A (seen
  2026-10-07: the `console=ttymxc0` change needed a slot-A install; `ecofleet-wifi` had to
  guard Bluetooth for units still on the old script).
- The u-boot environment is a single copy at `/dev/mmcblk2` offset `0x700000`
  (`/etc/fw_env.config`; the `.wks` comment saying `0x400000` is stale). The script writes it
  on every trial boot (`bootcount`). If it is ever corrupted, u-boot falls back to its
  built-in defaults, which again load `boot.scr` from partition 1.

No units are in the field yet, so a layout change with a one-time reflash is acceptable.

## Principle

Anything an update writes into a slot can only break **that** slot. The logic that picks a
slot and rolls back lives outside both slots and is never written by an update.

## Layout

| Part | Label | Size | Contents | Written by |
|---|---|---|---|---|
| (raw) | — | — | imx-boot at `IMX_BOOT_SEEK`; u-boot env at `0x700000` | factory flash |
| p1 | `boot` | 32 MB ext4 | `boot.scr` (stable) | factory flash only |
| p2 | `rootfs-a` | 1700 MB ext4 | slot A | factory flash, updates |
| p3 | `rootfs-b` | 1700 MB ext4 | slot B | updates |
| p4 | `data` | 64 MB ext4 | `/data` (by label, unchanged) | runtime |

Total about 3.5 GB, which fits the 3.7 GiB eMMC (MSDOS table, 4 primary partitions). u-boot's
built-in defaults (`mmcpart=1`, `bootdir=/boot`, `bsp_script=boot.scr`) already point at p1,
so no u-boot environment default needs to change. p1 is not mounted in Linux.

## Stable boot script (`ecofleet-boot.cmd` → `boot.scr` on p1)

1. `devnum` fallback as today (`devnum` → `mmcdev` → 1).
2. `slot_active` defaults to `a` (and is saved), as today.
3. **Rollback trial, unchanged:** `bootlimit=3`, and while `upgrade_available=1` it counts
   `bootcount` with `saveenv` before `booti`, flipping `slot_active` once the count passes the limit.
4. Slot → partition: `a` → 2, `b` → 3.
5. **Load the kernel `/boot/Image.gz` and DTB `/boot/imx8mm-var-dart-dt8mcustomboard.dtb` from
   the slot.** If either load fails, or `booti` returns, switch `slot_active` to the other slot,
   clear the trial (`upgrade_available=0`, `bootcount=0`), `saveenv`, and try that slot **in the
   same boot pass** (a two-iteration loop). There is no `reset`: u-boot's reset goes through the
   same WDOG path that hangs this board. Doing it in one pass also means there can be no reset
   loop. If both slots fail, it prints an error and stops.
6. **Per-slot extra kernel arguments (optional):** if the slot has `/boot/ecofleet-bootargs.env`,
   load it and run `env import -t ${loadaddr} ${filesize} ecofleet_extra_args` (a whitelist:
   only that variable is imported). Otherwise `ecofleet_extra_args` is empty. A slot file can
   never change `slot_active`, `bootcount` or `upgrade_available`.
7. `bootargs = console=ttymxc0,115200 root=/dev/mmcblk${devnum}p${part} rootwait rw quiet ${ecofleet_extra_args}`
8. `booti`. If `booti` returns, the same failure handling as step 5 applies.

## Linux side

- **`scripts/pre-install.sh`:** inactive slot device is `/dev/mmcblk2p3` when slot a is
  active, `/dev/mmcblk2p2` when slot b is active. **Safety guard:** before linking, check
  the target is slot-sized (`/sys/class/block/<dev>/size` = 3481600 sectors = 1700 MiB) and exit
  non-zero otherwise, which makes swupdate abort. Labels can't be used: a slot written by an
  update has no label (the rootfs image carries none). Without it, an old-layout unit (p3 = `data`) receiving
  a new-layout update would overwrite `/data`. Update `scripts/tests/test-ab-slot-scripts.sh`.
- **Auto-mount ignore lists** (`ecofleet-data`): boot p1, slots p2 and p3, data p4 (the data
  file changes from p3 to p4).
- **`ecofleet-emmc.wks.in`:** the new four-partition layout. p1 comes from a small ext4 image
  that contains only `/boot/boot.scr`. Fix the env-offset comment (`0x700000`).
- **`ecofleet-bootscript` recipe:** builds `boot.scr` and deploys it for the wic boot partition
  (`DEPLOYDIR`); it no longer installs `/boot/boot.scr` into the rootfs. The image's wic step
  depends on it (`WKS_FILE_DEPENDS` / `do_image_wic[depends]`).
- **Per-slot args file:** none shipped by default. The mechanism exists for future
  slot-specific kernel arguments.
- Docs: update the OTA and flash notes that mention p1/p2.

## Changing the boot script later

Only by a deliberate reflash of p1 (bench/factory). A signed "bootloader update" artifact is a
possible future project and is out of scope. Because the script reads the per-slot args file,
most kernel-argument changes no longer need a boot-script change at all.

## Migration

Units need one full `.wic` reflash (today: .86 and bench units). For .86:

1. Back up `/data` (`/data/wifi`, time zone, `/data/ecofleet` fault log) to the Mac.
2. Reflash the `.wic`, then restore `/data` content.
3. `ecofleet_tz` and other env variables are re-set from `/data` as today.

## Testing (bench, .86, after reflash)

1. First boot is slot A from p2. `/proc/cmdline` has `root=/dev/mmcblk2p2`. p1 is not mounted.
2. A normal update installs to p3 and boots slot B. Another update goes back to p2 and slot A.
3. **Rollback:** a slot that never confirms falls back after `bootlimit` boots (existing
   behaviour, re-verified).
4. **Missing kernel:** delete `/boot/Image.gz` in the inactive slot and activate it. The same
   boot falls back to the good slot.
5. **Both slots bad:** it tries both in one pass, then stops with an error (no reset loop).
   Restore by reflash.
6. **Wiped env:** zero the env area (`dd` at `0x700000`, 16 KiB). The unit still boots slot A.
7. **Bad per-slot args file:** a slot with `ecofleet-bootargs.env` that also tries to set
   `slot_active` changes only `ecofleet_extra_args`. A slot whose args stop the kernel booting
   rolls back.
8. Regression: WiFi + Bluetooth, RS-485 (`/dev/ecofleet-rs485`), reboot / panic recovery
   (PMIC restart handler), no stale mounts during an update, panel software update.

`scripts/tests/test-ab-slot-scripts.sh` covers the pre/post-install mapping on the host. The
u-boot script is verified on the bench, since there is no host u-boot test harness.

## Out of scope

- u-boot redundant environment (`CONFIG_ENV_OFFSET_REDUND`), which needs a u-boot rebuild; a later follow-up.
- WDOG_B → PMIC hardware path (4b): the PMIC is already set to cold reset (`PWRCTRL0=0xA2`), and the signal
  does not reach it. That needs Robb with a scope.
