# APU Test Plan — Gobi Auxiliary Power Unit

**Status:** draft for review · **Owner:** _TBD_ · **Last updated:** 2026-07-02

Working document for the "Transcription of logic for APU testing" meeting. It
transcribes the APU behaviour as **currently implemented in firmware**, then
defines the tests that must cover it. Edit inline during the meeting — assign
owners, tick the sign-off column, and resolve the open decisions at the bottom.

Source of truth:
- `meta-ecofleet/recipes-ecofleet/gobi-agent/files/config.h` — register map, comms
- `meta-ecofleet/recipes-ecofleet/gobi-agent/files/main.c` — poll loop, state, commands
- `meta-ecofleet/recipes-ecofleet/gobi-agent/files/shadow.{h,c}` — remote config/command
- `cloud/lambda/fault/faults.js` — fault bitmask → description

---

## 1. Logic under test (transcribed from firmware)

### 1.1 Comms layer  (`config.h:35-42`)
Modbus **RTU**, `/dev/ttyUSB0`, **19200 8N1**, slave id **1**, 1 s response
timeout. Poll interval default **5 s**, live-configurable **5–60 s** via shadow
(`shadow.h:27`). One request reads **14 holding registers** (addr 0–13) per cycle.

### 1.2 Register map  (`config.h:44-59`, decode in `main.c:365-378`)

| Reg | Field | Decode |
|----:|-------|--------|
| 0 | DC bus voltage | ÷10 → V |
| 1 | DC current | ÷10 → A |
| 2 | Battery voltage | ÷10 → V |
| 3 | Battery SOC | raw 0–100 % |
| 4 | Battery temp | ÷10 → °C |
| 5 | **APU state** | 0 off · 1 starting · 2 running · 3 stopping · 4 fault |
| 6 / 7 | Runtime hours | `(hi<<16) \| lo` → uint32 |
| 8 | **Fault word** | bitmask (§1.4) |
| 9 / 10 | Power watts | `(hi<<16) \| lo` → uint32 |
| 11 | Engine RPM | raw |
| 12 | Oil pressure | ÷10 |
| 13 | Coolant temp | ÷10 |

### 1.3 State machine  (`main.c:33-43`)
`off → starting → running → stopping`, plus `fault`. Any register-5 value
outside 0–4 decodes to `unknown`.

### 1.4 Fault model  (`faults.js:26-35`)
Register-8 bitmask; multiple bits may be set at once.

| Bit | Meaning | Bit | Meaning |
|-----|---------|-----|---------|
| `0x01` | Low oil pressure | `0x10` | Overcurrent |
| `0x02` | High coolant temp | `0x20` | Low fuel |
| `0x04` | Low battery voltage | `0x40` | Engine overspeed |
| `0x08` | Modbus comm failure | `0x80` | Starter failure |

Fault events publish to `ecofleet/<unit>/faults` **on every change, including the
clearing transition to `0x0000`**, so the cloud can resolve open faults.
_Fixed on this branch — previously non-zero-only (G1)._

### 1.5 Command path — start/stop  (`main.c:275-297`, `shadow.c:117-123`)
Cloud sets shadow desired `apu_command` = `"start"` | `"stop"` → device receives
delta → **the telemetry loop** writes **Modbus coil 0** (`APU_CMD_COIL`): start→1,
stop→0 (`modbus_write_bit`). The write is **retried each poll cycle until it
lands**, so a command issued while the serial link is down is not lost, and it
never races the poll read on the libmodbus context. Cleared only after a
successful write (`shadow_peek_apu_command` / `shadow_ack_apu_command`).
_Fixed on this branch (G2) — previously applied on the MQTT thread and dropped on
failure._

### 1.6 Data flow & offline buffering
Telemetry → `ecofleet/<unit>/telemetry` (QoS 1) every cycle; faults on change;
shadow `reported` (dc_v, batt_soc, apu_state, fault, last_seen_ts) every cycle.
When MQTT is down, rows buffer to SQLite (WAL, cap **8640 rows ≈ 12 h** at 5 s,
oldest dropped) and flush **50/cycle** on reconnect (`main.c:128-191`).

---

## 2. Test matrix

Sign-off: ☐ = not run · ✅ = pass · ❌ = fail.

