#include "control.h"
#include "app_timers.h"
#include "board_pins.h"
#include "mb_regmodel.h"

#define DIAG_INACTIVITY_SEC 10u

static apu_ctx_t *s_ctx;
static int8_t     s_active = -1;   /* -1 = none, else bsp_out_t index */

/* Refuse energizing the APU while the truck engine is on (no override). */
static bool diag_engine_gate_ok(const apu_ctx_t *ctx) {
    return !(ctx->in_truck_ignition && !ctx->standby_override);
}
static bool diag_entry_ok(const apu_ctx_t *ctx) {
    return ctx->op_state == OP_OFF
        && ctx->engine_op_status == ST_OFF
        && !ctx->out.fuel_pump
        && diag_engine_gate_ok(ctx);
}

static void diag_enter(apu_ctx_t *ctx) {
    control_deenergize_all(ctx);
    s_active = -1;
    ctx->op_state = OP_DIAG;
    app_timer_set(SCALE_SECOND, DIAG_INACTIVITY_TMR, DIAG_INACTIVITY_SEC);
}
static void diag_exit(apu_ctx_t *ctx) {
    control_deenergize_all(ctx);
    s_active = -1;
    ctx->op_state = OP_OFF;
}

static modbus_exc_t rd_diag_mode(uint16_t r, uint16_t *o) {
    (void)r; *o = (s_ctx->op_state == OP_DIAG) ? 1u : 0u; return MB_EXC_NONE;
}
static modbus_exc_t wr_diag_mode(uint16_t r, uint16_t v) {
    (void)r;
    if (v == 0u) { diag_exit(s_ctx); return MB_EXC_NONE; }
    if (v != 1u) return MB_EXC_ILLEGAL_VALUE;
    if (s_ctx->op_state == OP_DIAG) {   /* keepalive */
        app_timer_set(SCALE_SECOND, DIAG_INACTIVITY_TMR, DIAG_INACTIVITY_SEC);
        return MB_EXC_NONE;
    }
    if (!diag_entry_ok(s_ctx)) return MB_EXC_ILLEGAL_VALUE;
    diag_enter(s_ctx);
    return MB_EXC_NONE;
}

/* Filled in Task 2. */
static modbus_exc_t wr_diag_out(uint16_t r, uint16_t v) { (void)r; (void)v; return MB_EXC_ILLEGAL_VALUE; }
static modbus_exc_t rd_diag_status(uint16_t r, uint16_t *o) { (void)r; *o = 0u; return MB_EXC_NONE; }

void control_diag_register(apu_ctx_t *ctx) {
    s_ctx = ctx;
    s_active = -1;
    mb_reg_bind(49, rd_diag_mode,   wr_diag_mode);
    mb_reg_bind(50, 0,              wr_diag_out);
    mb_reg_bind(41, rd_diag_status, 0);
}

/* Filled in Tasks 2–3. */
void control_diag_mode(apu_ctx_t *ctx) { (void)ctx; }
