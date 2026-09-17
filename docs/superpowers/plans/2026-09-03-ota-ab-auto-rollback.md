# OTA A/B Auto-Rollback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a failed OTA auto-revert to the last-good A/B slot without a serial-console trip, using the standard u-boot bootcount mechanism driven through the shared u-boot environment.

**Architecture:** Four cooperating pieces on the shared u-boot env: (1) the boot script arms a boot-counter guard that rolls the slot back after `bootlimit` failed attempts; (2) swupdate post-install arms the trial after writing the new slot; (3) a systemd confirm service clears the trial once the new slot boots healthy; (4) first-boot env defaults so a never-OTA'd device has sane values. No kernel/rootfs code changes — only the boot script, one swupdate script, one new recipe, and the image manifest.

**Tech Stack:** u-boot boot script (compiled to `boot.scr` by `mkimage`), POSIX `sh`, `fw_setenv`/`fw_printenv` (libubootenv-bin), systemd, Yocto/BitBake recipe.

**Spec:** `docs/superpowers/specs/2026-09-02-ota-ab-auto-rollback-design.md`

## Global Constraints

- **Serial console is MANDATORY for every boot test.** A `boot.cmd` bug bricks boot; only test with serial recovery on hand. Nothing in this plan may be deployed to a field device before the bench test plan below passes.
- **The u-boot env is a single SHARED env** (raw region at `0x400000`, one copy — not per-slot; `fw_env.config` points here). All four vars — `slot_active`, `bootcount`, `upgrade_available`, `bootlimit` — live in this one env. Writes from userspace use `fw_setenv` (provided by `libubootenv-bin`, already in the image).
- **`boot.scr` is sourced by the stock Variscite `bsp_bootcmd` from a FIXED `mmcpart` (not per-slot).** Confirmed indirectly: the u-boot append ships only `fw_env.config`, and `post-install.sh` sets only `slot_active`; `ecofleet-boot.cmd` re-derives the kernel partition from `slot_active` itself. **PRE-FLIGHT BENCH CHECK #1: at the u-boot prompt run `printenv mmcpart bsp_bootcmd bootcmd` and record where `boot.scr` is loaded from.** Consequence: rollback escapes a bad *kernel/rootfs* but NOT a bad *boot.scr* (both slots run the fixed-partition script). Mitigation = keep the `boot.cmd` change MINIMAL and heavily bench-tested (spec option a). A per-slot `boot.scr` (spec option b) is out of scope here; note it as a follow-up if the bench check shows the fixed partition is a real exposure.
- **`boot.cmd` compiles to `boot.scr` via `mkimage`** in `ecofleet-bootscript.bb`. Every edit must stay mkimage-compilable and use only expressions valid on this u-boot: `setexpr`, `test ... -gt`, `saveenv`.
- **`bootlimit` default = 3.** With the `-gt` guard, rollback fires on the boot where `bootcount` first exceeds `bootlimit` (i.e. the 4th failed attempt).
- **Minimize eMMC wear:** `saveenv` only when the trial is live (`upgrade_available=1`). First-boot defaults are RAM-only (re-derived each boot if unset), never `saveenv`'d.
- This feature is not host-unit-testable (u-boot script + Yocto recipe + systemd). Per-task verification is a build/parse check; behavioral verification is the serial-console bench plan at the end.

---

### Task 1: Boot-script rollback guard + first-boot env defaults

**Files:**
- Modify: `meta-ecofleet/recipes-bsp/ecofleet-bootscript/files/ecofleet-boot.cmd`

**Interfaces:**
- Consumes: shared u-boot env vars `slot_active`, `upgrade_available`, `bootcount`, `bootlimit`.
- Produces: on a failed-trial rollback, flips `slot_active` and clears `upgrade_available`/`bootcount`; otherwise increments `bootcount` while a trial is live. The confirm service (Task 3) and post-install (Task 2) are the other writers of these vars.

- [ ] **Step 1: Add first-boot defaults** immediately AFTER the existing `slot_active` first-boot block (the `if test -z "${slot_active}"...` block) and BEFORE the `if test "${slot_active}" = "a"` block. These are RAM-only (no `saveenv`): they only supply sane values when the env has never been written, so `setexpr`/`test` below never see an empty var.

```
# A/B rollback trial defaults (RAM-only; persisted values from fw_setenv win).
# See ecofleet-boot-confirm.service (clears the trial on a healthy boot) and the
# swupdate post-install (arms it). bootlimit is a constant; upgrade_available=0
# means "no trial pending" so a never-OTA'd device skips the guard entirely.
if test -z "${bootlimit}";         then setenv bootlimit 3;         fi
if test -z "${upgrade_available}"; then setenv upgrade_available 0; fi
if test -z "${bootcount}";         then setenv bootcount 0;         fi
```

