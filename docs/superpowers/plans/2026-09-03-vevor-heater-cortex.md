# VEVOR Diesel Heater — Cortex (gobi-agent + gobi-ui) Implementation Plan (Sub-project #2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the STM32's new heater command + telemetry Modbus registers on the Cortex — the `gobi-agent` reads heater telemetry into `latest.json`/MQTT and writes heater start/stop/level from `command.json` and the AWS device shadow; the `gobi-ui` shows a compact Heater card on the Home screen (On/Off + level 1–10 + live state + fault).

**Architecture:** Pure passthrough on the agent, following the existing setpoint/diag patterns: best-effort reads of the heater registers → JSON keys; `command.json` keys → `mb_write_reg`; plus an AWS-shadow reported heater block and a heater-scoped desired → register write. The UI adds heater fields to the existing `TelemetryModel` (latest.json poll) and a `HeaterCard` on Home using the same optimistic-then-reconcile + `writeCommand` channel the thermostat uses.

**Tech Stack:** C11 (`gobi-agent`: libmodbus + mosquitto + cjson, systemd; hand-rolled `tests/run.sh` = `cc -std=c11 -fsanitize=address,undefined` + `CHECK` macros), Qt6/QML + a C++ `TelemetryModel` context property (`gobi-ui`), file-based IPC (`/var/lib/ecofleet/{latest,command}.json`), AWS IoT device shadow (`shadow.c`).

**Spec:** `docs/superpowers/specs/2026-09-03-vevor-heater-control-design.md` (Components F2 + F3). **This plan is Sub-project #2** and depends on the register map frozen by Sub-project #1 (`2026-09-03-vevor-heater-firmware.md`).

**Target repo for ALL file paths below:** `ecofleet-firmware` (= `cortex-yocto`). `gobi-agent` = `meta-ecofleet/recipes-ecofleet/gobi-agent/`; `gobi-ui` = `meta-ecofleet/recipes-ecofleet/gobi-ui/`.

## Global Constraints

