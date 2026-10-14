#!/usr/bin/env python3
"""Stop U-Boot at its prompt over serial, run commands there, optionally boot.

Works with both autoboot styles:
  - "Hit any key to stop autoboot"  (dev kit U-Boot today): any byte stops it
  - "Autoboot in N seconds - type ecofleet to stop" (keyed, R1 U-Boot)
The stop string is sent repeatedly during the 1 s delay, which a person can't
type in time. With --no-stop it sends only noise (spaces) instead, to prove
that stray bytes do NOT stop a keyed autoboot.

Stdlib only (termios + select), like capture-warm-reboot.py.

Usage:
  uboot-console.py [--port P] [--trigger CMD] [--boot] [--no-stop] -- 'cmd' ...

  --trigger runs CMD (e.g. "ssh root@192.168.0.86 reboot") after the port is
  open; otherwise power-cycle the board yourself once it says "waiting".

Example (.86):
  uboot-console.py --trigger 'ssh root@192.168.0.86 reboot' --boot -- \
      'i2c bus' 'i2c dev 2' \
      'if i2c probe 0x6f; then echo PROBE-6F=FOUND; else echo PROBE-6F=NONE; fi'
"""

import argparse
import glob
import os
import select
import subprocess
import sys
import termios
import time

PROMPT = b"u-boot=> "
AUTOBOOT = (b"Hit any key to stop autoboot", b"Autoboot in")
STOP_STR = b"ecofleet"


def open_port(path):
    fd = os.open(path, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
    a = termios.tcgetattr(fd)
    a[0] = 0                                                # iflag: raw
    a[1] = 0                                                # oflag: raw
    a[2] = termios.CS8 | termios.CREAD | termios.CLOCAL     # 8N1
    a[3] = 0                                                # lflag: raw
    a[4] = a[5] = termios.B115200
    a[6][termios.VMIN] = 0
    a[6][termios.VTIME] = 0
    termios.tcsetattr(fd, termios.TCSANOW, a)
    termios.tcflush(fd, termios.TCIOFLUSH)
    return fd


def read_until(fd, markers, timeout):
    """Echo serial output; return (data, marker) at the first marker or timeout."""
    buf = b""
    end = time.time() + timeout
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.05)
        if not r:
            continue
        chunk = os.read(fd, 4096)
        sys.stdout.write(chunk.decode(errors="replace"))
        sys.stdout.flush()
        buf += chunk
        for m in markers:
            if m in buf:
                return buf, m
    return buf, None


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--port", default=None, help="serial device (default: first /dev/cu.usbserial-*)")
    ap.add_argument("--trigger", default=None, help="shell command that reboots the board")
    ap.add_argument("--boot", action="store_true", help="send 'boot' after the commands")
    ap.add_argument("--no-stop", action="store_true",
                    help="send only spaces at the autoboot prompt (keyed autoboot must ignore them)")
    ap.add_argument("--timeout", type=float, default=90, help="seconds to wait for the autoboot prompt")
    ap.add_argument("cmds", nargs="*")
    args = ap.parse_args()

    port = args.port or (sorted(glob.glob("/dev/cu.usbserial-*")) or [None])[0]
    if not port:
        sys.exit("no serial port found (plug in the console cable or pass --port)")
    fd = open_port(port)
    print(f"[uboot-console] {port}: waiting for the autoboot prompt "
          f"({'trigger: ' + args.trigger if args.trigger else 'power-cycle the board now'})")
    if args.trigger:
        subprocess.Popen(args.trigger, shell=True)

    _, m = read_until(fd, AUTOBOOT, args.timeout)
    if not m:
        sys.exit("\n[uboot-console] no autoboot prompt seen")

    noise = b" " if args.no_stop else STOP_STR
    end = time.time() + 6
    got = None
    while time.time() < end and not got:
        os.write(fd, noise)
        _, got = read_until(fd, (PROMPT, b"Starting kernel", b"booting slot"), 0.1)
    if got != PROMPT:
        print(f"\n[uboot-console] autoboot NOT stopped (saw {got!r})")
        sys.exit(0 if args.no_stop else 1)
    if args.no_stop:
        print("\n[uboot-console] FAIL: noise stopped autoboot")
        sys.exit(1)

    # Leftover stop-string bytes may sit on the command line: Ctrl-C clears it.
    os.write(fd, b"\x03")
    read_until(fd, (PROMPT,), 2)
    for cmd in args.cmds:
        os.write(fd, cmd.encode() + b"\r")
        _, m = read_until(fd, (PROMPT,), 15)
        if not m:
            sys.exit(f"\n[uboot-console] no prompt after: {cmd}")
    if args.boot:
        os.write(fd, b"boot\r")
        read_until(fd, (b"Starting kernel",), 30)
    print("\n[uboot-console] done")


if __name__ == "__main__":
    main()
