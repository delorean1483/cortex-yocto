#include "heater_host.h"

#include <cjson/cJSON.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

static bool level_ok(int v)    { return v >= 1 && v <= 10; }
static bool setpoint_ok(int v) { return v >= HEATER_SETPOINT_C_MIN && v <= HEATER_SETPOINT_C_MAX; }
static bool mode_ok(int v)     { return v == HEATER_MODE_TEMPERATURE || v == HEATER_MODE_POWER; }

static bool any_known(const heater_host_settings_t *s)
{
    return level_ok(s->level) || setpoint_ok(s->setpoint_c) || mode_ok(s->mode);
}

void heater_host_init(heater_host_t *h, const heater_host_settings_t *loaded)
{
    memset(h, 0, sizeof(*h));
    h->want.mode = -1;
    if (loaded) {
        if (level_ok(loaded->level))         h->want.level = loaded->level;
        if (setpoint_ok(loaded->setpoint_c)) h->want.setpoint_c = loaded->setpoint_c;
        if (mode_ok(loaded->mode))           h->want.mode = loaded->mode;
    }
    h->startup = any_known(&h->want);
    h->last_why = HEATER_HOST_NONE;
}

bool heater_host_adopt(heater_host_t *h, const heater_host_readback_t *rb)
{
    bool changed = false;
    if (!level_ok(h->want.level) && level_ok(rb->level)) {
        h->want.level = rb->level; changed = true;
    }
    if (!setpoint_ok(h->want.setpoint_c) && setpoint_ok(rb->setpoint_c)) {
        h->want.setpoint_c = rb->setpoint_c; changed = true;
    }
    /* Mode only from a trusted read on a heater that offers it. */
    if (!mode_ok(h->want.mode) && (rb->caps & HEATER_CAP_MODE) && mode_ok(rb->mode)) {
        h->want.mode = rb->mode; changed = true;
    }
    return changed;
}

bool heater_host_note_write(heater_host_t *h, int reg, int value, int result)
{
    if (result != HEATER_WR_OK) return false;
    int *slot = NULL;
    if (reg == 54 && level_ok(value))                    slot = &h->want.level;
    else if (reg == 69 && setpoint_ok(value))            slot = &h->want.setpoint_c;
    else if (reg == HEATER_REG_MODE && mode_ok(value))   slot = &h->want.mode;
    if (!slot || *slot == value) return false;
    *slot = value;
    return true;
}

void heater_host_note_link_down(heater_host_t *h)
{
    h->link_down = true;
}

int heater_host_plan(heater_host_t *h, const heater_host_readback_t *rb,
                     bool cmd_pending, uint64_t now_ms,
                     heater_write_t out[HEATER_HOST_MAX_WRITES],
                     heater_host_reason_t *why)
{
    *why = HEATER_HOST_NONE;
    if (!any_known(&h->want)) return 0;

    bool cap = (rb->caps & HEATER_CAP_MODE) != 0;
    bool mismatch = (level_ok(h->want.level) && rb->level != h->want.level) ||
                    (setpoint_ok(h->want.setpoint_c) && rb->setpoint_c != h->want.setpoint_c);
    if (!mismatch && h->last_why == HEATER_HOST_MISMATCH)
        h->last_why = HEATER_HOST_NONE;   /* the last one fixed it */

    /* Applied mode (trusted readback only) differing from the remembered one.
     * It lags any mode write by a settings round trip (~5 s), and a pending
     * command may be changing it, so only a difference that lasts counts. */
    bool off = cap && mode_ok(h->want.mode) && mode_ok(rb->mode) &&
               rb->mode != h->want.mode && !cmd_pending;
    if (!off) {
        h->mode_off = false;
        if (h->last_why == HEATER_HOST_MODE_LOST) h->last_why = HEATER_HOST_NONE;
    } else if (!h->mode_off) {
        h->mode_off = true;
        h->mode_off_since_ms = now_ms;
    }
    bool mode_lost = h->mode_off && now_ms - h->mode_off_since_ms >= HEATER_HOST_MODE_HOLD_MS;

    heater_host_reason_t r =
        h->startup   ? HEATER_HOST_STARTUP  :
        h->link_down ? HEATER_HOST_LINK     :
        mismatch     ? HEATER_HOST_MISMATCH :
        mode_lost    ? HEATER_HOST_MODE_LOST :
        h->retry     ? HEATER_HOST_RETRY    :
        (h->mode_owed && cap && mode_ok(h->want.mode)) ? HEATER_HOST_MODE :
                       HEATER_HOST_NONE;
    if (r == HEATER_HOST_NONE) return 0;

    /* Triggers stay armed through every hold below. */
    if (cmd_pending) return 0;                      /* the command writes first */
    if (now_ms < h->backoff_until_ms) return 0;
    if (h->ever) {
        bool again = (r == HEATER_HOST_MISMATCH || r == HEATER_HOST_MODE_LOST) &&
                     h->last_why == (int)r;
        uint64_t gap = again ? HEATER_HOST_BACKOFF_MS       /* the last one didn't fix it */
                             : HEATER_HOST_MIN_GAP_MS;
        if (now_ms - h->last_ms < gap) return 0;
    }

    int n = 0;
    if (level_ok(h->want.level)) {
        out[n].reg = 54; out[n].value = h->want.level; out[n].what = "heater_level(host)"; n++;
    }
    if (setpoint_ok(h->want.setpoint_c)) {
        out[n].reg = 69; out[n].value = h->want.setpoint_c; out[n].what = "heater_setpoint_c(host)"; n++;
    }
    if (mode_ok(h->want.mode) && cap) {
        out[n].reg = HEATER_REG_MODE; out[n].value = h->want.mode; out[n].what = "heater_mode(host)"; n++;
    }
    h->mode_owed = mode_ok(h->want.mode) && !cap;
    h->startup = h->link_down = h->retry = false;
    if (n == 0) return 0;                           /* only a mode, not selectable now */

    h->ever = true;
    h->last_ms = now_ms;
    if (h->mode_off) h->mode_off_since_ms = now_ms;   /* give this write its hold */
    h->last_why = r;
    *why = r;
    return n;
}

