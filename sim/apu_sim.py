#!/usr/bin/env python3
"""
apu_sim.py — Gobi APU Modbus simulator for EcoFleet bench/HIL testing.

Emulates the Gobi Auxiliary Power Unit that gobi-agent polls over Modbus.
Exposes holding registers 0–13 and coil 0 exactly as the firmware expects
(see meta-ecofleet/recipes-ecofleet/gobi-agent/files/config.h and main.c).

Two transports, no third-party dependencies (Python 3 stdlib only):

  TCP (default) — easy bench testing with sim/apu_test.py:
      python3 sim/apu_sim.py --tcp --port 5020

  RTU over a serial device / pty — point the REAL gobi-agent at it (HIL):
      socat -d -d pty,raw,echo=0 pty,raw,echo=0        # note the two /dev/pts/N
      python3 sim/apu_sim.py --rtu /dev/pts/5          # sim on one end
      # set MODBUS_DEVICE_DEFAULT (config.h) or gobi-agent.conf to /dev/pts/6

Behaviour:
  - Coil 0 write 1 -> start sequence:  off -> starting -> (spin-time) -> running
  - Coil 0 write 0 -> stop sequence:   running -> stopping -> (spin-time) -> off
  - State-dependent registers (rpm, watts, oil, coolant, dc_*) update with state.
  - Fault word (reg 8) is externally settable (FC6) for fault-injection tests;
    it is NOT auto-managed, matching the firmware which reads state and fault
    independently.

Register map (0-based holding registers):
  0 dc_v x10   1 dc_a x10   2 batt_v x10   3 batt_soc %   4 batt_t x10
  5 apu_state (0 off,1 starting,2 running,3 stopping,4 fault)
  6/7 runtime hrs (hi/lo)   8 fault word (bitmask)   9/10 watts (hi/lo)
  11 rpm   12 oil_psi x10   13 coolant_t x10
"""

import argparse
import os
import socket
import sys
import threading
import time

# ── Register map (mirrors config.h) ──────────────────────────────────────────
REG_DC_V = 0
REG_DC_A = 1
REG_BATT_V = 2
REG_BATT_SOC = 3
REG_BATT_T = 4
REG_APU_STATE = 5
REG_RUNTIME_HI = 6
REG_RUNTIME_LO = 7
REG_FAULT = 8
REG_WATTS_HI = 9
REG_WATTS_LO = 10
REG_RPM = 11
REG_OIL_PSI = 12
REG_COOLANT_T = 13
REG_COUNT = 14

APU_CMD_COIL = 0
SLAVE_ID = 1

STATE_NAMES = {0: "off", 1: "starting", 2: "running", 3: "stopping", 4: "fault"}
OFF, STARTING, RUNNING, STOPPING, FAULT = 0, 1, 2, 3, 4


class IllegalAddress(Exception):
    pass


class IllegalFunction(Exception):
    pass


# ── Modbus CRC-16 (RTU) ───────────────────────────────────────────────────────
def crc16(data: bytes) -> bytes:
    crc = 0xFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            if crc & 1:
                crc = (crc >> 1) ^ 0xA001
            else:
                crc >>= 1
    return crc.to_bytes(2, "little")  # low byte first on the wire


