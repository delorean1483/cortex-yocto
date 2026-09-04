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
#include <stddef.h>
#include <stdint.h>
#include <mosquitto.h>

/* ── Configurable fields that can be changed via shadow ─────────────────── */
typedef struct {
    int      poll_interval_s;    /* Modbus poll interval, 5–60 s (default: 5)  */
    char     report_mode[16];    /* "normal" | "eco" | "debug"                  */
    char     firmware_target[32];/* semver, e.g. "1.2.0" — signals OTA desired  */
    bool     reboot_requested;   /* set true to trigger controlled reboot        */
    char     apu_command[8];     /* one-shot: "start" | "stop" | "" — applied by the
                                  * telemetry loop, then cleared via
                                  * shadow_ack_apu_command() once it lands */
    bool     heater_desired_valid; /* true while a heater on/level pair from
                                    * desired.heater is pending application */
    int      heater_on;          /* pending: 0|1 — applied to reg 53             */
    int      heater_level;       /* pending: 1..10 — applied to reg 54           */
} shadow_config_t;

/* ── Reported telemetry fields included in shadow update ────────────────── */
typedef struct {
    double   dc_v;
    double   batt_soc;
    char     apu_state[16];
    char     fault[10];          /* hex string, e.g. "0x0000"                    */
    char     firmware_version[32];
    uint64_t last_seen_ts;       /* epoch ms                                     */

    /* VEVOR heater (Sub-project #1 firmware, frozen regs 53..67) — mirrors
     * the heater_* fields in build_telemetry_json(). */
    char     heater_state[16];   /* "off" | "preheat" | "ignition" | "running" |
                                  * "cooldown" | "unknown"                       */
    int      heater_level;       /* active level (not target), 0 if off/absent   */
    int      heater_error;       /* raw error code, reg 57                       */
    int      heater_fan_rpm;     /* raw fan RPM, reg 59                          */
    bool     heater_safe_off;    /* HEATER_FLAG_SAFE_OFF set                     */
    bool     heater_comms_ok;    /* fresh & no HEATER_FLAG_COMMS_FAULT           */
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

/* ── One-shot APU start/stop command ────────────────────────────────────────
 * The command arrives via the shadow "desired" state but MUST be applied to the
 * Modbus hardware from the telemetry thread — never the MQTT callback thread —
 * because the libmodbus context is not safe for concurrent access.
 *
 * Each poll cycle the main loop calls shadow_peek_apu_command(); if a command
 * is pending it performs the Modbus write and, only on success, calls
 * shadow_ack_apu_command() to clear it and null the cloud desired state. If the
 * write fails the command stays pending and is retried on the next cycle. */

/* Copy any pending command ("start"/"stop") into `out` (NUL-terminated) without
 * clearing it. Returns true if a command is pending. Thread-safe. */
bool shadow_peek_apu_command(char *out, size_t out_len);

/* Mark the pending APU command as applied: clear it and schedule a
 * desired=null update so the cloud shadow is cleared too. Thread-safe. */
void shadow_ack_apu_command(void);

/* ── Heater-scoped start/stop/level command ─────────────────────────────────
 * Same one-shot idiom as the APU command above, scoped to the VEVOR heater
 * only (regs 53/54). This is a deliberate, narrower remote-control surface
 * than the deferred whole-APU apu_command — it stays wired while apu_command
 * does not. Applied from the telemetry thread, never the MQTT callback
 * thread, for the same libmodbus-concurrency reason. */

/* Copy any pending heater on/level command into *on / *level without
 * clearing it. Returns true if a command is pending. Thread-safe. */
bool shadow_peek_heater_cmd(int *on, int *level);

/* Mark the pending heater command as applied: clear it and schedule a
 * desired.heater=null update so the cloud shadow is cleared too. Thread-safe. */
void shadow_ack_heater_cmd(void);

/* Cleanup. */
void shadow_cleanup(void);
