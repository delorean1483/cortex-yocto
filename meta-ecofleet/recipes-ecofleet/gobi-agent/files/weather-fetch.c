/* weather-fetch.c — periodic forecast fetcher for the EcoFleet touchscreen.
 *
 * Runs OUT of band from the realtime telemetry agent (its own systemd timer),
 * so a slow or failing HTTP call can never stall the Modbus/MQTT loop.
 *
 * Flow: read [weather] lat/lon from gobi-agent.conf -> GET Open-Meteo daily
 * forecast (°F) -> transform to the compact schema (weather.c) -> write
 * /var/lib/ecofleet/weather.json atomically. gobi-ui polls that file.
 *
 * The feature is INERT until a location is configured: with no lat/lon the
 * fetcher logs and exits 0 without touching weather.json, so the UI simply
 * hides the strip. This is the swap point for modem GNSS later — feed the
 * live position in place of the configured lat/lon and nothing else changes.
 *
 * On any fetch/parse error the existing weather.json is left untouched (the UI
 * greys it out once it ages past its staleness window).
 */
#include "weather.h"

#include <curl/curl.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <syslog.h>
#include <time.h>
#include <unistd.h>

#define AGENT_CONFIG_FILE  "/etc/ecofleet/gobi-agent.conf"
#define WEATHER_JSON_PATH  "/var/lib/ecofleet/weather.json"
#define FORECAST_DAYS      4
#define HTTP_TIMEOUT_S     15L
#define API_HOST           "https://api.open-meteo.com/v1/forecast"
/* Keyless IP geolocation. ip-api.com's free tier is HTTP-only; the data is
 * non-sensitive (coarse coordinates) and the configured lat/lon is the fallback
 * if this is tampered with or unreachable. */
#define GEO_URL            "http://ip-api.com/json/?fields=status,lat,lon,city"

/* ── Config ──────────────────────────────────────────────────────────────── */
typedef struct {
    int    have_loc;
    double lat;
    double lon;
    char   label[64];
} weather_cfg_t;

static char *trim(char *s)
{
    while (*s == ' ' || *s == '\t') s++;
    char *e = s + strlen(s);
    while (e > s && (e[-1] == ' ' || e[-1] == '\t' || e[-1] == '\r' || e[-1] == '\n'))
        *--e = '\0';
    return s;
}

/* Parse the [weather] section of the INI-style agent config. Absent keys leave
 * cfg untouched. Missing file is not an error (feature stays inert). */
static void read_config(weather_cfg_t *cfg)
{
    FILE *f = fopen(AGENT_CONFIG_FILE, "r");
    if (!f) return;

    char line[256];
    int in_weather = 0;
    int have_lat = 0, have_lon = 0;

    while (fgets(line, sizeof(line), f)) {
        char *s = trim(line);
        if (s[0] == '\0' || s[0] == '#' || s[0] == ';') continue;

        if (s[0] == '[') {
            in_weather = (strncmp(s, "[weather]", 9) == 0);
            continue;
        }
        if (!in_weather) continue;

        char *eq = strchr(s, '=');
        if (!eq) continue;
        *eq = '\0';
        char *key = trim(s);
        char *val = trim(eq + 1);

        if (strcmp(key, "lat") == 0) {
            char *end = NULL;
            double v = strtod(val, &end);
            if (end != val) { cfg->lat = v; have_lat = 1; }
        } else if (strcmp(key, "lon") == 0) {
            char *end = NULL;
            double v = strtod(val, &end);
            if (end != val) { cfg->lon = v; have_lon = 1; }
        } else if (strcmp(key, "label") == 0) {
            snprintf(cfg->label, sizeof(cfg->label), "%s", val);
        }
    }
    fclose(f);

    cfg->have_loc = have_lat && have_lon
                    && cfg->lat >= -90.0  && cfg->lat <= 90.0
                    && cfg->lon >= -180.0 && cfg->lon <= 180.0;
}

/* ── HTTP ────────────────────────────────────────────────────────────────── */
typedef struct { char *data; size_t len; } membuf_t;

static size_t on_data(char *ptr, size_t size, size_t nmemb, void *ud)
{
    size_t add = size * nmemb;
    membuf_t *m = ud;
    char *p = realloc(m->data, m->len + add + 1);
    if (!p) return 0;                 /* signals curl to abort */
    m->data = p;
    memcpy(m->data + m->len, ptr, add);
    m->len += add;
    m->data[m->len] = '\0';
    return add;
}

/* GET a URL. Returns a malloc'd body (caller frees) or NULL on any
 * transport/non-200 error. `what` names the endpoint for log messages. */
