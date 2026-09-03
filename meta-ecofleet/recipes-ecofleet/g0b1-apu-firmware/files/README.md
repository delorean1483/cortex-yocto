# g0b1-apu-firmware — RELEASE-pending

This directory is where the two real STM32 (g0b1/APU) A/B slot images live
once sub-project #1 (the bootloader + app A/B firmware) has a release build.
**They are intentionally absent right now.** This recipe will NOT build
until they are placed here — `do_fetch` will fail on the missing
`file://...bin` entries in `g0b1-apu-firmware.bb`'s `SRC_URI`. That is by
design: it keeps a garbage/placeholder image from ever being flashed to a
real engine controller, and it keeps the rootfs build green until a real
release exists (see the commented `IMAGE_INSTALL:append` stanza in
`meta-ecofleet/recipes-core/images/ecofleet-image.bb`).

## Where the real `.bin` come from

Sub-project #1 lives in the `g0b1-firmware` repo. Its
`cube/build-slots.sh` produces one pre-linked `.bin` per A/B slot from a
single build of the bootloader + application:

- `g0b1-apu-<ver>-slotA.bin`
- `g0b1-apu-<ver>-slotB.bin`

where `<ver>` is the `fw_version.h` version string (e.g. `1.1.0`).

## Size limit

Each `.bin` **MUST be ≤ `0x38000` (224 KB)** — the app slot size baked into
both the STM32 bootloader's flash map and the agent's `G0B1_APP_SLOT_SIZE`
read bound (`meta-ecofleet/recipes-ecofleet/gobi-agent/files/config.h`). A
larger image will not fit the slot and must not be shipped.

## At release, do all of the following together

1. Copy the two `.bin` from `g0b1-firmware`'s `build-slots.sh` output into
   this `files/` directory.
2. Bump the version in the three filenames referenced by
   `../g0b1-apu-firmware.bb` (`SRC_URI` + `do_install`) to match.
3. Bump `version`/`slotA`/`slotB` in `manifest.json` (same directory) to
   match.
4. Uncomment the `IMAGE_INSTALL:append = " g0b1-apu-firmware"` stanza in
   `meta-ecofleet/recipes-core/images/ecofleet-image.bb`.

See `docs/stm32-ota.md` at the repo root for the full end-to-end flow.
