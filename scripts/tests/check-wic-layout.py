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
