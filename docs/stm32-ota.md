# STM32 (g0b1/APU) Remote Firmware Update — OTA Delivery

This documents how an STM32 (gobi/APU engine controller) firmware update
ships to the field. It rides **inside the normal signed cortex `.swu`** —
there is no separate STM32 update channel, no new signing key, and no CI
change. The blobs are just rootfs files, and the rootfs is already what
gets bundled and RSA-4096 signed.

## Status: RELEASE-pending

The recipe, manifest, and image wiring described below are complete and
ready to build, but the real `.bin` images do not exist yet — sub-project
#1 (the STM32 bootloader + A/B application firmware) is bench/release
-pending. See
`meta-ecofleet/recipes-ecofleet/g0b1-apu-firmware/files/README.md` for the
placeholder note. Until a release build drops real `.bin` into that
`files/` directory, `IMAGE_INSTALL:append = " g0b1-apu-firmware"` in
`meta-ecofleet/recipes-core/images/ecofleet-image.bb` stays commented out —
enabling it earlier would break the rootfs build (`do_fetch` failing on the
missing `file://...bin` entries in `g0b1-apu-firmware.bb`'s `SRC_URI`).

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
   { "version": "1.1.0",
     "slotA": "g0b1-apu-1.1.0-slotA.bin",
     "slotB": "g0b1-apu-1.1.0-slotB.bin" }
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

## Recipe verification

Recipe/bitbake syntax cannot be parsed on the dev host — there is no Yocto
build environment here. `g0b1-apu-firmware.bb`'s correctness (SRC_URI
fetch, do_install, FILES) is verified by the Yocto CI build once the real
`.bin` are in place. `manifest.json`'s JSON validity can and should be
checked locally with `python3 -m json.tool`.
