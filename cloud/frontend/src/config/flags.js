// Feature flags.
//
// APU_OTA_ENABLED gates the *live trigger* for flashing the STM32 APU-controller
// firmware from the dashboard. The read-only "APU controller firmware" status
// (current / bundled version + flash state) always renders; only the Flash
// button + command path is behind this flag.
//
// Keep it OFF until the STM32 flash path is proven end-to-end on real hardware:
//   1. sub-project #1 (bootloader + A/B slots) bench-validated — specifically
//      the engine-running refusal and A/B trial-revert cases,
//   2. PR #18 (agent flash + real .bin delivery) merged, and
//   3. the backend command endpoint accepts `apu_firmware_target` under the
//      `apu_ota` action (scope Phase 2) and the agent acts on it (Phase 1).
// See docs/superpowers/specs/2026-09-14-apu-firmware-ota-control-scope.md.
export const APU_OTA_ENABLED = false
