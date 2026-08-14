# STM32G0 APU Port — Milestone 6e: Runtime Hours + Oil-Change Warnings — Design

**Status:** Approved 2026-08-14. Expands the overarching design spec `2026-08-12-pic18-to-stm32g0-apu-port-design.md` for the background runtime-accounting routine. Source of truth: PIC `main.c` `Do_1minute` (~L1107–1188) + `inc_long_term_counter`/`read_long_term_counter` (~L1190–1245), `main.h` oil-change constants + `oil_message_state_list`.

## 1. Overview & Scope

Port the PIC `Do_1minute` runtime-accounting behavior: accumulate machine/engine/oil-change runtime hours into NVM once per hour, and raise oil-change warnings (`OIL_CHANGE_SOON`/`NEEDED`/`PAST_DUE`) from the accumulated oil hours. This is a **background accounting routine on a new 1-minute scheduler slot — no new control mode, no dispatcher change.** It completes the port of the PIC application behavior.

**Decisions (from brainstorming):**
- **Single 16-bit saturating word per counter** — the PIC's multi-word carry chain (`inc_long_term_counter`/`read_long_term_counter`) is **not** ported. Each of `MACHINE_RUNTIME`, `ENGINE_RUNTIME`, `ENGINE_OILTIME` is one NVM word, incremented per hour, saturating at 65535 (no wrap). 65535 hr ≈ 7.5 years continuous run — ample; and the oil-change threshold logic only ever read the first word in the PIC. Matches the existing M4b single-word exposure of regs 11/20/21; no `nvm_map.h` change.
- **Reg 18 (`oil_change_state`) made read/write** so the display can set `OIL_WARNING_DISMISSED`, mirroring the PIC's display-driven dismissal.

**Prereqs:** M6a (control ctx, `oil_change_state`/reg 18, `control_io`), M5 (`app_timers` `NEXT_OIL_WARNING_TMR`, `sched` `SLOT_1MIN`), M2 (`nvm` counter words), M4b (regs 11/20/21 already read the counter words). No new modes; independent of M6b/c/d control logic.

## 2. The 1-minute routine (`control_service_runtime`, called by `control_1min_slot`)

Mirrors PIC `Do_1minute`. Uses ctx minute-accumulators (§5); increments per call (once per minute via `SLOT_1MIN`):

- **Machine hours (always):** `machine_run_min++`; when it reaches 60 → `machine_run_min = 0`, saturating-bump the `MACHINE_RUNTIME_START` word.
- **Engine + oil hours (only while `ctx->out.fuel_pump`):** `engine_run_min++` and `engine_oil_min++`; each reaching 60 → reset to 0 and saturating-bump `ENGINE_RUNTIME_START` / `ENGINE_OILTIME_START` respectively. On the **oil** rollover, call `control_oil_change_check` (§3).
- **Saturating-bump** = read the NVM word; `if (w < 65535u) { w++; write; }` (no wrap). Reg 11/20/21 keep reading these words unchanged — no binding work.

(PIC parity note: the PIC increments engine/oil while `FUEL_PUMP_STATE == ON`; `ctx->out.fuel_pump` is the port's equivalent, as used in M6d's monitor tails.)

## 3. Oil-change warning check (`control_oil_change_check`)

Runs when the oil counter rolls a new hour. Reads the oil-hours word (`nvm_read_word(ENGINE_OILTIME_START)`) and `app_timer_get(SCALE_MINUTE, NEXT_OIL_WARNING_TMR)` (auto-decremented by sched each minute). Constants (from PIC `main.h`): `HOURS_OIL_CHANGE_SOON = 500`, `HOURS_OIL_CHANGE_NOW = 580`, `HOURS_OIL_CHANGE_MISSED = 700`; re-warn reloads `1200` min (20 hr) for SOON/NEEDED, `300` min (5 hr) for PAST_DUE. Faithful to the PIC's `NEXT_OIL_WARNING_TMR`-gated, dismissal-aware `if/else if` cascade:

```
hours = nvm_read_word(ENGINE_OILTIME_START);
if (hours < 500) {
    oil_change_state = OIL_GOOD;
} else if (hours < 580 && app_timer_expired(SCALE_MINUTE, NEXT_OIL_WARNING_TMR)) {
    if (oil_change_state != OIL_WARNING_DISMISSED) oil_change_state = OIL_CHANGE_SOON;
    else app_timer_set(SCALE_MINUTE, NEXT_OIL_WARNING_TMR, 1200);
} else if (hours < 700 && app_timer_expired(SCALE_MINUTE, NEXT_OIL_WARNING_TMR)) {
    if (oil_change_state != OIL_WARNING_DISMISSED) oil_change_state = OIL_CHANGE_NEEDED;
    else app_timer_set(SCALE_MINUTE, NEXT_OIL_WARNING_TMR, 1200);
} else if (app_timer_expired(SCALE_MINUTE, NEXT_OIL_WARNING_TMR)) {   /* hours >= 700 */
    if (oil_change_state != OIL_WARNING_DISMISSED) oil_change_state = OIL_CHANGE_PAST_DUE;
    else app_timer_set(SCALE_MINUTE, NEXT_OIL_WARNING_TMR, 300);
}
```

