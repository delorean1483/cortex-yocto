/* device/gobi-agent/main.c
 * EcoFleet Gobi APU agent.
 *
 * Reads Modbus registers from the Gobi APU every poll_interval_s seconds,
 * publishes telemetry and fault events to AWS IoT Core over MQTT/TLS,
 * buffers rows in SQLite when offline, and manages Device Shadow for
 * remote config and status reporting.
 *
 * Build deps: libmodbus, libmosquitto, libsqlite3, libcjson, libpthread
 */

#include "config.h"
#include "shadow.h"
#include "stm32_flash_task.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <stdint.h>
#include <signal.h>
#include <unistd.h>
#include <time.h>
#include <errno.h>
#include <syslog.h>
#include <sys/wait.h>

#include <modbus.h>
#include <mosquitto.h>
#include <sqlite3.h>
#include <cjson/cJSON.h>

/* ── EF-G0B1R enum → label helpers ───────────────────────────────────────── */
/* Mirror the firmware enums in App/services/control.h. */
static const char *mode_name(uint16_t v)      /* op_mode_t (reg 10) */
{
    switch (v) {
        case 0: return "off";
        case 1: return "climate";
        case 2: return "battery";
        default: return "unknown";
    }
}

static const char *status_name(uint16_t v)    /* control_status_t (reg 22/23) */
{
    switch (v) {
        case 0: return "off";        case 1: return "warming_up";
        case 2: return "starting";   case 3: return "running";
        case 4: return "defrost";    case 5: return "charging";
        case 6: return "cooling";    case 7: return "chillin";
        default: return "unknown";
    }
}

static const char *error_name(uint16_t v)     /* control_error_t (reg 17) */
{
    switch (v) {
        case 0:  return "none";               case 1:  return "low_oil";
        case 2:  return "high_engine_temp";   case 3:  return "low_battery";
        case 4:  return "ac_low_pressure";    case 5:  return "ac_high_pressure";
        case 6:  return "starting_failure";   case 7:  return "standby";
        case 8:  return "engine_stalled";     case 9:  return "no_rpm";
        case 10: return "high_ac_pressure";   default: return "unknown";
    }
}

static const char *oil_change_name(uint16_t v)/* oil_state_t (reg 18) */
{
    switch (v) {
        case 0: return "good";           case 1: return "change_soon";
        case 2: return "change_needed";  case 3: return "past_due";
        case 4: return "dismissed";      default: return "unknown";
    }
}

/* ── Telemetry struct (EF-G0B1R climate-APU register map) ────────────────── */
typedef struct {
    double   cabin_temp_f;   /* reg 1  */
    double   ext_temp_f;     /* reg 51 */
    double   batt_v;         /* reg 6  (centivolts / 100) */
    double   batt_set_v;     /* reg 13 (centivolts / 100) */
    uint16_t rpm;            /* reg 38 */
    uint16_t engine_hrs;     /* reg 11 */
    uint16_t oil_hrs;        /* reg 20 */
    uint16_t machine_hrs;    /* reg 21 */
    uint16_t clmt_set_f;     /* reg 14 */
    uint8_t  oil_ok;         /* reg 7  */
    uint8_t  ignition;       /* reg 8  */
    uint8_t  mode;           /* reg 10 */
    uint8_t  error;          /* reg 17 */
    uint8_t  engine_status;  /* reg 22 */
    uint8_t  control_status; /* reg 23 */
    uint8_t  oil_change;     /* reg 18 */
    uint8_t  fan_speed;      /* reg 12 */
    uint8_t  diag_mode;      /* reg 49  component-test mode 0/1 (best-effort) */
    uint16_t diag_outputs;   /* reg 41  energized-output bitmask (best-effort) */
    bool     fan_auto;       /* reg 9   auto-fan flag 0/1 (best-effort) */
    uint16_t fw_version;     /* reg 2   APU firmware version, encoded (best-effort) */
    uint64_t ts_ms;
} telemetry_t;

/* ── Global state ────────────────────────────────────────────────────────── */
static volatile sig_atomic_t g_running = 1;
static bool     g_mqtt_connected = false;
static char     g_unit_serial[64] = {0};
static char     g_modbus_device[64] = MODBUS_DEVICE_DEFAULT;
static modbus_t *g_modbus = NULL;
static sqlite3  *g_db = NULL;
static struct mosquitto *g_mosq = NULL;

/* MQTT topic buffers */
static char g_topic_telemetry[128];
static char g_topic_faults[128];

/* ── Signal handler ──────────────────────────────────────────────────────── */
static void handle_signal(int sig)
{
    (void)sig;
    g_running = 0;
}