- [ ] **Step 2: Add the rollback guard** immediately after the defaults block (still before the `slot_active`→`_root_part` block, because it may flip `slot_active`). The increment + `saveenv` happen BEFORE `booti`, so a hang/panic after handoff still counts on the next power-cycle.

```
# Rollback guard: while a freshly-installed slot is on trial, count boot attempts
# and revert to the previous slot once the count exceeds bootlimit. Runs only
# when a trial is armed, so normal boots are untouched.
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
```

- [ ] **Step 3: Verify the script still compiles to boot.scr.** No local Yocto, so this is checked when the image builds (Task 4 / CI). Sanity now: re-read the whole file and confirm the guard sits after the first-boot defaults and before `if test "${slot_active}" = "a"`, every `if` has a matching `fi`, and only `setenv`/`setexpr`/`test`/`saveenv`/`echo` are used.

- [ ] **Step 4: Commit**

```bash
git add meta-ecofleet/recipes-bsp/ecofleet-bootscript/files/ecofleet-boot.cmd
git commit -m "feat(ota): boot.scr A/B rollback guard + trial env defaults"
```

---

### Task 2: Arm the boot trial in swupdate post-install

**Files:**
- Modify: `scripts/post-install.sh`

**Interfaces:**
- Consumes: `/tmp/next-slot` (written by `pre-install.sh`), already used to set `slot_active`.
- Produces: sets `upgrade_available=1` and `bootcount=0` in the shared env — the signal Task 1's guard watches for.

- [ ] **Step 1: Arm the trial** right after the existing `fw_setenv slot_active "$NEXT_SLOT"` line. This must remain gated to the `postinst` phase (the script already `exit 0`s in preinst at the top).

```sh
fw_setenv slot_active "$NEXT_SLOT"
# Arm the boot trial: the bootloader will count attempts on the new slot and
# roll back if it never confirms healthy (see ecofleet-boot.cmd + boot-confirm).
fw_setenv upgrade_available 1
fw_setenv bootcount 0
echo "post-install: slot_active set to '${NEXT_SLOT}', boot trial armed (upgrade_available=1)"
```

- [ ] **Step 2: Remove the now-redundant trailing echo** if it duplicates the message (the original ended with `echo "post-install: slot_active set to '${NEXT_SLOT}' — reboot to activate"`). Replace that line with the armed-trial echo above so there is exactly one summary line.

- [ ] **Step 3: Syntax check** (POSIX sh): `sh -n scripts/post-install.sh` — expect no output (parses clean).

- [ ] **Step 4: Commit**

```bash
git add scripts/post-install.sh
git commit -m "feat(ota): arm boot trial (upgrade_available/bootcount) on post-install"
```

---

### Task 3: Boot-health confirm service (new recipe)

**Files:**
- Create: `meta-ecofleet/recipes-core/ecofleet-boot-confirm/ecofleet-boot-confirm.bb`
- Create: `meta-ecofleet/recipes-core/ecofleet-boot-confirm/files/ecofleet-boot-confirm.sh`
- Create: `meta-ecofleet/recipes-core/ecofleet-boot-confirm/files/ecofleet-boot-confirm.service`

**Interfaces:**
- Consumes: `systemctl is-active` state of `gobi-ui.service` and `gobi-agent.service`.
- Produces: on a healthy boot, clears `upgrade_available=0` and `bootcount=0` — closing the trial so Task 1's guard won't roll back on the next power-cycle.

- [ ] **Step 1: Write the confirm script** `files/ecofleet-boot-confirm.sh`:

```sh
#!/bin/sh
# EcoFleet A/B boot-health confirm.
# Clears the u-boot rollback trial once this slot has booted healthy, so the
# bootloader won't revert on the next power-cycle. If the apps aren't up, leave
# the trial armed and fail — the guard keeps counting and will eventually roll
# back (see ecofleet-boot.cmd).
set -e

if systemctl is-active --quiet gobi-ui && systemctl is-active --quiet gobi-agent; then
    fw_setenv upgrade_available 0
    fw_setenv bootcount 0
    echo "boot-confirm: slot healthy — cleared boot trial"
else
    echo "boot-confirm: gobi-ui/gobi-agent not active — leaving boot trial armed" >&2
    exit 1
fi
```

- [ ] **Step 2: Write the systemd unit** `files/ecofleet-boot-confirm.service`. `After=` + `Wants=` the two apps, a settle delay so a slow first boot isn't falsely failed, `Type=oneshot` + `RemainAfterExit=yes` so it runs once per boot.

```ini
[Unit]
Description=EcoFleet A/B boot-health confirm (clears u-boot rollback trial)
After=gobi-ui.service gobi-agent.service
Wants=gobi-ui.service gobi-agent.service

[Service]
Type=oneshot
ExecStartPre=/bin/sleep 45
ExecStart=/usr/bin/ecofleet-boot-confirm.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: Write the recipe** `ecofleet-boot-confirm.bb` (mirrors the gobi-agent recipe's LICENSE/systemd conventions; `fw_setenv` comes from `libubootenv-bin`, already in the image):

```bitbake
SUMMARY = "Confirms A/B boot health and clears the u-boot rollback trial"
LICENSE = "CLOSED"

