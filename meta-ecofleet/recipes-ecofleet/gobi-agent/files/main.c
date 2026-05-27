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

#include <modbus.h>
#include <mosquitto.h>
#include <sqlite3.h>
#include <cjson/cJSON.h>

/* ── APU state names ─────────────────────────────────────────────────────── */
static const char *apu_state_name(uint16_t v)
{
    switch (v) {
        case 0: return "off";
        case 1: return "starting";
        case 2: return "running";
        case 3: return "stopping";
        case 4: return "fault";
        default: return "unknown";
    }
}

/* ── Telemetry struct ────────────────────────────────────────────────────── */
typedef struct {
    double   dc_v, dc_a, batt_v, batt_soc, batt_t;
    double   oil_psi, coolant_t;
    uint32_t runtime_hrs, watts, rpm;
    uint16_t fault_word;
    char     apu_state[16];
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

/* ── Shadow config callback ──────────────────────────────────────────────── */
static void on_shadow_config(const shadow_config_t *cfg, void *userdata)
{
    (void)userdata;
    syslog(LOG_INFO,
           "shadow config: poll=%ds mode=%s fw_target=%s reboot=%d",
           cfg->poll_interval_s, cfg->report_mode,
           cfg->firmware_target, cfg->reboot_requested);

    if (cfg->reboot_requested) {
        syslog(LOG_WARNING, "shadow: reboot requested — rebooting in 3 s");
        sleep(3);
        system("systemctl reboot");
    }
    if (cfg->firmware_target[0] != '\0') {
        /* TODO: trigger OTA. For now just log. */
        syslog(LOG_INFO, "shadow: firmware_target=%s (OTA not yet implemented)",
               cfg->firmware_target);
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
static int modbus_read_telemetry(telemetry_t *t)
{
    uint16_t regs[REG_COUNT];
    int rc = modbus_read_registers(g_modbus, 0, REG_COUNT, regs);
    if (rc != REG_COUNT) {
        syslog(LOG_WARNING, "modbus_read_registers: only got %d/%d regs: %s",
               rc, REG_COUNT, modbus_strerror(errno));
        return -1;
    }

    t->dc_v        = regs[REG_DC_V]     / 10.0;
    t->dc_a        = regs[REG_DC_A]     / 10.0;
    t->batt_v      = regs[REG_BATT_V]   / 10.0;
    t->batt_soc    = regs[REG_BATT_SOC];
    t->batt_t      = regs[REG_BATT_T]   / 10.0;
    t->runtime_hrs = ((uint32_t)regs[REG_RUNTIME_HI] << 16) | regs[REG_RUNTIME_LO];
    t->fault_word  = regs[REG_FAULT];
    t->watts       = ((uint32_t)regs[REG_WATTS_HI]   << 16) | regs[REG_WATTS_LO];
    t->rpm         = regs[REG_RPM];
    t->oil_psi     = regs[REG_OIL_PSI]     / 10.0;
    t->coolant_t   = regs[REG_COOLANT_T]   / 10.0;
    strncpy(t->apu_state, apu_state_name(regs[REG_APU_STATE]),
            sizeof(t->apu_state) - 1);
    t->ts_ms = (uint64_t)time(NULL) * 1000ULL;

    return 0;
}

/* ── JSON payload builders ───────────────────────────────────────────────── */
static char *build_telemetry_json(const telemetry_t *t)
{
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "unit",        g_unit_serial);
    cJSON_AddNumberToObject(root, "ts",          (double)t->ts_ms);
    cJSON_AddNumberToObject(root, "dc_v",        t->dc_v);
    cJSON_AddNumberToObject(root, "dc_a",        t->dc_a);
    cJSON_AddNumberToObject(root, "batt_v",      t->batt_v);
    cJSON_AddNumberToObject(root, "batt_soc",    t->batt_soc);
    cJSON_AddNumberToObject(root, "batt_t",      t->batt_t);
    cJSON_AddStringToObject(root, "apu_state",   t->apu_state);
    cJSON_AddNumberToObject(root, "runtime_hrs", t->runtime_hrs);
    cJSON_AddNumberToObject(root, "watts",       t->watts);
    cJSON_AddNumberToObject(root, "rpm",         t->rpm);
    cJSON_AddNumberToObject(root, "oil_psi",     t->oil_psi);
    cJSON_AddNumberToObject(root, "coolant_t",   t->coolant_t);

    char fault_hex[10];
    snprintf(fault_hex, sizeof(fault_hex), "0x%04X", t->fault_word);
    cJSON_AddStringToObject(root, "fault", fault_hex);

    char *json = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return json;
}

static char *build_fault_json(const telemetry_t *t)
{
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "unit",  g_unit_serial);
    cJSON_AddNumberToObject(root, "ts",    (double)t->ts_ms);

    char fault_hex[10];
    snprintf(fault_hex, sizeof(fault_hex), "0x%04X", t->fault_word);
    cJSON_AddStringToObject(root, "fault", fault_hex);
    cJSON_AddStringToObject(root, "state", t->apu_state);

    char *json = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return json;
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
    uint16_t prev_fault = 0;

    while (g_running) {
        /* Read poll interval from shadow config (updated live by delta msgs) */
        const shadow_config_t *scfg = shadow_get_config();
        int poll_s = scfg->poll_interval_s;

        telemetry_t t = {0};
        if (modbus_read_telemetry(&t) == 0) {

            /* ── Telemetry publish ───────────────────────────────────────── */
            char *telem_json = build_telemetry_json(&t);
            if (telem_json) {
                publish_or_buffer(g_topic_telemetry, "telemetry", t.ts_ms, telem_json);
                free(telem_json);
            }

            /* ── Fault publish (only on change) ─────────────────────────── */
            if (t.fault_word != prev_fault) {
                if (t.fault_word != 0) {
                    char *fault_json = build_fault_json(&t);
                    if (fault_json) {
                        publish_or_buffer(g_topic_faults, "faults", t.ts_ms, fault_json);
                        free(fault_json);
                    }
                    syslog(LOG_WARNING, "Fault detected: 0x%04X", t.fault_word);
                } else {
                    syslog(LOG_INFO, "Fault cleared");
                }
                prev_fault = t.fault_word;
            }

            /* ── Shadow reported update ──────────────────────────────────── */
            shadow_reported_t srep = {
                .dc_v         = t.dc_v,
                .batt_soc     = t.batt_soc,
                .last_seen_ts = t.ts_ms,
            };
            strncpy(srep.apu_state, t.apu_state, sizeof(srep.apu_state) - 1);
            snprintf(srep.fault, sizeof(srep.fault), "0x%04X", t.fault_word);
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

        sleep((unsigned int)poll_s);
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