/* ── Unit serial ─────────────────────────────────────────────────────────── */
static int read_unit_serial(char *buf, size_t len)
{
    FILE *f = fopen(UNIT_SERIAL_FILE, "r");
    if (!f) {
        syslog(LOG_ERR, "Cannot open %s: %s", UNIT_SERIAL_FILE, strerror(errno));
        return -1;
    }
    if (!fgets(buf, (int)len, f)) {
        fclose(f);
        syslog(LOG_ERR, "Cannot read %s", UNIT_SERIAL_FILE);
        return -1;
    }
    fclose(f);
    /* Strip trailing newline */
    buf[strcspn(buf, "\r\n")] = '\0';
    if (strcmp(buf, "TRUCK-XXX") == 0) {
        syslog(LOG_ERR, "unit-serial is still placeholder TRUCK-XXX — refusing to start");
        return -1;
    }
    return 0;
}

/* ── SQLite buffer ───────────────────────────────────────────────────────── */
static int db_init(void)
{
    int rc = sqlite3_open(SQLITE_DB_PATH, &g_db);
    if (rc != SQLITE_OK) {
        syslog(LOG_ERR, "sqlite3_open %s: %s", SQLITE_DB_PATH, sqlite3_errmsg(g_db));
        return -1;
    }
    const char *sql =
        "PRAGMA journal_mode=WAL;"
        "CREATE TABLE IF NOT EXISTS telemetry ("
        "  id      INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  ts_ms   INTEGER NOT NULL,"
        "  payload TEXT    NOT NULL"
        ");"
        "CREATE TABLE IF NOT EXISTS faults ("
        "  id      INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  ts_ms   INTEGER NOT NULL,"
        "  payload TEXT    NOT NULL"
        ");";
    char *errmsg = NULL;
    rc = sqlite3_exec(g_db, sql, NULL, NULL, &errmsg);
    if (rc != SQLITE_OK) {
        syslog(LOG_ERR, "db_init: %s", errmsg);
        sqlite3_free(errmsg);
        return -1;
    }
    return 0;
}

static int db_store(const char *table, uint64_t ts_ms, const char *payload)
{
    /* Enforce max row cap — drop oldest when full */
    char cap_sql[256];
    snprintf(cap_sql, sizeof(cap_sql),
             "DELETE FROM %s WHERE id IN "
             "(SELECT id FROM %s ORDER BY id ASC "
             " LIMIT MAX(0, (SELECT COUNT(*) FROM %s) - %d + 1));",
             table, table, table, SQLITE_MAX_ROWS);
    sqlite3_exec(g_db, cap_sql, NULL, NULL, NULL);

    sqlite3_stmt *stmt;
    char sql[128];
    snprintf(sql, sizeof(sql),
             "INSERT INTO %s (ts_ms, payload) VALUES (?, ?);", table);
    if (sqlite3_prepare_v2(g_db, sql, -1, &stmt, NULL) != SQLITE_OK)
        return -1;
    sqlite3_bind_int64(stmt, 1, (sqlite3_int64)ts_ms);
    sqlite3_bind_text(stmt, 2, payload, -1, SQLITE_STATIC);
    int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    return (rc == SQLITE_DONE) ? 0 : -1;
}

/* Flush buffered rows to MQTT. Returns number flushed. */
static int db_flush(const char *table, const char *topic)
{
    if (!g_mqtt_connected) return 0;

    char sql[256];
    snprintf(sql, sizeof(sql),
             "SELECT id, payload FROM %s ORDER BY id ASC LIMIT %d;",
             table, SQLITE_FLUSH_BATCH);

    sqlite3_stmt *stmt;
    if (sqlite3_prepare_v2(g_db, sql, -1, &stmt, NULL) != SQLITE_OK)
        return 0;

    int flushed = 0;
    while (sqlite3_step(stmt) == SQLITE_ROW) {
        sqlite3_int64 id = sqlite3_column_int64(stmt, 0);
        const char *payload = (const char *)sqlite3_column_text(stmt, 1);

        int rc = mosquitto_publish(g_mosq, NULL, topic,
                                   (int)strlen(payload), payload,
                                   MQTT_QOS, false);
        if (rc != MOSQ_ERR_SUCCESS) {
            syslog(LOG_WARNING, "db_flush publish failed: %d — stopping flush", rc);
            break;
        }

        /* Delete the row we just published */
        char del[64];
        snprintf(del, sizeof(del),
                 "DELETE FROM %s WHERE id = %lld;", table, (long long)id);
        sqlite3_exec(g_db, del, NULL, NULL, NULL);
        flushed++;
    }
    sqlite3_finalize(stmt);

    if (flushed > 0)
        syslog(LOG_INFO, "Flushed %d buffered rows from %s", flushed, table);
    return flushed;
}

