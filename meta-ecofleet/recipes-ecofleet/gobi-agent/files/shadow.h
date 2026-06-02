/* device/gobi-agent/shadow.h
 * Device Shadow client for gobi-agent.
 *
 * Handles:
 *   - Fetching desired config on MQTT connect
 *   - Receiving delta messages and applying config changes
 *   - Publishing reported state after each telemetry cycle
 *
 * Shadow topics used:
 *   Publish:   $aws/things/{unit}/shadow/get
 *              $aws/things/{unit}/shadow/update
 *   Subscribe: $aws/things/{unit}/shadow/get/accepted
 *              $aws/things/{unit}/shadow/get/rejected
 *              $aws/things/{unit}/shadow/update/delta
 *              $aws/things/{unit}/shadow/update/accepted
 *              $aws/things/{unit}/shadow/update/rejected
 */

#pragma once

#include <stdbool.h>
#include <stdint.h>
#include <mosquitto.h>

/* ── Configurable fields that can be changed via shadow ─────────────────── */
typedef struct {
    int      poll_interval_s;    /* Modbus poll interval, 5–60 s (default: 5)  */
    char     report_mode[16];    /* "normal" | "eco" | "debug"                  */
    char     firmware_target[32];/* semver, e.g. "1.2.0" — signals OTA desired  */
    bool     reboot_requested;   /* set true to trigger controlled reboot        */
    char     apu_command[8];     /* one-shot: "start" | "stop" | "" (consumed once) */
} shadow_config_t;

/* ── Reported telemetry fields included in shadow update ────────────────── */
typedef struct {
    double   dc_v;
    double   batt_soc;
    char     apu_state[16];
    char     fault[10];          /* hex string, e.g. "0x0000"                    */
    char     firmware_version[32];
    uint64_t last_seen_ts;       /* epoch ms                                     */
} shadow_reported_t;

/* ── Callbacks ────────────────────────────────────────────────────────────── */

/* Called when the shadow module applies a new config from desired/delta.
 * The agent's main loop should check shadow_get_config() after connect
 * and after this callback fires. */
typedef void (*shadow_config_cb_t)(const shadow_config_t *cfg, void *userdata);

/* ── Public API ─────────────────────────────────────────────────────────── */

/* Initialise the shadow module.
 * unit_serial: e.g. "TRUCK-001" — used to build topic strings.
 * firmware_version: running version string, e.g. "1.1.0".
 * config_cb: called whenever desired config changes.
 * Returns 0 on success. */
int  shadow_init(const char *unit_serial,
                 const char *firmware_version,
                 shadow_config_cb_t config_cb,
                 void *userdata);

/* Subscribe to all shadow topics. Call after MQTT connect. */
int  shadow_subscribe(struct mosquitto *mosq);

/* Request the current shadow from IoT Core. Call after MQTT connect
 * and after shadow_subscribe(). */
int  shadow_get(struct mosquitto *mosq);

/* MQTT message callback — call from your on_message handler for any
 * topic starting with "$aws/things/". Returns true if the message
 * was handled by the shadow module (caller should not process further). */
bool shadow_on_message(struct mosquitto *mosq,
                       const char *topic,
                       const void *payload,
                       int payloadlen);

/* Publish a shadow update with the current reported state.
 * Call once per telemetry cycle (every poll_interval_s seconds). */
int  shadow_publish_reported(struct mosquitto *mosq,
                             const shadow_reported_t *reported);

/* Returns a pointer to the current live config (read-only).
 * Thread-safe: protected by an internal mutex. */
const shadow_config_t *shadow_get_config(void);

/* Cleanup. */
void shadow_cleanup(void);
