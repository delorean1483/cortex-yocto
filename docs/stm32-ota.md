# STM32 (g0b1/APU) Remote Firmware Update — OTA Delivery

This documents how an STM32 (gobi/APU engine controller) firmware update
ships to the field. It rides **inside the normal signed cortex `.swu`** —
there is no separate STM32 update channel, no new signing key, and no CI
change. The blobs are just rootfs files, and the rootfs is already what
gets bundled and RSA-4096 signed.

## Status: real v1.1.1 `.bin` wired; IMAGE_INSTALL gated on bench

Sub-project #1 (the STM32 bootloader + A/B application firmware) is merged
to `g0b1-firmware` main, and its `build-slots.sh` output — the two real
`g0b1-apu-1.1.1-slot{A,B}.bin` — is now wired into
`meta-ecofleet/recipes-ecofleet/g0b1-apu-firmware/` (recipe + manifest +
blobs). The recipe `do_fetch`es and builds, so CI can link the full agent +
firmware bundle.

**`IMAGE_INSTALL:append = " g0b1-apu-firmware"` in
`meta-ecofleet/recipes-core/images/ecofleet-image.bb` stays commented out**
until the flash path is bench-validated on real hardware — specifically the
two cases in **Bench validation** below (engine-running refusal + A/B
trial-revert). Enabling it earlier would auto-ship an un-bench-proven image
into every rootfs, which is exactly the gate that keeps a bad image off a
real engine controller. Flipping that one line is the go-live switch once
bench passes.

## Architecture in one paragraph

`gobi-agent` (running on the i.MX8/Variscite cortex board) already talks
Modbus-RTU to the STM32 g0b1/APU controller over RS-485. Sub-project #1 add
ed a custom Modbus bootloader (FC 0x41/0x42) plus A/B application slots to
the STM32 firmware itself. Sub-project #2 (this delivery mechanism) adds a
poll-loop task to the agent that reads a small manifest + two per-slot
`.bin` bundled in the cortex rootfs, compares versions against the
controller's live reg-2 firmware version, and — only when the APU is idle
and auto-flash is enabled — drives the transfer state machine (enter
bootloader → INFO → ERASE → stream DATA → VERIFY → COMMIT → confirm) into
the controller's inactive slot.

## End-to-end flow, step by step