/* ── OTA update ──────────────────────────────────────────────────────────── */
/*
 * S3 base URL for .swu bundles.  Bundles are named ecofleet-<version>.swu and
 * hosted at OTA_BUNDLE_BASE_URL/<version>/ecofleet-<version>.swu.
 * Override at build time via config.h or OTA_BUNDLE_BASE_URL env.
 */
#ifndef OTA_BUNDLE_BASE_URL
#define OTA_BUNDLE_BASE_URL "https://ecofleet-ota.s3.amazonaws.com/releases"
#endif

/* Download and apply an OTA bundle in a forked child process so the main
 * telemetry loop keeps running.  The child:
 *   1. curl downloads the .swu to /tmp/
 *   2. Runs swupdate -i <file>
 *   3. Reboots on success (swupdate exits 0)
 * SIGCHLD is set to SIG_IGN in main() so zombies are auto-reaped. */
static void ota_trigger(const char *version)
{
    pid_t pid = fork();
    if (pid < 0) {
        syslog(LOG_ERR, "ota: fork failed: %s", strerror(errno));
        return;
    }
    if (pid > 0) {
        syslog(LOG_INFO, "ota: download child pid=%d", (int)pid);
        return;  /* parent returns immediately */
    }

    /* ── Child ── */
    char url[256], local[64];
    snprintf(url,   sizeof(url),   "%s/%s/ecofleet-%s.swu",
             OTA_BUNDLE_BASE_URL, version, version);
    snprintf(local, sizeof(local), "/tmp/ecofleet-%s.swu", version);

    syslog(LOG_INFO, "ota: downloading %s -> %s", url, local);

    /* curl: silent, fail on HTTP errors, follow redirects, 5-min timeout */
    const char *curl_argv[] = {
        "curl", "-fsSL", "--max-time", "300",
        "-o", local, url, NULL
    };
    pid_t curl_pid = fork();
    if (curl_pid == 0) {
        execvp("curl", (char *const *)curl_argv);
        _exit(127);
    }
    int status = 0;
    waitpid(curl_pid, &status, 0);
    if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
        syslog(LOG_ERR, "ota: curl failed (exit %d) — aborting", WEXITSTATUS(status));
        _exit(1);
    }

    syslog(LOG_INFO, "ota: download complete, running swupdate");

    /* swupdate -i <file> -f <config> : install to the inactive A/B slot and
     * flip the bootloader env. swupdate is built with CONFIG_SIGNED_IMAGES, so
     * every bundle's signature is verified before flashing. The verification
     * key could be given on the CLI (-k <pubkey>; -K is AES decryption, unused
     * here) but we instead drive it from `public-key-file` in the config we
     * ship at /etc/swupdate/ecofleet.cfg (from recipes-swupdate
     * ecofleet-swupdate.cfg), so the key path lives in one place. */
    const char *swu_argv[] = { "swupdate", "-i", local,
                               "-f", "/etc/swupdate/ecofleet.cfg", NULL };
    pid_t swu_pid = fork();
    if (swu_pid == 0) {
        execvp("swupdate", (char *const *)swu_argv);
        _exit(127);
    }
    waitpid(swu_pid, &status, 0);
    if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
        syslog(LOG_ERR, "ota: swupdate failed (exit %d)", WEXITSTATUS(status));
        unlink(local);
        _exit(1);
    }

    syslog(LOG_INFO, "ota: update applied — rebooting");
    unlink(local);
    execl("/sbin/reboot", "reboot", NULL);
    _exit(0);
}

/* ── Shadow config callback ──────────────────────────────────────────────── */
/* Remote APU start/stop is intentionally NOT wired in this telemetry-only
 * build. The EF-G0B1R exposes no Modbus coils; commanding it means writing the
 * mode register (reg 10: 0=Off 1=Climate 2=Battery), which actuates real
 * relays/the engine. That control path is deferred to a later, deliberate
 * change, so any queued shadow command is logged and ignored here. */

static void on_shadow_config(const shadow_config_t *cfg, void *userdata)
{
    (void)userdata;
    syslog(LOG_INFO,
           "shadow config: poll=%ds mode=%s fw_target=%s reboot=%d apu_cmd=%s",
           cfg->poll_interval_s, cfg->report_mode,
           cfg->firmware_target, cfg->reboot_requested, cfg->apu_command);

    if (cfg->apu_command[0] != '\0')
        syslog(LOG_INFO,
               "shadow: APU '%s' command received — remote control is deferred "
               "in this telemetry-only build; ignoring", cfg->apu_command);

    if (cfg->reboot_requested) {
        syslog(LOG_WARNING, "shadow: reboot requested — rebooting in 3 s");
        sleep(3);
        system("systemctl reboot");
    }
    if (cfg->firmware_target[0] != '\0') {
        syslog(LOG_INFO, "shadow: OTA requested, target=%s — spawning download",
               cfg->firmware_target);
        ota_trigger(cfg->firmware_target);
    }
}

