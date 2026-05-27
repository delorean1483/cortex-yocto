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
#define MODBUS_BAUD           19200
#define MODBUS_PARITY         'N'
#define MODBUS_DATA_BITS      8
#define MODBUS_STOP_BITS      1
#define MODBUS_SLAVE_ID       1
#define MODBUS_TIMEOUT_S      1

/* Gobi APU Modbus register map (starting address, 0-based) */
#define REG_DC_V        0   /* DC bus voltage × 10 (e.g. 278 = 27.8 V)   */
#define REG_DC_A        1   /* DC current × 10                             */
#define REG_BATT_V      2   /* Battery voltage × 10                        */
#define REG_BATT_SOC    3   /* Battery state of charge, 0–100 %            */
#define REG_BATT_T      4   /* Battery temperature × 10 (°C)               */
#define REG_APU_STATE   5   /* 0=off 1=starting 2=running 3=stopping 4=fault */
#define REG_RUNTIME_HI  6   /* Runtime hours, high word                    */
#define REG_RUNTIME_LO  7   /* Runtime hours, low word                     */
#define REG_FAULT       8   /* Fault word (bitmask, see faults.js)         */
#define REG_WATTS_HI    9   /* Power output watts, high word               */
#define REG_WATTS_LO   10   /* Power output watts, low word                */
#define REG_RPM        11   /* Engine RPM                                  */
#define REG_OIL_PSI    12   /* Oil pressure × 10                           */
#define REG_COOLANT_T  13   /* Coolant temperature × 10                    */
#define REG_COUNT      14   /* Total registers to read in one request      */

/* ── SQLite offline buffer ───────────────────────────────────────────────── */
#define SQLITE_DB_PATH      "/var/lib/ecofleet/telemetry.db"
#define SQLITE_MAX_ROWS     8640    /* ~12 h at 5 s poll — then oldest is dropped */
#define SQLITE_FLUSH_BATCH  50      /* rows to flush per MQTT reconnect cycle     */

/* ── Config file ──────────────────────────────────────────────────────────── */
#define AGENT_CONFIG_FILE "/etc/ecofleet/gobi-agent.conf"
