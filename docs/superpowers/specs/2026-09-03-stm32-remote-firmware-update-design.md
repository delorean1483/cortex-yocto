# STM32 (gobi/APU) Remote Firmware Update — Design Spec

**Date:** 2026-09-03
**Status:** Draft — design approved in brainstorm; pending spec review, then implementation plan.
**Repos:** `g0b1-firmware` (bootloader + app changes) and `cortex-yocto` (gobi-agent flash protocol + delivery).

## Goal

Update the STM32G0B1 (gobi/APU controller) firmware **remotely**, the way the cortex (i.MX8) already updates over the air — without an ST-LINK trip to the vehicle. A failed update must never brick the APU or drop engine control: the old firmware keeps running until the new one is verified and confirmed healthy.

## Context / why this shape

- Today the STM32 is flashed **only via SWD** (ST-LINK on header HDR1) at the bench. There is no remote path.
- **Hardware constraint (from `G0B1 APU Manager R1.pdf`):** `BOOT0` (PA14, shared SWCLK) and `NRST` (PF2) are wired **only to the SWD header**, not to the cortex. So the cortex cannot force the STM32 into the **ST ROM bootloader** (no BOOT0/NRST control). The clean "ST-ROM-over-UART / stm32flash" path is unavailable.
- The cortex↔STM32 link is the **Main-Board Scorpion connector (ST1)**, carrying **USART1 via the RS-485 transceiver** (the existing Modbus link), **LPUART1** (PC0/PC1 + RTS/CTS, full-duplex), and spare GPIOs (PA15, PD9, PD8).
- The STM32 firmware **already reserved the hooks** for a custom bootloader: `EE_BOOTLOADER_FLAG` (NVM) and Modbus **function codes 0x41/0x42 "reserved for bootloader file transfer, not implemented"**.
- The cortex **already** verifies a signed `.swu`, runs A/B with auto-rollback (built this session), and can command the STM32 (Modbus, incl. reg 34 software reset).
- Flash is **512 KB**; the app is ~61 KB. Room for a bootloader **plus two A/B app slots**.

Given all of the above, the design is a **custom Modbus bootloader on the STM32 with A/B app slots**, fed by the cortex over the existing RS-485 link, delivered inside the cortex OTA image.

## Architecture

```
cortex signed .swu  (existing OTA + shadow pipeline, unchanged)
  └─ bundles g0b1-apu-<ver>.bin + manifest (version, CRC32) in the rootfs
       └─ gobi-agent: read running STM32 version (reg 2) vs bundled version
            └─ if bundled newer AND apu is OFF/engine-off (safety gate):
                 1. command STM32 → enter bootloader (Modbus)          [app → reset]
                 2. bootloader handshake (FC 0x41 "info")
                 3. erase INACTIVE slot
                 4. stream image chunks into inactive slot (FC 0x42), each ACK'd
                 5. send expected length+CRC32; bootloader verifies the written slot
                 6. commit: mark inactive slot valid + TRIAL-active; reset
                      └─ bootloader boots the new slot on trial
                           └─ app runs clean → sends "confirm" (Modbus) → slot COMMITTED
                           └─ app never confirms within N boots → bootloader REVERTS to old slot
```

One signed delivery, one version to bump; reuses the whole cortex OTA + shadow infrastructure.

## Component A — STM32 bootloader (`g0b1-firmware`, new)

The bootloader is the one piece that is **never updated remotely** (SWD-only). It must be small, robust, and self-contained (no dependency on the SPI NOR or the app).

### Flash layout (512 KB, page size 2 KB, base 0x08000000)

| Region | Address | Size | Remote-updatable |
|--------|---------|------|------------------|
| Bootloader | 0x08000000 | 32 KB | No (SWD only) |
| Slot A app | 0x08008000 | 224 KB | Yes |
| Slot B app | 0x08040000 | 224 KB | Yes |
| Boot-config | 0x08078000 | 32 KB (a few 2 KB pages used) | By bootloader |

(32 + 224 + 224 + 32 = 512 KB exactly; boundaries are 2 KB-page-aligned.)

Sizes are the proposed starting point; the plan finalizes exact page-aligned boundaries. (STM32G0B1 can run dual-bank; not required here since the bootloader executes from its own region while writing a slot.)

### Boot decision (runs first, at reset)

1. **Update requested?** Check a magic value in a reset-surviving location (TAMP backup register or a `no-init` RAM word) set by the app before it reset. If present → clear it, enter **update mode** (wait for an image over Modbus). This is how the cortex triggers an update without BOOT0.
2. **Trial in progress?** If the active slot is marked `TRIAL` in boot-config, increment its trial-boot counter (persist). If it exceeds the limit (e.g. 3) without a `CONFIRM`, **revert**: mark the active slot bad, switch to the other valid slot.
3. **Boot the active slot:** validate it (magic header + CRC32 over its length from boot-config). If valid → relocate VTOR + jump. If invalid → try the other slot. If both invalid → stay in a **safe recovery** update-mode (wait for an image; do NOT run garbage).

