#!/usr/bin/env python3
"""Capture the i.MX8M warm-reboot hang point over serial.

Plan step 1 of docs/superpowers/plans/2026-09-15-warm-reboot-hang-followup.md:
with serial attached, trigger a warm `reboot` and record the LAST serial line
before silence. That single line says which boot stage wedges (boot ROM vs
TF-A vs SPL DDR-init vs u-boot) and disambiguates the candidate fixes.

What this does:
  - Opens the board's debug UART (115200 8N1) and echoes it live, like `screen`.
  - Writes a timestamped log so you can see exactly when output stopped.
  - Recognizes the boot-stage banners (TF-A BL31 / U-Boot SPL / U-Boot) so you
    know at a glance how far the reboot got.
  - Flags silence gaps. Linux -> "reboot: Restarting system" -> then either a
    fresh boot banner (reboot works) or growing [SILENCE] with no banner (HANG).
  - On Ctrl-C (or a long silence) prints a verdict + the tail + the log path.

No third-party deps (pure stdlib termios) -- nothing to pip install at the bench.

Usage:
    python3 capture-warm-reboot.py                    # auto-detect the FTDI port
    python3 capture-warm-reboot.py /dev/cu.usbserial-XXXX
    python3 capture-warm-reboot.py --baud 115200 --silence 15 --logdir .

Then, in a SECOND terminal, trigger the warm reboot on the device:
    ssh root@192.168.0.86 reboot
...and watch THIS window. Recover from a hang with a COLD power-cycle.
"""

import argparse
import glob
import os
import select
import sys
import termios
import time
from collections import deque

# Boot-stage banners: seeing one means the warm reset got AT LEAST this far.
STAGE_MARKERS = [
    ("boot ROM",  ("Trying to boot from", "SDPS", "SDPV", "Fastboot")),
    ("TF-A/BL31", ("NOTICE:  BL31", "BL31:", "NOTICE:  BL2")),
    ("U-Boot SPL", ("U-Boot SPL",)),
    ("U-Boot",     ("U-Boot 20", "Hit any key to stop autoboot", "=> ")),
    ("kernel",     ("Booting Linux", "Starting kernel", "Linux version")),
]
# Linux lines that mean "handoff to firmware is imminent / done".
REBOOT_MARKERS = (
    "reboot: Restarting system",
    "reboot: System halted",
    "Reboot failed",
    "systemd-shutdown",
    "Rebooting",
    "Sending SIGTERM",
)


def find_port(explicit):
    if explicit:
        if not os.path.exists(explicit):
            sys.exit(f"error: {explicit} does not exist")
        return explicit
    cands = sorted(glob.glob("/dev/cu.usbserial-*") + glob.glob("/dev/cu.usbmodem*"))
    if not cands:
        sys.exit(
            "error: no /dev/cu.usbserial-* or /dev/cu.usbmodem* found.\n"
            "       Plug in the FTDI USB-UART, then re-run, or pass the port "
            "explicitly:\n"
            "       ls /dev/cu.*\n"
            "       python3 capture-warm-reboot.py /dev/cu.usbserial-XXXX"
        )
    if len(cands) > 1:
        sys.exit(
            "error: multiple serial ports found -- pass one explicitly:\n  "
            + "\n  ".join(cands)
        )
    return cands[0]