/* ── MQTT callbacks ──────────────────────────────────────────────────────── */
static void on_connect(struct mosquitto *mosq, void *obj, int rc)
{
    (void)obj;
    if (rc != 0) {
        syslog(LOG_ERR, "MQTT connect failed: %d", rc);
        return;
    }
    syslog(LOG_INFO, "MQTT connected");
    g_mqtt_connected = true;

    /* Shadow: subscribe then fetch current desired config */
    shadow_subscribe(mosq);
    shadow_get(mosq);

    /* Flush any buffered rows now that we're online */
    db_flush("telemetry", g_topic_telemetry);
    db_flush("faults",    g_topic_faults);
}

static void on_disconnect(struct mosquitto *mosq, void *obj, int rc)
{
    (void)mosq; (void)obj;
    g_mqtt_connected = false;
    syslog(LOG_WARNING, "MQTT disconnected (rc=%d) — buffering to SQLite", rc);
}

static void on_message(struct mosquitto *mosq, void *obj,
                       const struct mosquitto_message *msg)
{
    (void)obj;
    // Shadow module handles all $aws/things/<thing>/shadow/<type> topics
    if (shadow_on_message(mosq, msg->topic, msg->payload, msg->payloadlen))
        return;
    /* No other inbound topics expected */
}

static void on_log(struct mosquitto *mosq, void *obj, int level, const char *str)
{
    (void)mosq; (void)obj; (void)level;
    syslog(LOG_DEBUG, "mosquitto: %s", str);
}

/* ── Modbus read ─────────────────────────────────────────────────────────── */
/* The EF-G0B1R register map is sparse across regs 1..52 and the firmware
 * rejects a block read that spans an unbound register (exception 0x02), so we
 * read each bound register individually. The first failed read is treated as a
 * link error and returns -1, which drives the reconnect path in main(). */
static int modbus_read_telemetry(telemetry_t *t)
{
    uint16_t v;

    #define RD(addr) do {                                                       \
        if (modbus_read_registers(g_modbus, (addr), 1, &v) != 1) {              \
            syslog(LOG_WARNING, "modbus read reg (wire %d) failed: %s",         \
                   (addr), modbus_strerror(errno));                            \
            return -1;                                                          \
        }                                                                       \
    } while (0)

    RD(REG_CABIN_TEMP_F);    t->cabin_temp_f  = (int16_t)v;   /* signed degF */
    RD(REG_EXT_TEMP_F);      t->ext_temp_f    = (int16_t)v;   /* signed degF */
    RD(REG_BATT_CV);         t->batt_v        = v / 100.0;
    RD(REG_BATT_SET_CV);     t->batt_set_v    = v / 100.0;
    RD(REG_RPM);             t->rpm           = v;
    RD(REG_ENGINE_HRS);      t->engine_hrs    = v;
    RD(REG_OIL_HRS);         t->oil_hrs       = v;
    RD(REG_MACHINE_HRS);     t->machine_hrs   = v;
    RD(REG_CLMT_SET_F);      t->clmt_set_f    = v;
    RD(REG_OIL_OK);          t->oil_ok        = (uint8_t)v;
    RD(REG_IGNITION);        t->ignition      = (uint8_t)v;
    RD(REG_MODE);            t->mode          = (uint8_t)v;
    RD(REG_ERROR);           t->error         = (uint8_t)v;
    RD(REG_ENGINE_STATUS);   t->engine_status = (uint8_t)v;
    RD(REG_CONTROL_STATUS);  t->control_status= (uint8_t)v;
    RD(REG_OIL_CHANGE);      t->oil_change    = (uint8_t)v;
    RD(REG_FAN_SPEED);       t->fan_speed     = (uint8_t)v;

    #undef RD

    t->ts_ms = (uint64_t)time(NULL) * 1000ULL;
    return 0;
}

/* Best-effort single-register read: returns the register value on success,
 * or dflt if the register is unbound on old firmware (exception 0x02) or the
 * read otherwise fails. Unlike RD() in modbus_read_telemetry(), this never
 * returns -1 / drives the reconnect path — modbus_read_telemetry remains the
 * sole link-health authority. Used for optional registers that may be
 * absent on older firmware (Component Test diag regs, fan_auto). */
