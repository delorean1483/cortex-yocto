# Stable Boot Partition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the u-boot boot script out of the A/B root slots onto its own partition, so no update can break slot selection or rollback.

**Architecture:** The eMMC gets four partitions: p1 `boot` (32 MB, holds only the stable `boot.scr`), p2/p3 the root slots, p4 `/data`. u-boot's built-in defaults already source `boot.scr` from partition 1, so no u-boot change is needed. The stable script picks the slot, keeps the existing rollback trial, and imports an optional, whitelisted per-slot kernel-argument file. If a slot fails to load or boot, it tries the other slot in the same pass, with no `reset`. The swupdate pre-install script targets p2/p3 and refuses any target that isn't slot-sized.

**Tech Stack:** Yocto/OE (wic `.wks`, `bootimg-partition`, `deploy` class), u-boot hush script (`mkimage -T script`), POSIX sh, Python 3 (host check), swupdate.

**Spec:** `docs/superpowers/specs/2026-10-07-boot-partition-design.md`

## Global Constraints

- Layout (MSDOS table): p1 `boot` 32 MiB ext4 · p2 `rootfs-a` 1700 MiB ext4 · p3 `rootfs-b` 1700 MiB ext4 · p4 `data` 64 MiB ext4. All `--align 8192`.
- The u-boot env is at `/dev/mmcblk2` offset `0x700000`, size `0x4000` (`/etc/fw_env.config`). p1 must start at or after 8 MiB, past the env.
- Slot → partition: `a` → 2, `b` → 3. Slot size check: `/sys/class/block/<dev>/size` = **3481600** sectors.
- Base kernel command line: `console=ttymxc0,115200 root=/dev/mmcblk${devnum}p${part} rootwait rw quiet` plus `${ecofleet_extra_args}`.
- Kernel `/boot/Image.gz`; DTB `/boot/imx8mm-var-dart-dt8mcustomboard.dtb`; `kernel_comp_addr_r 0x44000000`, `kernel_comp_size 0x4000000`.
- Per-slot args file: `/boot/ecofleet-bootargs.env` in the slot, imported with `env import -t ${loadaddr} ${filesize} ecofleet_extra_args` (whitelist only).
- The boot script never calls `reset`: u-boot's reset goes through the WDOG path that hangs this board.
- Updates never write p1. The rootfs no longer contains `/boot/boot.scr`.
- Releases are tag-gated in CI. Branch builds run via `gh workflow run build.yml -R delorean1483/cortex-yocto --ref <branch>`, and the artifact is `ecofleet-bench-image` (`.swu`, `.wic.zst`, `.wic.bmap`).
- `gh` must always get `-R delorean1483/cortex-yocto`.

## Review Focus

