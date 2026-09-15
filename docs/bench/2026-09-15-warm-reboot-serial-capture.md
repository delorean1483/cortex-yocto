# Bench runbook — capture the warm-reboot hang point (plan step 1)

**Board:** Variscite DART-MX8M-MINI / DT8MCustomBoard 2.x (i.MX8MM), unit **TRUCK-001** @ `192.168.0.86`
**You need:** FTDI USB-UART on the debug console (→ Mac) **and** SSH (`root@192.168.0.86`, empty password, same LAN).
**Goal:** record the **last serial line before silence** on a warm `reboot`, so we know which boot stage wedges (boot ROM vs TF-A vs SPL DDR-init vs u-boot). That one line disambiguates the candidate fixes.
**Plan:** `docs/superpowers/plans/2026-09-15-warm-reboot-hang-followup.md` (this is its step 1).

## Where we are (don't re-chase)

- eMMC `RST_n_FUNCTION` is already `0x01` (applied on .86) — **necessary but did NOT fix** the warm-reboot hang.
- The **DT/PMIC angle is ruled out** (removed `rohm,reset-snvs-powered`, confirmed gone from live `/proc/device-tree`, still hung; DTBs restored to factory).
- Best current theory: **u-boot/SPL warm-boot DDR re-init limitation**. This capture is to confirm *which* stage actually wedges before we spend time on imx-boot/TF-A work.

---

## The tool

`docs/bench/tools/capture-warm-reboot.py` — pure stdlib (no `pip install`). It echoes the UART live like `screen`, writes a timestamped log, recognizes the boot-stage banners (TF-A BL31 / U-Boot SPL / U-Boot / kernel), flags silence gaps, and prints a stage-specific verdict.

---

## Steps

### 0. Find the serial port (Mac)
```sh
ls /dev/cu.usbserial-* /dev/cu.usbmodem* 2>/dev/null
```
Note the device (e.g. `/dev/cu.usbserial-XXXX`). The script auto-detects it if there's exactly one.

### 1. Sanity check — prove the port + console are right (do this ONCE)
Start the capture, then **cold power-cycle** the board (physical). You should watch a full cold boot scroll by (TF-A `NOTICE: BL31` → `U-Boot SPL` → `U-Boot` → `Starting kernel`). If you see that, the port and console baud are correct.
```sh
cd docs/bench/tools
python3 capture-warm-reboot.py            # or: python3 capture-warm-reboot.py /dev/cu.usbserial-XXXX
```
- ✅ Cold boot banners appear → port is good. Ctrl-C. Continue to step 2.
- ❌ Nothing at all on a cold boot → wrong port / wrong wire / console disabled. Fix that before the reboot test (a silent warm reboot is meaningless if the port was never right).

### 2. Start the capture (terminal A)
Board is up in Linux. Leave this running:
```sh
cd docs/bench/tools
python3 capture-warm-reboot.py
```
It prints `READY -- trigger the warm reboot in another terminal now`.

### 3. Trigger the warm reboot (terminal B)
> Agent-issued device writes are blocked by the auto-mode classifier — **run this yourself** (in Claude Code, prefix with `!`):
```sh
ssh root@192.168.0.86 reboot
```

### 4. Read terminal A, then recover
Watch the capture window:
- A fresh boot banner appears and it comes back to Linux → **reboot works** (verdict: "PROGRESS").
- The line goes quiet and `[SILENCE Ns]` grows with **no** boot banner → **HANG**. The script prints a verdict naming the last stage reached.

**Recover from a hang with a COLD power-cycle** (physical). Then `Ctrl-C` the capture to save the log + print the last ~15 lines.

### 5. Send the result
The log is `docs/bench/tools/warm-reboot-<timestamp>.log` (git-ignored). Paste that log — or the last ~15 lines + the VERDICT — back into the session.

---

## Interpreting the verdict → next fix

| Last stage before silence | Meaning | Points at (plan candidate) |
|---|---|---|
| **before SPL** (no banner after `reboot: Restarting`) | wedged in boot ROM / pre-DDR — SoC reset but boot media/DDR never came up | #2 force full PMIC POR on reset, #4 re-provision eMMC the Variscite way |
| **TF-A / BL31** then silence | got through boot ROM, dies at/after TF-A before SPL | #5 imx-boot/TF-A warm-boot support |
| **U-Boot SPL** then silence | classic LPDDR4 warm-boot retrain failure | #5 SPL DDR retrain (the "proper" upstream fix) |
| reaches **U-Boot / kernel** | not a boot-stage hang — look higher (env, boot.scr, rootfs) | re-scope |

Whatever the stage: the real fix lives in **imx-boot (TF-A / u-boot / DDR firmware)**, which is **not** delivered by A/B OTA (imx-boot is in the eMMC user area, written by raw flash) — so it needs a **separate imx-boot flash**, not the normal `.swu` path.

---

## Recovery / notes

- A hung board only recovers via **cold power-cycle**. Never `reboot` from Linux to reach u-boot on this board — that's the very thing that hangs.
- This capture changes nothing on the device (read-only serial + one `reboot`). No DTB edits, no `mmc rst-function`.
- Optional: to widen the u-boot prompt window for later interactive work, `fw_setenv bootdelay 10` (restore with `fw_setenv bootdelay 3`). Not needed for this capture — the hang is *before* u-boot.
