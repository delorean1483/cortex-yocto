#!/usr/bin/env python3
"""Host test for docs/bench/tools/uboot-console.py against a fake U-Boot on a pty.

The bench helper is how Review Focus 2 (stray bytes on UART1 must not stop the
keyed autoboot) gets proved on hardware, so a run that saw nothing after the
autoboot prompt must not pass. Cases:
  anykey      stop with the stop string, run a command, boot     -> exit 0
  keyed       same against keyed autoboot                        -> exit 0
  keyed-boot  --no-stop, the board boots on its own              -> exit 0
  keyed-quiet --no-stop, the console goes silent after the prompt -> exit 1
  usb-late    --port is a glob: R1's USB console port only appears once U-Boot
              runs (and a stale port from Linux may still be listed); stop,
              run a command, boot                                  -> exit 0
Usage: python3 scripts/tests/test-uboot-console.py
"""
import os
import select
import subprocess
import sys
import threading
import time
import tempfile
import tty

HELPER = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                      "../../docs/bench/tools/uboot-console.py")


def fake_uboot(master, mode, link=None, slave_path=None):
    if link:
        # The board resets: its USB port shows up a while after the helper
        # started waiting, and U-Boot's output only flows once it is open.
        time.sleep(1.0)
        os.symlink(slave_path, link)
    time.sleep(0.5)
    os.write(master, b"U-Boot 2024.04\r\n")
    keyed = mode.startswith("keyed") or mode == "usb-late"
    os.write(master, b"Autoboot in 1 seconds - type ecofleet to stop\r\n" if keyed
             else b"Hit any key to stop autoboot:  1 \r\n")
    buf, end, stopped = b"", time.time() + 1.0, False
    while time.time() < end:
        r, _, _ = select.select([master], [], [], 0.05)
        if r:
            buf += os.read(master, 100)
            if (not keyed and buf) or (keyed and b"ecofleet" in buf):
                stopped = True
                break
    if not stopped:
        if mode != "keyed-quiet":
            os.write(master, b"==> EcoFleet: booting slot a (mmc 2 p2)\r\nStarting kernel ...\r\n")
        return
    os.write(master, b"\r\nu-boot=> ")
    line = b""
    while True:
        r, _, _ = select.select([master], [], [], 5)
        if not r:
            return
        for ch in os.read(master, 100):
            ch = bytes([ch])
            if ch == b"\x03":
                os.write(master, b"<INTERRUPT>\r\nu-boot=> ")
                line = b""
            elif ch == b"\r":
                os.write(master, b"\r\n")
                if line == b"boot":
                    os.write(master, b"Starting kernel ...\r\n")
                    return
                if line == b"version":
                    os.write(master, b"U-Boot 2024.04\r\n")
                os.write(master, b"u-boot=> ")
                line = b""
            else:
                line += ch
                os.write(master, ch)


def run(mode, args):
    master, slave = os.openpty()
    tty.setraw(master)
    port, link, extra = os.ttyname(slave), None, []
    if mode == "usb-late":
        d = tempfile.mkdtemp()
        # A stale port (Linux's gadget, about to vanish) that must be ignored:
        # it is a pty nobody answers on.
        stale_m, stale_s = os.openpty()
        extra = [stale_m, stale_s]
        os.symlink(os.ttyname(stale_s), os.path.join(d, "port-old"))
        link, port = os.path.join(d, "port-new"), os.path.join(d, "port-*")
    t = threading.Thread(target=fake_uboot, args=(master, mode, link, os.ttyname(slave)), daemon=True)
    t.start()
    p = subprocess.run([sys.executable, HELPER, "--port", port, "--timeout", "5"] + args,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=60)
    t.join(timeout=8)
    for fd in [slave, master] + extra:
        os.close(fd)
    return p.returncode, p.stdout.decode(errors="replace")


CASES = [
    ("anykey", ["--boot", "--", "version"], 0),
    ("keyed", ["--boot", "--", "version"], 0),
    ("keyed-boot", ["--no-stop"], 0),
    ("keyed-quiet", ["--no-stop"], 1),
    ("usb-late", ["--boot", "--", "version"], 0),
]

fail = 0
for mode, args, want in CASES:
    rc, out = run(mode, args)
    if rc == want:
        print(f"ok   - {mode}: exit {rc}")
    else:
        print(f"FAIL - {mode}: exit {rc}, want {want}\n{out}")
        fail = 1
print("PASS" if not fail else "FAILED")
sys.exit(fail)