static uint16_t modbus_read_reg_besteffort(modbus_t *ctx, int wire_addr, uint16_t dflt)
{
    uint16_t v;
    return (modbus_read_registers(ctx, wire_addr, 1, &v) == 1) ? v : dflt;
}

/* Best-effort telemetry: Component Test diag regs, fan_auto, and fw_version
 * are optional. A failure here (unbound on old firmware, or a transient)
 * leaves the field at its default and never forces a reconnect. */
static void modbus_read_besteffort(telemetry_t *t)
{
    t->diag_mode    = (uint8_t)  modbus_read_reg_besteffort(g_modbus, REG_DIAG_MODE,   0);
    t->diag_outputs =            modbus_read_reg_besteffort(g_modbus, REG_DIAG_STATUS, 0);
    t->fan_auto     = modbus_read_reg_besteffort(g_modbus, REG_FAN_AUTO, 0) ? true : false;
    t->fw_version   =            modbus_read_reg_besteffort(g_modbus, REG_FW_VERSION,  0);
}

/* ── JSON payload builders ───────────────────────────────────────────────── */
static char *build_telemetry_json(const telemetry_t *t)
{
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "unit",             g_unit_serial);
    cJSON_AddNumberToObject(root, "ts",               (double)t->ts_ms);

    /* live sensors */
    cJSON_AddNumberToObject(root, "cabin_temp_f",     t->cabin_temp_f);
    cJSON_AddNumberToObject(root, "ext_temp_f",       t->ext_temp_f);
    cJSON_AddNumberToObject(root, "batt_v",           t->batt_v);
    cJSON_AddNumberToObject(root, "rpm",              t->rpm);
    cJSON_AddBoolToObject  (root, "oil_ok",           t->oil_ok);
    cJSON_AddBoolToObject  (root, "ignition",         t->ignition);

    /* mode + status (string label + raw enum) */
    cJSON_AddStringToObject(root, "mode",             mode_name(t->mode));
    cJSON_AddNumberToObject(root, "mode_n",           t->mode);
    cJSON_AddStringToObject(root, "engine_status",    status_name(t->engine_status));
    cJSON_AddNumberToObject(root, "engine_status_n",  t->engine_status);
    cJSON_AddStringToObject(root, "control_status",   status_name(t->control_status));
    cJSON_AddNumberToObject(root, "control_status_n", t->control_status);
    cJSON_AddStringToObject(root, "error",            error_name(t->error));
    cJSON_AddNumberToObject(root, "error_n",          t->error);
    cJSON_AddStringToObject(root, "oil_change",       oil_change_name(t->oil_change));
    cJSON_AddNumberToObject(root, "oil_change_n",     t->oil_change);

    /* runtime hours + setpoints */
    cJSON_AddNumberToObject(root, "engine_hrs",       t->engine_hrs);
    cJSON_AddNumberToObject(root, "oil_hrs",          t->oil_hrs);
    cJSON_AddNumberToObject(root, "machine_hrs",      t->machine_hrs);
    cJSON_AddNumberToObject(root, "clmt_setpoint_f",  t->clmt_set_f);
    cJSON_AddNumberToObject(root, "batt_setpoint_v",  t->batt_set_v);
    cJSON_AddNumberToObject(root, "fan_speed",        t->fan_speed);
    cJSON_AddBoolToObject  (root, "fan_auto",         t->fan_auto);
    cJSON_AddBoolToObject  (root, "diag_active",  t->diag_mode != 0);
    cJSON_AddNumberToObject(root, "diag_outputs", t->diag_outputs);
    cJSON_AddNumberToObject(root, "apu_fw_version", t->fw_version);
    cJSON_AddStringToObject(root, "stm32_update_status", stu_status_str(stm32_flash_status()));
    cJSON_AddNumberToObject(root, "stm32_update_pct", stm32_flash_status_pct());

    char *json = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return json;
}

static char *build_fault_json(const telemetry_t *t)
{
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "unit",    g_unit_serial);
    cJSON_AddNumberToObject(root, "ts",      (double)t->ts_ms);
    cJSON_AddStringToObject(root, "error",   error_name(t->error));
    cJSON_AddNumberToObject(root, "error_n", t->error);
    cJSON_AddStringToObject(root, "status",  status_name(t->control_status));

    char *json = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return json;
}

/* ── Live snapshot for the local display ─────────────────────────────────────
 * Write the latest telemetry JSON to LATEST_JSON_PATH atomically (temp + rename)
 * every cycle, whether or not it was published to MQTT. gobi-ui reads this file
 * so the on-screen values are live even while the device is online (the SQLite
 * buffer only holds rows when offline). Best-effort: a failed write never
 * disrupts telemetry. */
