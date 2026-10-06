#include "heater_ext.h"
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

const char *heater_control_name(unsigned caps)
{
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

bool heater_present_from(bool state_ok, bool type_ok, unsigned type)
{
    return state_ok && (!type_ok || type != 0);
}

int heater_plan_writes(int on, int level, int setpoint_f, bool clear_fault,
                       bool ext, heater_write_t out[4])
{
    int n = 0;
    if (ext && clear_fault) {
        out[n].reg = 75; out[n].value = HEATER_CMD_CLEAR_FAULT; out[n].what = "heater_clear_fault"; n++;
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
