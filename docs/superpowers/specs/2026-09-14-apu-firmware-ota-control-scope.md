# APU (STM32) Firmware OTA — Dashboard Control (Scope)

**Date:** 2026-09-14
**Status:** Scoped + **read-only scaffold landed** (this PR) / live flash trigger
still **BLOCKED on the STM32 flash path being bench-validated** (see Dependencies).

**Update 2026-09-14 — scaffold in this PR (behind `APU_OTA_ENABLED = false`):**
- `apu_ota` permission added to the frontend mirror **and** the authoritative
  api Lambda matrix (admin/fm). No command maps to it yet — `apu_firmware_target`
  is still rejected server-side (guard-tested), so the trigger is inert.
- `apuVersionLabel` / `apuFlashStateLabel` contract helpers (decode the encoded
  reg-2 int → human semver; label the flash state).
- FirmwareTab "APU controller firmware" card: read-only Current/Bundled/state
  now; the role/demo/engine-gated **Flash** button + stern confirm are written
  but rendered only when `APU_OTA_ENABLED` flips true.

**To finish (gated — do NOT flip the flag until Phase 0 is done):** Phase 1
(agent publishes `apu_bundled_fw_version` + `apu_flash_state`/`_seq`, accepts
`desired.apu_firmware_target`), Phase 2 (backend `validateCommand`/`commandActions`
accept `apu_firmware_target` under `apu_ota`), then set `APU_OTA_ENABLED = true`
and bench-verify (Phase 4).

---

## Goal
Let an operator push the **STM32 APU-controller firmware** to a unit from the web
dashboard — distinct from the existing Linux/cortex **image** OTA (`1.2.x`,
swupdate). Same guarded/confirmed UX, but it flashes the microcontroller that
runs the APU, so the safety bar is higher.

## Two firmwares (why this is separate)
- **Linux image OTA** (already shipped): dashboard `desired.firmware_target` →
  agent → `swupdate` A/B → reboots the Variscite board. Updates `gobi-agent`/UI.
- **APU firmware OTA** (this scope): the STM32 (EF-G0B1R) firmware, flashed by
  `gobi-agent` over RS-485/Modbus into the STM32's own A/B bootloader slots.
  A totally different transport and target.

