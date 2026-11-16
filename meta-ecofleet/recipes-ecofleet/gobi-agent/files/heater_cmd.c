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

    /* Order: clear_fault -> setpoint -> level -> on, so a single "clear then
     * start" message lands in a usable order (the firmware still refuses the
     * start if the clear was BUSY). On older firmware (no regs 68..75) the
     * planner drops setpoint/clear, which would otherwise fail forever. */
    heater_write_t hw[4];
    int res[4];
    int n = heater_plan_writes(hc.on, hc.level, hc.setpoint_f, hc.clear_fault, ext, hw);
    bool lost = false;
    for (int i = 0; i < n; i++) {
        res[i] = wr(hw[i].reg, hw[i].value, hw[i].what, ctx);
        if (res[i] == HEATER_WR_FAILED) lost = true;
        if (heater_write_is_on(&hw[i])) {
            if (res[i] == HEATER_WR_FAILED)
                syslog(LOG_WARNING, "shadow: heater ON delivery unknown (no answer); "
                       "not re-sending, request readback shows the real state");
            shadow_consume_heater_on(hc.on_seq);
        }
    }

    /* Ack (clears the command and nulls the cloud desired.heater) once every
     * write got an answer, an ON excepted. The seq guard keeps a newer
     * command that landed during the writes; a consumed ON is no longer in
     * it. */
    if (heater_cmd_settled(hw, res, n)) shadow_ack_heater_cmd(seq);

    if (n == 0) return HEATER_APPLY_IDLE;
    return lost ? HEATER_APPLY_LOST : HEATER_APPLY_ANSWERED;
}