1. **An old-layout unit (p3 = data) receives a new-layout `.swu`:** the update must abort, not overwrite `/data`. Pinned by the Task 1 test `old layout: refuse to write data partition`.
2. **The u-boot env is wiped or corrupt:** the unit must still boot slot A from p2. Pinned by Task 5, step 6.
3. **A per-slot args file that also tries to set `slot_active`/`bootcount`/`upgrade_available`:** it must change only `ecofleet_extra_args`. Pinned by Task 5, step 7.
4. **The active slot's kernel is missing or unreadable:** the same boot must fall back to the other slot. Pinned by Task 5, step 4.
5. **Both slots unbootable:** there must be no reset loop; it stops with a message. Pinned by Task 5, step 5.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/pre-install.sh` (modify) | swupdate preinst: choose inactive slot p2/p3, refuse non-slot-sized targets |
| `scripts/tests/test-ab-slot-scripts.sh` (modify) | host test of the pre/post-install slot mapping + the size guard |
| `scripts/tests/check-wic-layout.py` (create) | host check of a built `.wic(.zst)`: partition table + p1 contents |
| `meta-ecofleet/recipes-bsp/ecofleet-bootscript/files/ecofleet-boot.cmd` (rewrite) | the stable u-boot script |
| `meta-ecofleet/recipes-bsp/ecofleet-bootscript/ecofleet-bootscript.bb` (modify) | build `boot.scr`, deploy it for wic, install nothing into the rootfs |
| `meta-ecofleet/wic/ecofleet-emmc.wks.in` (modify) | the four-partition layout |
| `meta-ecofleet/recipes-core/images/ecofleet-image.bb` (modify) | `IMAGE_BOOT_FILES`, wic depends on the script deploy, drop bootscript from the rootfs |
| `meta-ecofleet/recipes-ecofleet/ecofleet-data/files/ecofleet-data.ignorelist` (modify) | data is p4 |
| `meta-ecofleet/recipes-ecofleet/ecofleet-data/files/ecofleet-slots.ignorelist` (modify) | boot p1 + slots p2, p3 |

`ecofleet-slots.ignorelist` arrives with PR #94 (`fix/no-automount-slots`). If #94 is not merged when Task 4 starts, merge `main` into this branch first, or create the file in Task 4 with the content given there.

---

### Task 1: pre-install targets p2/p3 and refuses non-slot partitions

**Files:**
- Modify: `scripts/pre-install.sh`
- Test: `scripts/tests/test-ab-slot-scripts.sh`

**Interfaces:**
- Consumes: nothing.
- Produces: `pre-install.sh preinst` links `/dev/swupdate-inactive` → `/dev/mmcblk2p3` (active a) or `/dev/mmcblk2p2` (active b), and writes `/tmp/next-slot`. It exits 1 without linking if `${ECOFLEET_SYS_BLOCK:-/sys/class/block}/<dev>/size` ≠ 3481600.

- [ ] **Step 1: Write the failing test**

Replace the whole of `scripts/tests/test-ab-slot-scripts.sh` with:

```sh
#!/bin/sh
# Regression test for the A/B slot OTA scripts (pre-install.sh / post-install.sh).
#
# swupdate runs a "shellscript" in BOTH the preinst and postinst phases, passing
# the phase name as $1. The scripts MUST guard on $1 so that:
#   - pre-install (points /dev/swupdate-inactive at the inactive slot) runs once,
#     in preinst, before the image write;
#   - post-install (commits slot_active) runs once, in postinst, after the write.
# The original scripts had no guard, so post-install ran in both phases and the
# second run reverted slot_active -> the OTA installed but never activated. That
# bug was only discoverable on real hardware; this test replays swupdate's exact
# call sequence with mocked fw_printenv/fw_setenv/ln so CI catches a regression.
#
# Layout (2026-10-07 boot-partition spec): p1 boot, p2 rootfs-a, p3 rootfs-b,
# p4 data. pre-install must also refuse a target that isn't slot-sized, so an
# old-layout unit (p3 = data) can never have /data overwritten by an update.
set -e
SCRIPTS_DIR=$(cd "$(dirname "$0")/.." && pwd)   # -> scripts/
TMP=$(mktemp -d)
trap 'rm -rf "$TMP" /tmp/next-slot' EXIT
mkdir "$TMP/bin" "$TMP/sys"

