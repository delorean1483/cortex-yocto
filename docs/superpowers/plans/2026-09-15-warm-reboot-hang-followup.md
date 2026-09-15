# Warm-reboot hang on i.MX8M Mini (TRUCK-001) — follow-up plan

**Status:** open, scoped. Bootloader-level project, uncertain effort. Needs bench + serial + power access + build/reflash cycles.
**Diagnosed:** 2026-09-15 bench session. This doc captures what's known so a future session doesn't re-derive it.

---

## Problem & impact

A warm `reboot` from Linux **hangs the board before u-boot** (silent serial console, black LCD); only a **cold power-cycle** recovers. Consequence: **A/B OTA installs correctly but activation needs a cold power-cycle** → firmware updates are not hands-free-remote. Every remote update needs someone physically on site to power-cycle.

Everything else in the OTA chain works (proven 2026-09-15): shadow push → agent → download → signature verify → swupdate install → slot flip. Only the activation *reboot* is blocked.

---

## Hardware / boot facts (verified)

- Variscite **DART-MX8M-MINI**, **DT8MCustomBoard 2.x**, **i.MX8MM**, SOM rev **2.0**. PMIC = **ROHM BD71847** @ i2c1 (0x30a20000) addr 0x4b.
- Reset path: Linux `reboot` → PSCI `SYSTEM_RESET` → TF-A → WDOG/SRC. Reset cause on a normal boot = `POR`.
- Hang is **before any u-boot/SPL serial output** — points at the boot ROM / TF-A / SPL DDR-init stage.
- imx-boot in the **eMMC user area @0x8400**, `boot0`/`boot1` **empty** (raw-`.wic` provisioning; Variscite's own flasher differs — imx-boot in boot0 + ext_csd config).
- DTB is loaded **per active slot** by `meta-ecofleet/recipes-bsp/ecofleet-bootscript/files/ecofleet-boot.cmd`:
  `ext4load mmc ${devnum}:${_root_part} ${fdt_addr} /boot/imx8mm-var-dart-dt8mcustomboard.dtb` (slot a → p1, slot b → p2). NOT the shared p1 for the DTB.

---

## Already fixed (keep)

- **eMMC `RST_n_FUNCTION` 0x00 → 0x01** (permanent), via u-boot `mmc dev 2; mmc rst-function 2 1`. This was a real misconfig (raw-`.wic` never set ext_csd; Variscite's flasher does). **Necessary but NOT the cause** — warm reboot still hangs. **Action item: bake `mmc rst-function 2 1` into device provisioning** so future units get it.

## Ruled out — DO NOT re-chase

- **PMIC reset-target state (SNVS vs READY) is not the (sufficient) cause.** The BD71847 DT had `rohm,reset-snvs-powered` (→ reset target = SNVS = partial power-down keeping the SNVS domain; vs READY = full power-down + OTP reload). We removed the property from the **active-slot** DTB, **confirmed it was gone from live `/proc/device-tree`** (so the Linux bd718x7 driver reconfigured the PMIC for READY-state reset) — **warm reboot still hung.** All PMIC regulators are already `regulator-always-on`/`boot-on`, so the "boot-critical regulator kept off after SNVS reset" variant does not apply here. Restored to factory.

---

## Root cause (best current understanding)

Matches multiple NXP community reports for the i.MX8M series: **u-boot/SPL warm-boot DDR re-init is lacking/broken.** On a warm reset the SoC resets but the LPDDR4 is not fully power-cycled/retrained, so SPL's DDR init hangs. A full power loss (cold boot) is what brings DDR up cleanly. The WDOG_B→PMIC full-POR path is not delivering a full power cycle on warm reset on this board even with the PMIC in READY mode — suggesting either WDOG_B isn't wired to force a PMIC POR on this carrier, or SPL simply can't retrain DDR without one.

---

## Captured serial evidence (2026-09-15, TRUCK-001, slot b, fw 1.2.42)

Captured with `capture-warm-reboot.py` on the debug UART (`/dev/cu.usbserial-DP07JT55`, 115200 8N1); board confirmed hung via no-ping, capture process + port confirmed healthy (so silence is real, not a dead capture).

- **Warm `reboot` from Linux → ZERO serial output.** No Linux shutdown text, and critically **no `U-Boot SPL` line**. Board never returned (no ping); only a cold power-cycle recovered it.
- **Cold power-cycle (same port, capture still running) → full normal boot:** first line `U-Boot SPL 2024.04-lf_v2024.04_6.6.52-2.2.2_var01...` → `Trying to boot from MMC2` → `U-Boot 2024.04` → `Reset cause: POR` → `==> EcoFleet: booting slot b (mmc 2 p2)` → `Starting kernel ...` → `imx8mm-var-dart login:` on `ttymxc0`. Board back on the network.

**Interpretation:** the first serial output on *any* healthy boot is `U-Boot SPL` (the i.MX8M boot ROM is silent on a normal boot). The warm reset produces *nothing*, so it wedges **between the SoC warm-reset and SPL's first print** — boot ROM loading imx-boot from eMMC, or SPL's DDR init before its banner. Confirms the DDR/power root-cause direction and **rules out** u-boot-proper, DTB, and kernel causes (all print after SPL). Note: Linux console **is** on `ttymxc0` but boots quietly (only the getty `login:` shows), so a warm reboot legitimately prints no Linux text before the reset — the tool's auto-verdict needs a Linux reboot marker to classify and so reported "no reboot observed"; the raw before/after silence is the real signal.

**Directs next work to:** candidate #2 (force full PMIC POR on warm reset — DDR isn't getting a clean power cycle; `RST_n` already set didn't fix it), #4 (Variscite-style eMMC provisioning: imx-boot in `boot0` + ext_csd), #5 (SPL/DDR warm-boot retrain). Fix ships via a **separate imx-boot flash**, not A/B OTA.

---

## Candidate approaches (research + try, rough order)

1. **✅ DONE — captured 2026-09-15 (see "Captured serial evidence" below).** Result: on a warm reset **nothing prints at all** — the wedge is *before* the first `U-Boot SPL` line (boot ROM / SPL pre-DDR-init), earlier than "before u-boot." Tool: `docs/bench/tools/capture-warm-reboot.py` + runbook `docs/bench/2026-09-15-warm-reboot-serial-capture.md`.
2. **Force a full PMIC POR on reset.** Determine whether WDOG_B is routed to the BD71847's reset/POR input on the DT8MCustomBoard, and configure the PMIC (register / DT) to do a full power cycle on WDOG. TF-A/u-boot `reset_cpu()` may need to assert the right path. (READY-state DT change alone didn't do it → the WDOG_B→PMIC trigger/wiring is the suspect.)
3. **Diff against stock Variscite.** Flash a stock Variscite Yocto image via their installer and test a warm reboot. If stock reboots fine → diff our imx-boot / u-boot / DDR-timing firmware / provisioning vs stock (our raw-`.wic` differs). If stock also hangs → it's upstream; pursue #2/#4.
4. **Re-provision the eMMC the Variscite way** (imx-boot in `boot0` + ext_csd), instead of raw-`.wic`, and re-test — the boot-source difference may matter for warm reset.
5. **u-boot/SPL warm-boot DDR retrain** (the "proper" upstream fix). Check newer NXP imx-boot/u-boot releases for existing warm-boot support before implementing.

---

## Test methodology (proven this session)

- **Serial console is mandatory** (FTDI USB-UART → Mac, e.g. `/dev/cu.usbserial-*`, **115200 8N1**). Drive u-boot from the Mac with a small `python`/`termios` script (self-verifying: type the command, read the echo, only send Enter if the echoed line is exact — critical for the **write-once** `mmc rst-function`).
- **Widen the u-boot prompt window** from Linux: `fw_setenv bootdelay 10` (restore to 3 after).
- **Fast, reversible DT-level validation** (no full Yocto build): `brew install dtc` (gives `fdtput`); pull the **active-slot** `/boot/imx8mm-var-dart-dt8mcustomboard.dtb`, edit with `fdtput`, install with an `.orig` backup, cold power-cycle, verify via `/proc/device-tree`. (Confirm which partition is active — `root=/dev/mmcblk2p{1|2}` — and edit *that* slot; the DTB is per-slot, not shared p1.)
- **Warm-reboot test:** trigger `reboot`, watch serial for the u-boot banner (works) vs silence (hang), and poll SSH for reconnect. Recovery from a hang = cold power-cycle. Requires bench + serial + power access.
- **Device writes over SSH are blocked by the auto-mode classifier** → a human runs them via the `!` prefix (I prep the file/commands, user executes).

---

## Deployment considerations

- The real fix likely lives in **imx-boot (TF-A / u-boot / DDR firmware)**, which is **NOT updated by A/B OTA** (imx-boot sits in the eMMC user area, written by raw flash — the `.swu` only writes the rootfs slot). So the fix needs a **separate imx-boot flash** (uuu, or `dd` to the eMMC boot offset), not the normal OTA path.
- The **DTB is per-slot in the rootfs** and *would* ride the A/B OTA — but the DT angle is ruled out, so that doesn't help here.

---

## Definition of done

A warm `reboot` from Linux returns to Linux **without a cold power-cycle**, validated on the bench with serial across several consecutive attempts. Then hands-free remote OTA works end-to-end (install + activate via `reboot`, no person on site).

Until then: **workaround = OTA installs remotely, activation via cold power-cycle** (acceptable at a bench / with someone on site).
