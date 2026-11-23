#include "heater_cmd.h"
#include "heater_ext.h"
#include "shadow.h"

#include <syslog.h>

heater_apply_t heater_cmd_apply(bool ext, uint64_t now_ms, heater_write_fn wr, void *ctx)
{
    shadow_heater_cmd_t hc;
    unsigned seq;
    if (!shadow_peek_heater_cmd(&hc, &seq)) return HEATER_APPLY_IDLE;

    if (hc.on == 1 && now_ms - hc.on_rx_ms > HEATER_ON_MAX_AGE_MS) {
        syslog(LOG_WARNING, "shadow: heater ON dropped, %llu ms old (limit %u ms)",
               (unsigned long long)(now_ms - hc.on_rx_ms), HEATER_ON_MAX_AGE_MS);
        shadow_consume_heater_on(hc.on_seq);
        hc.on = -1;
    }

    /* Order: clear_fault -> mode -> setpoint -> level -> on, so a single
     * "clear then start" message lands in a usable order (the firmware still
     * refuses the start if the clear was BUSY) and a START goes out in the
     * chosen mode. On older firmware (no regs 68..75) the planner drops
     * setpoint/clear/mode, which would otherwise fail forever. */
    heater_write_t hw[HEATER_MAX_WRITES];
    int res[HEATER_MAX_WRITES];
    int n = heater_plan_writes(hc.on, hc.level, hc.setpoint_f, hc.clear_fault,
                               hc.mode, ext, hw);
    /* After a write with no answer, only a STOP is still tried this tick:
     * the bus is suspect, each try can block ~3 s, and the rest waits for the
     * next tick (SKIPPED keeps it pending, an ON included).
     * An ON is consumed BEFORE its write: AWS re-sends desired.heater.on with
     * its original timestamp in every delta until our null lands, and one
     * arriving during the (up to ~3 s) write must find it already handled. */
    bool lost = false;
    for (int i = 0; i < n; i++) {
        bool stop = hw[i].reg == 53 && hw[i].value == 0;
        if (lost && !stop) { res[i] = HEATER_WR_SKIPPED; continue; }
        bool on = heater_write_is_on(&hw[i]);
        if (on) shadow_consume_heater_on(hc.on_seq);
        res[i] = wr(hw[i].reg, hw[i].value, hw[i].what, ctx);
        if (res[i] == HEATER_WR_FAILED) lost = true;
        if (on && res[i] == HEATER_WR_FAILED)
            syslog(LOG_WARNING, "shadow: heater ON delivery unknown (no answer); "
                   "not re-sending, request readback shows the real state");
    }

    /* Ack (clears the command and nulls the cloud desired.heater) once every
     * write got an answer, an ON excepted. The seq guard keeps a newer
     * command that landed during the writes; a consumed ON is no longer in
     * it. */
    if (heater_cmd_settled(hw, res, n)) shadow_ack_heater_cmd(seq);

    if (n == 0) return HEATER_APPLY_IDLE;
    return lost ? HEATER_APPLY_LOST : HEATER_APPLY_ANSWERED;
}
