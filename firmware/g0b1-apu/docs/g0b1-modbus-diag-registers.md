# APU Component Test — Modbus register contract

Shared between g0b1-firmware (server) and cortex-yocto gobi-agent (master).
Slave id 1, holding registers, FC 0x03 read / 0x06 write.

| reg | name | dir | encoding / meaning |
|-----|------|-----|--------------------|
| 49 | DIAG_MODE   | R/W | write 1=enter (interlock-gated; refused -> ILLEGAL_VALUE), 0=exit. read=1 in diag else 0 |
| 50 | DIAG_OUT    | W   | value=(index<<8)\|state; index 0..6 = OUT_* order; honored only in diag; engine idx 0/1/2 gated |
| 41 | DIAG_STATUS | R   | bitmask, bit i = output i energized (single bit at most) |

Output index: 0 Fuel Pump, 1 Starter, 2 Glow Plug, 3 Compressor Clutch,
4 Heat Reverser, 5 Evap Fan, 6 Condenser Fan. Engine relays (0/1/2) require
engine off + ignition off (or standby-override). Timeouts: 10 s inactivity
drop-all + exit; engine max-on Starter 4 s / Fuel·Glow 5 s. Old firmware:
reg 49 unbound -> ILLEGAL_ADDRESS (graceful degrade).