static void write_latest_snapshot(const char *payload)
{
    char tmp[80];
    snprintf(tmp, sizeof(tmp), "%s.tmp", LATEST_JSON_PATH);
    FILE *f = fopen(tmp, "w");
    if (!f) return;
    fputs(payload, f);
    fclose(f);
    if (rename(tmp, LATEST_JSON_PATH) != 0)
        unlink(tmp);
}

/* ── Local control channel (gobi-ui -> Modbus writes) ────────────────────────
 * Apply any command the touchscreen dropped at COMMAND_JSON_PATH, then remove
 * it. Called from the telemetry thread so the libmodbus context is never
 * touched concurrently. Register numbers are 1-based; the wire address is
 * (reg - 1). Best-effort: a bad file or a failed write is logged and the file
 * removed so it can't wedge the queue. */
static void mb_write_reg(int reg1based, int value, const char *what)
{
    if (modbus_write_register(g_modbus, reg1based - 1, value) == 1)
        syslog(LOG_INFO, "control: %s -> reg %d = %d", what, reg1based, value);
    else
        syslog(LOG_WARNING, "control: %s write reg %d failed: %s",
               what, reg1based, modbus_strerror(errno));
}

static void apply_command_file(void)
{
    FILE *f = fopen(COMMAND_JSON_PATH, "r");
    if (!f) return;   /* no pending command (the common case) */

    char buf[256];
    size_t n = fread(buf, 1, sizeof(buf) - 1, f);
    fclose(f);
    unlink(COMMAND_JSON_PATH);          /* consume it regardless of outcome */
    if (n == 0) return;
    buf[n] = '\0';

    cJSON *root = cJSON_Parse(buf);
    if (!root) {
        syslog(LOG_WARNING, "control: bad command JSON, ignoring: %s", buf);
        return;
    }

    /* mode: off|climate|battery -> reg 10 = 0|1|2 */
    const cJSON *mode = cJSON_GetObjectItemCaseSensitive(root, "mode");
    if (cJSON_IsString(mode) && mode->valuestring) {
        int v = -1;
        if      (strcmp(mode->valuestring, "off")     == 0) v = 0;
        else if (strcmp(mode->valuestring, "climate") == 0) v = 1;
        else if (strcmp(mode->valuestring, "battery") == 0) v = 2;
        if (v >= 0) mb_write_reg(10, v, "mode");
        else syslog(LOG_WARNING, "control: unknown mode '%s'", mode->valuestring);
    }

    /* setpoint_f -> reg 14 (climate temp, degF) */
    const cJSON *sp = cJSON_GetObjectItemCaseSensitive(root, "setpoint_f");
    if (cJSON_IsNumber(sp))
        mb_write_reg(14, (int)sp->valuedouble, "setpoint");

    /* fan percent 0..100 (0 = off) -> reg 12 (evap fan speed) */
    const cJSON *fan = cJSON_GetObjectItemCaseSensitive(root, "fan");
    if (cJSON_IsNumber(fan)) {
        int v = (int)fan->valuedouble;
        if (v >= 0 && v <= 100) mb_write_reg(12, v, "fan");
    }

    /* fan_auto: 0|1 -> reg 9 (auto-fan flag) */
    const cJSON *fan_auto = cJSON_GetObjectItemCaseSensitive(root, "fan_auto");
    if (cJSON_IsNumber(fan_auto)) {
        int v = fan_auto->valueint;
        if (v == 0 || v == 1) mb_write_reg(9, v, "fan_auto");
    }

    /* batt_setpoint centivolts (10.0-15.0 V) -> reg 13 (battery auto-charge
     * threshold; firmware auto-starts the APU to charge below this) */
    const cJSON *bsp = cJSON_GetObjectItemCaseSensitive(root, "batt_setpoint");
    if (cJSON_IsNumber(bsp)) {
        int v = (int)bsp->valuedouble;
        if (v >= 1000 && v <= 1500) mb_write_reg(13, v, "batt_setpoint");
    }

    /* reset_oil -> zero engine-oil hours (reg 20) + oil-change state (reg 18) */
    const cJSON *ro = cJSON_GetObjectItemCaseSensitive(root, "reset_oil");
    if (cJSON_IsTrue(ro)) {
        mb_write_reg(20, 0, "reset_oil_hours");
        mb_write_reg(18, 0, "reset_oil_state");
    }

    /* diag_mode: 0|1 -> reg 49 (enter/exit Component Test) */
    const cJSON *dmode = cJSON_GetObjectItemCaseSensitive(root, "diag_mode");
    if (cJSON_IsNumber(dmode)) {
        int v = (int)dmode->valuedouble;
        if (v == 0 || v == 1) mb_write_reg(49, v, "diag_mode");
    }

    /* diag_out: (index<<8)|state -> reg 50 (actuate one output) */
    const cJSON *dout = cJSON_GetObjectItemCaseSensitive(root, "diag_out");
    if (cJSON_IsNumber(dout)) {
        int v   = (int)dout->valuedouble;
        int idx = (v >> 8) & 0xFF;
        int st  = v & 0xFF;
        if (idx <= 6 && st <= 1) mb_write_reg(50, v, "diag_out");
        else syslog(LOG_WARNING, "control: bad diag_out 0x%04x", v);
    }

    cJSON_Delete(root);
}

