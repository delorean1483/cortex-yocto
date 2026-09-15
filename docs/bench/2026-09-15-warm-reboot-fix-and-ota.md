# Bench runbook — fix warm-reboot hang + land the new agent on TRUCK-001

**Board:** Variscite DART-MX8M-MINI / DT8MCustomBoard 2.x (i.MX8MM), unit **TRUCK-001** @ `192.168.0.86`
**You need:** serial console (to reach u-boot and watch reboots) **and** SSH (`root@192.168.0.86`, empty password, same LAN).
**Date diagnosed:** 2026-09-15

Do the parts **in order**. Part 1 (the warm-reboot fix) must be validated before Part 3 (activation reboot), or the box hangs and you're back to cold-power-cycling.

---

## Background (why we're here)

- Warm `reboot` hangs this board **before u-boot** (silent console, black LCD); only a cold power-cycle recovers.
- **Root cause:** the eMMC's hardware reset is disabled — `ext_csd[162] RST_n_FUNCTION = 0x00`. On a warm SoC reset the eMMC is *not* reset, stays in HS200/HS400 mode, and the boot ROM (expecting legacy mode) can't read imx-boot → hang. A cold power-cycle removes eMMC power → full reset → boots fine.
- **Cause of the cause:** the board was provisioned by a raw `.wic` `dd` (imx-boot in the eMMC *user* area @0x8400, `boot0` empty), which never sets ext_csd. Variscite's own flasher enables `RST_n`; `dd` doesn't.
- **Fix:** enable `RST_n` once (`RST_n_FUNCTION = 0x1`, the value stock Variscite uses). Write-once, permanent, per-device.

---

## Part 0 — Prep & baseline (SSH)

```sh
ssh root@192.168.0.86
fw_printenv slot_active          # expect: slot_active=a  (currently running slot a)
cat /proc/cmdline | grep -o 'root=[^ ]*'    # note the current root (mmcblk2p1 = slot a)
# confirm the bug is present (0x00 = RST_n disabled):
python3 -c "b=bytes.fromhex(open('/sys/kernel/debug/mmc2/mmc2:0001/ext_csd').read()); print('RST_n_FUNCTION=0x%02x'%b[162])"
```
Expect `RST_n_FUNCTION=0x00`. Note `slot_active` (should be `a`).

---

## Part 1 — Fix the warm-reboot hang (u-boot, one time)

1. **Cold power-cycle** the board and **interrupt boot** at the u-boot prompt (hit a key during the 3 s `bootdelay`). *(Do not `reboot` from Linux to get here — that hangs.)*
2. At the `=>` prompt, enable the eMMC reset line:
   ```
   => mmc dev 2
   => mmc rst-function 2 1
   ```
   > ⚠️ **Write-once.** `1` = RST_n **permanently enabled** (correct). **Never** write `2` (= permanently *disabled*).
3. Boot normally (`boot`) or `reset`.
4. **Validate the fix before going further.** From Linux:
   ```sh
   ssh root@192.168.0.86 'reboot'
   ```
   Watch serial: it should reboot cleanly through u-boot and back to Linux — **no hang.**
   - ✅ Clean reboot → warm-reboot hang is fixed. Continue to Part 2.
   - ❌ Still hangs → cold power-cycle to recover, then **STOP** — there's a second cause (DDR/PMIC re-init). Capture the last serial line before the hang and send it over; don't proceed to the OTA.

---

## Part 2 — Install the new agent image (SSH, as root)

Pick the version to land:
- **`1.2.42` (recommended)** — `apu_command` remote control **+ PR #27** (agent can run swupdate via sudo). Landing this makes the unit **web-OTA-capable** for all future updates. *(Ask Kang to merge PR #27 + cut v1.2.42 first; it'll be in S3 like 1.2.41.)*
- **`1.2.41`** — `apu_command` remote control only. Future web OTA would still fail (agent runs swupdate as non-root) until PR #27 ships.

Set `VER` and install:

```sh
ssh root@192.168.0.86
VER=1.2.42        # or 1.2.41
cd /tmp
curl -fsSL -o ecofleet-${VER}.swu \
  https://ecofleet-ota.s3.amazonaws.com/releases/${VER}/ecofleet-${VER}.swu

# (optional dry-run: verify signature + hw-compat, installs nothing)
swupdate -c -i /tmp/ecofleet-${VER}.swu -f /etc/swupdate/ecofleet.cfg

# real install to the INACTIVE slot (b):
swupdate -i /tmp/ecofleet-${VER}.swu -f /etc/swupdate/ecofleet.cfg
```
Expect: `openssl_rsa_verify_file: Verified OK` → `Hardware compatibility verified` → writes `/dev/mmcblk2p2` → `SWUpdate successful !`.

The phase-guarded pre/post-install scripts (PR #13, in the image) flip the slot automatically. Confirm:
```sh
fw_printenv slot_active           # expect: slot_active=b
# if it's still 'a', set it:
fw_setenv slot_active b
```

---

## Part 3 — Activate (reboot into the new slot)

With Part 1 done, a warm reboot works:
```sh
ssh root@192.168.0.86 'reboot'
```
Watch serial: u-boot → `boot.scr` reads `slot_active=b` → boots `/dev/mmcblk2p2`.

---

## Part 4 — Verify (SSH)

```sh
ssh root@192.168.0.86
cat /proc/cmdline | grep -o 'root=[^ ]*'     # expect root=/dev/mmcblk2p2 (slot b)
systemctl status gobi-agent --no-pager | head
journalctl -u gobi-agent -n 20 --no-pager    # should connect + publish
```

**First real test of remote APU control** — from the dashboard (Firmware/Remote tab as admin/fm) or by shadow, push `apu_command=climate`, and on the box:
```sh
ssh root@192.168.0.86 'journalctl -u gobi-agent -f'
```
Expect `control: apu_command(shadow) -> reg 10 = 1`. `stop` → `reg 10 = 0`, `battery` → `reg 10 = 2`.

If you landed **1.2.42**: also confirm hands-free OTA now works end-to-end — push a later `firmware_target` from the web and watch it download → `sudo -n /usr/sbin/gobi-ota-apply` → install → reboot, with no SSH.

---

## Recovery / abort

| Situation | Recovery |
|---|---|
| New slot won't boot / broken | u-boot: `setenv slot_active a; saveenv; reset` → back to slot a |
| Warm reboot still hangs | Cold power-cycle (physical). If it hangs *after* Part 1, stop and report the last serial line. |
| swupdate fails | Nothing was activated; stay on slot a. Re-check `/etc/swupdate/ecofleet.cfg` has the `public-key-file` line. |

No auto-rollback is deployed yet, so a bad-but-booting slot needs the manual `slot_active` flip above. (Auto-rollback is a follow-up; it depends on this warm-reboot fix to function.)

---

## Durable follow-ups (not at the bench)

1. **Bake `mmc rst-function 2 1` into device provisioning** so every future unit gets `RST_n` enabled (the raw-`.wic` flow skips it).
2. **Merge PR #27** + ship it in a release so the *web* OTA install runs as root (this runbook's manual swupdate is the interim path).
3. **Agent → shadow OTA status:** the agent doesn't report OTA progress/failure, so the dashboard shows a failed OTA as a stuck "pending." Add reported OTA state for visibility.