| # | What to verify | Method | Automated? | Owner | Sign-off |
|--:|----------------|--------|-----------|-------|:-------:|
| 1 | Register decode & scaling (÷10, 32-bit hi/lo) | `sim/apu_test.py` | ✅ yes | | ☐ |
| 2 | State machine incl. out-of-range → `unknown` | `sim/apu_test.py` | ✅ yes | | ☐ |
| 3 | Start/stop round-trip: coil 0 → state change | `sim/apu_test.py` | ✅ yes | | ☐ |
| 4 | Fault raise: single + multi-bit words | `sim/apu_test.py` | ✅ yes | | ☐ |
| 5 | Fault clear → cloud resolves fault, no false alarm | firmware + `faults.js`; verify on-device | ✅ fixed † | | ☐ |
| 6 | Command retried (not lost) when Modbus down | HIL, pull pty | ✅ fixed † | | ☐ |
| 7 | Modbus disconnect → reconnect after 2 s | HIL, pull pty | ✏️ manual | | ☐ |
| 8 | Offline buffer + reconnect flush order + cap | kill MQTT | ✏️ manual | | ☐ |
| 9 | Poll interval clamp to 5–60 s | shadow out-of-range | ✏️ manual | | ☐ |
| 10 | Full pipeline (telemetry only) | `scripts/e2e-smoke-test.sh` | ✅ exists | | ☐ |
| 11 | Command round-trip via cloud (shadow→coil) | shadow-tools + HIL sim | ✏️ manual | | ☐ |
| 12 | Fault-word decode, all 8 bits | `sim/apu_test.py` + `faults.test.js` | ✅ yes | | ☐ |

Rows 1–4 and 12 run today (simulator + Lambda) — see §4.
**†** Code fixed on this branch (G1/G2); needs on-device + cloud verification before sign-off.

---

## 3. Known gaps / risks

### Fixed on the `apu-test-harness` branch (verify on-device before closing)

- **G1 — fault-cleared event now published.** Firmware publishes the transition
  back to `0x0000` (`main.c` fault block); `faults.js` records `active=false` in
  InfluxDB and sends a "Recovered" notice instead of a false "No fault" alarm.
- **G2 — start/stop command no longer lost, and thread race fixed.** The coil
  write moved out of the MQTT callback into the telemetry loop; it retries each
  cycle until it lands (survives a down serial link) and no longer touches the
  libmodbus context concurrently with the poll read. New API
  `shadow_peek_apu_command` / `shadow_ack_apu_command`.
- **G6 — fault decoder was mis-masking bits ≥ `0x10`** (found while fixing G1).
  `faults.js` masked with `parseInt(bit, 16)` on decimal object keys, so e.g.
  `0x0080` decoded to "Unknown fault" and `0x0004` gained spurious labels. Fixed
  to `Number(bit)`; locked in by `cloud/lambda/fault/faults.test.js` (8/8 pass).

### Open — decide disposition in the meeting

- **G3 — register/coil map is assumed.** `main.c` and `config.h:44` carry
  "adjust to match actual Gobi APU" notes; 32-bit word order (`hi<<16|lo`) is
  unverified against the real device. **Owner to confirm with vendor:** ___
- **G4 — poll-interval clamping.** `apply_desired` (`shadow.c:91-97`) does reject
  values outside 5–60 s — confirm that matches intent and add a test. **Decision:** ___
- **G5 — `apu_command` via the API.** Unclear whether `/fleet/config` accepts
  `apu_command`; `scripts/shadow-tools.sh` has no helper for it. **Decision:** ___

---

## 4. How to run the automated tests

Dependency-free (Python 3 stdlib). Full detail in `sim/README.md`.

```bash
# bench: simulator + test matrix rows 1–4
python3 sim/apu_sim.py --tcp --port 5020 &
python3 sim/apu_test.py --port 5020        # STATUS: ALL PASS, exit 0 on success

# cloud: fault decoder regression test (matrix row 12, guards G6)
node cloud/lambda/fault/faults.test.js     # 8/8 passed

# HIL: point the real gobi-agent at a simulated APU over RTU
socat -d -d pty,raw,echo=0 pty,raw,echo=0  # note the two pty paths
python3 sim/apu_sim.py --rtu /dev/pts/5 --spin-time 8
#   set gobi-agent MODBUS_DEVICE to /dev/pts/6

# existing full-pipeline smoke test (telemetry path)
scripts/e2e-smoke-test.sh TRUCK-001
```

---

## 5. Open decisions for the meeting

- [ ] **Bench simulator or real hardware** for the APU test rig? (Simulator is
      ready — `sim/`. Real APU needs the vendor map confirmed, gap #3.)
- [ ] Disposition of gaps #1–#5 above (fix now / backlog / accept).
- [ ] Which rows block release vs. which are nice-to-have.
- [ ] Owner + target date per matrix row.
- [ ] Do we add `sim/apu_test.py` (+ smoke test) to CI as a release gate?