def open_serial(path, baud):
    fd = os.open(path, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
    try:
        speed = getattr(termios, f"B{baud}")
    except AttributeError:
        os.close(fd)
        sys.exit(f"error: baud {baud} not supported by termios on this host")
    # [iflag, oflag, cflag, lflag, ispeed, ospeed, cc]
    attrs = termios.tcgetattr(fd)
    attrs[0] = 0  # iflag: no XON/XOFF, no CR/NL translation, no parity check
    attrs[1] = 0  # oflag: raw output
    attrs[2] = (attrs[2] & ~termios.CSIZE & ~termios.PARENB & ~termios.CSTOPB
                & ~getattr(termios, "CRTSCTS", 0)) | termios.CS8 | termios.CREAD | termios.CLOCAL
    attrs[3] = 0  # lflag: no canonical mode, no echo, no signals
    attrs[4] = speed
    attrs[5] = speed
    attrs[6][termios.VMIN] = 0
    attrs[6][termios.VTIME] = 0
    termios.tcsetattr(fd, termios.TCSANOW, attrs)
    termios.tcflush(fd, termios.TCIFLUSH)
    return fd


def stage_of(line):
    for name, needles in STAGE_MARKERS:
        for n in needles:
            if n in line:
                return name
    return None


def main():
    ap = argparse.ArgumentParser(description="Capture the i.MX8M warm-reboot hang point.")
    ap.add_argument("port", nargs="?", help="serial device (default: auto-detect)")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--silence", type=float, default=15.0,
                    help="seconds of no data after a reboot marker to call it a HANG (default 15)")
    ap.add_argument("--logdir", default=None,
                    help="where to write the log (default: this script's dir)")
    args = ap.parse_args()

    port = find_port(args.port)
    fd = open_serial(port, args.baud)

    logdir = args.logdir or os.path.dirname(os.path.abspath(__file__))
    os.makedirs(logdir, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    logpath = os.path.join(logdir, f"warm-reboot-{stamp}.log")
    log = open(logpath, "w", buffering=1)

    def emit(msg):
        """Write a script annotation to both the live view and the log."""
        line = f"\n>>> {msg}\n"
        sys.stdout.write(line)
        sys.stdout.flush()
        log.write(f"[{time.strftime('%H:%M:%S')}] {msg}\n")

    emit(f"Serial open: {port} @ {args.baud} 8N1")
    emit(f"Logging to:  {logpath}")
    emit("READY -- trigger the warm reboot in another terminal now:  "
         "ssh root@192.168.0.86 reboot")
    emit("Watch for a boot-stage banner (reboot OK) vs growing [SILENCE] (HANG). "
         "Ctrl-C for the verdict.")

    tail = deque(maxlen=40)          # recent complete lines, for the summary
    partial = ""                     # bytes since the last newline
    last_data = time.monotonic()
    reboot_seen = False
    reboot_at = None
    last_stage = None
    hang_reported = False
    next_silence_note = args.silence
    verdict = "no reboot observed (did you trigger it?)"

    def log_line(text):
        nonlocal last_stage
        ts = time.strftime("%H:%M:%S")
        log.write(f"[{ts}] {text}\n")
        tail.append(text)
        st = stage_of(text)
        if st and st != last_stage:
            last_stage = st
            emit(f"[stage] reached: {st}")

    try:
        while True:
            r, _, _ = select.select([fd], [], [], 0.25)
            now = time.monotonic()
            if r:
                try:
                    chunk = os.read(fd, 4096)
                except BlockingIOError:
                    chunk = b""
                if chunk:
                    last_data = now
                    next_silence_note = args.silence
                    hang_reported = False
                    text = chunk.decode("utf-8", "replace")
                    # Live raw echo (like screen), so partial lines show live.
                    sys.stdout.write(text)
                    sys.stdout.flush()
                    # Line-oriented, timestamped logging.
                    partial += text.replace("\r", "")
                    while "\n" in partial:
                        one, partial = partial.split("\n", 1)
                        log_line(one)
                        if not reboot_seen and any(m in one for m in REBOOT_MARKERS):
                            reboot_seen = True
                            reboot_at = now
                            emit("[event] Linux reboot marker seen -- handoff to "
                                 "firmware. Watching for boot ROM / SPL / u-boot...")
                continue

            # --- idle tick (no data this interval) ---
            idle = now - last_data
            if reboot_seen and idle >= next_silence_note:
                emit(f"[SILENCE {idle:0.0f}s] no serial data since reboot handoff"
                     + (f" (last stage: {last_stage})" if last_stage else ""))
                next_silence_note += args.silence
            if reboot_seen and not hang_reported and (now - reboot_at) >= args.silence:
                hang_reported = True
                if last_stage in (None, "boot ROM"):
                    verdict = ("HANG before SPL serial output -- wedged in boot ROM / "
                               "pre-DDR. Consistent with eMMC-reset / boot-source theory.")
                elif last_stage == "TF-A/BL31":
                    verdict = "HANG in/after TF-A BL31, before SPL -- DDR firmware / SPL handoff."
                elif last_stage == "U-Boot SPL":
                    verdict = "HANG in U-Boot SPL -- classic warm-boot LPDDR4 re-init/retrain."
                else:
                    verdict = f"HANG after reaching '{last_stage}'."
                emit("[VERDICT] " + verdict)
                emit("Recover with a COLD power-cycle. Ctrl-C to finish and save the log.")
    except KeyboardInterrupt:
        pass
    finally:
        if partial.strip():
            log_line("(no trailing newline) " + partial)
        emit("=" * 60)
        if reboot_seen and last_stage not in (None,) and last_stage in (
                "U-Boot", "kernel") and (time.monotonic() - last_data) < args.silence:
            verdict = f"reboot appears to PROGRESS (reached {last_stage}) -- likely no hang."
        emit("VERDICT: " + verdict)
        emit("Last serial lines before end/silence (newest last):")
        for ln in list(tail)[-15:]:
            sys.stdout.write("    " + ln + "\n")
            log.write("    " + ln + "\n")
        emit(f"Full log saved: {logpath}")
        emit("Send that log (or the last ~15 lines above) over for diagnosis.")
        log.close()
        os.close(fd)


if __name__ == "__main__":
    main()
