#!/usr/bin/env python3
"""
apu_test.py — automated APU test harness for the Gobi APU simulator.

Acts as a Modbus/TCP master (the role gobi-agent plays) and runs the APU test
matrix against a running apu_sim.py. It is also an executable transcription of
the firmware's decode + command logic: the scaling, 32-bit word composition,
state names, and fault bitmask here mirror gobi-agent (main.c) and the fault
Lambda (cloud/lambda/fault/faults.js).

Usage:
    python3 sim/apu_sim.py --tcp --port 5020 --spin-time 0.5 --quiet &
    python3 sim/apu_test.py --port 5020

Exit code is 0 only if every check passes.

Covers test-matrix rows:
    #1 register decode & scaling (x10, 32-bit hi/lo word order)
    #2 state machine incl. out-of-range -> "unknown"
    #3 start/stop command round-trip (coil 0 -> apu_state)
    #4 fault raise (single + multi-bit words)
    #5 fault clear -> decodes back to "No fault"
"""

import argparse
import socket
import struct
import sys
import time

# ── Register map (mirrors config.h) ──────────────────────────────────────────
(REG_DC_V, REG_DC_A, REG_BATT_V, REG_BATT_SOC, REG_BATT_T, REG_APU_STATE,
 REG_RUNTIME_HI, REG_RUNTIME_LO, REG_FAULT, REG_WATTS_HI, REG_WATTS_LO,
 REG_RPM, REG_OIL_PSI, REG_COOLANT_T) = range(14)
REG_COUNT = 14
APU_CMD_COIL = 0

# ── Firmware-mirrored decode tables ───────────────────────────────────────────
STATE_NAMES = {0: "off", 1: "starting", 2: "running", 3: "stopping", 4: "fault"}

# From cloud/lambda/fault/faults.js FAULT_BITS
FAULT_BITS = {
    0x0001: "Low oil pressure",
    0x0002: "High coolant temperature",
    0x0004: "Low battery voltage",
    0x0008: "Modbus communication failure",
    0x0010: "Overcurrent",
    0x0020: "Low fuel",
    0x0040: "Engine overspeed",
    0x0080: "Starter failure",
}


def state_name(v):
    return STATE_NAMES.get(v, "unknown")


def describe_fault(word):
    if not word:
        return "No fault"
    active = [d for bit, d in FAULT_BITS.items() if word & bit]
    return ", ".join(active) if active else f"Unknown fault (0x{word:04X})"


def decode_telemetry(regs):
    """Mirror of modbus_read_telemetry() / build_telemetry_json() in main.c."""
    return {
        "dc_v": regs[REG_DC_V] / 10.0,
        "dc_a": regs[REG_DC_A] / 10.0,
        "batt_v": regs[REG_BATT_V] / 10.0,
        "batt_soc": regs[REG_BATT_SOC],
        "batt_t": regs[REG_BATT_T] / 10.0,
        "apu_state": state_name(regs[REG_APU_STATE]),
        "runtime_hrs": (regs[REG_RUNTIME_HI] << 16) | regs[REG_RUNTIME_LO],
        "fault_word": regs[REG_FAULT],
        "watts": (regs[REG_WATTS_HI] << 16) | regs[REG_WATTS_LO],
        "rpm": regs[REG_RPM],
        "oil_psi": regs[REG_OIL_PSI] / 10.0,
        "coolant_t": regs[REG_COOLANT_T] / 10.0,
    }


