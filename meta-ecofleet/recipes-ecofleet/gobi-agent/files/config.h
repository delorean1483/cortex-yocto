/* device/gobi-agent/config.h
 * Build-time configuration for gobi-agent.
 * MQTT_ENDPOINT and FIRMWARE_VERSION are injected by CMake via
 * -DMQTT_ENDPOINT=... and -DFIRMWARE_VERSION=...
 * All other values are defaults that can be overridden in gobi-agent.conf.
 */

#pragma once

/* ── Injected at build time (CMake -D flags) ──────────────────────────────
 * The Yocto recipe's do_configure:prepend() guard will fail the build if
 * MQTT_ENDPOINT is not set, preventing placeholder images shipping. */
#ifndef MQTT_ENDPOINT
#  error "MQTT_ENDPOINT has not been set for this unit. Pass -DMQTT_ENDPOINT=<host> to cmake."
#endif

#ifndef FIRMWARE_VERSION
#  define FIRMWARE_VERSION "1.0.0"
#endif

/* ── MQTT ────────────────────────────────────────────────────────────────── */
#define MQTT_PORT            8883
#define MQTT_KEEPALIVE_S     60
#define MQTT_QOS             1
#define MQTT_RECONNECT_MAX_S 60     /* cap on exponential back-off */

/* ── TLS certificate paths (installed by Yocto recipe) ──────────────────── */
#define TLS_CA_FILE   "/etc/ecofleet/certs/AmazonRootCA1.pem"
#define TLS_CERT_FILE "/etc/ecofleet/certs/device.crt"
#define TLS_KEY_FILE  "/etc/ecofleet/certs/device.key"

/* ── Unit identity ────────────────────────────────────────────────────────── */
#define UNIT_SERIAL_FILE "/etc/ecofleet/unit-serial"

/* ── Modbus ───────────────────────────────────────────────────────────────── */
#define MODBUS_DEVICE_DEFAULT "/dev/ttyUSB0"
#define MODBUS_BAUD           9600    /* EF-G0B1R firmware USART1 = 9600 8N1 */
#define MODBUS_PARITY         'N'
#define MODBUS_DATA_BITS      8
#define MODBUS_STOP_BITS      1
#define MODBUS_SLAVE_ID       1
#define MODBUS_TIMEOUT_S      1

/* EF-G0B1R APU Modbus holding-register map.
 * Values below are 0-based WIRE addresses (= firmware register number - 1);
 * the firmware register number is shown in the comment. The firmware map is
 * SPARSE across regs 1..52 and rejects a block read that spans an unbound
 * register (exception 0x02), so the agent reads ONLY these, one at a time.
 * The firmware exposes no coils — there is no start/stop coil. */
#define REG_CABIN_TEMP_F    0   /* fw 1  enclosure/cabin temp, degF (int16) R  */
#define REG_BATT_CV         5   /* fw 6  battery voltage, centivolts (/100) R  */
#define REG_OIL_OK          6   /* fw 7  oil-pressure switch OK, 0/1        R  */
#define REG_IGNITION        7   /* fw 8  truck ignition, 0/1               R  */
#define REG_MODE            9   /* fw 10 mode: 0=Off 1=Climate 2=Battery   R  */
#define REG_ENGINE_HRS     10   /* fw 11 engine runtime, hours             R  */
#define REG_FAN_SPEED      11   /* fw 12 evap fan speed, 0-100 %           R  */
#define REG_BATT_SET_CV    12   /* fw 13 batt monitor setpoint, centivolts R  */
#define REG_CLMT_SET_F     13   /* fw 14 climate temp setpoint, degF       R  */
#define REG_ERROR          16   /* fw 17 error state, 0-10 (control_error_t) R */
#define REG_OIL_CHANGE     17   /* fw 18 oil-change state, 0-4             R  */
#define REG_OIL_HRS        19   /* fw 20 engine oil time, hours            R  */
#define REG_MACHINE_HRS    20   /* fw 21 machine runtime, hours            R  */
#define REG_ENGINE_STATUS  21   /* fw 22 engine op status (control_status_t) R */
#define REG_CONTROL_STATUS 22   /* fw 23 control status (control_status_t) R  */
#define REG_RPM            37   /* fw 38 engine RPM                        R  */
#define REG_EXT_TEMP_F     50   /* fw 51 external temp, degF (int16)       R  */

/* Component Test (Plan B) — see docs/.../2026-09-01-apu-component-test-*.md.
 * These are OPTIONAL: on firmware without them a read returns exception 0x02,
 * handled best-effort (never a reconnect). */
#define REG_DIAG_STATUS    40   /* fw 41 energized-output bitmask (bit i = OUT i) R */
#define REG_DIAG_MODE      48   /* fw 49 component-test mode 0/1                 R/W */
/* fw 50 DIAG_OUT is write-only via mb_write_reg(50, (index<<8)|state) — no read define */

/* ── SQLite offline buffer ───────────────────────────────────────────────── */
#define SQLITE_DB_PATH      "/var/lib/ecofleet/telemetry.db"
/* Always-current telemetry snapshot for the local display (gobi-ui), written
 * every cycle regardless of MQTT connectivity — the SQLite buffer only holds
 * rows while offline, so the live UI reads this instead. */
#define LATEST_JSON_PATH    "/var/lib/ecofleet/latest.json"

/* Local control channel: gobi-ui (the touchscreen) writes a small JSON command
 * here; the agent applies it to the Modbus holding registers each poll cycle,
 * then removes it. gobi-ui can't drive Modbus itself — the agent is the sole
 * RTU master on the serial port. Keys (any subset): "mode" (off|climate|
 * battery), "setpoint_f" (int), "fan" (0-100), "reset_oil" (true),
 * "diag_mode" (0|1 → enter/exit Component Test, reg 49),
 * "diag_out" (int (index<<8)|state → actuate one output, reg 50). */
#define COMMAND_JSON_PATH   "/var/lib/ecofleet/command.json"
#define SQLITE_MAX_ROWS     8640    /* ~12 h at 5 s poll — then oldest is dropped */
#define SQLITE_FLUSH_BATCH  50      /* rows to flush per MQTT reconnect cycle     */

/* ── Config file ──────────────────────────────────────────────────────────── */
#define AGENT_CONFIG_FILE "/etc/ecofleet/gobi-agent.conf"
