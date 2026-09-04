/* heater_fields.h — pure field helpers for the VEVOR XMZ-F-D5 diesel heater
 * telemetry block (EF-G0B1R firmware regs 53..67 / wire 52..66).
 *
 * These functions have no I/O: they decode raw register values read by
 * main.c's best-effort Modbus reads into the state string, flag bits, and
 * scaled floats emitted in latest.json/MQTT. Keeping them pure lets them be
 * unit-tested on the host (see ../tests/test_heater_fields.c).
 */
#pragma once

/* Heater status-flags word (fw reg 64 / wire REG_HEATER_FLAGS) bit layout.
 * Mirrors the firmware's heater flags bits 0..4. */
#define HEATER_FLAG_FRESH       0x01u   /* bit0: reading is fresh (not stale) */
#define HEATER_FLAG_COOLDOWN    0x02u   /* bit1: heater in cooldown cycle     */
#define HEATER_FLAG_SAFE_OFF    0x04u   /* bit2: forced to safe-off           */
#define HEATER_FLAG_COMMS_FAULT 0x08u   /* bit3: one-wire link fault          */
#define HEATER_FLAG_XPORT_FAULT 0x10u   /* bit4: transport/frame fault        */

/* Heater state (fw reg 55 / wire REG_HEATER_STATE) name, 0..4:
 * 0=off 1=priming 2=ignition 3=running 4=cooldown, else "unknown".
 * Never returns NULL. */
const char *heater_state_name(unsigned state);

/* 1 if bit `bit` (one of the HEATER_FLAG_* masks) is set in `flags`, else 0. */
int heater_flag(unsigned flags, unsigned bit);

/* Supply voltage in volts from raw millivolts (fw reg 58). */
double heater_supply_volts(unsigned mv);

/* Coolant pump frequency in Hz from raw tenths-of-Hz (fw reg 60). */
double heater_pump_hz(unsigned x10);