cat > "$TMP/bin/fw_printenv" <<'EOF'
#!/bin/sh
[ "$1" = "-n" ] && [ "$2" = "slot_active" ] && cat "$STATE"
exit 0
EOF
cat > "$TMP/bin/fw_setenv" <<'EOF'
#!/bin/sh
[ "$1" = "slot_active" ] && printf '%s' "$2" > "$STATE"
exit 0
EOF
cat > "$TMP/bin/ln" <<'EOF'
#!/bin/sh
for a in "$@"; do case "$a" in /dev/mmcblk*) printf '%s' "$a" > "$LNLOG";; esac; done
exit 0
EOF
chmod +x "$TMP/bin"/*
export PATH="$TMP/bin:$PATH" STATE="$TMP/state" LNLOG="$TMP/lnlog" ECOFLEET_SYS_BLOCK="$TMP/sys"

# Fake /sys/class/block/<dev>/size (512-byte sectors).
layout() { # new | old
    rm -rf "$TMP/sys"/*
    for p in 1 2 3 4; do mkdir -p "$TMP/sys/mmcblk2p$p"; done
    if [ "$1" = new ]; then
        echo 65536   > "$TMP/sys/mmcblk2p1/size"   # boot 32M
        echo 3481600 > "$TMP/sys/mmcblk2p2/size"   # rootfs-a
        echo 3481600 > "$TMP/sys/mmcblk2p3/size"   # rootfs-b
        echo 131072  > "$TMP/sys/mmcblk2p4/size"   # data
    else
        echo 3481600 > "$TMP/sys/mmcblk2p1/size"   # rootfs-a
        echo 3481600 > "$TMP/sys/mmcblk2p2/size"   # rootfs-b
        echo 131072  > "$TMP/sys/mmcblk2p3/size"   # data
    fi
}

# Replay swupdate's call sequence for one OTA; echo "<image_target> <final_slot> <preinst_rc>".
# swupdate stops (no write, no postinst) when the preinst script fails.
replay() {
    printf '%s' "$1" > "$STATE"; : > "$LNLOG"; rm -f /tmp/next-slot
    rc=0
    sh "$SCRIPTS_DIR/pre-install.sh"  preinst  >/dev/null 2>&1 || rc=$?
    if [ "$rc" = 0 ]; then
        sh "$SCRIPTS_DIR/post-install.sh" preinst  >/dev/null 2>&1
        img=$(cat "$LNLOG")                       # symlink target when image is written
        sh "$SCRIPTS_DIR/pre-install.sh"  postinst >/dev/null 2>&1
        sh "$SCRIPTS_DIR/post-install.sh" postinst >/dev/null 2>&1
    else
        img=$(cat "$LNLOG")
    fi
    printf '%s %s %s' "${img:-none}" "$(cat "$STATE")" "$rc"
}

fail=0
check() { # desc  got  want
    if [ "$2" = "$3" ]; then echo "ok   - $1"; else echo "FAIL - $1: got '$2' want '$3'"; fail=1; fi
}
layout new
check "from slot a: image->p3, activate b" "$(replay a)" "/dev/mmcblk2p3 b 0"
check "from slot b: image->p2, activate a" "$(replay b)" "/dev/mmcblk2p2 a 0"
layout old
check "old layout: refuse to write data partition" "$(replay a)" "none a 1"

if [ "$fail" = 0 ]; then echo "PASS"; exit 0; else echo "FAILED"; exit 1; fi
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `sh scripts/tests/test-ab-slot-scripts.sh`
Expected: `FAIL - from slot a: image->p3 ...` (got `/dev/mmcblk2p2 b 0`), `FAIL - from slot b ...` (got `/dev/mmcblk2p1 a 0`), `FAIL - old layout ...` (got `/dev/mmcblk2p2 b 0`), then `FAILED`.

- [ ] **Step 3: Implement**

In `scripts/pre-install.sh`, change the partition-map comment line (line 5) to:

```sh
# Partition map:  mmcblk2p1 = boot (never written here), mmcblk2p2 = rootfs-a,
#                 mmcblk2p3 = rootfs-b, mmcblk2p4 = data
```

and replace the block from `if [ "$ACTIVE" = "a" ]; then` through `echo "pre-install: active slot=..."` with:

```sh
if [ "$ACTIVE" = "a" ]; then
    INACTIVE_DEV=/dev/mmcblk2p3
    NEXT_SLOT=b
else
    INACTIVE_DEV=/dev/mmcblk2p2
    NEXT_SLOT=a
fi

# Refuse anything that isn't a root slot. On the old layout (p1/p2 slots,
# p3 data) "the inactive slot" of a unit on slot a would be /data. Slots carry
# no label once written, so check the size: 1700 MiB = 3481600 sectors.
SYS_BLOCK=${ECOFLEET_SYS_BLOCK:-/sys/class/block}
SECTORS=$(cat "$SYS_BLOCK/$(basename "$INACTIVE_DEV")/size" 2>/dev/null || echo 0)
if [ "$SECTORS" != 3481600 ]; then
    echo "pre-install: ${INACTIVE_DEV} is ${SECTORS} sectors, not a 1700 MiB root slot — wrong partition layout, refusing to install" >&2
    exit 1
fi

echo "pre-install: active slot=${ACTIVE}, writing to ${INACTIVE_DEV} (slot ${NEXT_SLOT})"
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `sh scripts/tests/test-ab-slot-scripts.sh`
Expected: three `ok` lines and `PASS`.

- [ ] **Step 5: Commit**

```bash
git add scripts/pre-install.sh scripts/tests/test-ab-slot-scripts.sh
git commit -m "feat(ota): pre-install targets slots p2/p3 and refuses non-slot partitions"
```

---

### Task 2: Host check for the built image layout

**Files:**
- Create: `scripts/tests/check-wic-layout.py`

**Interfaces:**
- Consumes: a `.wic` or `.wic.zst` path (needs `zstd` on PATH for `.zst`).
- Produces: `python3 scripts/tests/check-wic-layout.py <image>`. It exits 0 and prints `PASS` when the layout and p1 contents match; otherwise it exits 1 and prints one `FAIL - …` line per problem. Task 4 uses it on the branch build.

- [ ] **Step 1: Write the check**

```python
#!/usr/bin/env python3
"""Check a built EcoFleet eMMC image (.wic or .wic.zst) against the A/B layout:
p1 boot 32 MiB, p2 rootfs-a 1700 MiB, p3 rootfs-b 1700 MiB, p4 data 64 MiB,
p1 past the u-boot env (0x700000 + 0x4000), and p1 holding the stable boot
script. Reads only the first 64 MiB (MBR + p1).

Usage: python3 scripts/tests/check-wic-layout.py <image.wic[.zst]>
"""
import struct
import subprocess
import sys

MIB = 1024 * 1024
EXPECT = [("boot", 32), ("rootfs-a", 1700), ("rootfs-b", 1700), ("data", 64)]
ENV_END = 0x700000 + 0x4000
P1_NEEDLES = (b"EcoFleet boot script", b"ecofleet_extra_args")


def read_head(path, n):
    if path.endswith(".zst"):
        proc = subprocess.Popen(["zstd", "-dc", path], stdout=subprocess.PIPE)
        data = proc.stdout.read(n)
        proc.kill()
        proc.wait()
        return data
    with open(path, "rb") as f:
        return f.read(n)


def ext4_label(part):
    sb = part[1024:2048]                       # ext4 superblock
    if struct.unpack("<H", sb[0x38:0x3A])[0] != 0xEF53:
        return None
    return sb[0x78:0x88].split(b"\0")[0].decode(errors="replace")


def check(data):
    errs = []
    if data[510:512] != b"\x55\xaa":
        return ["no MBR signature"]
    parts = []
    for i in range(4):
        e = data[446 + 16 * i: 462 + 16 * i]
        start, count = struct.unpack("<II", e[8:16])
        if e[4]:
            parts.append((start, count))
    if len(parts) != len(EXPECT):
        return [f"expected {len(EXPECT)} partitions, got {len(parts)}"]
    for (start, count), (name, size) in zip(parts, EXPECT):
        if count * 512 != size * MIB:
            errs.append(f"{name}: {count * 512 / MIB:g} MiB, want {size}")
    if parts[0][0] * 512 < ENV_END:
        errs.append("p1 starts inside the u-boot env (0x700000)")
    if any(parts[i][0] <= parts[i - 1][0] for i in range(1, len(parts))):
        errs.append("partitions are not in disk order")
    p1 = data[parts[0][0] * 512:(parts[0][0] + parts[0][1]) * 512]
    if ext4_label(p1) != "boot":
        errs.append(f"p1 ext4 label is {ext4_label(p1)!r}, want 'boot'")
    for needle in P1_NEEDLES:
        if needle not in p1:
            errs.append(f"p1 does not contain {needle.decode()!r} (boot.scr missing?)")
    return errs


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    errs = check(read_head(sys.argv[1], 64 * MIB))
    for e in errs:
        print(f"FAIL - {e}")
    print("PASS" if not errs else "FAILED")
    return 0 if not errs else 1


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Run it against the current release and confirm it fails**

```bash
D=$(mktemp -d) && gh release download v1.2.75 -R delorean1483/cortex-yocto -p '*.wic.zst' -D "$D"
python3 scripts/tests/check-wic-layout.py "$D"/*.wic.zst
```
Expected: `FAIL - expected 4 partitions, got 3`, then `FAILED`, exit 1.

- [ ] **Step 3: Commit**

```bash
git add scripts/tests/check-wic-layout.py
git commit -m "test(image): host check for the eMMC partition layout and boot script"
```

---

### Task 3: The stable boot script, deployed for wic instead of installed in the rootfs

**Files:**
- Rewrite: `meta-ecofleet/recipes-bsp/ecofleet-bootscript/files/ecofleet-boot.cmd`
- Modify: `meta-ecofleet/recipes-bsp/ecofleet-bootscript/ecofleet-bootscript.bb`

**Interfaces:**
- Consumes: nothing.
- Produces: `${DEPLOY_DIR_IMAGE}/ecofleet-boot.scr` (mkimage script, name `EcoFleet boot script`) from `ecofleet-bootscript:do_deploy`. The package installs nothing. Task 4 maps it to `/boot/boot.scr` on p1.

- [ ] **Step 1: Rewrite `ecofleet-boot.cmd`**

```
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
```

- [ ] **Step 2: Update the recipe**

Replace `ecofleet-bootscript.bb` with:

```
SUMMARY = "EcoFleet stable u-boot boot script (eMMC boot partition)"
DESCRIPTION = "Builds boot.scr and deploys it as ecofleet-boot.scr for the wic \
'boot' partition (p1). Nothing is installed into the root filesystem: the \
script lives outside both A/B slots so an update can never rewrite it."
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = "file://ecofleet-boot.cmd"

inherit deploy nopackages

DEPENDS = "u-boot-mkimage-native"

do_compile() {
    mkimage -A arm64 -O linux -T script -C none \
        -n "EcoFleet boot script" \
        -d ${WORKDIR}/ecofleet-boot.cmd \
        ${WORKDIR}/boot.scr
}

do_deploy() {
    install -m 0644 ${WORKDIR}/boot.scr ${DEPLOYDIR}/ecofleet-boot.scr
}
addtask deploy after do_compile before do_build
```

- [ ] **Step 3: Check that the script compiles (if `mkimage` is available on the Mac)**

Run: `command -v mkimage && mkimage -A arm64 -O linux -T script -C none -n "EcoFleet boot script" -d meta-ecofleet/recipes-bsp/ecofleet-bootscript/files/ecofleet-boot.cmd /tmp/boot.scr && strings /tmp/boot.scr | grep -c ecofleet_extra_args`
Expected: a number ≥ 1, or no output if mkimage isn't installed. The CI build in Task 4 is the authoritative compile.

- [ ] **Step 4: Commit**

```bash
git add meta-ecofleet/recipes-bsp/ecofleet-bootscript
git commit -m "feat(boot): stable boot script for the boot partition, same-pass slot fallback"
```

---

### Task 4: Four-partition image, wired up and checked

**Files:**
- Modify: `meta-ecofleet/wic/ecofleet-emmc.wks.in`
- Modify: `meta-ecofleet/recipes-core/images/ecofleet-image.bb`
- Modify: `meta-ecofleet/recipes-ecofleet/ecofleet-data/files/ecofleet-data.ignorelist`
- Modify (or create, see File Structure): `meta-ecofleet/recipes-ecofleet/ecofleet-data/files/ecofleet-slots.ignorelist`

**Interfaces:**
- Consumes: `ecofleet-boot.scr` in `DEPLOY_DIR_IMAGE` (Task 3) and `check-wic-layout.py` (Task 2).
- Produces: a branch-build artifact `ecofleet-bench-image` whose `.wic.zst` passes `check-wic-layout.py`. Task 5 flashes it.

- [ ] **Step 1: The layout**

Replace `ecofleet-emmc.wks.in` with:

```
# EcoFleet eMMC layout for 4GB eMMC (imx8mm-var-dart) — stable boot + A/B slots
#
# WARNING: changing the layout REQUIRES a full reflash of existing boards.
# There is no in-place migration path.
#
# Map (MSDOS, imx-boot raw-copied below the partition table):
#   [0x0 .. seek]   imx-boot (SPL + u-boot proper, no partition entry)
#   [gap]           u-boot env at 0x700000 (16 KiB) — /etc/fw_env.config
#   p1  boot         32M ext4  ← stable boot.scr ONLY; never written by an update
#   p2  rootfs-a   1700M ext4  ← active slot on first boot
#   p3  rootfs-b   1700M ext4  ← inactive slot, filled by OTA
#   p4  data         64M ext4  ← persistent /data mount (by label)
#
# u-boot's built-in bsp_bootcmd sources boot.scr from partition 1, so the boot
# logic survives a wiped environment. Total ~3496M < 3.7GiB usable.

part u-boot --source rawcopy --sourceparams="file=imx-boot" --ondisk mmcblk --no-table --align ${IMX_BOOT_SEEK}
part        --source bootimg-partition --ondisk mmcblk --fstype=ext4 --label boot --align 8192 --fixed-size 32M
part /      --source rootfs  --ondisk mmcblk --fstype=ext4 --label rootfs-a --align 8192 --fixed-size 1700M
part        --ondisk mmcblk --fstype=ext4 --label rootfs-b --align 8192 --fixed-size 1700M
part /data  --ondisk mmcblk --fstype=ext4 --label data     --align 8192 --fixed-size 64M

bootloader --ptable msdos
```

- [ ] **Step 2: Image recipe**

In `ecofleet-image.bb`:
- Remove the line `    ecofleet-bootscript \` from the main `IMAGE_INSTALL:append` list.
- After the `WKS_FILE:mx8-nxp-bsp = "ecofleet-emmc.wks.in"` line, add:

```
# The wic "boot" partition (p1) carries only the stable boot script, deployed
# by ecofleet-bootscript; it is never part of the root filesystem.
IMAGE_BOOT_FILES = "ecofleet-boot.scr;boot/boot.scr"
do_image_wic[depends] += "ecofleet-bootscript:do_deploy"
```

- [ ] **Step 3: Auto-mount ignore lists**

`ecofleet-data.ignorelist`: change the comment's `mmcblk2p3` to `mmcblk2p4`, and the device line to `/dev/mmcblk2p4`.

`ecofleet-slots.ignorelist`: replace the whole file with:

```
# Keep udev's automounter off the boot partition and both A/B root slots
# (ecofleet-emmc.wks: p1 = boot, p2 = A, p3 = B). The running slot is already
# "/", so this only affects the boot partition and the inactive slot, which
# swupdate rewrites raw during an update. Left auto-mounted rw at
# /run/media/mmcblk2pN, a stale mount sits on top of the freshly written
# filesystem and could write old metadata back into it.
/dev/mmcblk2p1
/dev/mmcblk2p2
/dev/mmcblk2p3
```

- [ ] **Step 4: Commit, push, branch build**

```bash
git add meta-ecofleet
git commit -m "feat(image): four-partition layout with a stable boot partition"
git push -u origin feat/boot-partition
gh workflow run build.yml -R delorean1483/cortex-yocto --ref feat/boot-partition
```
Wait for the run (`gh run watch <id> -R delorean1483/cortex-yocto --exit-status`). Expected: success.

- [ ] **Step 5: Run the layout check on the build**

```bash
D=$(mktemp -d) && gh run download <id> -R delorean1483/cortex-yocto -n ecofleet-bench-image -D "$D"
python3 scripts/tests/check-wic-layout.py "$D"/*.wic.zst
sh scripts/tests/test-ab-slot-scripts.sh
```
Expected: `PASS` from both.

If wic rejects `bootimg-partition` with ext4, or `IMAGE_BOOT_FILES` puts the file elsewhere, fix it in this task. The check is what decides.

---

### Task 5: Bench migration and verification on .86 (user at the bench)

Needs the user physically: an SD card for booting .86 off-eMMC, and power access. All steps run from the Mac.

**Files:** none (bench). Record results in the PR description.

**Interfaces:**
- Consumes: the Task 4 artifact.
- Produces: .86 on the new layout, verified.

- [ ] **Step 1: Back up /data from .86**

```bash
mkdir -p ~/ecofleet-backup && ssh root@192.168.0.86 'tar -C /data -czf - .' > ~/ecofleet-backup/86-data-$(date +%Y%m%d).tgz
```
Expected: a non-empty `.tgz` containing `wifi/` and `ecofleet/`.

- [ ] **Step 2: Flash the new image to eMMC**

Write the `.wic` to an SD card on the Mac (the user does this; the bench method is the existing one). Boot .86 from SD (SD is first in `boot_targets`), then from the Mac:

```bash
zstd -dc "$D"/*.wic.zst | ssh root@<sd-booted-ip> 'for m in $(grep -o "^/dev/mmcblk2p[0-9]*" /proc/mounts); do umount $m; done; dd of=/dev/mmcblk2 bs=4M conv=fsync'
```
Then power off, remove the SD, and power on (eMMC boot).

- [ ] **Step 3: First boot checks**

```bash
ssh root@192.168.0.86 'cat /proc/cmdline; fw_printenv slot_active; lsblk -o NAME,SIZE,LABEL /dev/mmcblk2; grep mmcblk2 /proc/mounts; ls /boot/boot.scr 2>&1'
```
Expected: `root=/dev/mmcblk2p2`; slot `a` (or unset); four partitions with labels boot/rootfs-a/rootfs-b/data; only p2 (`/`) and p4 (`/data`) mounted; `/boot/boot.scr` absent from the rootfs. Restore /data: `ssh root@192.168.0.86 'tar -C /data -xzf -' < ~/ecofleet-backup/86-data-*.tgz`, then reboot.

- [ ] **Step 4: Updates both ways, plus missing-kernel fallback**

1. Install the same `.swu` (`swupdate -i … -f /etc/swupdate/ecofleet.cfg`). Expected: pre-install says `writing to /dev/mmcblk2p3 (slot b)`. Reboot, and `root=/dev/mmcblk2p3`, trial confirmed.
2. Install again. Expected: `/dev/mmcblk2p2 (slot a)`, and it boots p2.
3. Missing kernel: install once more (to p3, now `slot_active=b`, trial armed). Before rebooting, `mkdir -p /mnt/x && mount /dev/mmcblk2p3 /mnt/x && rm /mnt/x/boot/Image.gz && umount /mnt/x`, then reboot. Expected: the unit comes back on `root=/dev/mmcblk2p2` in **one** boot, `fw_printenv slot_active` = `a`, `upgrade_available` = 0.

- [ ] **Step 5: Both slots unbootable (needs serial or eyes on the console)**

Only with serial access. Remove `Image.gz` from p3 (the inactive slot) and, from u-boot or a rescue SD, from p2. Expected: the console shows both `booting slot` lines and then `neither slot could be booted; reflash required`, with no reset loop. Restore by reflashing (step 2). If there's no serial console, skip this step and note it in the PR.

- [ ] **Step 6: Wiped u-boot environment**

```bash
ssh root@192.168.0.86 'dd if=/dev/zero of=/dev/mmcblk2 bs=1024 seek=7168 count=16 conv=fsync && reboot'
```
Expected: the unit comes back on `root=/dev/mmcblk2p2` (slot a, from u-boot defaults + p1 script); `fw_printenv slot_active` = `a`. (The time zone and location come back from `/data` on their own.)

- [ ] **Step 7: Per-slot args file can't touch slot state**

On the inactive slot (p3), create `/boot/ecofleet-bootargs.env` containing:

```
ecofleet_extra_args=ecofleet_test=1
slot_active=a
bootcount=99
upgrade_available=0
```
Activate p3 (`fw_setenv slot_active b; fw_setenv upgrade_available 1; fw_setenv bootcount 0`), then reboot. Expected: `root=/dev/mmcblk2p3`, `/proc/cmdline` contains `ecofleet_test=1`, `fw_printenv slot_active` = `b`, `bootcount` = 1 or 0 (cleared by boot-confirm), never 99. Afterwards, delete the file.

- [ ] **Step 8: Regression**

```bash
ssh root@192.168.0.86 'ls /sys/class/bluetooth; ls -l /dev/ecofleet-rs485; lsmod | grep -c pmic_restart; systemctl --failed --no-legend | wc -l; grep -o "\"apu_fw_version\":[0-9]*" /var/lib/ecofleet/latest.json'
```
Expected: `hci0`, the link present, `1`, `0`, `10106`. Plain `reboot` comes back on its own. The panel's Software Update screen shows a status.

- [ ] **Step 9: Open the PR**

```bash
gh pr create -R delorean1483/cortex-yocto --base main --head feat/boot-partition --title "feat(boot): stable boot partition — boot script outside both A/B slots"
```
In the body, list the results of steps 3–8 and whether step 5 ran.