# ── Minimal Modbus/TCP master ─────────────────────────────────────────────────
class ModbusClient:
    def __init__(self, host, port, unit=1, timeout=3.0):
        self.sock = socket.create_connection((host, port), timeout=timeout)
        self.sock.settimeout(timeout)
        self.unit = unit
        self._tid = 0

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass

    def _txn(self, pdu):
        self._tid = (self._tid + 1) & 0xFFFF
        header = struct.pack(">HHHB", self._tid, 0, len(pdu) + 1, self.unit)
        self.sock.sendall(header + pdu)
        rhdr = self._recv_exact(6)
        length = struct.unpack(">H", rhdr[4:6])[0]
        rest = self._recv_exact(length)
        resp_pdu = rest[1:]
        if resp_pdu and resp_pdu[0] & 0x80:
            raise IOError(f"Modbus exception fc=0x{resp_pdu[0] & 0x7F:02X} "
                          f"code={resp_pdu[1]}")
        return resp_pdu

    def _recv_exact(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise IOError("connection closed by simulator")
            buf += chunk
        return buf

    def read_holding(self, start, qty):
        pdu = struct.pack(">BHH", 0x03, start, qty)
        resp = self._txn(pdu)
        count = resp[1]
        vals = struct.unpack(">" + "H" * (count // 2), resp[2:2 + count])
        return list(vals)

    def read_coil(self, addr):
        pdu = struct.pack(">BHH", 0x01, addr, 1)
        resp = self._txn(pdu)
        return resp[2] & 1

    def write_coil(self, addr, on):
        pdu = struct.pack(">BHH", 0x05, addr, 0xFF00 if on else 0x0000)
        self._txn(pdu)

    def write_register(self, addr, value):
        pdu = struct.pack(">BHH", 0x06, addr, value & 0xFFFF)
        self._txn(pdu)


# ── Test framework ────────────────────────────────────────────────────────────
class Runner:
    def __init__(self):
        self.passed = 0
        self.failed = 0

    def check(self, cond, label, detail=""):
        mark = "PASS" if cond else "FAIL"
        if cond:
            self.passed += 1
        else:
            self.failed += 1
        line = f"  [{mark}] {label}"
        if detail:
            line += f"  ({detail})"
        print(line, flush=True)
        return cond

    def section(self, title):
        print(f"\n── {title}", flush=True)


def wait_for_state(cli, want, timeout=6.0, interval=0.1):
    """Poll apu_state until it equals `want` or timeout."""
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        regs = cli.read_holding(0, REG_COUNT)
        last = state_name(regs[REG_APU_STATE])
        if last == want:
            return True, last
        time.sleep(interval)
    return False, last


def main(argv=None):
    p = argparse.ArgumentParser(description="APU simulator test harness")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=5020)
    p.add_argument("--unit", type=int, default=1)
    args = p.parse_args(argv)

    print("═══════════════════════════════════════════════════════════════")
    print(f" EcoFleet APU Simulator Test — {args.host}:{args.port}")
    print("═══════════════════════════════════════════════════════════════")

    try:
        cli = ModbusClient(args.host, args.port, unit=args.unit)
    except OSError as e:
        print(f"\nCannot reach simulator at {args.host}:{args.port} — {e}")
        print("Start it first:  python3 sim/apu_sim.py --tcp "
              f"--port {args.port} --quiet &")
        return 2

    r = Runner()

    # ── #1 register decode & scaling ─────────────────────────────────────────
    r.section("#1 Register decode & scaling")
    regs = cli.read_holding(0, REG_COUNT)
    r.check(len(regs) == REG_COUNT, "read 14 holding registers in one request",
            f"got {len(regs)}")
    t = decode_telemetry(regs)
    r.check(abs(t["batt_v"] - 26.4) < 1e-6, "batt_v scaled /10", f'{t["batt_v"]} V')
    r.check(t["batt_soc"] == 82, "batt_soc raw percent", f'{t["batt_soc"]} %')
    r.check(abs(t["batt_t"] - 24.5) < 1e-6, "batt_t scaled /10", f'{t["batt_t"]} C')
    r.check(t["runtime_hrs"] == 1234, "runtime 32-bit (hi<<16)|lo",
            f'{t["runtime_hrs"]} h')

    # ── #2 initial state ─────────────────────────────────────────────────────
    r.section("#2 State machine")
    r.check(t["apu_state"] == "off", "initial apu_state decodes to 'off'",
            t["apu_state"])

    # ── #3 start/stop command round-trip ─────────────────────────────────────
    r.section("#3 Start/stop command round-trip (coil 0)")
    cli.write_coil(APU_CMD_COIL, True)
    r.check(cli.read_coil(APU_CMD_COIL) == 1, "coil 0 reads back = 1 after start")
    ok, st = wait_for_state(cli, "running")
    r.check(ok, "APU reaches 'running' after start command", f"last={st}")

    cli.write_coil(APU_CMD_COIL, False)
    r.check(cli.read_coil(APU_CMD_COIL) == 0, "coil 0 reads back = 0 after stop")
    ok, st = wait_for_state(cli, "off")
    r.check(ok, "APU returns to 'off' after stop command", f"last={st}")
    # running-state side effects
    cli.write_coil(APU_CMD_COIL, True)
    wait_for_state(cli, "running")
    run = decode_telemetry(cli.read_holding(0, REG_COUNT))
    r.check(run["rpm"] > 0 and run["watts"] > 0,
            "running state produces rpm & watts",
            f'rpm={run["rpm"]} watts={run["watts"]}')
    cli.write_coil(APU_CMD_COIL, False)
    wait_for_state(cli, "off")

    # ── #4 fault raise (single + multi-bit) ──────────────────────────────────
    r.section("#4 Fault raise")
    cli.write_register(REG_FAULT, 0x0004)  # low battery voltage
    fw = cli.read_holding(0, REG_COUNT)[REG_FAULT]
    r.check(describe_fault(fw) == "Low battery voltage",
            "single-bit fault decodes", describe_fault(fw))
    cli.write_register(REG_FAULT, 0x0014)  # low battery + overcurrent
    fw = cli.read_holding(0, REG_COUNT)[REG_FAULT]
    r.check(describe_fault(fw) == "Low battery voltage, Overcurrent",
            "multi-bit fault decodes both", describe_fault(fw))

    # ── #5 fault clear ───────────────────────────────────────────────────────
    r.section("#5 Fault clear")
    cli.write_register(REG_FAULT, 0x0000)
    fw = cli.read_holding(0, REG_COUNT)[REG_FAULT]
    r.check(describe_fault(fw) == "No fault",
            "cleared fault decodes to 'No fault'", describe_fault(fw))

    # ── #2b out-of-range state ───────────────────────────────────────────────
    r.section("#2b Out-of-range state -> 'unknown'")
    cli.write_register(REG_APU_STATE, 9)
    st = state_name(cli.read_holding(0, REG_COUNT)[REG_APU_STATE])
    r.check(st == "unknown", "state value 9 decodes to 'unknown'", st)

    # ── summary ──────────────────────────────────────────────────────────────
    cli.close()
    total = r.passed + r.failed
    print("\n═══════════════════════════════════════════════════════════════")
    print(f" Results: {r.passed}/{total} passed")
    if r.failed == 0:
        print(" STATUS: ALL PASS — APU logic behaves as transcribed")
    else:
        print(f" STATUS: FAIL ({r.failed} check(s) failed — see above)")
    print("═══════════════════════════════════════════════════════════════")
    return 0 if r.failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
