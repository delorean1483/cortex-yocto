// Feature flags.
//
// APU_OTA_ENABLED gates the *live trigger* for flashing the STM32 APU-controller
// firmware from the dashboard. The read-only "APU controller firmware" status
// (current / bundled version + flash state) always renders; only the Flash
// button + command path is behind this flag.
//
// GO-LIVE 2026-09-18: all preconditions met —
//   1. sub-project #1 bench-validated on silicon: engine-running refusal
//      (Case A) + A/B trial-revert (Case B) both proven,
//   2. agent flash path + real v1.1.2 .bin delivery merged + bundled in the
//      image (IMAGE_INSTALL enabled), and
//   3. backend accepts `apu_firmware_target` under `apu_ota` (deployed) and the
//      agent acts on it.
// See docs/bench/2026-09-16-stm32-ota-go-live-runbook.md.
export const APU_OTA_ENABLED = true