static char *http_get(const char *url, const char *what)
{
    CURL *c = curl_easy_init();
    if (!c) return NULL;

    membuf_t buf = { NULL, 0 };
    curl_easy_setopt(c, CURLOPT_URL, url);
    curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, on_data);
    curl_easy_setopt(c, CURLOPT_WRITEDATA, &buf);
    curl_easy_setopt(c, CURLOPT_TIMEOUT, HTTP_TIMEOUT_S);
    curl_easy_setopt(c, CURLOPT_CONNECTTIMEOUT, HTTP_TIMEOUT_S);
    curl_easy_setopt(c, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(c, CURLOPT_USERAGENT, "gobi-weather-fetch/1.0");
    curl_easy_setopt(c, CURLOPT_ACCEPT_ENCODING, "");   /* allow gzip */

    CURLcode rc = curl_easy_perform(c);
    long http = 0;
    curl_easy_getinfo(c, CURLINFO_RESPONSE_CODE, &http);
    curl_easy_cleanup(c);

    if (rc != CURLE_OK) {
        syslog(LOG_WARNING, "weather: %s fetch failed: %s", what, curl_easy_strerror(rc));
        free(buf.data);
        return NULL;
    }
    if (http != 200) {
        syslog(LOG_WARNING, "weather: %s HTTP %ld", what, http);
        free(buf.data);
        return NULL;
    }
    return buf.data;
}

/* Resolve the forecast location. Primary source is IP-based geolocation (so the
 * dashboard follows the device's network); the configured lat/lon is the
 * fallback when the lookup fails or is offline. On return, lat, lon and label
 * hold the location to use; returns 1 if a location was resolved, else 0. */
static int resolve_location(const weather_cfg_t *cfg,
                            double *lat, double *lon, char *label, size_t label_sz)
{
    int have = cfg->have_loc;
    if (have) {                       /* seed with configured fallback */
        *lat = cfg->lat;
        *lon = cfg->lon;
        snprintf(label, label_sz, "%s", cfg->label);
    }

    char *geo = http_get(GEO_URL, "ip-geo");
    if (geo) {
        double glat, glon;
        char gcity[64];
        if (geo_parse(geo, &glat, &glon, gcity, sizeof(gcity))) {
            *lat = glat;
            *lon = glon;
            snprintf(label, label_sz, "%s", gcity[0] ? gcity : cfg->label);
            have = 1;
            syslog(LOG_INFO, "weather: auto-location %.4f,%.4f (%s)",
                   glat, glon, label[0] ? label : "unnamed");
        } else {
            syslog(LOG_INFO, "weather: ip-geo response unusable — using configured location");
        }
        free(geo);
    } else {
        syslog(LOG_INFO, "weather: ip-geo unavailable — using configured location");
    }
    return have;
}

/* ── Atomic write (mirrors the agent's write_latest_snapshot) ────────────── */
static int write_atomic(const char *path, const char *payload)
{
    char tmp[300];
    snprintf(tmp, sizeof(tmp), "%s.tmp", path);
    FILE *f = fopen(tmp, "w");
    if (!f) return -1;
    if (fputs(payload, f) == EOF) { fclose(f); unlink(tmp); return -1; }
    if (fclose(f) != 0)           { unlink(tmp); return -1; }
    if (rename(tmp, path) != 0)   { unlink(tmp); return -1; }
    return 0;
}

int main(void)
{
    openlog("weather-fetch", LOG_PID, LOG_DAEMON);

    weather_cfg_t cfg = { 0, 0.0, 0.0, { 0 } };
    read_config(&cfg);

    curl_global_init(CURL_GLOBAL_DEFAULT);

    /* Location: IP geolocation first, configured lat/lon as fallback. */
    double lat = 0.0, lon = 0.0;
    char   label[64] = { 0 };
    int    have_loc = resolve_location(&cfg, &lat, &lon, label, sizeof(label));

    if (!have_loc) {
        /* No geolocation and nothing configured — nothing to fetch for. */
        syslog(LOG_INFO, "weather: no location (ip-geo failed, none configured) — skipping");
        curl_global_cleanup();
        closelog();
        return 0;   /* inert: leave any existing file, exit clean */
    }

    char url[512];
    snprintf(url, sizeof(url),
             "%s?latitude=%.5f&longitude=%.5f"
             "&daily=weather_code,temperature_2m_max,temperature_2m_min,"
             "precipitation_probability_max"
             "&temperature_unit=fahrenheit&timezone=auto&forecast_days=%d",
             API_HOST, lat, lon, FORECAST_DAYS);

    char *body = http_get(url, "open-meteo");
    curl_global_cleanup();

    if (!body) { closelog(); return 1; }   /* keep last good file */

    long long now_ms = (long long)time(NULL) * 1000LL;
    char *json = weather_build_json(body, label, now_ms, FORECAST_DAYS);
    free(body);

    if (!json) {
        syslog(LOG_WARNING, "weather: response did not parse into a forecast");
        closelog();
        return 1;
    }

    int rc = write_atomic(WEATHER_JSON_PATH, json);
    if (rc == 0)
        syslog(LOG_INFO, "weather: updated %s (%s)",
               WEATHER_JSON_PATH, label[0] ? label : "unnamed");
    else
        syslog(LOG_WARNING, "weather: could not write %s", WEATHER_JSON_PATH);

    free(json);
    closelog();
    return rc == 0 ? 0 : 1;
}