`app_timer_expired(s,i)` is true when the timer value == 0 (M5 semantics). The oil-hours word resets only on factory-init (unchanged, matching the PIC — no runtime oil-reset). `OIL_GOOD=0, OIL_CHANGE_SOON=1, OIL_CHANGE_NEEDED=2, OIL_CHANGE_PAST_DUE=3, OIL_WARNING_DISMISSED=4` (existing `oil_state_t` in control.h).

## 4. Reg 18 (`oil_change_state`) → read/write

`control_io.c` currently binds `mb_reg_bind(18, rd_oilc, 0)` (read-only). Add a write accessor and rebind:

```c
static modbus_exc_t wr_oilc(uint16_t r, uint16_t v) { (void)r;
    if (v > OIL_WARNING_DISMISSED) return MB_EXC_ILLEGAL_VALUE;
    s_ctx->oil_change_state = (uint8_t)v; return MB_EXC_NONE; }
...
    mb_reg_bind(18, rd_oilc, wr_oilc);
```

Lets the display dismiss the warning (`v = OIL_WARNING_DISMISSED = 4`) or set any valid state; the §3 check honors `!= OIL_WARNING_DISMISSED`. Follows the existing `wr_mode`/`wr_td` validated-writer pattern.

## 5. ctx extensions & sourcing

New fields (internal minute accumulators, kept in ctx for testability, as M6c did with the compressor timers): `uint8_t machine_run_min;`, `uint8_t engine_run_min;`, `uint8_t engine_oil_min;`. `control_init` resets all three to 0. No new `apu_outputs_t`, no new enum/error codes. `oil_change_state` (reg 18) already exists; fuel state from `ctx->out.fuel_pump`. NVM word addresses `MACHINE_RUNTIME_START`(10)/`ENGINE_RUNTIME_START`(12)/`ENGINE_OILTIME_START`(14) already in `nvm_map.h`.

## 6. Wiring

`control_app_init` registers `control_1min_slot` on `SLOT_1MIN` (alongside the existing `SLOT_10MS`/`SLOT_1S` registrations). `control_1min_slot()` calls `control_service_runtime(&s_ctx)`. No mode registration, no dispatcher edit. The pre-existing integration tests that register the scheduler slots may need `control_runtime.c` added to their link set (link fallout, as in prior milestones) once `control_app.c` references `control_1min_slot`.

## 7. Testing

Host tests (CMake + Unity), TDD. The 60-minute rollover is impractical to advance in a 1 ms-step loop, so the routine is unit-tested by driving the ctx accumulators + NVM word directly:
- `control_oil_change_check`: drive `nvm_write_word(ENGINE_OILTIME_START, X)` + `NEXT_OIL_WARNING_TMR` + `oil_change_state`, assert the transition for each band (GOOD/<500, SOON/[500,580), NEEDED/[580,700), PAST_DUE/≥700), the timer-gated no-change case, and the dismissed→timer-reload branches.
- `control_service_runtime`: set `engine_oil_min = 59` + fuel on + NVM oil-word, call once → assert word bumped + oil-check ran; machine accumulator increments regardless of fuel; engine/oil only while fuel on; saturating cap at 65535 (word=65535 stays 65535).
- Reg-18 round-trip: `mb_reg_write(18, 4)` → `oil_change_state == OIL_WARNING_DISMISSED`; out-of-range (`> 4`) → `MB_EXC_ILLEGAL_VALUE`.
- Integration: register `SLOT_1MIN`, advance ~1 minute through the real scheduler, assert `machine_run_min` incremented (or a machine-hour NVM bump after 60 min if driving the accumulator).
Drive NVM via the M2 API and the fuel state via `ctx->out.fuel_pump` (not slot-overwritten here, since runtime has no sensor sample).

## 8. Task decomposition (~5 TDD tasks; refined by the plan)

1. ctx fields (`machine_run_min`/`engine_run_min`/`engine_oil_min`) + oil-change constants + `control_init` resets.
2. Reg 18 read/write (`wr_oilc` + rebind) in `control_io.c`.
3. `control_oil_change_check` (threshold bands + dismissal + re-warn reload).
4. `control_service_runtime` (machine/engine/oil minute accumulation + saturating NVM hour bump, calling the oil check).
5. `control_1min_slot` + register in `control_app_init` + integration.

## 9. Deferred / carry-forward

- **Multi-word counter chain (>65535 hr)** — deliberately not ported (single-word saturating chosen); revisit only if a unit must exceed ~7.5 yr continuous accounting.
- **Runtime oil-timer reset on service** — the PIC resets `ENGINE_OILTIME` only on factory-init; a "reset oil hours after service" command (a small NVM write) is deferred to bench/HMI if wanted.
- **Display-side re-warn cadence + the actual dismissal write** — validated on the real display at bench; M6e provides reg-18 writability + the state machine.
- **`OP_COLD_STORAGE`** remains descoped (OI-6). After M6e, all PIC application behavior is ported except cold storage; everything else is the USER-OWNED hardware bench bring-up (M1 Task 1 + the deferred HAL/drivers + sensor derivations).

## 10. Open items (overarching spec §10)

- After M6e the software port is functionally complete (minus cold storage). Remaining is bench: `.ioc`/clock/boot, `bsp_*`/`drv_*` HAL, SysTick, and the sensor-derivation carry-forwards (`engine_temp_ok`, A/C pressures, RPM, oil-pressure polarity).