# ── APU model ─────────────────────────────────────────────────────────────────
class APUModel:
    def __init__(self, spin_time: float = 0.5, verbose: bool = True):
        self.lock = threading.Lock()
        self.spin_time = spin_time
        self.verbose = verbose
        self.regs = [0] * REG_COUNT
        self.coils = {APU_CMD_COIL: 0}
        self._gen = 0

        # Constants that do not depend on APU state.
        self.regs[REG_BATT_V] = 264      # 26.4 V
        self.regs[REG_BATT_SOC] = 82      # 82 %
        self.regs[REG_BATT_T] = 245      # 24.5 C
        self.regs[REG_RUNTIME_HI] = 0
        self.regs[REG_RUNTIME_LO] = 1234  # 1234 h
        self.regs[REG_FAULT] = 0

        self._apply_state(OFF)

    # --- state machine ---------------------------------------------------------
    def _apply_state(self, state: int):
        """Set reg 5 and the registers whose values track the APU state."""
        self.regs[REG_APU_STATE] = state
        if state == OFF:
            self._set_dynamic(dc_v=262, dc_a=5, rpm=0, watts=0, oil=0, coolant=250)
        elif state == STARTING:
            self._set_dynamic(dc_v=270, dc_a=20, rpm=1200, watts=0, oil=250, coolant=400)
        elif state == RUNNING:
            self._set_dynamic(dc_v=278, dc_a=150, rpm=3600, watts=2400, oil=420, coolant=880)
        elif state == STOPPING:
            self._set_dynamic(dc_v=272, dc_a=10, rpm=800, watts=0, oil=200, coolant=700)
        elif state == FAULT:
            self._set_dynamic(dc_v=250, dc_a=0, rpm=0, watts=0, oil=0, coolant=900)
        if self.verbose:
            print(f"  [sim] APU state -> {STATE_NAMES.get(state, '?')}", flush=True)

    def _set_dynamic(self, dc_v, dc_a, rpm, watts, oil, coolant):
        self.regs[REG_DC_V] = dc_v
        self.regs[REG_DC_A] = dc_a
        self.regs[REG_RPM] = rpm
        self.regs[REG_WATTS_HI] = (watts >> 16) & 0xFFFF
        self.regs[REG_WATTS_LO] = watts & 0xFFFF
        self.regs[REG_OIL_PSI] = oil
        self.regs[REG_COOLANT_T] = coolant

    def _drive(self, want_on: bool, gen: int):
        """Background transition after a coil write."""
        if want_on:
            with self.lock:
                if gen == self._gen:
                    self._apply_state(STARTING)
            time.sleep(self.spin_time)
            with self.lock:
                if gen == self._gen and self.coils[APU_CMD_COIL]:
                    self._apply_state(RUNNING)
        else:
            with self.lock:
                if gen == self._gen:
                    self._apply_state(STOPPING)
            time.sleep(self.spin_time)
            with self.lock:
                if gen == self._gen and not self.coils[APU_CMD_COIL]:
                    self._apply_state(OFF)

    # --- register access -------------------------------------------------------
    def read_holding(self, start: int, qty: int):
        if start < 0 or qty < 1 or start + qty > REG_COUNT:
            raise IllegalAddress
        with self.lock:
            return list(self.regs[start:start + qty])

    def read_coils(self, start: int, qty: int):
        with self.lock:
            out = []
            for a in range(start, start + qty):
                out.append(self.coils.get(a, 0))
            return out

    def write_register(self, addr: int, value: int):
        if addr < 0 or addr >= REG_COUNT:
            raise IllegalAddress
        with self.lock:
            self.regs[addr] = value & 0xFFFF
        if self.verbose:
            print(f"  [sim] reg[{addr}] <- {value & 0xFFFF} "
                  f"(0x{value & 0xFFFF:04X})", flush=True)

    def write_coil(self, addr: int, on: bool):
        if addr != APU_CMD_COIL:
            raise IllegalAddress
        with self.lock:
            self.coils[APU_CMD_COIL] = 1 if on else 0
            self._gen += 1
            gen = self._gen
        if self.verbose:
            print(f"  [sim] coil[{addr}] <- {'start(1)' if on else 'stop(0)'}",
                  flush=True)
        threading.Thread(target=self._drive, args=(on, gen), daemon=True).start()

    # --- PDU dispatch ----------------------------------------------------------
    def handle_pdu(self, pdu: bytes) -> bytes:
        if len(pdu) < 1:
            raise IllegalFunction
        fc = pdu[0]
        try:
            if fc == 0x03:  # read holding registers
                start = int.from_bytes(pdu[1:3], "big")
                qty = int.from_bytes(pdu[3:5], "big")
                regs = self.read_holding(start, qty)
                data = b"".join(r.to_bytes(2, "big") for r in regs)
                return bytes([0x03, len(data)]) + data
            if fc == 0x01:  # read coils
                start = int.from_bytes(pdu[1:3], "big")
                qty = int.from_bytes(pdu[3:5], "big")
                bits = self.read_coils(start, qty)
                nbytes = (qty + 7) // 8
                val = 0
                for i, b in enumerate(bits):
                    val |= (b & 1) << i
                return bytes([0x01, nbytes]) + val.to_bytes(nbytes, "little")
            if fc == 0x05:  # write single coil
                addr = int.from_bytes(pdu[1:3], "big")
                value = int.from_bytes(pdu[3:5], "big")
                self.write_coil(addr, value == 0xFF00)
                return pdu  # echo request
            if fc == 0x06:  # write single register
                addr = int.from_bytes(pdu[1:3], "big")
                value = int.from_bytes(pdu[3:5], "big")
                self.write_register(addr, value)
                return pdu  # echo request
            raise IllegalFunction
        except IllegalAddress:
            return bytes([fc | 0x80, 0x02])
        except IllegalFunction:
            return bytes([fc | 0x80, 0x01])


# ── TCP server ────────────────────────────────────────────────────────────────
def _recv_exact(sock, n):
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            return None
        buf += chunk
    return buf


