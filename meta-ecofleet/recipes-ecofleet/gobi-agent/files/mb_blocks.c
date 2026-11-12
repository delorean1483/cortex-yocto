/* mb_blocks.c - the agent's FC03 block plan for the EF-G0B1R map. */
#include "mb_blocks.h"
#include "config.h"
#include <string.h>

/* Blocks, as wire address + count (firmware regs in the comments). Bound on
 * firmware since v1.1.3 unless noted; the gaps are fw 4-5 (unbound), 24-37
 * (calibration/NVM, unused), 42-48 (read the I2C RTC on every access) and
 * fw 50 (write-only). Response sizes stay far below the firmware's 125-register
 * FC03 limit and 256-byte frame. */
const mbb_block_t mbb_link_blocks[] = {
    { REG_CABIN_TEMP_F,  3, MBB_SPLIT },   /* fw 1..3: cabin temp, fw version */
    { REG_BATT_CV,      18, MBB_SPLIT },   /* fw 6..23: battery .. control status, fan_auto */
    { REG_RPM,           4, MBB_SPLIT },   /* fw 38..41: rpm, component-test outputs */
    { REG_EXT_TEMP_F,    1, MBB_SPLIT },   /* fw 51: external temp */
};
const size_t mbb_link_nblocks = sizeof mbb_link_blocks / sizeof mbb_link_blocks[0];

const mbb_block_t mbb_diag_block       = { REG_DIAG_MODE,       1, MBB_GROUP };  /* fw 49 */
const mbb_block_t mbb_heater_block     = { REG_HEATER_REQUEST, 15, MBB_GROUP };  /* fw 53..67 */
const mbb_block_t mbb_heater_ext_block = { REG_HEATER_TYPE,     8, MBB_GROUP };  /* fw 68..75, v1.1.6+ */
const mbb_block_t mbb_led_block        = { REG_LED_RED,         4, MBB_GROUP };  /* fw 76..79, v1.1.7+ */

#define REQ MBB_REQUIRED
#define OPT MBB_OPTIONAL
const uint8_t mbb_role[MBB_NREGS] = {
    [REG_CABIN_TEMP_F]   = REQ, [REG_EXT_TEMP_F]     = REQ, [REG_BATT_CV]       = REQ,
    [REG_BATT_SET_CV]    = REQ, [REG_RPM]            = REQ, [REG_ENGINE_HRS]    = REQ,
    [REG_OIL_HRS]        = REQ, [REG_MACHINE_HRS]    = REQ, [REG_CLMT_SET_F]    = REQ,
    [REG_OIL_OK]         = REQ, [REG_IGNITION]       = REQ, [REG_MODE]          = REQ,
    [REG_ERROR]          = REQ, [REG_ENGINE_STATUS]  = REQ, [REG_CONTROL_STATUS] = REQ,
    [REG_OIL_CHANGE]     = REQ, [REG_FAN_SPEED]      = REQ,

    [REG_FW_VERSION]     = OPT, [REG_FAN_AUTO]       = OPT, [REG_DIAG_STATUS]   = OPT,
    [REG_DIAG_MODE]      = OPT,
    [REG_HEATER_REQUEST] = OPT, [REG_HEATER_LEVEL]   = OPT, [REG_HEATER_STATE]  = OPT,
    [REG_HEATER_ACTIVE_LVL] = OPT, [REG_HEATER_ERROR] = OPT, [REG_HEATER_SUPPLY_MV] = OPT,
    [REG_HEATER_FAN_RPM] = OPT, [REG_HEATER_PUMP_HZ_X10] = OPT, [REG_HEATER_EXCH_RAW] = OPT,
    [REG_HEATER_STATE_SECS] = OPT, [REG_HEATER_AGE_MS] = OPT, [REG_HEATER_FLAGS] = OPT,
    [REG_HEATER_VALID_FR] = OPT, [REG_HEATER_CSUM_FAIL] = OPT, [REG_HEATER_XPORT_ERR] = OPT,
    [REG_HEATER_TYPE]    = OPT, [REG_HEATER_SETPOINT_C] = OPT, [REG_HEATER_CAPS] = OPT,
    [REG_HEATER_PHASE]   = OPT, [REG_HEATER_VENDOR_ST] = OPT, [REG_HEATER_COMMAND] = OPT,
    [REG_LED_RED]        = OPT, [REG_LED_GREEN]      = OPT, [REG_LED_BLUE]      = OPT,
    [REG_LED_STATUS]     = OPT,
};
#undef REQ
#undef OPT

/* First required register in b, or -1. */
static int first_required(const mbb_block_t *b)
{
    for (int a = b->first; a < b->first + b->count; a++)
        if (mbb_role[a] == MBB_REQUIRED) return a;
    return -1;
}

bool mbb_read_block(mbb_snap_t *s, const mbb_block_t *b, mbb_read_fn rd, void *ctx,
                    int *fail_addr)
{
    uint16_t buf[MBB_NREGS];
    bool exception = false;

    for (int a = b->first; a < b->first + b->count; a++) s->ok[a] = false;
    if (rd(ctx, b->first, b->count, buf, &exception) == b->count) {
        for (int i = 0; i < b->count; i++) {
            s->val[b->first + i] = buf[i];
            s->ok[b->first + i]  = true;
        }
        return true;
    }

    /* Link failure, an absent feature, or nothing narrower to try. */
    if (!exception || b->kind == MBB_GROUP || b->count == 1) {
        int req = first_required(b);
        if (req < 0) return true;
        *fail_addr = req;
        return false;
    }

    /* Older firmware lacks a register in this block: read the ones we use.
     * Stop at the first failure that isn't an exception (the link dropped). */
    for (int a = b->first; a < b->first + b->count; a++) {
        if (mbb_role[a] == MBB_UNUSED) continue;
        uint16_t v;
        if (rd(ctx, a, 1, &v, &exception) == 1) {
            s->val[a] = v;
            s->ok[a]  = true;
        } else if (mbb_role[a] == MBB_REQUIRED) {
            *fail_addr = a;
            return false;
        } else if (!exception) {
            for (int r = a + 1; r < b->first + b->count; r++) {
                if (mbb_role[r] == MBB_REQUIRED) { *fail_addr = r; return false; }
            }
            return true;
        }
    }
    return true;
}

int mbb_read_link(mbb_snap_t *s, mbb_read_fn rd, void *ctx, int *fail_addr)
{
    memset(s, 0, sizeof *s);
    for (size_t i = 0; i < mbb_link_nblocks; i++)
        if (!mbb_read_block(s, &mbb_link_blocks[i], rd, ctx, fail_addr)) return -1;
    return 0;
}

void mbb_read_optional(mbb_snap_t *s, mbb_read_fn rd, void *ctx)
{
    int unused;
    mbb_read_block(s, &mbb_diag_block, rd, ctx, &unused);
    mbb_read_block(s, &mbb_heater_block, rd, ctx, &unused);
    /* The coprocessor block only exists alongside the heater block. */
    for (int a = mbb_heater_ext_block.first;
         a < mbb_heater_ext_block.first + mbb_heater_ext_block.count; a++)
        s->ok[a] = false;
    if (mbb_ok(s, REG_HEATER_STATE))
        mbb_read_block(s, &mbb_heater_ext_block, rd, ctx, &unused);
    mbb_read_block(s, &mbb_led_block, rd, ctx, &unused);
}