### Update mode (receiving an image)

- Speaks a **minimal Modbus** (transfer FCs + a status read) — NOT the full app register map.
- Sequence: handshake (info) → erase inactive slot → receive chunks → verify CRC32 → commit (mark inactive slot valid + TRIAL-active) → reset.
- **Never erases or writes the bootloader region or the active slot.** Only the inactive slot.
- Watchdog-safe; a transfer timeout aborts cleanly (bootloader keeps the old active slot).

### Boot-config (internal flash page)

Per-slot state so the bootloader is self-contained (no NOR): `{ active_slot, for each slot: valid flag + image_length + CRC32 + state (COMMITTED|TRIAL|BAD), trial_boot_count }`. Written by the bootloader (on commit / revert) and read at every boot. Kept in internal flash (not the SPI NOR) so a NOR fault can't affect the boot decision.

## Component B — STM32 app changes (`g0b1-firmware`)

- **Linker:** build the app to run at a slot base (VTOR-relocatable). The image is slot-agnostic (position-independent enough, or built per-slot / linked to run from either via VTOR + a fixed offset). Plan decides: single image bootable from either slot vs per-slot builds. (Preferred: one image, bootloader sets VTOR to the active slot's base.)
- **Version:** already exposed as reg 2 (`G0B1_FW_VERSION_ENC`). The bootloader also stores the running version in boot-config for the agent to compare (or the agent reads reg 2 from the running app — simpler).
- **Enter-bootloader command:** a Modbus write (reuse `EE_BOOTLOADER_FLAG` semantics or a dedicated control reg) → the app sets the reset-magic and calls `NVIC_SystemReset`. **MUST refuse if the engine is running** (or perform a safe shutdown first) — see Safety.
- **Confirm-healthy:** once the app has booted and is running cleanly (control loop alive, sensors sane), it sends a Modbus "confirm slot" command → the bootloader clears the slot's TRIAL state to COMMITTED (mirrors the cortex boot-confirm). Until then the trial-boot counter is armed.

## Component C — Modbus firmware-transfer protocol (FCs 0x41 / 0x42)

Wire protocol over RS-485, 9600 8N1, DE-controlled (the bootloader drives PB3/DE exactly like the app). Modbus PDU max 253 bytes → chunk payload ~240 bytes.

- **FC 0x41 — bootloader control/status** (sub-function in the first data byte):
  - `INFO` → returns {bootloader version, inactive slot #, slot size, max chunk, CRC algo=CRC32}.
  - `ERASE` → erase the inactive slot; ACK when done (erase is slow — allow a long response timeout).
  - `VERIFY {length, crc32}` → bootloader CRC32s the written inactive slot; ACK/NAK.
  - `COMMIT` → mark inactive slot valid + TRIAL-active; then reset.
  - `ABORT` → discard; stay on the old active slot.
  - `CONFIRM` → (from the running app) clear TRIAL → COMMITTED.
- **FC 0x42 — write data chunk** `{offset (4B), len (1B), data[len]}` into the inactive slot; ACK per chunk (agent retries a NAK/timeout).

Exact framing (CRC-16 Modbus wrapper, addresses, timing) finalized in the plan; the reserved 0x41/0x42 codes anchor it.

## Component D — cortex / gobi-agent side (`cortex-yocto`)

- **Version compare:** read running STM32 version (reg 2) vs the bundled `g0b1-apu-<ver>.bin` version (from its manifest/filename). Flash only if bundled is newer.
- **Safety gate:** flash ONLY when the APU is safe — `mode=off` and engine not running (reg 22 engine status off, reg 10 mode off). Never interrupt a running engine. If not safe, defer (retry when the APU next goes idle).
- **Flash sequence:** the Component-C protocol — enter bootloader → info → erase → stream chunks with ACK/retry → verify → commit → wait for reset → re-read reg 2 → expect the new version. On the new app confirming healthy, done. On any failure, the bootloader keeps the old slot; agent logs + retries later.
- **Progress + observability:** syslog progress, expose STM32-update status in telemetry (latest.json) so the UI/cloud can see "APU firmware updating…".
- **New gobi-agent module** for the transfer (bounded, testable against a host fake bootloader).

## Component E — Delivery

- The **STM32 image ships inside the cortex OTA image** (rootfs), e.g. `/lib/firmware/g0b1-apu/g0b1-apu-<ver>.bin` + a small manifest (version, CRC32).
- **Fetch mechanism (decision for the plan):** a Yocto recipe that fetches `g0b1-apu-<ver>.bin` from a **g0b1-firmware GitHub release** pinned by version (keeps the binary blob out of the cortex repo and versioned), OR commits the blob into cortex-yocto. Preference: fetch-by-release.
- Bumping the STM32 firmware = build a g0b1-firmware release, bump the pinned version in the cortex recipe, cut a cortex `.swu`. The next cortex OTA carries it and auto-flashes the STM32.

## Integrity & authenticity

- **Authenticity:** inherited from the cortex `.swu` RSA-4096 signature (already enforced). The STM32 image rides inside the signed bundle, so a tampered image can't reach the device. No crypto on the M0+.
- **Integrity:** **CRC32** over the STM32 image, checked (a) by the agent before sending, (b) by the bootloader after writing the inactive slot (VERIFY), and (c) at every boot (boot-config CRC over the slot). Catches corrupt/interrupted transfers and flash bit-rot.

## Safety (critical — this controls a real engine)

- **Never flash while the engine runs.** Entering the bootloader stops the control loop → no oil-pressure/over-temp monitoring. The agent gates on APU-off; the app **refuses the enter-bootloader command while the engine is running** (belt-and-suspenders) — or safe-shuts-down first, then enters.
- **Bootloader is never remotely writable.** Only the inactive app slot is ever erased/written remotely. The bootloader + active slot are untouched during a transfer.
- **A/B keeps the last-good app.** A failed/interrupted update leaves the old slot active and valid; the APU keeps running it.
- **Watchdog:** the bootloader refreshes the IWDG during long erase/write, or runs with the IWDG windowed appropriately; a wedged transfer resets into the still-valid old slot.
- **Power-loss during flash:** the inactive slot may be half-written, but it's marked valid only after VERIFY+COMMIT, so a power cut mid-transfer leaves the old slot active and the inactive slot simply invalid (re-attempted next time).

## Edge cases

- **Interrupted transfer / timeout:** bootloader aborts, old slot stays active. Agent retries later.
- **Bad CRC at VERIFY:** NAK; inactive slot not committed; old slot stays. Retry.
- **Both slots invalid** (should be impossible in normal flow): bootloader stays in safe update-mode waiting for an image (APU down but recoverable over the bus — no ST-LINK trip).
- **New app boots but is broken** (crashes / never confirms): trial-boot counter exceeds limit → bootloader reverts to the old slot.
- **Agent commands bootloader but STM32 already updated** (version match): agent skips; no-op.
- **Engine starts mid-transfer:** can't happen — the app isn't running during transfer (it's in the bootloader), so nothing can start the engine; and the agent only starts a transfer when the APU is off.

## Testing plan

- **Host-testable (TDD):** the Modbus transfer protocol codec (chunk framing, CRC32, FC parsing) on both sides; the boot-decision logic (slot validation, trial/revert state machine) via a flash fake; the gobi-agent transfer module against a host fake bootloader. Aim to make as much as possible host-tested — the bootloader's decision logic especially.
- **Bench (SWD + serial + ST-LINK recovery on hand):** flash the bootloader + both slots via SWD; exercise a full remote update over RS-485 from the cortex; interrupted-transfer + bad-CRC + revert cases; **confirm the bootloader can always be re-entered / a bad slot recovered without an ST-LINK** (the whole point). The bootloader is the risky part — heavy bench validation.
- **Engine-safety:** verify the app refuses enter-bootloader while the engine runs, and the agent defers while the APU is on.

## Risks

- **Bricking via a bad bootloader.** The bootloader is SWD-only to fix, so a bad bootloader shipped to the field = an ST-LINK trip per unit. Mitigation: keep it minimal, host-test the decision logic exhaustively, and bench-validate hard before it's ever in a field unit. (First deployment of the bootloader itself is an SWD/bench step, not remote.)
- **RS-485 at 9600 is slow** (~1 min per slot). Acceptable for a one-shot; LPUART1 is the escape hatch if needed.
- **Flash-write reliability on M0+** (erase/program timing, IWDG interplay). Standard HAL flash, but exercise power-loss cases at the bench.
- **Cross-repo version coupling** (cortex image pins a g0b1 release). Needs a clear release/version discipline.

## Open items / to finalize in the plan

- Exact page-aligned slot boundaries + boot-config format.
- One slot-agnostic app image (VTOR relocation) vs per-slot builds.
- Reset-magic location: TAMP backup register vs no-init RAM.
- Exact Modbus framing for FC 0x41/0x42 (sub-functions, CRC-16 wrapper, timeouts, erase-response timing).
- Delivery: g0b1 release fetch recipe vs blob-in-repo.
- Confirm mechanism: dedicated Modbus reg vs reuse of `EE_BOOTLOADER_FLAG`.
- Whether the app safe-shuts-down before entering the bootloader, or simply refuses while running.

## Out of scope

- Updating the bootloader itself remotely (SWD-only by design).
- LPUART1 / FDCAN transfer channels (RS-485 Modbus for v1; LPUART1 noted as a future speed option).
- Cortex-side OTA changes (that pipeline is done and reused as-is).

## Sub-projects (each gets its own plan)

1. **STM32 bootloader + app A/B** (`g0b1-firmware`) — the bootloader, flash layout/linker, boot-config state machine, the transfer FCs, app enter-bootloader/confirm/engine-safety. The larger + riskier half.
2. **cortex flash + delivery** (`cortex-yocto`) — gobi-agent transfer module + version-compare + safety gate + progress, and the delivery recipe bundling the g0b1 image. Depends on the protocol from (1).