def serve_tcp(model: APUModel, host: str, port: int):
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((host, port))
    srv.listen(5)
    print(f"[apu-sim] Modbus/TCP listening on {host}:{port} "
          f"(unit {SLAVE_ID}, spin={model.spin_time}s)", flush=True)
    try:
        while True:
            conn, addr = srv.accept()
            threading.Thread(target=_tcp_client, args=(model, conn),
                             daemon=True).start()
    except KeyboardInterrupt:
        pass
    finally:
        srv.close()


def _tcp_client(model, conn):
    with conn:
        while True:
            header = _recv_exact(conn, 6)  # trans(2)+proto(2)+len(2)
            if not header:
                return
            trans = header[0:2]
            length = int.from_bytes(header[4:6], "big")
            rest = _recv_exact(conn, length)  # unit(1)+pdu
            if not rest:
                return
            unit = rest[0]
            pdu = rest[1:]
            try:
                resp_pdu = model.handle_pdu(pdu)
            except IllegalFunction:
                resp_pdu = bytes([(pdu[0] if pdu else 0) | 0x80, 0x01])
            resp = (trans + b"\x00\x00"
                    + (len(resp_pdu) + 1).to_bytes(2, "big")
                    + bytes([unit]) + resp_pdu)
            conn.sendall(resp)


# ── RTU server (over a serial device / pty) ───────────────────────────────────
# Request lengths (bytes incl. addr + CRC) keyed by function code. The firmware
# only issues FC3 (read) and FC5 (write coil); FC1/FC6 are supported for tests.
_RTU_REQ_LEN = {0x01: 8, 0x03: 8, 0x05: 8, 0x06: 8}


def serve_rtu(model: APUModel, device: str):
    try:
        import termios
        import tty
    except ImportError:
        termios = tty = None

    fd = os.open(device, os.O_RDWR | os.O_NOCTTY)
    if tty is not None:
        try:
            tty.setraw(fd)  # binary-clean: no CR/LF translation
        except termios.error:
            pass
    print(f"[apu-sim] Modbus/RTU on {device} (unit {SLAVE_ID}, "
          f"spin={model.spin_time}s)", flush=True)
    print("[apu-sim] point gobi-agent's MODBUS_DEVICE at the paired pty.",
          flush=True)

    buf = b""
    while True:
        chunk = os.read(fd, 256)
        if not chunk:
            time.sleep(0.01)
            continue
        buf += chunk
        while True:
            frame, buf = _rtu_extract(buf)
            if frame is None:
                break
            resp = _rtu_respond(model, frame)
            if resp:
                os.write(fd, resp)


def _rtu_extract(buf: bytes):
    """Pull one complete, CRC-valid RTU frame off the front of buf."""
    while buf:
        if len(buf) < 2:
            return None, buf
        fc = buf[1]
        need = _RTU_REQ_LEN.get(fc)
        if need is None:
            buf = buf[1:]  # unknown fc — resync
            continue
        if len(buf) < need:
            return None, buf
        frame = buf[:need]
        if crc16(frame[:-2]) == frame[-2:]:
            return frame, buf[need:]
        buf = buf[1:]  # bad CRC — resync
    return None, buf


def _rtu_respond(model, frame: bytes):
    addr = frame[0]
    if addr not in (SLAVE_ID, 0):
        return b""  # not for us
    pdu = frame[1:-2]
    try:
        resp_pdu = model.handle_pdu(pdu)
    except IllegalFunction:
        resp_pdu = bytes([(pdu[0] if pdu else 0) | 0x80, 0x01])
    if addr == 0:
        return b""  # broadcast: no reply
    body = bytes([addr]) + resp_pdu
    return body + crc16(body)


# ── main ──────────────────────────────────────────────────────────────────────
def main(argv=None):
    p = argparse.ArgumentParser(description="Gobi APU Modbus simulator")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--tcp", action="store_true",
                      help="Modbus/TCP mode (default)")
    mode.add_argument("--rtu", metavar="DEVICE",
                      help="Modbus/RTU over a serial device or pty")
    p.add_argument("--host", default="127.0.0.1", help="TCP bind host")
    p.add_argument("--port", type=int, default=5020, help="TCP port")
    p.add_argument("--spin-time", type=float, default=0.5,
                   help="seconds for starting->running / stopping->off "
                        "(use ~8 for realistic timing)")
    p.add_argument("--quiet", action="store_true", help="suppress event log")
    args = p.parse_args(argv)

    model = APUModel(spin_time=args.spin_time, verbose=not args.quiet)

    if args.rtu:
        serve_rtu(model, args.rtu)
    else:
        serve_tcp(model, args.host, args.port)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[apu-sim] stopped")
        sys.exit(0)
