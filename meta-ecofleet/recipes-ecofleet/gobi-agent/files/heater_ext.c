#include "heater_ext.h"
#include "heater_fields.h"   /* HEATER_FLAG_* (reg 64 bits) */
#include <stdio.h>

const char *heater_type_name(unsigned type)
{
    switch (type) {
    case 0: return "none";
    case 1: return "vevor";
    case 2: return "autoterm";
    default: return "unknown";
    }
}

const char *heater_phase_name(unsigned phase)
{
    static const char *const names[] = {
        "off", "detecting", "starting", "running", "stopping", "cooldown", "fault"
    };
    return (phase < sizeof(names) / sizeof(names[0])) ? names[phase] : "unknown";
}

const char *heater_mode_name(unsigned caps, int mode)
{
    if (!(caps & HEATER_CAP_MODE)) return NULL;
    if (mode == HEATER_MODE_TEMPERATURE) return "temperature";
    if (mode == HEATER_MODE_POWER) return "power";
    return NULL;
}

int heater_mode_next(int prev, unsigned l011_ver, unsigned l011_build,
                     unsigned flags, unsigned raw)
{
    if (l011_ver == 0 && l011_build == 0) return prev;   /* L011 not identified */
    if (flags & (HEATER_FLAG_COMMS_FAULT | HEATER_FLAG_MAP_MISMATCH |
                 HEATER_FLAG_MAP_UNREADABLE)) return prev;
    return (raw == HEATER_MODE_TEMPERATURE || raw == HEATER_MODE_POWER) ? (int)raw : -1;
}

const char *heater_control_name(unsigned caps, int mode)
{
    const char *m = heater_mode_name(caps, mode);
    if (m) return (mode == HEATER_MODE_POWER) ? "level" : "setpoint";
    return (caps & HEATER_CAP_SETPOINT) ? "setpoint" : "level";
}

/* n/d rounded half away from zero, for d > 0. */
static int div_round(int n, int d)
{
    return (n >= 0) ? (n + d / 2) / d : -((-n + d / 2) / d);
}

int heater_c_to_f(int c)
{
    return div_round(c * 9, 5) + 32;
}

int heater_f_to_c(int f)
{
    int c = div_round((f - 32) * 5, 9);
    if (c < HEATER_SETPOINT_C_MIN) c = HEATER_SETPOINT_C_MIN;
    if (c > HEATER_SETPOINT_C_MAX) c = HEATER_SETPOINT_C_MAX;
    return c;
}

void heater_vendor_state_str(unsigned v, char *buf, size_t len)
{
    if (!buf || len == 0) return;
    snprintf(buf, len, "%u.%u", (v >> 8) & 0xFFu, v & 0xFFu);
}

void heater_l011_fw_str(unsigned ver, unsigned build, char *buf, size_t len)
{
    if (!buf || len == 0) return;
    if (ver == 0 && build == 0) { buf[0] = '\0'; return; }
    snprintf(buf, len, "%u.%u.%u", (ver >> 8) & 0xFFu, ver & 0xFFu, build & 0xFFFFu);
}

const char *heater_l011_reject_name(unsigned code)
{
    switch (code) {
        case 0: return "none";
        case 1: return "phase_not_off";
        case 2: return "run_request_set";
        case 3: return "lamp_not_off";
        case 4: return "identity_mismatch";
        case 5: return "heater_mode_set";
        case 6: return "loader_error";
        default: return "unknown";
    }
}

bool heater_l011_probe_due(const heater_l011_probe_t *p, bool ext, uint16_t g0b1_fw)
{
    return ext && !(p->refused && p->refused_fw == g0b1_fw);
}

void heater_l011_probe_note(heater_l011_probe_t *p, bool refused, uint16_t g0b1_fw)
{
    p->refused = refused;
    p->refused_fw = refused ? g0b1_fw : 0;
}

bool heater_present_from(bool state_ok, bool type_ok, unsigned type)
{
    return state_ok && (!type_ok || type != 0);
}

int heater_plan_writes(int on, int level, int setpoint_f, bool clear_fault,
                       int mode, bool ext, heater_write_t out[HEATER_MAX_WRITES])
{
    int n = 0;
    if (ext && clear_fault) {
        out[n].reg = 75; out[n].value = HEATER_CMD_CLEAR_FAULT; out[n].what = "heater_clear_fault"; n++;
    }
    if (ext && (mode == HEATER_MODE_TEMPERATURE || mode == HEATER_MODE_POWER)) {
        out[n].reg = HEATER_REG_MODE; out[n].value = mode; out[n].what = "heater_mode"; n++;
    }
    if (ext && setpoint_f >= HEATER_SETPOINT_F_MIN && setpoint_f <= HEATER_SETPOINT_F_MAX) {
        out[n].reg = 69; out[n].value = heater_f_to_c(setpoint_f); out[n].what = "heater_setpoint_f"; n++;
    }
    if (level >= 1 && level <= 10) {
        out[n].reg = 54; out[n].value = level; out[n].what = "heater_level"; n++;
    }
    if (on == 0 || on == 1) {
        out[n].reg = 53; out[n].value = on; out[n].what = "heater_on"; n++;
    }
    return n;
}

bool heater_write_is_on(const heater_write_t *w)
{
    return w->reg == 53 && w->value == 1;
}

bool heater_cmd_settled(const heater_write_t *w, const int *results, int n)
{
    for (int i = 0; i < n; i++) {
        if (results[i] == HEATER_WR_SKIPPED) return false;
        if (results[i] == HEATER_WR_FAILED && !heater_write_is_on(&w[i])) return false;
    }
    return true;
}

bool heater_ext_next(bool prev, bool read_ok, bool refused)
{
    if (read_ok) return true;
    if (refused) return false;
    return prev;
}