- **Register map (frozen by Sub-project #1; firmware reg N = Modbus wire address N−1):** command regs **53 `heater_request`** (0/1) + **54 `heater_level`** (1–10); telemetry regs **55** state (0 off,1 preheat,2 ignition,3 running,4 cooldown), **56** active_level, **57** error, **58** supply_mv, **59** fan_rpm, **60** pump_hz_x10, **61** exchanger_raw, **62** state_seconds, **63** age_ms, **64** flags (bit0 fresh, bit1 cooldown, bit2 safe_off, bit3 comms_fault, bit4 transport_fault), **65** valid_frames, **66** checksum_failures, **67** transport_errors.
- **Reads are best-effort** (`modbus_read_reg_besteffort`) so the agent degrades gracefully on APU firmware that predates the heater block; a `heater_present` flag is derived from a successful read.
- **All control is via holding registers** — the firmware exposes no coils. Writes use `mb_write_reg(53|54, value, "heater")` (it subtracts 1 for the wire address).
- **Safety:** a heater "off" from the UI or the cloud is a **stop request**, never a power-cut. The UI must show cooldown-in-progress (≈5 min) so "off" isn't presented as instantaneous. `safe_off`/`comms_fault` come straight from the firmware flags word (reg 64) — the Cortex does not re-derive safety.
- **Local + cloud scope:** heater control flows through both the on-device `command.json` path AND the AWS shadow (reported telemetry + desired start/stop), scoped to the heater and distinct from the deliberately-deferred whole-APU start/stop.
- **Agent code style:** C11, `-Wall -Wextra -Wpedantic -Wformat=2 -Wstrict-prototypes -fstack-protector-strong`; pure modules dependency-light (like `weather.c`) and host-tested via `tests/run.sh`.

---

## File Structure

**gobi-agent:**
- `files/heater_fields.c` / `files/heater_fields.h` — **new pure module** (host-tested): `heater_state_name()` (state → "off"/"preheat"/"ignition"/"running"/"cooldown"/"unknown") and small flag/scale decoders (flags → bools, `supply_mv`→volts, `pump_hz_x10`→Hz). No libmodbus/mosquitto.
- `tests/test_heater_fields.c` + `tests/run.sh` — host test for the pure helpers.
- `files/config.h` — add `REG_HEATER_*` wire-address constants (0-based).
- `files/main.c` — `telemetry_t` heater fields; best-effort reads; `build_telemetry_json` heater keys; `apply_command_file` heater command keys.
- `files/shadow.h` / `files/shadow.c` — reported heater block + desired heater fields + a heater-scoped peek/ack applied to `mb_write_reg`.
- `files/CMakeLists.txt` + `gobi-agent_1.0.bb` — add `heater_fields.c`/`.h` to the build + `SRC_URI`.

**gobi-ui:**
- `files/TelemetryModel.h` / `files/TelemetryModel.cpp` — heater `Q_PROPERTY`s + `poll()` parsing + `Q_INVOKABLE setHeaterOn/​setHeaterLevel`.
- `files/qml/components/HeaterCard.qml` — the Home heater control (new).
- `files/qml/screens/HomeScreen.qml` — mount the `HeaterCard`.
- The `qml.qrc`/CMake resource list — register `HeaterCard.qml`.

**Docs:** `docs/vevor-heater-cortex.md` — the JSON keys, command keys, shadow fields, and the Home card.

---

## Phase 0 — gobi-agent telemetry (host-TDD where pure)

### Task 1: pure heater field helpers + telemetry read → latest.json

**Files:** Create `files/heater_fields.h`, `files/heater_fields.c`, `tests/test_heater_fields.c`; Modify `tests/run.sh`, `files/config.h`, `files/main.c`, `files/CMakeLists.txt`, `gobi-agent_1.0.bb`.

**Interfaces:**
- Produces (pure): `const char *heater_state_name(unsigned state);` (0..4 → names, else "unknown"); `int heater_flag(unsigned flags, unsigned bit);` helpers or `#define HEATER_FLAG_*` mirroring the firmware bits; `double heater_supply_volts(unsigned mv);` (`mv/1000.0`); `double heater_pump_hz(unsigned x10);` (`x10/10.0`).
- Consumed by `build_telemetry_json` (this task) and reused by the UI copy conceptually.

- [ ] **Step 1: Write the failing test** — `tests/test_heater_fields.c`:
```c
#include "heater_fields.h"
#include <string.h>
#include <stdio.h>
static int fails;
#define CHECK(c) do{ if(!(c)){ printf("FAIL %s:%d %s\n",__FILE__,__LINE__,#c); fails++; } }while(0)
int main(void){
    CHECK(strcmp(heater_state_name(0),"off")==0);
    CHECK(strcmp(heater_state_name(3),"running")==0);
    CHECK(strcmp(heater_state_name(4),"cooldown")==0);
    CHECK(strcmp(heater_state_name(9),"unknown")==0);
    CHECK(heater_flag(0x04u, HEATER_FLAG_SAFE_OFF)==1);   /* bit2 */
    CHECK(heater_flag(0x04u, HEATER_FLAG_COMMS_FAULT)==0);/* bit3 */
    CHECK(heater_supply_volts(13800u) > 13.79 && heater_supply_volts(13800u) < 13.81);
    CHECK(heater_pump_hz(51u) > 5.09 && heater_pump_hz(51u) < 5.11);
    printf(fails?"test_heater_fields FAILED (%d)\n":"test_heater_fields ok\n", fails);
    return fails?1:0;
}
```
Add a compile+run block to `tests/run.sh` (mirror the `test_bl_crc32` no-cJSON block): `cc -std=c11 -Wall -Wextra -Wpedantic -g -fsanitize=address,undefined -I"$files" "$here/test_heater_fields.c" "$files/heater_fields.c" -o "$here/test_heater_fields" && "$here/test_heater_fields"`.

- [ ] **Step 2: Run to verify it fails** — `bash tests/run.sh` → FAIL (heater_fields.* missing).

- [ ] **Step 3: Implement** `files/heater_fields.h` (`HEATER_FLAG_FRESH/COOLDOWN/SAFE_OFF/COMMS_FAULT/XPORT_FAULT` = bits 0..4, matching the firmware) + `files/heater_fields.c`.

- [ ] **Step 4: Run to verify it passes** — `bash tests/run.sh` → `test_heater_fields ok`, all prior tests still green.

- [ ] **Step 5: Wire the reads + JSON.** In `files/config.h`, add (0-based wire = firmware reg − 1):
```c
#define REG_HEATER_REQUEST     52   /* fw 53 heater_request 0/1              RW */
#define REG_HEATER_LEVEL       53   /* fw 54 heater_level 1..10              RW */
#define REG_HEATER_STATE       54   /* fw 55                                 R  */
#define REG_HEATER_ACTIVE_LVL  55   /* fw 56 */
#define REG_HEATER_ERROR       56   /* fw 57 */
#define REG_HEATER_SUPPLY_MV   57   /* fw 58 */
#define REG_HEATER_FAN_RPM     58   /* fw 59 */
#define REG_HEATER_PUMP_HZ_X10 59   /* fw 60 */
#define REG_HEATER_EXCH_RAW    60   /* fw 61 */
#define REG_HEATER_STATE_SECS  61   /* fw 62 */
#define REG_HEATER_AGE_MS      62   /* fw 63 */
#define REG_HEATER_FLAGS       63   /* fw 64 */
#define REG_HEATER_VALID_FR    64   /* fw 65 */
#define REG_HEATER_CSUM_FAIL   65   /* fw 66 */
#define REG_HEATER_XPORT_ERR   66   /* fw 67 */
```
Add heater fields to `telemetry_t` (main.c:78-101 block; a `heater_present` flag + the raw register values). In `modbus_read_besteffort()` (main.c:454-460), read each `REG_HEATER_*` best-effort, setting `heater_present` when the state/flags read succeeds. In `build_telemetry_json()` (before `cJSON_PrintUnformatted`, ~main.c:498), add: `heater_present` (bool), `heater_state` (`heater_state_name(...)`), `heater_target_level`, `heater_active_level`, `heater_error`, `heater_supply_v` (`heater_supply_volts`), `heater_fan_rpm`, `heater_pump_hz` (`heater_pump_hz`), `heater_exchanger`, `heater_state_seconds`, `heater_age_ms`, `heater_flags`, `heater_safe_off` (bool from bit2), `heater_comms_ok` (bool: fresh && !comms_fault), and the three diagnostic counters. Add `heater_fields.c` to `files/CMakeLists.txt` `target_sources(gobi-agent …)` and `file://heater_fields.c`/`.h` to `gobi-agent_1.0.bb` `SRC_URI`.

- [ ] **Step 6: Verify + commit** — `bash tests/run.sh` still green. `git add files/heater_fields.* tests/test_heater_fields.c tests/run.sh files/config.h files/main.c files/CMakeLists.txt gobi-agent_1.0.bb && git commit -m "feat(agent): heater telemetry read + latest.json/MQTT keys (+ pure field helpers, host-tested)"`

---

### Task 2: heater command path (command.json → Modbus)

**Files:** Modify `files/main.c`.

- [ ] **Step 1: Add heater command keys to `apply_command_file()`** (main.c:555-636, alongside the `setpoint`/`diag_out` blocks):
```c
/* heater_on -> reg 53 (heater_request, 0|1) */
const cJSON *hon = cJSON_GetObjectItemCaseSensitive(root, "heater_on");
if (cJSON_IsNumber(hon)) {
    int v = (int)hon->valuedouble;
    if (v == 0 || v == 1) mb_write_reg(53, v, "heater_on");
}
/* heater_level -> reg 54 (1..10) */
const cJSON *hlv = cJSON_GetObjectItemCaseSensitive(root, "heater_level");
if (cJSON_IsNumber(hlv)) {
    int v = (int)hlv->valuedouble;
    if (v >= 1 && v <= 10) mb_write_reg(54, v, "heater_level");
}
```

- [ ] **Step 2: Verify + commit** — `bash tests/run.sh` still green (unaffected). `git add files/main.c && git commit -m "feat(agent): heater start/stop/level command via command.json -> Modbus"`

---

## Phase 1 — AWS shadow (heater reported + desired)

### Task 3: shadow reported heater block + heater-scoped desired → register write

**Files:** Modify `files/shadow.h`, `files/shadow.c`, `files/main.c`.

**Interfaces:**
- Extend `shadow_reported_t` (shadow.h:38-45) with a heater block (`heater_state` string, `heater_level`, `heater_error`, `heater_fan_rpm`, `heater_safe_off`, `heater_comms_ok`); `shadow_publish_reported()` (shadow.c:278-352) emits it under `state.reported.heater`.
- Extend `shadow_config_t` with `heater_desired_valid`, `heater_on`, `heater_level`; `apply_desired()` (shadow.c:85-144) parses a `desired.heater` object; add `shadow_peek_heater_cmd(int *on, int *level)` / `shadow_ack_heater_cmd()` mirroring the existing `shadow_peek_apu_command`/`ack` idiom (shadow.h:100-106, shadow.c:362-384).

- [ ] **Step 1: Reported.** Add the heater fields to `shadow_reported_t`; in `main.c` where `shadow_publish_reported()` is populated each cycle (main.c:781-788), copy from the heater telemetry; emit the `heater` sub-object in `shadow_publish_reported()`.

- [ ] **Step 2: Desired → apply.** In `apply_desired()`, parse `desired.heater.{on,level}` into `shadow_config_t` (validate `on∈{0,1}`, `level∈1..10`) and set `heater_desired_valid`. Add `shadow_peek_heater_cmd`/`shadow_ack_heater_cmd`. In the telemetry loop (same thread as `g_modbus`), after a successful Modbus cycle, `if (shadow_peek_heater_cmd(&on,&lvl)) { mb_write_reg(54,lvl,"heater_level(shadow)"); mb_write_reg(53,on,"heater_on(shadow)"); shadow_ack_heater_cmd(); }`. This is the **heater-scoped** remote-control enablement — the deferred whole-APU `apu_command` stays ignored (main.c:330-353); do not wire that. A shadow "off" is a stop request, same safety rules as local.

- [ ] **Step 3: Verify + commit** — `bash tests/run.sh` still green. `git add files/shadow.h files/shadow.c files/main.c && git commit -m "feat(agent): heater reported telemetry + heater-scoped desired start/stop via AWS shadow"`

---

## Phase 2 — gobi-ui (Home Heater card)

### Task 4: TelemetryModel heater fields + command invokables

**Files:** Modify `files/TelemetryModel.h`, `files/TelemetryModel.cpp`.

- [ ] **Step 1: Add heater `Q_PROPERTY`s** to `TelemetryModel.h` (all sharing the existing `dataChanged` NOTIFY, TelemetryModel.h:14-37): `heaterPresent` (bool), `heaterState` (QString), `heaterTargetLevel` (int), `heaterActiveLevel` (int), `heaterError` (int), `heaterFanRpm` (int), `heaterSupplyV` (double), `heaterExchanger` (int), `heaterStateSeconds` (int), `heaterAgeMs` (int), `heaterSafeOff` (bool), `heaterCommsOk` (bool), `heaterFlags` (int).

- [ ] **Step 2: Parse them in `poll()`** (TelemetryModel.cpp:44-86, after the existing field assignments): `m_heaterState = o[u"heater_state"].toString("off");` `m_heaterTargetLevel = o[u"heater_target_level"].toInt();` … one line per field, matching the existing `toDouble()/toInt()/toString()` style; keep the single `emit dataChanged()` (TelemetryModel.cpp:85).

- [ ] **Step 3: Add command invokables** — `Q_INVOKABLE void setHeaterOn(bool on){ writeCommand(QStringLiteral("heater_on"), on?1:0); }` and `void setHeaterLevel(int lvl){ writeCommand(QStringLiteral("heater_level"), lvl); }` (TelemetryModel.cpp, next to `setSetpoint`/`setTestRelay` at ~cpp:89/97 — the same `writeCommand` merge-write to `command.json`).

- [ ] **Step 4: Verify + commit** — builds (the gobi-ui build / offscreen). `git add files/TelemetryModel.h files/TelemetryModel.cpp && git commit -m "feat(ui): TelemetryModel heater fields + setHeaterOn/setHeaterLevel"`

---

### Task 5: HeaterCard on Home

**Files:** Create `files/qml/components/HeaterCard.qml`; Modify `files/qml/screens/HomeScreen.qml`, the `qml.qrc`/CMake resource list.

**Interfaces:** reads `telemetry.heater*` properties; calls `telemetry.setHeaterOn(...)` / `telemetry.setHeaterLevel(...)`.

- [ ] **Step 1: Build `HeaterCard.qml`** — a compact control: an **On/Off** toggle (optimistic `heaterOn` override cleared when `telemetry.heaterState` reconciles, mirroring `HomeScreen.setAuto`/`onDataChanged` at HomeScreen.qml:16,27); a **level 1–10 stepper** (▲/▼ with a ~350 ms debounce `Timer` calling `telemetry.setHeaterLevel`, mirroring the setpoint `bump`/`spSend` at HomeScreen.qml:13-14); a **live state line** from `telemetry.heaterState` (off/preheat/ignition/running/cooldown) that shows **"cooling down…"** while state==cooldown (so "off" reads as in-progress, not instant); a small **fan RPM + exchanger** readout; and an **error/fault badge** shown when `telemetry.heaterError != 0` or `!telemetry.heaterCommsOk`. Hide the whole card when `!telemetry.heaterPresent` (graceful on firmware without the heater block). Use the existing theme/StatusLabels style.

- [ ] **Step 2: Mount it on Home** — add `HeaterCard {}` as a fourth control block in `HomeScreen.qml`'s layout (below the fan presets), keeping the 800×480 layout tidy (the fan-preset row already caps its height per db5d5df — apply the same discipline). Register `HeaterCard.qml` in the `qml.qrc`/CMake resource list so it's packaged.

- [ ] **Step 3: Verify** — offscreen QML preview-verify the card across states (off / preheat / running / cooldown / error / comms-fault / not-present) using the project's offscreen preview workflow.

- [ ] **Step 4: Commit** — `git add files/qml/components/HeaterCard.qml files/qml/screens/HomeScreen.qml <qrc/CMake> && git commit -m "feat(ui): compact Heater card on Home (On/Off + level + state + fault)"`

---

## Phase 3 — Docs

### Task 6: cortex heater doc

**Files:** Create `docs/vevor-heater-cortex.md`.

- [ ] **Step 1: Write `docs/vevor-heater-cortex.md`** — the `latest.json` heater keys + types, the `command.json` keys (`heater_on`, `heater_level`), the shadow `reported.heater` + `desired.heater` fields, and the Home card behavior (incl. the cooldown-in-progress presentation and the heater-scoped remote-control note vs. the deferred whole-APU control). Point to the firmware plan for the register map.

- [ ] **Step 2: Commit** — `git add docs/vevor-heater-cortex.md && git commit -m "docs(heater): cortex agent/UI keys, shadow fields, and Home card"`

---

## Self-Review

**Spec coverage (Components F2 + F3):**
- F2.a telemetry read → JSON → Task 1 (best-effort reads + `heater_*` keys + pure helpers host-tested). ✓
- F2.b local command → Task 2 (`command.json` `heater_on`/`heater_level` → `mb_write_reg`). ✓
- F2.c cloud shadow reported + desired → Task 3. ✓
- F3 UI TelemetryModel fields → Task 4; Home HeaterCard → Task 5. ✓

**Verification split:** the one genuinely pure/riskable transform (state-name + flag/scale decode) is host-tested via `tests/run.sh`; the rest is passthrough (agent register plumbing, shadow JSON) and UI, verified by the suite staying green + the offscreen QML preview + code review, consistent with the agent's testing culture (`weather.c` pure + best-effort register precedent) and the spec's "no hardware yet" decision.

**Placeholder scan:** no "handle appropriately" placeholders — command keys carry explicit range checks, the reads are the named best-effort calls, the UI card enumerates its states. The `qml.qrc`/CMake resource entry is named as a concrete edit (its exact path is whatever the existing resource list uses — the implementer mirrors an existing `.qml` entry).

**Type consistency:** the register numbers/wire addresses match Sub-project #1's frozen block (53–67; wire = reg−1) and the spec table. The `HEATER_FLAG_*` bit positions in `heater_fields.h` (Task 1) match the firmware flags word and are reused by the UI's `heaterSafeOff`/`heaterCommsOk` derivation. JSON keys emitted in Task 1 are the exact keys parsed in Task 4 (`heater_state`, `heater_target_level`, `heater_safe_off`, `heater_comms_ok`, …).