void heater_host_done(heater_host_t *h, const heater_write_t *w,
                      const int *results, int n, uint64_t now_ms)
{
    (void)w;
    for (int i = 0; i < n; i++) {
        if (results[i] == HEATER_WR_REFUSED) {
            h->retry = true;
            h->backoff_until_ms = now_ms + HEATER_HOST_BACKOFF_MS;
        } else if (results[i] != HEATER_WR_OK) {
            h->retry = true;                        /* no answer / not tried */
        }
    }
}

const char *heater_host_reason_name(heater_host_reason_t why)
{
    switch (why) {
    case HEATER_HOST_STARTUP:  return "agent start";
    case HEATER_HOST_LINK:     return "APU link back";
    case HEATER_HOST_MISMATCH: return "G0B1 lost settings";
    case HEATER_HOST_MODE_LOST: return "mode not applied";
    case HEATER_HOST_RETRY:    return "retry";
    case HEATER_HOST_MODE:     return "mode selectable";
    default:                   return "none";
    }
}

int heater_host_format(const heater_host_settings_t *s, char *buf, size_t len)
{
    char lv[16] = "", sp[24] = "", md[16] = "";
    bool first = true;
    if (level_ok(s->level)) {
        snprintf(lv, sizeof lv, "\"level\":%d", s->level); first = false;
    }
    if (setpoint_ok(s->setpoint_c)) {
        snprintf(sp, sizeof sp, "%s\"setpoint_c\":%d", first ? "" : ",", s->setpoint_c); first = false;
    }
    if (mode_ok(s->mode))
        snprintf(md, sizeof md, "%s\"mode\":%d", first ? "" : ",", s->mode);
    int n = snprintf(buf, len, "{%s%s%s}\n", lv, sp, md);
    return (n < 0 || (size_t)n >= len) ? -1 : n;
}

bool heater_host_parse(const char *json, heater_host_settings_t *out)
{
    out->level = 0; out->setpoint_c = 0; out->mode = -1;
    cJSON *root = json ? cJSON_Parse(json) : NULL;
    if (!cJSON_IsObject(root)) { cJSON_Delete(root); return false; }
    const cJSON *lv = cJSON_GetObjectItemCaseSensitive(root, "level");
    const cJSON *sp = cJSON_GetObjectItemCaseSensitive(root, "setpoint_c");
    const cJSON *md = cJSON_GetObjectItemCaseSensitive(root, "mode");
    if (cJSON_IsNumber(lv) && level_ok((int)lv->valuedouble))    out->level = (int)lv->valuedouble;
    if (cJSON_IsNumber(sp) && setpoint_ok((int)sp->valuedouble)) out->setpoint_c = (int)sp->valuedouble;
    if (cJSON_IsNumber(md) && mode_ok((int)md->valuedouble))     out->mode = (int)md->valuedouble;
    cJSON_Delete(root);
    return any_known(out);
}

bool heater_host_load(const char *path, heater_host_settings_t *out)
{
    char buf[256];
    FILE *f = fopen(path, "r");
    if (!f) { heater_host_parse(NULL, out); return false; }
    size_t n = fread(buf, 1, sizeof buf - 1, f);
    fclose(f);
    buf[n] = '\0';
    return heater_host_parse(buf, out);
}

int heater_host_save(const char *path, const heater_host_settings_t *s)
{
    char body[96];
    if (heater_host_format(s, body, sizeof body) < 0) return -1;
    char tmp[512];
    snprintf(tmp, sizeof(tmp), "%s.tmp", path);
    FILE *f = fopen(tmp, "w");
    if (!f) return -1;
    /* fsync: trucks lose power abruptly */
    int ok = fputs(body, f) != EOF && fflush(f) == 0 && fsync(fileno(f)) == 0;
    if (fclose(f) != 0) ok = 0;
    if (!ok || rename(tmp, path) != 0) { unlink(tmp); return -1; }
    return 0;
}
