# EcoFleet Cloud Data Contract

**Authoritative source:** `meta-ecofleet/recipes-ecofleet/gobi-agent/files/main.c`
`build_telemetry_json()`. The golden fixture `cloud/fixtures/telemetry.sample.json`
is asserted by both the ingest host test (`lambda/ingest/telemetry-map.test.js`)
and the API host test (`lambda/api/telemetry-view.test.js`) so device → cloud → web
field names can never silently drift.

The agent publishes to AWS IoT Core over MQTT/TLS and writes the identical
telemetry JSON to `latest.json` for the local Qt UI. **No firmware or agent
changes are in scope** — the cloud conforms to this contract.

---

## 1. Telemetry — topic `ecofleet/<serial>/telemetry`

Every field is authoritative. Enum fields carry **both** a string label and a raw
`_n` integer; the UI renders the label and keys logic off `_n`.

| Field | Type | Meaning |
|---|---|---|
| `unit` | string | Device serial |
| `ts` | number (ms) | Sample timestamp (epoch ms) |
| `cabin_temp_f`, `ext_temp_f` | number | Cabin / external temp (°F) |
| `batt_v` | number | Battery voltage |
| `rpm` | number | Engine RPM |
| `oil_ok` | bool | Oil pressure OK |
| `ignition` | bool | Ignition sense |
| `mode` / `mode_n` | string / int | APU op mode (e.g. `battery`) |
| `engine_status` / `_n` | string / int | Engine status |
| `control_status` / `_n` | string / int | Control status |
| `error` / `_n` | string / int | Active error/fault label |
| `oil_change` / `_n` | string / int | Oil-change state |
| `engine_hrs`, `oil_hrs`, `machine_hrs` | number | Runtime hour counters |
| `clmt_setpoint_f` | number | Climate setpoint (°F) |
| `batt_setpoint_v` | number | Battery-mode setpoint (V) |
| `fan_speed` | number | Fan duty (0–100%) |
| `fan_auto` | bool | Auto-fan enabled |
| `diag_active` | bool | Component-Test (OP_DIAG) mode active |
| `diag_outputs` | int (bitmask) | Energized output bitmask |
| `apu_fw_version` | int | APU firmware version (encoded) |
| `heater_present` | bool | Heater block answered Modbus |
| `heater_state` | string | off / preheat / ignition / running / cooldown |
| `heater_target_level`, `heater_active_level` | int | Requested / active level (1–10) |
| `heater_error` | int | Heater ECU error code |
| `heater_supply_v` | number | Heater supply voltage |
| `heater_fan_rpm` | int | Heater blower RPM |
| `heater_pump_hz` | number | Fuel pump frequency (Hz) |
| `heater_exchanger` | int | Exchanger temp (raw) |
| `heater_state_seconds` | int | Seconds in current state |
| `heater_age_ms` | int | Age of last good heater read (ms) |
| `heater_flags` | int (bitmask) | bit0 fresh, bit1 cooldown, bit2 safe_off, bit3 comms_fault, bit4 xport_fault |
| `heater_safe_off`, `heater_comms_ok` | bool | Derived from `heater_flags` |
| `heater_valid_frames`, `heater_checksum_failures`, `heater_transport_errors` | int | One-wire link health counters |

### InfluxDB storage

Written by `lambda/ingest/telemetry-map.js` to measurement `telemetry`:

- **Tags** (low-cardinality, bounded enums): `unit`, `mode`, `engine_status`,
  `control_status`, `error`, `oil_change`, `heater_state`.
- **Fields**: everything else (floats / ints / bools per `telemetry-map.js`).

Read back by `lambda/api/telemetry-view.js` (`mapTelemetryRow`) using the same
field names.

---

## 2. Fault — topic `ecofleet/<serial>/faults`

```json
{ "unit": "APU-000123", "ts": 1757563200000, "error": "none", "error_n": 0, "status": "idle" }
```

Published on every change, including the transition back to `none`, so the cloud
can auto-resolve.

---

## 3. Device shadow — control plane

**`desired`** (written by the dashboard via `POST /fleet/units/{unit}/command`
and `POST /fleet/config`):

| Key | Type | Notes |
|---|---|---|
| `heater` | `{on: 0\|1, level: 1..10}` | Heater remote control |
| `apu_command` | `"start"` \| `"stop"` | APU start/stop |
| `firmware_target` | semver string | Triggers OTA (see §4) |
| `reboot` | bool | Reboot request |
| `poll_interval_s` | number 5–60 | Report cadence |
| `report_mode` | `normal` \| `eco` \| `debug` | |
| `clmt_setpoint_f` | number 50–90 | Climate setpoint |
| `batt_setpoint_v` | number 10–15 | Battery-mode setpoint |

**`reported`** (device acks): applied values + `heater_desired_seq` (monotonic,
bumped when a heater desired is accepted). The agent nulls `desired.heater` once
applied — **compare-and-clear**. The UI tracks pending → applied off this.

---

## 4. OTA

Setting shadow `desired.firmware_target = "<version>"` makes the agent download
`https://ecofleet-ota.s3.amazonaws.com/releases/<version>/ecofleet-<version>.swu`,
run `swupdate`, and reboot on success. The dashboard triggers by setting
`firmware_target`; progress is inferred from `reported` fw version + connection.