1. **Bump the firmware version.** In the `g0b1-firmware` repo, bump
   `fw_version.h` (the STM32 application's own version string) and land the
   firmware change.
2. **Build the release slot images.** Run sub-project #1's
   `cube/build-slots.sh`. It produces one pre-linked `.bin` per A/B slot
   from a single build:
   - `g0b1-apu-<ver>-slotA.bin`
   - `g0b1-apu-<ver>-slotB.bin`

   Each MUST be `≤ 0x38000` (224 KB) — the app slot size baked into both
   the STM32 flash map and the agent's `G0B1_APP_SLOT_SIZE` read bound.
3. **Drop the two `.bin` into this repo.** Copy them into
   `meta-ecofleet/recipes-ecofleet/g0b1-apu-firmware/files/`.
4. **Bump the recipe.** In
   `meta-ecofleet/recipes-ecofleet/g0b1-apu-firmware/g0b1-apu-firmware.bb`,
   update the three filenames referenced in `SRC_URI` and `do_install()` to
   the new version.
5. **Bump the manifest.** In
   `meta-ecofleet/recipes-ecofleet/g0b1-apu-firmware/files/manifest.json`,
   update `version`, `slotA`, and `slotB` to match:
   ```json
   { "version": "1.1.1",
     "slotA": "g0b1-apu-1.1.1-slotA.bin",
     "slotB": "g0b1-apu-1.1.1-slotB.bin" }
   ```
   The agent's `stu_parse_manifest()` reads only `version` + the two
   filenames from this file; it computes CRC32/length from the `.bin`
   itself at VERIFY time, so the manifest never needs a checksum field.
6. **Uncomment the image wiring.** In
   `meta-ecofleet/recipes-core/images/ecofleet-image.bb`, uncomment the
   trailing stanza:
   ```
   IMAGE_INSTALL:append = " g0b1-apu-firmware"
   ```
   This is the one-line go-live switch — everything else is already in
   place.
7. **Tag the release.** `git tag vX.Y.Z` as usual for a cortex release.
8. **CI builds the signed `.swu` — no CI change needed.** The existing CI
   `make-swu.sh` (`scripts/make-swu.sh`) builds the `.swu` from the raw
   ext4 rootfs and signs it (`SWUPDATE_SIGN_KEY`, RSA-4096) exactly as it
   does today. Because the two `.bin` + `manifest.json` are now installed
   by the `g0b1-apu-firmware` recipe into `/lib/firmware/g0b1-apu/` inside
   that same rootfs, they are bundled and signed automatically along with
   everything else. Nothing in the CI pipeline or signing step needs to
   change or even be aware that an STM32 update is riding along.
9. **Device OTA lands the blobs.** A device applies the `.swu` the normal
   way (SWUpdate verifies the RSA-4096 signature over the whole bundle);
   after the update, `/lib/firmware/g0b1-apu/{manifest.json,
   g0b1-apu-<ver>-slotA.bin, g0b1-apu-<ver>-slotB.bin}` exist in the new
   rootfs.
10. **The agent auto-flashes the STM32.** On its next poll cycles,
    `gobi-agent`'s `stm32_flash_tick()` notices the bundled manifest
    version is newer than the controller's live reg-2 version. When the
    APU is idle (`mode` reg 10 == 0 **and** `engine_status` reg 22 == 0)
    and auto-flash is enabled (`G0B1_AUTO_FLASH_DEFAULT`, currently
    defaulted on in `files/config.h`), it drives the Modbus bootloader
    transfer into the controller's inactive slot, verifies, commits, and
    reports `stm32_update_status` in telemetry. If the APU is busy, the
    update just waits — it is picked up on a later idle cycle.

## Authenticity and integrity

- **Authenticity** is inherited entirely from the signed `.swu`. There is
  no additional crypto on the agent side, no separate key, and no
  per-blob signature — if the `.swu` verified, the STM32 blobs inside it
  are as trustworthy as the rest of the rootfs.
- **Integrity** is enforced with CRC32 (CRC-32/IEEE-802.3, zlib-compatible)
  computed by the agent from the `.bin` bytes it actually read, checked
  both at the bootloader's VERIFY step and again implicitly at boot by the
  STM32 bootloader before it will jump to the newly-written slot. A
  truncated or corrupted transfer fails VERIFY and is never committed —
  the previously-active slot stays authoritative.

## Operational note: the retry guard is version-keyed

The agent will attempt a given bundled version **at most once per process**
(see `stm32_flash_task.c`'s outcome-latching against
`g_bundled_ver_enc`). If a flash fails for a transient reason (comms glitch,
power interruption mid-stream, etc.) and you simply re-upload the same
`.swu` with the same `manifest.json` `version`, the agent will NOT retry —
it already recorded an outcome for that version. **Any content fix must
bump the patch version** (e.g. `1.1.0` → `1.1.1`) even if the STM32 binary
itself didn't need to change, so the agent sees a "new" bundled version and
re-attempts the flash. A device reboot also clears the in-process latch, so
a power cycle plus the same version will retry too — but don't rely on that
as the primary remediation path for a fleet-wide re-push.

If `stm32_update_status` is lingering on "failed" and you're not sure
whether the flash actually worked, check the live `apu_fw_version`
telemetry: if it already matches the bundled version, the flash actually
succeeded (the recorded failure was likely a transient post-commit
version-read glitch) and the status will read "ok" once the device
version is re-read — no action needed.

## Bench validation (required before go-live)

Two safety-critical cases must pass on real hardware before the
`IMAGE_INSTALL:append` line is uncommented. The code paths for both are in
place and host-reviewed; these bench runs prove them on silicon.

### Case A — engine-running refusal (fueled run)

The authoritative gate is **device-side**: reg 35 (enter-bootloader) in the
firmware's `mbp_boot.c` refuses with **Modbus exception 0x04**
(`MB_EXC_SLAVE_DEVICE_FAILURE`) whenever `app_engine_running()` is true. That
predicate covers `op_state == OP_ENGINE_START` (glow / fuel-prime / crank),
`op_state == OP_DIAG` (component test with a relay energized), **and**
`engine_op_status == ST_RUNNING`. The agent adds a soft gate:
`stu_should_flash()` only auto-attempts when reg 10 (`mode`) == 0 **and**
reg 22 (`engine_status`) == 0.

Procedure (with a real fueled APU and a newer bundled manifest present):
1. **Running** (reg 22 == `ST_RUNNING`): confirm the agent does NOT
   auto-flash — `stm32_update_status` stays `idle`/`available`, never
   `flashing`.
2. Force the attempt anyway by writing the arm-magic to reg 35 (bench Modbus
   master): confirm the controller returns exception **0x04** and the MCU
   does **not** reset.
3. Repeat mid-**crank** (`OP_ENGINE_START`) and during a **component test**
   (`OP_DIAG`, one output energized): both must refuse identically.

**PASS:** no MCU reset / no slot write in any running / crank / diag state;
the previously-active slot stays authoritative throughout.

### Case B — A/B trial-revert with a patched app

Mechanism: a freshly-flashed slot is marked `SLOT_STATE_TRIAL`
(`bl_session.c`). On each boot, `boot_decide()` increments `trial_count`; the
app self-confirms to `SLOT_STATE_COMMITTED` only after
`APP_CONFIRM_HEALTHY_SECS` (5) consecutive healthy 1 s ticks (`app_confirm.c`).
If the trial slot is not confirmed within `TRIAL_BOOT_LIMIT` (3) boots,
`boot_decide()` marks it `BAD` and reverts to the other `COMMITTED` slot.

Procedure:
1. Build a deliberately-broken app `.bin` — e.g. a hard fault at startup, or
   one whose health predicate never returns healthy so it never
   self-confirms. Give it a bumped version (the retry guard is version-keyed).
2. Flash it into the inactive slot; confirm the slot is marked `TRIAL` and
   becomes active.
3. Let it boot: confirm it never self-confirms (never reaches 5 healthy
   seconds), the MCU resets (watchdog / fault), and `trial_count` climbs each
   boot.
4. After the 3rd unconfirmed trial boot: confirm `boot_decide()` marks the
   trial slot `BAD` and reverts `active_slot` to the previous `COMMITTED`
   slot, which boots normally (reg-2 `apu_fw_version` reads the OLD version
   again).

**PASS:** the controller ends up running the previous good firmware, the bad
slot is `BAD` and never booted, and the unit is not bricked.

**Carry-forward:** after a revert, re-testing the *same* broken version will
not re-flash (version-keyed retry latch) — bump the patch version to attempt
again.

## Recipe verification

Recipe/bitbake syntax cannot be parsed on the dev host — there is no Yocto
build environment here. `g0b1-apu-firmware.bb`'s correctness (SRC_URI
fetch, do_install, FILES) is verified by the Yocto CI build once the real
`.bin` are in place. `manifest.json`'s JSON validity can and should be
checked locally with `python3 -m json.tool`.