SRC_URI = " \
    file://ecofleet-boot-confirm.sh \
    file://ecofleet-boot-confirm.service \
"

S = "${WORKDIR}"

inherit systemd

RDEPENDS:${PN} += "libubootenv-bin"

SYSTEMD_SERVICE:${PN} = "ecofleet-boot-confirm.service"
SYSTEMD_AUTO_ENABLE:${PN} = "enable"

do_install() {
    install -d ${D}${bindir}
    install -m 0755 ${WORKDIR}/ecofleet-boot-confirm.sh ${D}${bindir}/ecofleet-boot-confirm.sh
    install -d ${D}${systemd_system_unitdir}
    install -m 0644 ${WORKDIR}/ecofleet-boot-confirm.service ${D}${systemd_system_unitdir}/
}

FILES:${PN} = " \
    ${bindir}/ecofleet-boot-confirm.sh \
    ${systemd_system_unitdir}/ecofleet-boot-confirm.service \
"
```

- [ ] **Step 4: Syntax check the script:** `sh -n meta-ecofleet/recipes-core/ecofleet-boot-confirm/files/ecofleet-boot-confirm.sh` — expect clean.

- [ ] **Step 5: Commit**

```bash
git add meta-ecofleet/recipes-core/ecofleet-boot-confirm/
git commit -m "feat(ota): ecofleet-boot-confirm service clears the trial on healthy boot"
```

---

### Task 4: Wire the confirm service into the image

**Files:**
- Modify: `meta-ecofleet/recipes-core/images/ecofleet-image.bb`

**Interfaces:**
- Consumes: the `ecofleet-boot-confirm` recipe from Task 3.
- Produces: the confirm service present + auto-enabled in the built rootfs.

- [ ] **Step 1: Add the recipe to the image.** In the `IMAGE_INSTALL:append = " \ ... "` block (the one that already lists `gobi-agent`, `gobi-ui`, `ecofleet-bootscript`, `libubootenv-bin`), add a line:

```
    ecofleet-boot-confirm \
```

- [ ] **Step 2: Verify the manifest edit** — re-read the `IMAGE_INSTALL:append` block and confirm `ecofleet-boot-confirm` is present on its own continued line, the block's trailing `"` is intact, and every line ends with ` \` except the closer.

- [ ] **Step 3: Commit**

```bash
git add meta-ecofleet/recipes-core/images/ecofleet-image.bb
git commit -m "feat(ota): install ecofleet-boot-confirm in the image"
```

---

## Build verification (no local Yocto)

There is no local BitBake, so recipe/boot.scr build errors surface only in CI. Kick the `build.yml` workflow against a throwaway tag (or the feature branch) and confirm: the image builds, `ecofleet-bootscript` compiles `boot.scr` (mkimage step green), and `ecofleet-boot-confirm` packages. Do NOT tag a real release version until the bench test below passes.

## Bench test plan (serial console MANDATORY — from the spec §Testing)

Run only with serial recovery on hand; a boot.cmd bug bricks boot.

- [ ] **Pre-flight #1:** at the u-boot prompt, `printenv mmcpart bsp_bootcmd bootcmd` — record where `boot.scr` is sourced from (Global Constraints). If a fixed partition, note the bad-boot.scr exposure.
- [ ] **Pre-flight #2:** `fw_printenv` from Linux shows `bootlimit`, `upgrade_available`, `bootcount` resolve (defaulted by first-boot init) and that `fw_env.config` targets the same env u-boot reads.
- [ ] **Happy path:** OTA a good image → cold-boot → confirm `ecofleet-boot-confirm` clears the trial (`fw_printenv upgrade_available` = 0, `bootcount` = 0), no rollback, correct slot.
- [ ] **Bad-boot rollback:** OTA a deliberately broken image (mask gobi-ui/gobi-agent so confirm never fires, or a rootfs that panics) → cold-boot repeatedly → confirm `bootcount` climbs each power-cycle and, once it exceeds `bootlimit`, `slot_active` flips back and the good slot boots.
- [ ] **Flicker resilience:** healthy boot, then a few power-cycles → `bootcount` stays 0 (confirm resets it every healthy boot), no spurious rollback.
- [ ] **Env-expression sanity:** confirm `setexpr` and `test -gt` behaved as expected in the captured console log.

## Follow-ups (out of scope here)
- If pre-flight #1 shows a fixed/shared `boot.scr` partition and that exposure matters, implement spec option (b): a per-slot `boot.scr` so A/B protects the boot script itself.
- Tune the confirm settle delay if a legitimately slow first boot trips a false rollback.
