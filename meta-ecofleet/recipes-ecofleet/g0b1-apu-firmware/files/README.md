# g0b1-apu-firmware — v1.1.1 wired, IMAGE_INSTALL still gated on bench

This directory holds the two real STM32 (g0b1/APU) A/B slot images produced
by sub-project #1 (the bootloader + app A/B firmware, merged to
`g0b1-firmware` main):

- `g0b1-apu-1.1.1-slotA.bin` — resets into slot A (`0x08008000`)
- `g0b1-apu-1.1.1-slotB.bin` — resets into slot B (`0x08040000`)

`fw_version.h` documents 1.1.1 as the OTA round-trip validation build — a
real version bump meant to be streamed over RS-485 into the inactive slot of
a 1.1.0 device to prove the end-to-end flash. The recipe now `do_fetch`es and
builds, so CI can link the full agent + firmware bundle.

**`IMAGE_INSTALL:append` stays COMMENTED** (line 61 of
`meta-ecofleet/recipes-core/images/ecofleet-image.bb`) until sub-project #1
is bench-validated on real hardware — specifically the two remaining bench
cases: (a) the agent refuses to flash while the engine is running (fueled
run), and (b) A/B trial-boot auto-reverts a deliberately-broken app. Until
those pass, this un-bench-proven image must NOT auto-ship into every rootfs —
that gate is what keeps a bad image off a real engine controller.

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

## To ship a new release, do all of the following together

1. Copy the two `.bin` from `g0b1-firmware`'s `build-slots.sh` output into
   this `files/` directory.
2. Bump the version in the three filenames referenced by
   `../g0b1-apu-firmware.bb` (`SRC_URI` + `do_install`) to match.
3. Bump `version`/`slotA`/`slotB` in `manifest.json` (same directory) to
   match.
4. Uncomment the `IMAGE_INSTALL:append = " g0b1-apu-firmware"` stanza in
   `meta-ecofleet/recipes-core/images/ecofleet-image.bb` — **only once the
   image has been bench-validated** (see the gate note above).

See `docs/stm32-ota.md` at the repo root for the full end-to-end flow.
