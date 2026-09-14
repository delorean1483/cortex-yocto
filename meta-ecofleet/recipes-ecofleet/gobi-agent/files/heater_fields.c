/* heater_fields.c — see heater_fields.h */

#include "heater_fields.h"

const char *heater_state_name(unsigned state)
{
    switch (state) {
        case 0: return "off";
        case 1: return "preheat";
        case 2: return "ignition";
        case 3: return "running";
        case 4: return "cooldown";
        default: return "unknown";
    }
}

int heater_flag(unsigned flags, unsigned bit)
{
    return (flags & bit) ? 1 : 0;
}

int heater_comms_ok(unsigned flags)
{
    return (heater_flag(flags, HEATER_FLAG_FRESH) &&
            !heater_flag(flags, HEATER_FLAG_COMMS_FAULT)) ? 1 : 0;
}

int heater_safe_off(unsigned flags)
{
    return heater_flag(flags, HEATER_FLAG_SAFE_OFF);
}

double heater_supply_volts(unsigned mv)
{
    return mv / 1000.0;
}

double heater_pump_hz(unsigned x10)
{
    return x10 / 10.0;
}
