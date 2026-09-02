# OTA A/B Auto-Rollback — Design Spec (future work)

**Date:** 2026-09-02
**Status:** Draft — **not scheduled / not built.** Design for a later, deliberately-tested implementation.
**Repo:** `cortex-yocto` (bootscript + swupdate + a new confirm service).

## Goal

Make a failed OTA **auto-revert to the last-good slot** without a serial-console trip. Today the A/B setup protects against a bad *install*, but a slot that installs cleanly yet **fails to boot** (bad kernel/rootfs/init, or a broken app) leaves the unit stuck on the bad slot until someone manually flips `slot_active`. That's a fleet-bricking risk for units you can't physically reach.

## Current state (what exists)

- `ecofleet-boot.cmd` (→ `boot.scr`) reads `slot_active` (a/b) → `_root_part` (1/2) → `ext4load` kernel+dtb from that slot → `booti`. **No `bootcount` / `upgrade_available` / confirm logic.**
- u-boot env has only `slot_active` (+ Variscite BSP `bsp_bootcmd`). No `bootcount`, `bootlimit`, `upgrade_available`, `altbootcmd`.
- swupdate (`ecofleet.cfg`) installs to the inactive slot; the A/B pre/post-install scripts set `slot_active` to the new slot.
- **Manual recovery today:** u-boot console `setenv slot_active b; saveenv; boot`, or from a booted slot `fw_setenv slot_active b` + cold power-cycle.

## Design — the standard u-boot bootcount rollback

Three pieces cooperating through the u-boot environment:

### 1. u-boot env vars
- `slot_active` (a|b) — selected slot (existing).
- `upgrade_available` (0|1) — 1 while a freshly-installed slot awaits confirmation.
- `bootcount` (int) — boot attempts since the update, while `upgrade_available=1`.
- `bootlimit` (int, default **3**) — attempts before rollback.

### 2. swupdate post-install (extend the existing A/B post-install script)
After installing to the inactive slot and setting `slot_active` to it, also:
```
fw_setenv upgrade_available 1
fw_setenv bootcount 0
```
(arm the trial; the new slot must confirm within `bootlimit` boots).

### 3. `ecofleet-boot.cmd` — rollback guard (runs BEFORE the existing slot→part→boot block)
```
if test "${upgrade_available}" = "1"; then
    setexpr bootcount ${bootcount} + 1
    saveenv
    if test ${bootcount} -gt ${bootlimit}; then
        echo "==> boot trial exceeded ${bootlimit}, rolling back slot"
        if test "${slot_active}" = "a"; then setenv slot_active b; else setenv slot_active a; fi
        setenv upgrade_available 0
        setenv bootcount 0
        saveenv
    fi
fi
# ... existing: slot_active -> _root_part -> ext4load -> booti ...
```
The increment+`saveenv` happens **before** `booti`, so a hang/panic after handoff still counts on the next power-cycle.

### 4. Boot-confirm systemd service (NEW recipe, ships in the rootfs)
After a **healthy** boot, mark the slot good:
```
fw_setenv upgrade_available 0
fw_setenv bootcount 0
```
This is what closes the trial. If the unit never reaches "healthy," `upgrade_available` stays 1 and `bootcount` climbs each power-cycle → rollback at `bootlimit`.

## Decision — what counts as a "healthy boot"

Recommended: the confirm service runs `After=gobi-ui.service gobi-agent.service` with a short settle (e.g. `ExecStartPre=/bin/sleep 45`), then confirms **only if both services are `active`** (`systemctl is-active`). This catches *app-level* failure (gobi-ui/agent crash-looping), not just "the kernel booted." Simpler alternative (OS-boot-only): a plain `After=multi-user.target` + 60 s delay, no service check — weaker, but catches kernel/rootfs death. Prefer the app-aware version.

## Components (files to touch when built)
- `meta-ecofleet/recipes-bsp/ecofleet-bootscript/files/ecofleet-boot.cmd` — add the rollback guard.
- The swupdate A/B **post-install** script (the one that sets `slot_active`) — add `upgrade_available=1` + `bootcount=0`.
- **New** `meta-ecofleet/recipes-core/ecofleet-boot-confirm/` — a recipe + systemd unit (`ecofleet-boot-confirm.service`) that confirms the slot after healthy boot; `SYSTEMD_AUTO_ENABLE`.
- u-boot default env — ship `bootlimit=3`, `upgrade_available=0`, `bootcount=0` as defaults (via the BSP/uEnv or first-boot init in boot.cmd), so a device that never OTA'd has sane values.

## ⚠️ Critical must-verify before building: where is `boot.scr` loaded from?
The auto-rollback logic lives **in `boot.scr`**. If u-boot loads `boot.scr` from a **single shared location**, a buggy `boot.cmd` is a **single point of failure that bricks BOTH slots** — defeating the purpose. Confirm whether `bsp_bootcmd` loads `boot.scr` **per-slot** (from each rootfs's `/boot`) or from a fixed/shared partition. If shared, the design must (a) keep the boot.cmd change minimal + heavily tested, and/or (b) move to a per-slot boot.scr so A/B protects the boot script itself. **This is the #1 risk and gates the whole feature.**

## Edge cases
- **First boot / never-OTA'd:** `upgrade_available` unset/0 → guard skipped. Safe.
- **Power flicker mid-boot:** counts as a failed attempt (bootcount saved before booti). Mitigated by `bootlimit ≥ 3` and the confirm service resetting `bootcount=0` on every healthy boot, so flickers don't accumulate across good boots.
- **Both slots bad:** rollback target also fails → unit down (no third slot). Out of scope; unlikely double-failure.
- **`saveenv` wear:** a save each boot while `upgrade_available=1` writes the (small) u-boot env to eMMC; negligible, bounded by `bootlimit` per update.

## Testing plan (bench, **serial console mandatory**)
A boot.cmd bug bricks boot, so test only with serial recovery on hand.
1. **Happy path:** OTA a *good* image, cold-boot → confirm the boot-confirm service clears `upgrade_available` (fw_printenv shows 0), no rollback, correct slot.
2. **Bad-boot rollback:** OTA a *deliberately broken* image (rootfs that panics, or mask gobi-ui/agent so confirm never fires) → cold-boot repeatedly → confirm `bootcount` increments and, after `bootlimit`, `slot_active` flips back + the good slot boots.
3. **Flicker resilience:** healthy boot then a few power-cycles → confirm `bootcount` stays 0 (reset by confirm), no spurious rollback.
4. Validate `boot.scr` compiles (`mkimage`) and the env expressions (`setexpr`, `test -gt`) behave on this u-boot.

## Risks
- **Bricking boot** via a boot.cmd bug (see the must-verify above) — the dominant risk; mitigated by serial-available testing, minimal change, and confirming per-slot boot.scr.
- False rollback if the "healthy" definition is too strict (e.g., a legitimately slow first boot) — tune the settle delay + service check.
- `fw_setenv` from userspace must target the **same** env the bootloader reads (redundant-env offsets in `/etc/fw_env.config` must match u-boot) — verify on this BSP.

## Out of scope
- Multi-image / >2 slots. Remote/fleet OTA orchestration (this is device-local rollback only). Signature/verification (already handled by swupdate CONFIG_SIGNED_IMAGES).
