# STM32 (g0b1/APU) Firmware OTA — Go-Live Runbook

Turnkey checklist for **activating** remote STM32 APU-controller firmware
updates on the fleet. Everything below is staged and merged; the only thing
gating go-live is the two bench cases. Once they pass, this is a ~30-minute
software activation.

Companion docs:
- `docs/stm32-ota.md` — the delivery mechanism + the **Bench validation**
  section (exact Case A / Case B procedure and PASS criteria).
- Sub-project detail: the agent flash path, delivery recipe, and web trigger.

---

## 0. Where we are (as of 2026-09-16)

All software is on `main` and staged **inert**:

| Piece | State |
|---|---|
| Agent flash code (`stm32_*.c`, `bl_*.c`) | Merged; **live on `.86` in v1.2.49** (reports `stm32_update_status:"idle"`) |
| Delivery recipe + real **v1.1.1** A/B blobs + manifest | Merged; usrmerge-fixed; **build-verified via a one-off Yocto build** with `IMAGE_INSTALL` temporarily enabled (recipe fetch/install/usrmerge-QA pass + image bundles the blobs). ⚠ No *standing* CI job builds it — §2d is the first time it's exercised in a real release build. |
| Web trigger (agent `apu_firmware_target` + telemetry `apu_bundled_fw_version`/`apu_flash_state`) | Merged (PR #44) |
| Backend `apu_firmware_target` under `apu_ota` (admin/fm) | Merged **and deployed to prod** (`ecofleet-prod-api`) 2026-09-16 |
| Frontend Flash button | Scaffolded, behind `APU_OTA_ENABLED=false` |
| Flashing posture | **Explicit web-only** (`G0B1_AUTO_FLASH_DEFAULT=0`) — flash per-unit on operator request, never fleet-wide auto |

**Why it's inert:** `IMAGE_INSTALL:append " g0b1-apu-firmware"` is commented in
`meta-ecofleet/recipes-core/images/ecofleet-image.bb`, so no manifest ships →
`stm32_flash_bundled_ver_enc()==0` → any request mismatches the (absent)
bundled image and self-clears without flashing. Flipping that one line + the
frontend flag is the whole go-live.

---

## 1. GATE — bench validation (MUST pass first) — Robb + hardware

Do **not** proceed past here until both pass on a real fueled APU. Full
procedure and PASS criteria: `docs/stm32-ota.md` → **Bench validation**.

- [ ] **Case A — engine-running refusal.** With a newer bundled manifest
      present: engine running / cranking (`OP_ENGINE_START`) / component test
      (`OP_DIAG`) all refuse the flash (firmware reg-35 returns Modbus
      exception `0x04`), no MCU reset, previously-active slot stays
      authoritative.
- [ ] **Case B — A/B trial-revert.** A deliberately-broken app (never
      self-confirms) is flashed into the inactive slot, marked `TRIAL`; after
      `TRIAL_BOOT_LIMIT` (3) unconfirmed boots `boot_decide()` marks it `BAD`
      and reverts to the previous `COMMITTED` slot. Unit not bricked.

> These prove the safety gate on silicon. Everything below assumes both passed.

---

## 2. GO-LIVE — software activation (after bench passes)

Run in order. Repo is `delorean1483/cortex-yocto` (this dir). Work on a branch
and PR to `main` — don't commit go-live switches directly to `main`.

### 2a. Enable the delivery recipe in the image
- [ ] Edit `meta-ecofleet/recipes-core/images/ecofleet-image.bb` — **uncomment**
      the last line:
      ```
      IMAGE_INSTALL:append = " g0b1-apu-firmware"
      ```
- [ ] Confirm the bundled version is the intended one:
      `meta-ecofleet/recipes-ecofleet/g0b1-apu-firmware/files/manifest.json`
      (currently `1.1.1`). To ship a *different* STM32 version, do §4 first.

### 2b. Backend — already deployed, just verify
The `apu_firmware_target` handler is already live in prod (2026-09-16). Verify
prod tracks `main`:
- [ ] `aws lambda get-function-configuration --function-name ecofleet-prod-api --region us-east-1 --profile ecofleet --query CodeSha256 --output text`
- [ ] If a later backend change is unmerged/undeployed: `./scripts/deploy-lambda.sh api`
      (Claude-runnable; watch the spurious `ResourceConflictException` per the
      lambda-deploy note — verify via `CodeSha256`).

### 2c. Frontend — reveal the Flash button

> ⚠ **Ordering:** revealing the button before the blob-carrying image has
> reached at least one unit (§2d–§2f) leaves a **dead-click window** — the
> button is live but no unit has a manifest, so `bnd==0` and every click
> **acks-and-drops** (`apu_flash_state` stays `idle`, `apu_fw_version`
> unchanged). To the operator it looks like the flash silently does nothing.
> Prefer to do §2d–§2f first and run the actual `vercel --prod` here **last**,
> or accept that clicks are no-ops until the image lands.

`APU_OTA_ENABLED` is a build-time constant, so this is a code change + redeploy:
- [ ] Edit `cloud/frontend/src/config/flags.js` line 15 → `export const APU_OTA_ENABLED = true`.
- [ ] `cd cloud/frontend && npm test -- --run` (expect green).
- [ ] Deploy: `vercel --prod` from `cloud/frontend`. **User-run via `!`** —
      the auto-mode classifier blocks `vercel --prod` for Claude. Move
      `.env.local` (`VITE_MOCK=on`) aside for the build and restore after (Vite
      loads it in all modes — see the web-dashboard deploy notes).

### 2d. Cut the image release that carries the blobs
The STM32 blobs ride the normal signed `.swu`; no CI change.
- [ ] Merge the go-live branch (§2a + §2c) to `main`.
- [ ] Tag + build (build.yml is `workflow_dispatch`-only; publish steps are
      tag-gated — a branch build ships nothing):
      ```
      git tag vX.Y.Z && git push origin vX.Y.Z
      gh workflow run build.yml -R delorean1483/cortex-yocto --ref vX.Y.Z
      ```
- [ ] Wait for success; confirm `s3://ecofleet-ota/releases/X.Y.Z/ecofleet-X.Y.Z.swu`
      (HTTP 200) + GitHub release. (`X.Y.Z` has no leading `v` in the asset name.)

### 2e. Deliver the image to a unit
Hands-free OTA works end-to-end (warm-reboot fix + decoupled worker shipped):
- [ ] Push the target to the unit's shadow:
      ```
      aws iot-data update-thing-shadow --thing-name gobi-apu-TRUCK-001 \
        --region us-east-1 --profile ecofleet --cli-binary-format raw-in-base64-out \
        --payload '{"state":{"desired":{"firmware_target":"X.Y.Z"}}}' /tmp/o.json
      ```
- [ ] The agent self-serves (download → swupdate → PMIC cold reboot).
      Optionally clear the desired (`firmware_target: null`) afterward as state
      hygiene — **not** required to avoid a loop: `ota_trigger()` has a
      loop-guard (main.c) that skips the install once the unit is already
      running the target version, so leaving it set does not re-install/reboot.
- [ ] (Manual alternative: `swupdate -i ecofleet-X.Y.Z.swu -f /etc/swupdate/ecofleet.cfg`
      on the device — the real `swupdate -i` install is **user-run via `!`**,
      classifier-blocked for Claude.)

### 2f. Confirm the manifest landed
On the device, the recipe now installs the blobs:
- [ ] `ssh root@192.168.0.86 'ls -l /lib/firmware/g0b1-apu/'` → `manifest.json` +
      `g0b1-apu-<STM32VER>-slotA.bin` + `...slotB.bin`, where `<STM32VER>` is the
      **STM32 firmware version from the manifest (currently `1.1.1`)** — NOT the
      cortex image release `X.Y.Z` used in §2d/§2e. The two are independent: image
      `v1.2.50` can carry STM32 blobs named `g0b1-apu-1.1.1-slot{A,B}.bin`.
      (Resolves via the usrmerge `/lib -> usr/lib` symlink; the recipe installs
      to `/usr/lib/firmware/...`.)
- [ ] `ssh root@192.168.0.86 'grep -o "\"apu_bundled_fw_version\":[0-9]*\|\"apu_flash_state\":\"[a-z]*\"" /var/lib/ecofleet/latest.json'`
      → bundled version encoded (e.g. `10101` for 1.1.1) + `"idle"`.

### 2g. Flash a unit from the dashboard
- [ ] APU must be **OFF/idle** (mode 0, engine 0). On the FirmwareTab
      (https://frontend-murex-xi-74.vercel.app → unit → Firmware) click **Flash
      APU firmware** and confirm.
- [ ] Watch `apu_flash_state`: `idle → flashing → done`, and `apu_fw_version`
      bump to the new version (reg-2). If the APU is busy, the request stays
      pending and flashes when it next goes idle.

---

## 3. Verify / rollback

**Success looks like:** `apu_fw_version` == the bundled version; the STM32 A/B
swap landed and self-confirmed (`TRIAL → COMMITTED`); heater + control still
work (heater_present=true, sensors live).

**Rollback / disable:**
- **Firmware self-heals:** a bad slot never self-confirms → the STM32
  bootloader auto-reverts to the previous `COMMITTED` slot (bench Case B). No
  fleet action needed for a single bad flash.
- **Disable the web trigger fleet-wide:** flip `APU_OTA_ENABLED=false` +
  `vercel --prod` (hides the button immediately, no image needed). The backend
  still accepts the command, but with the button gone nothing sends it.
- **Stop shipping the blobs:** re-comment `IMAGE_INSTALL` and cut the next
  image (removes the manifest → agent goes inert again).

**Retry a failed flash:** the retry guard is **version-keyed** — the agent
attempts a given bundled version at most once per process. To re-attempt after
a failure, bump the STM32 patch version (§4) or reboot the unit; re-sending the
same version won't re-flash. See `docs/stm32-ota.md` → *Operational note*.

---

## 4. Ongoing — shipping a NEW STM32 firmware version

Full steps in `docs/stm32-ota.md` → *End-to-end flow*. In brief, in
`g0b1-firmware`:
1. Bump `fw_version.h`; land the firmware change.
2. `cube/build-slots.sh` → `g0b1-apu-<ver>-slot{A,B}.bin` (each ≤ `0x38000`).

Then in this repo:
3. Drop the two `.bin` into `meta-ecofleet/recipes-ecofleet/g0b1-apu-firmware/files/`.
4. Bump the **two** versioned `.bin` filenames in `g0b1-apu-firmware.bb` —
   `slotA` and `slotB`, each appearing in both `SRC_URI` and `do_install`
   (4 edit sites). `manifest.json` is unversioned — don't rename it.
5. Bump `files/manifest.json` (`version`, `slotA`, `slotB`).
6. Cut a tagged image (§2d) and deliver (§2e). Any content fix **must** bump the
   patch version even if the binary is unchanged (version-keyed retry guard).

> The recipe installs under `${nonarch_base_libdir}/firmware/g0b1-apu` (usrmerge-
> safe); don't hardcode `/lib`.

---

## Handy: who can run what
- **Claude can run:** `deploy-lambda.sh api`, `gh workflow run build.yml`,
  `gh pr merge`, `aws iot-data update-thing-shadow`, ssh read checks.
- **User must run via `!`** (classifier-blocked): `vercel --prod`, the real
  `swupdate -i` install on the device.
