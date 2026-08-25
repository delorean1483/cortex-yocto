# Milestone: Dev kit → gobi → real APU unit, with control

**Target date:** 2026‑08‑31 (end of month, ~6 days from 2026‑08‑25)
**Goal:** A Variscite dev kit talks to the EF‑G0B1R (gobi) board over RS‑485, the gobi board is connected to an **actual HP2000 APU unit**, and the unit can be **controlled** (mode command) end‑to‑end.
**Control fidelity for the demo (chosen):** *minimal command path* — change mode (Off/Climate/Battery via holding reg 10) from the dev kit or AWS shadow and watch the real unit respond. No polished cloud UI required for the milestone.

---

## Reality check — where the risk actually is

The Modbus/telemetry software is essentially done (PR #3, compile‑verified) and a minimal control write is small. **The milestone is gated by hardware + firmware bench work, not the agent:**

| Gate | State (2026‑08‑25) | Owner | Risk |
|---|---|---|---|
| RS‑485 converter in hand | Not yet (ordered) | — | Low (any USB‑RS485 dongle works) |
| gobi board wired to a **real** APU unit | **Standalone bench board** — not wired | Hardware | **High** — nothing actuates until done |
| Firmware op‑states validated on **real** actuators | **Not yet** — host tests + SWD only | Firmware | **Highest** — never driven real relays/engine |
| gobi‑agent ↔ firmware Modbus link | Code done (PR #3), not deployed | Software | Low |
| Minimal control (write reg 10) | Not yet (removed in read‑only pass) | Software | Low |

**Bottom line:** the critical path is **wire the unit → validate actuators safely → prove control**, with the link drop‑in the moment the converter arrives. Six days is achievable *only if* the unit gets wired early and actuator validation starts immediately; the safe‑actuation work is the schedule driver.

---

## Critical path

```
                 (converter arrives)
Phase A: LINK ───────────────┐  (independent, ~0.5 day once converter here)
                             │
Phase C: WIRE UNIT ──► Phase B: VALIDATE ACTUATORS ──► Phase D: CONTROL DEMO
   (hardware)              (firmware bench, biggest)      (small SW + safety)
```

Phase A (link) can run in parallel with C/B. The demo needs A + B + C + D.

---

## Phases

### Phase A — Bring the RS‑485 link up (Tier 0). *~0.5 day once converter arrives.*
Software is done; this is deploy + verify.
1. Merge **PR #3** (gobi‑agent reconciliation) → CI builds image.
2. Get the new agent onto **TRUCK‑001**. Fast bench loop: rebuild just `gobi-agent`, `scp` the binary, `systemctl restart gobi-agent` (no full reflash). Proper: image flash/OTA.
3. Wire converter A/B/GND → `RS-485_P` / `RS-485_N` / `GND_485`; converter USB → dev kit USB‑A → `/dev/ttyUSB0`.
4. Verify: `tools/gobi_bench.py` (see below) → `EF-G0B1R` + live register decode; `journalctl -u gobi-agent`; `mosquitto_sub -t 'ecofleet/+/telemetry'`.
**Exit:** climate telemetry flowing board→agent→MQTT, confirmed by CLI.

### Phase C — Wire gobi board into a real APU unit. *Hardware — start ASAP.*
- Harness relay outputs → fuel pump, starter, glow plug, compressor clutch, heat‑reverse, evap/condenser fans.
- Discrete inputs: oil‑pressure switch, truck ignition. Sensors: enclosure/ext temp, battery, RPM tach.
- Power: 12 V truck battery / alt input.
**Exit:** board powered in‑unit, all I/O landed, continuity checked, nothing energized yet.

### Phase B — Validate firmware op‑state control on real hardware. *Firmware bench — biggest effort/risk.*
Safety‑first, staged. For each op‑state confirm the right outputs fire *before* connecting live loads:
1. **Dry run:** relays disconnected (or dummy loads / LEDs). Drive each mode, read the output relay‑state registers / SWD, confirm logic: OFF (all safe‑off), POWER_UP, ENGINE_START (fuel/starter/glow sequencing + timing), CLIMATE (compressor + fan + OI‑2 ramp), BATTERY (charging), ERROR_SHUTDOWN (de‑energize).
2. **Input validation:** oil‑pressure polarity (bench carry‑forward), ignition debounce, RPM tach reads real cranking/run speed, sensor scaling (enclosure/ext °F, battery V).
3. **Progressive live‑load:** connect one subsystem at a time (fans → compressor → engine last), verify each, keep e‑stop / disconnect ready.
**Exit:** each op‑state drives the real unit correctly and safely; error‑shutdown proven to de‑energize.

### Phase D — Minimal control (Tier 3‑lite). *Small SW + safety.*
1. **First proof (no cloud):** from the dev kit, write **reg 10** = 0/1/2 (Off/Climate/Battery) with `tools/gobi_bench.py --set-mode …`; observe op‑state change → actuation → telemetry reflects it. This *is* end‑to‑end control.
2. **Optional (AWS path):** re‑enable the agent command path — shadow `desired.mode` → `modbus_write_register(reg 10, mode)` (thread‑safe, in the poll loop as before), so control can originate from AWS. Small, additive change to PR #3's `main.c`.
3. Safety interlocks: bound the commandable modes; never auto‑issue ENGINE_START unattended on the bench.
**Exit:** commanding a mode from the dev kit (and optionally AWS) drives the real unit.

---

## Minimum viable demo + fallback
- **MVP demo:** dev kit commands Off→Climate on the real unit; compressor/fan engage; telemetry shows mode/status/temp change.
- **Fallback if the real unit isn't wired in time:** prove the *full command→actuation chain* on a **bench relay rig** (dummy contactors/LEDs on the gobi outputs), then swap to the real unit. De‑risks the deadline: the SW/firmware chain is demonstrable even if unit wiring slips.

---

## Suggested schedule (6 days)
- **Day 1–2:** Phase C wiring **in parallel** with Phase A prep (merge PR #3, stage the agent build). Start Phase B dry‑run on the standalone board (safe‑off, mode logic via SWD/regs).
- **Day 2–3:** Converter arrives → Phase A link up (fast). Continue Phase B dry‑run → input validation.
- **Day 3–5:** Phase B progressive live‑load on the wired unit (fans → compressor → engine).
- **Day 5–6:** Phase D control proof (dev‑kit reg‑10 write) → optional AWS shadow path → MVP demo dry‑run.
- **Buffer:** Day 6 for the demo + slack.

---

## Explicitly deferred (NOT in this milestone)
- **Local gobi‑ui display** (Tier 1): still reads genset fields (`dc_v`/`batt_soc`/`apu_state`) from the SQLite payload — will show blanks until updated. Not needed for the command‑path demo.
- **Cloud dashboards + ingest Lambda + fault Lambda + Device Shadow schema** (Tier 2): still genset‑coupled. The minimal control path uses shadow `desired.mode` only; full climate dashboards are post‑milestone.

---

## Open items to confirm
- Which physical APU unit is the target, and is a harness/loom available for Phase C?
- Is a bench relay rig available as the Phase‑B/D fallback?
- Safety plan for first engine‑start on a real unit (attended, e‑stop, fuel/HV isolation).
