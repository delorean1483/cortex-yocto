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
3. **Diff against stock Variscite.** Flash a stock Variscite Yocto image via their installer and test a warm reboot. *(⬆ PROMOTED by the 2026-09-16 research update to step **B** — note: our provisioning already matches stock, so if stock also hangs it's a platform limitation.)*
4. **Re-provision the eMMC the Variscite way** (imx-boot in `boot0` + ext_csd). *(❌ DEMOTED by the 2026-09-16 research update — Variscite's own MINI installer uses the SAME user-area 0x8400 layout, so boot-source is not the differentiator. Low probability; procedure kept as a secondary experiment below.)*
5. **u-boot/SPL warm-boot DDR retrain** (the "proper" upstream fix). Check newer NXP imx-boot/u-boot releases for existing warm-boot support before implementing.

---

## Research update (2026-09-16) — reprioritizes the above

Off-bench research (Variscite installer scripts + NXP community + Variscite DTS; sources at bottom). **Two premises above were wrong; the direction shifts from "our provisioning/config differs" to "the warm `reboot` is not physically power-cycling/resetting the eMMC+DDR."**

**❌ Candidate #4 (boot0 reprovisioning) is NOT the differentiator — demote to low-probability.** Variscite's own MINI installer (`meta-variscite-sdk-imx` `mx8_install_yocto.sh`) provisions the eMMC **identically to our raw-`.wic`**: `dd` imx-boot to the **user area at seek=33 KiB = 0x8400** (`BOOTLOADER_OFFSET=33` for i.MX8MM), `boot0`/`boot1` left empty, and it never touches PARTITION_CONFIG / BOOT_BUS_CONDITIONS / RST_n_FUNCTION (so stock MINI units also ship `RST_n_FUNCTION=0x00`). Confirmed by `flexbuild` `imx8mm-var-dart.conf DISK_BOOTLOADER_OFFSET=33792`. → Boot-source is the wrong variable; our layout matches Variscite's. (The boot0 procedure is kept below as a documented *secondary* experiment only.)

**❌ "`mmc rst-function 2 1` is the fix" from web search is circular** — that text is scraped from *our own* repo (cortex-yocto PR #28/#31), not an independent NXP source. Disregard as corroboration.

**Revised root cause (best current understanding):** on i.MX8M a `reboot` is *designed* to become a **full PMIC POR via WDOG_B** (NXP's explicit position: a DDR-retaining "warm reset" is **not supported**; the reboot must power-cycle DDR — and normally the eMMC rails — via the PMIC). Our two prior experiments failing is the **diagnostic signal**: (a) `RST_n_FUNCTION 0x00→0x01` = "make the SoC's eMMC reset line actually reset the card" — no change; (b) drop `rohm,reset-snvs-powered` (SNVS→READY full power-down) — no change. Neither helping means **the warm reboot isn't reaching the eMMC as a power-cycle or RST pulse at all.** Leading suspects:
1. **WDOG_B isn't actually triggering the PMIC POR** on the DT8MCustomBoard reset path (so SNVS-vs-READY is moot — the PMIC never sees it), and/or TF-A `psci_system_reset` isn't asserting WDOG1 the way the pinmux assumes. (Our running DTS *does* have `&wdog1 fsl,ext-reset-output` + `GPIO1_IO02_WDOG1_WDOG_B 0xc6` — so it's wired in DT; question is whether it fires.)
2. **eMMC VCC/VCCQ sits on an always-on rail** (or READY off-time too short to discharge), so the eMMC keeps the HS200/HS400 mode Linux left it in and the low-speed boot ROM can't talk to it — matches "only a full cold power-cycle recovers."
3. Marginal POR on the carrier (weak POR_B pull-up / sequencing) that only bites on the warm path (NXP i.MX8MM "stuck in Boot ROM" class).

### SOURCE-PROVEN UPDATE (2026-09-16, TF-A + kernel source analysis) — suspect #1 REFUTED

Read the branch-matched Variscite source (`varigit/imx-atf` `lf_v2.10_6.6.52-2.2.2_var01`, `varigit/linux-imx` `lf-6.6.y_...`):
- **TF-A ALREADY asserts WDOG_B on a cold `reboot`.** `imx8mm` defines `IMX_WDOG_B_RESET` (unconditional, `plat/imx/imx8m/imx8mm/include/platform_def.h`), so `imx_system_reset()` → `imx_wdog_restart(true)` → writes WDOG1 WCR with **WDA=0 (active-low) = WDOG_B asserted**. So **suspect #1 (WDOG_B not firing / TF-A internal reset) is WRONG** for the normal cold path. Verified live too: WDOG1 WCR=0x0039 has WDT set (ext-reset routing armed), PSCI method=smc.
- **⚠ The WARM/SOFT path IS internal-only:** `imx_system_reset2()` = `imx_wdog_restart(false)` = WDA=1/SRS = **no WDOG_B**. Kernel `psci_sys_reset()` picks `SYSTEM_RESET2` when `reboot_mode` is `warm`/`soft`. So NEVER use `reboot=warm`/`reboot=soft`/`systemctl soft-reboot` — those definitely won't power-cycle DDR/eMMC. Plain `reboot`/`shutdown -r` = cold = WDOG_B (our cmdline has no `reboot=`, so we're on the cold path — good; confirm the OTA helper uses plain `reboot`).
- **NO OTA-able (rootfs DTB/kernel) reboot-routing fix exists.** The kernel `imx2_wdt_restart()` writes the **identical** WDOG_B assertion (WCR=WDE|SRS with `ext_reset`), so same endpoint; and it's **priority-blocked** anyway (imx2_wdt restart priority **128** < PSCI **129**, both hard-coded — no DT/sysfs knob to reorder). Every software path converges on the same WDOG_B pulse. The fix is NOT a rootfs change.

**⇒ Wall is DOWNSTREAM of WDOG_B: the BD71847 isn't cold-cycling the eMMC/DDR rails on WDOG_B (and/or SPL can't re-init DDR without a true power loss).** The BD71847 has two WDOG_B responses — "Warm Reset" (rails retained) vs "Cold Reset" (rails cycled, duration set by PONT[3:0]); our WDOG_B is landing on a warm/partial reset. Unlike the pca9450 (which has a Linux driver knob for this), the BD71847's WDOG_B warm/cold behavior is PMIC OTP/register config, not a mainline driver property — so the levers are: **PMIC register/OTP config, a hardware rework (NXP community: 100k pull WDOG_B→POR_B to force a real SoC POR), or imx-boot SPL DDR warm-boot re-init.** *(Whether a RUNTIME i2c register on the BD71847 can force the cold-reset rail cycle — i.e. an OTA-able pre-reboot script — is the open question under active research 2026-09-16.)*

**⇒ New next steps (cheapest / most decisive first):**
- **A0. Watchdog-reset bench test (NEW — cheapest decisive test, no scope, no reflash).** Trigger the imx2-wdt hardware timeout (asserts the same WDOG_B): `/dev/watchdog`, set 1s timeout, stop feeding (commands in the bench section). Most-likely outcome = **same pre-SPL hang** → confirms the wall is WDOG_B→PMIC/DDR (not software), closing the software avenue. A **clean recovery** instead = surprising, means the timeout assertion differs from TF-A's one-shot WDA pulse (a pulse-width/hold lever). Needs serial + power access.
- **A. Scope the reset path during `reboot` (do FIRST — no reflash, fully reversible, discriminates everything).** With a scope, probe on a `reboot`: **WDOG_B (GPIO1_IO02)**, the **BD71847 rails feeding DDR**, the **eMMC VCC + VCCQ**, and **eMMC_RST_B**. The one question it answers: *does `reboot` actually cause a PMIC POR that drops/re-sequences eMMC power (or pulses eMMC_RST_B)?* Near-certain finding given "cold always works": **no** — and *which* signal is missing tells you whether it's #1 (WDOG_B not asserting), #2 (eMMC on an always-on rail), or #3 (marginal POR). Needs scope + carrier test points (hardware — Robb).
- **B. Diff against a stock Variscite image (cheap, software-only discriminator; candidate #3).** Flash a stock Variscite Yocto image and test a warm `reboot` on the same unit. Stock **also hangs** → it's a latent Variscite/NXP i.MX8MM-on-this-carrier limitation (NXP has an open "warm reset unsupported" position with no workaround) → the cold-cycle workaround may be the accepted answer, or it's a carrier hardware fix. Stock **reboots fine** → something in *our* image (DTB/u-boot config, since provisioning matches) differs — re-open that diff.

**Reframed candidate priority:** A (scope) → B (stock diff) → #2 (fix WDOG_B→PMIC POR, hardware/TF-A) → #4 boot0 (low prob, documented below) → #5 SPL DDR retrain (NXP says there's nothing to patch at the ROM stage — the wedge is pre-SPL).

### Secondary experiment (low probability) — boot0 reprovisioning procedure
imx-boot goes at **offset 0** in boot0 (use the `flash.bin`/`-flash` variant, NOT seek=33). From Linux (`/dev/mmcblk2`):
```
echo 0 > /sys/class/block/mmcblk2boot0/force_ro
dd if=/dev/zero of=/dev/mmcblk2boot0 bs=1M count=1
dd if=imx-boot-<...>-flash.bin of=/dev/mmcblk2boot0 bs=1k     # offset 0, NO seek
sync; echo 1 > /sys/class/block/mmcblk2boot0/force_ro
mmc bootpart enable 1 1 /dev/mmcblk2      # BOOT_PARTITION_ENABLE=1(boot0), BOOT_ACK=1
mmc extcsd read /dev/mmcblk2 | grep -i PARTITION_CONFIG   # expect 0x48
```
From u-boot: `mmc dev 2 1; mmc write ${loadaddr} 0 ${blkcnt}; mmc dev 2 0; mmc partconf 2 1 1 0` (→0x48); revert with `mmc partconf 2 1 7 0` (user-area). ext_csd: PARTITION_CONFIG=[179], BOOT_BUS_CONDITIONS=[177], RST_n_FUNCTION=[162].

**Sources:** Variscite installer `varigit/meta-variscite-sdk-imx` `scripts/.../mx8_install_yocto.sh` (BOOTLOADER_OFFSET=33, dd seek=33, no ext_csd) · `varigit/flexbuild` `imx8mm-var-dart.conf` (DISK_BOOTLOADER_OFFSET=33792) · `varigit/linux-imx` `lf-6.6.y_6.6.52-2.2.2_var01` DTS (`wdog1 fsl,ext-reset-output` + `GPIO1_IO02_WDOG1_WDOG_B`; `pmic@4b rohm,bd71847 rohm,reset-snvs-powered`) · `bd718x7-regulator.c` (SNVS vs READY) · NXP community 1760816 (iMX8MP warm reboot SPL romapi read fail), 1606363 (soft reboot stuck in imx-atf; `fsl,ext-reset` → WDOG→PMIC POR), 1720184 (warm/DDR-retaining reset unsupported), 1224262 (boot0 offset 0 vs user 0x8400), 1241544 (Linux boot0 commands, PARTITION_CONFIG 0x48), 1343472 (iMX8MM stuck in Boot ROM / POR class).

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