/* ── Publish or buffer ───────────────────────────────────────────────────── */
static void publish_or_buffer(const char *topic, const char *table,
                               uint64_t ts_ms, const char *payload)
{
    if (g_mqtt_connected) {
        int rc = mosquitto_publish(g_mosq, NULL, topic,
                                   (int)strlen(payload), payload,
                                   MQTT_QOS, false);
        if (rc == MOSQ_ERR_SUCCESS) return;
        syslog(LOG_WARNING, "publish failed (%d) — buffering", rc);
    }
    if (db_store(table, ts_ms, payload) != 0)
        syslog(LOG_ERR, "db_store failed for %s", table);
}

/* ── Main ────────────────────────────────────────────────────────────────── */
int main(void)
{
    openlog("gobi-agent", LOG_PID | LOG_CONS, LOG_DAEMON);
    syslog(LOG_INFO, "gobi-agent starting (fw=%s)", FIRMWARE_VERSION);

    signal(SIGTERM, handle_signal);
    signal(SIGINT,  handle_signal);
    signal(SIGCHLD, SIG_IGN);   /* auto-reap OTA child processes */

    /* ── 1. Read unit serial ─────────────────────────────────────────────── */
    if (read_unit_serial(g_unit_serial, sizeof(g_unit_serial)) != 0)
        return EXIT_FAILURE;
    syslog(LOG_INFO, "Unit: %s", g_unit_serial);

    /* Build MQTT topic strings */
    snprintf(g_topic_telemetry, sizeof(g_topic_telemetry),
             "ecofleet/%s/telemetry", g_unit_serial);
    snprintf(g_topic_faults, sizeof(g_topic_faults),
             "ecofleet/%s/faults", g_unit_serial);

    /* ── 2. Shadow init ──────────────────────────────────────────────────── */
    if (shadow_init(g_unit_serial, FIRMWARE_VERSION, on_shadow_config, NULL) != 0)
        syslog(LOG_ERR, "shadow_init failed — continuing without shadow support");

    /* ── 3. SQLite ───────────────────────────────────────────────────────── */
    if (db_init() != 0)
        return EXIT_FAILURE;

    /* ── 4. Modbus ───────────────────────────────────────────────────────── */
    g_modbus = modbus_new_rtu(g_modbus_device, MODBUS_BAUD,
                              MODBUS_PARITY, MODBUS_DATA_BITS, MODBUS_STOP_BITS);
    if (!g_modbus) {
        syslog(LOG_ERR, "modbus_new_rtu: %s", modbus_strerror(errno));
        return EXIT_FAILURE;
    }
    modbus_set_slave(g_modbus, MODBUS_SLAVE_ID);
    struct timeval tv = { .tv_sec = MODBUS_TIMEOUT_S, .tv_usec = 0 };
    modbus_set_response_timeout(g_modbus, tv.tv_sec, tv.tv_usec);

    if (modbus_connect(g_modbus) != 0) {
        syslog(LOG_ERR, "modbus_connect %s: %s",
               g_modbus_device, modbus_strerror(errno));
        /* Non-fatal: we'll retry in the loop */
    }

    stm32_flash_task_init(g_modbus);

    /* ── 5. Mosquitto ────────────────────────────────────────────────────── */
    mosquitto_lib_init();

    char client_id[96];
    snprintf(client_id, sizeof(client_id), "gobi-apu-%s", g_unit_serial);

    g_mosq = mosquitto_new(client_id, true, NULL);
    if (!g_mosq) {
        syslog(LOG_ERR, "mosquitto_new failed");
        return EXIT_FAILURE;
    }

    mosquitto_connect_callback_set(g_mosq,    on_connect);
    mosquitto_disconnect_callback_set(g_mosq, on_disconnect);
    mosquitto_message_callback_set(g_mosq,    on_message);
    mosquitto_log_callback_set(g_mosq,        on_log);

    /* TLS */
    int rc = mosquitto_tls_set(g_mosq,
                               TLS_CA_FILE, NULL,
                               TLS_CERT_FILE, TLS_KEY_FILE, NULL);
    if (rc != MOSQ_ERR_SUCCESS) {
        syslog(LOG_ERR, "mosquitto_tls_set: %d", rc);
        return EXIT_FAILURE;
    }
    mosquitto_tls_opts_set(g_mosq, 1, "tlsv1.2", NULL);

    /* Connect (non-blocking — on_connect fires when ready) */
    rc = mosquitto_connect_async(g_mosq, MQTT_ENDPOINT, MQTT_PORT, MQTT_KEEPALIVE_S);
    if (rc != MOSQ_ERR_SUCCESS)
        syslog(LOG_WARNING, "Initial MQTT connect failed (%d) — will retry", rc);

    mosquitto_loop_start(g_mosq);   /* background thread handles reconnects */

    /* ── 6. Telemetry loop ───────────────────────────────────────────────── */
    uint8_t prev_error = 0;   /* control_error_t; 0 = ERR_NONE */

    while (g_running) {
        /* Read poll interval from shadow config (updated live by delta msgs) */
        const shadow_config_t *scfg = shadow_get_config();
        int poll_s = scfg->poll_interval_s;

        telemetry_t t = {0};
        if (modbus_read_telemetry(&t) == 0) {
            modbus_read_besteffort(&t);
            stm32_flash_tick(t.fw_version, t.mode, t.engine_status);

            /* (Touchscreen commands are applied in the 1 Hz wait loop below, in
             * this same thread — the libmodbus context is never touched
             * concurrently. Remote shadow commands remain unhandled — see
             * on_shadow_config().) */

            /* ── Telemetry publish ───────────────────────────────────────── */
            char *telem_json = build_telemetry_json(&t);
            if (telem_json) {
                write_latest_snapshot(telem_json);   /* live source for gobi-ui */
                publish_or_buffer(g_topic_telemetry, "telemetry", t.ts_ms, telem_json);
                free(telem_json);
            }

            /* ── Fault publish (on every change, including clear) ────────── */
            /* Publishing the transition back to "none" lets the cloud resolve
             * open faults and stop alerting; without it a cleared fault looks
             * stuck until the next change. See cloud/lambda/fault/faults.js. */
            if (t.error != prev_error) {
                char *fault_json = build_fault_json(&t);
                if (fault_json) {
                    publish_or_buffer(g_topic_faults, "faults", t.ts_ms, fault_json);
                    free(fault_json);
                }
                if (t.error != 0)
                    syslog(LOG_WARNING, "APU error: %s (%u)", error_name(t.error), t.error);
                else
                    syslog(LOG_INFO, "APU error cleared");
                prev_error = t.error;
            }

            /* ── Shadow reported update (existing schema, best-effort) ────── */
            /* shadow_reported_t is left unchanged in this pass; feed it the
             * closest available values from the EF-G0B1R map. */
            shadow_reported_t srep = {
                .dc_v         = t.batt_v,   /* this APU's DC rail is the battery */
                .batt_soc     = 0,          /* SOC not provided by EF-G0B1R      */
                .last_seen_ts = t.ts_ms,
            };
            strncpy(srep.apu_state, status_name(t.control_status), sizeof(srep.apu_state) - 1);
            snprintf(srep.fault, sizeof(srep.fault), "0x%04X", t.error);
            shadow_publish_reported(g_mosq, &srep);

        } else {
            /* Modbus read failed — try reconnecting the serial port */
            syslog(LOG_WARNING, "Modbus read failed — reconnecting...");
            modbus_close(g_modbus);
            sleep(2);
            modbus_connect(g_modbus);
        }

        /* Flush offline buffer in small batches each cycle */
        db_flush("telemetry", g_topic_telemetry);
        db_flush("faults",    g_topic_faults);

        /* Wait out the poll interval, but check the touchscreen command file
         * every second so a button press lands within ~1 s instead of waiting
         * a whole telemetry cycle. */
        for (int slept = 0; slept < poll_s && g_running; slept++) {
            sleep(1);
            apply_command_file();
        }
    }

    /* ── 7. Cleanup ──────────────────────────────────────────────────────── */
    syslog(LOG_INFO, "gobi-agent shutting down");
    shadow_cleanup();
    mosquitto_loop_stop(g_mosq, true);
    mosquitto_destroy(g_mosq);
    mosquitto_lib_cleanup();
    modbus_close(g_modbus);
    modbus_free(g_modbus);
    sqlite3_close(g_db);
    closelog();

    return EXIT_SUCCESS;
}
