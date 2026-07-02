# Gobi APU Simulator & Test Harness

A dependency-free (Python 3 stdlib only) Modbus simulator of the **Gobi
Auxiliary Power Unit** that `gobi-agent` polls, plus an automated test harness.
Use it to exercise the APU logic without real hardware, and to point the real
firmware at a simulated APU for hardware-in-the-loop (HIL) testing.

Everything here mirrors the real register/coil map in
`meta-ecofleet/recipes-ecofleet/gobi-agent/files/config.h` and `main.c`, and the
fault bitmask in `cloud/lambda/fault/faults.js`.

## Quick start (bench, no hardware)

```bash
# terminal 1 — start the simulated APU (Modbus/TCP)
python3 sim/apu_sim.py --tcp --port 5020

# terminal 2 — run the test matrix against it
python3 sim/apu_test.py --port 5020
```

Expected: `STATUS: ALL PASS`. The harness exits non-zero if any check fails, so
it drops straight into CI.

## What the harness checks

| Row | Check |
|-----|-------|
| #1 | Register decode & scaling (÷10 fields, 32-bit `hi<<16\|lo` for runtime/watts) |
| #2 | State machine, including out-of-range register value → `unknown` |
| #3 | Start/stop command round-trip: write coil 0 → APU reaches `running`/`off`; running produces rpm & watts |
| #4 | Fault raise: single-bit and multi-bit fault words decode correctly |
| #5 | Fault clear: fault word 0 decodes back to `No fault` |

The decode logic in `apu_test.py` (scaling, word order, state names, fault bits)
is an **executable transcription of the firmware** — it is the reference oracle
tests assert against.

## Driving the simulator by hand

The simulator responds to standard Modbus:

- **Start APU:** write coil `0` = ON → `off → starting → running`
- **Stop APU:** write coil `0` = OFF → `running → stopping → off`
- **Inject a fault:** write holding register `8` (e.g. `0x0014` = low battery + overcurrent)
- **Clear a fault:** write holding register `8` = `0`
- **Force a raw state:** write holding register `5` (e.g. `9` to test `unknown`)

`--spin-time` controls how long `starting→running` and `stopping→off` take
(default `0.5s`; use `~8` for realistic engine timing). `--quiet` silences the
per-event log.

## HIL: point the REAL gobi-agent at the simulator

The firmware speaks Modbus **RTU** on a serial port, so bridge two virtual
serial endpoints with `socat` and run the sim in RTU mode:

```bash
# 1. create a linked pty pair — note the two /dev/pts/N (or /dev/ttysNNN on macOS)
socat -d -d pty,raw,echo=0 pty,raw,echo=0
#   ... 2025/.. PTY is /dev/pts/5      <- give this to the simulator
#   ... 2025/.. PTY is /dev/pts/6      <- give this to gobi-agent

# 2. run the simulator on one end
python3 sim/apu_sim.py --rtu /dev/pts/5 --spin-time 8

# 3. point gobi-agent at the other end
#    set MODBUS_DEVICE_DEFAULT in config.h, or in /etc/ecofleet/gobi-agent.conf,
#    to /dev/pts/6  (19200 8N1, slave id 1 — already the firmware defaults)
```

The simulator's RTU parser handles FC1/FC3/FC5/FC6 and validates CRC. Baud is
irrelevant across a pty (it's a byte pipe), so the firmware's 19200 8N1 config
just works.

## Not covered here (needs AWS / real integration)

- Full cloud round-trip (shadow `apu_command` → IoT delta → coil). Use
  `scripts/shadow-tools.sh` + this sim in RTU mode against the real agent.
- Offline SQLite buffering & reconnect flush (kill MQTT, not Modbus).
- The known **fault-cleared gap**: firmware logs "Fault cleared" but publishes
  no cleared-event — see `docs/apu-test-plan.md`.