## Dependencies / gate (must be true before building this)
1. **STM32 bootloader + A/B slots** (g0b1-firmware, sub-project #1): custom
   Modbus bootloader (FC 0x41/0x42), A/B slots, auto-revert on boot-fail —
   currently implemented but **bench-pending & unmerged**. Must be
   hardware-validated and cutting a real release `.bin`.
2. **Agent flash + delivery** (cortex, **PR #18**, sub-project #2): `gobi-agent`
   flashing the STM32 over Modbus; a real APU `.bin` bundled into the image
   (`g0b1-apu-firmware.bb`, `IMAGE_INSTALL` currently commented). Must be merged
   and the real `.bin` wired.

Until both are live, this dashboard control is inert. Build it only once the
agent can actually flash the MCU and report progress.

---

## Contract additions (device shadow)
Keep it separate from the image-OTA fields.

**`desired`** (dashboard → device):
- `apu_firmware_target` — the APU `.bin` version to flash (matches the version
  the agent has available; see "available versions" below). Distinct from
  `firmware_target` (Linux image).

**`reported`** (device → cloud, via shadow + telemetry):
- `apu_fw_version` — already published (current running STM32 firmware).
- `apu_bundled_fw_version` — the APU `.bin` version shipped in the current image
  (what a flash would install). New.
- `apu_flash_state` — `idle | flashing | verifying | done | failed`. New.
- `apu_flash_seq` — monotonic ack counter (compare-and-clear, like the heater
  `heater_desired_seq` pattern) so the dashboard can show pending→applied.
- `apu_flash_error` — optional code/string on failure.

Agent behaviour: on `apu_firmware_target`, verify APU is **idle/off** (reuse the
existing refuse-while-engine / crank / OP_DIAG safety gate), flash the STM32 A/B
slot over Modbus, verify, bump `apu_flash_seq`, and null `desired.apu_firmware_target`
once applied. A/B auto-revert protects against a bad flash.

## Backend
- **Permission**: new action `apu_ota` in the matrix — **admin/fm only** (stricter
  than image OTA if desired; maint excluded). Add to `permissions.js` + mirror.
- **Command endpoint**: extend `validateCommand`/`authorizeCommand` to accept
  `apu_firmware_target` (semver string, must be an available version) under the
  `apu_ota` action. Reject for demo units (already generic).
- **Available versions**: the APU `.bin` is bundled in the image (not S3), so the
  authoritative "available APU firmware" is whatever the device reports as
  `apu_bundled_fw_version`. No new S3 endpoint needed — the dashboard offers
  "flash the bundled version `<apu_bundled_fw_version>`". (If APU `.bin`s ever
  move to an S3 channel like the image OTA, add `GET /fleet/apu-releases`
  mirroring `/fleet/releases`.)

## Frontend (FirmwareTab, new section)
Add an **"APU controller firmware"** section below the existing image OTA block:
- Show **Current**: `apu_fw_version`; **Bundled/available**: `apu_bundled_fw_version`.
- **Flash APU firmware** button — `useCan('apu_ota')` gated, demo-disabled, with a
  stern `ConfirmDialog`: names the unit + version and warns the APU must be OFF
  and will be briefly unavailable while the MCU reflashes.
- Pending→applied via `apu_flash_seq`/`apu_flash_state` (reuse the heater-ack
  pattern: capture seq at send, show "Flashing…" until state=done/seq bumps).
- Disable the button (with reason) when the unit isn't idle/off — mirror the
  device-side safety gate so the UI doesn't offer an action the device will refuse.

## Safety (non-negotiable)
- Never flash while the engine is running/cranking — device enforces; UI also
  gates + confirms.
- A/B slots + auto-revert on boot-fail (bootloader side) are the real safety net.
- Command is role-gated server-side (authoritative) + UI-gated.

## Phasing
0. **(Blocked)** Validate STM32 bootloader (sub-project #1) + merge PR #18 + wire
   the real APU `.bin` into the image.
1. **Contract**: agent publishes `apu_bundled_fw_version` + `apu_flash_state`/
   `apu_flash_seq`; accepts `desired.apu_firmware_target`. (firmware/agent change)
   — **TODO** (gated on Phase 0).
2. **Backend**: `apu_ota` permission ✅ (done, this PR) + command validation
   (`apu_firmware_target`) — **TODO** (Phase 2).
3. **Frontend**: FirmwareTab APU section — read-only status ✅ + guarded/confirm
   Flash button written behind `APU_OTA_ENABLED` ✅ (this PR); flip the flag +
   pending/applied wiring on `apu_flash_seq` — **TODO** once Phases 0–2 land.
4. **Deploy + bench-verify** on a real MCU (flash → verify → auto-revert path).

## Open questions
- **Trigger model**: sub-project #2 designed *auto-when-idle, config-gated*
  flashing. Does the dashboard push **replace** that, or **coexist** (auto by
  default, manual override from the dashboard)? Recommend coexist.
- **APU `.bin` distribution**: stay bundled-in-image, or move to an S3 channel
  (like the image OTA) so APU firmware can be pushed without a full image update?
  The latter unlocks true independent APU OTA but is more infra.
- **Version scheme**: APU `.bin` version vs the encoded `apu_fw_version` register
  (e.g. 10240) — need a clean human-readable version the UI can show/compare.
- **Who**: is `apu_ota` admin-only, or admin+fm like image OTA?

---

**Bottom line:** the dashboard side is small and well-understood (a second OTA
section + one shadow field + one permission). The real work and risk are on the
device — the STM32 bootloader and the agent flasher — which must be validated and
merged first. Do not build steps 1–4 until Phase 0 is done.
