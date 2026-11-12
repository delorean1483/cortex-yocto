/* Host tests for the block-read plan (mb_blocks.c) against a fake EF-G0B1R
 * slave that answers like the firmware: an exception for any read spanning an
 * unbound register, or nothing at all when the link is down. */
#include "mb_blocks.h"
#include "config.h"
#include <errno.h>
#include <stdio.h>
#include <string.h>

static int fails;
#define CHECK(c) do{ if(!(c)){ printf("FAIL %s:%d %s\n",__FILE__,__LINE__,#c); fails++; } }while(0)

typedef struct {
    bool bound[MBB_NREGS];
    bool link_down;
    int  down_after;      /* > 0: the link drops after this many transactions */
    int  calls;           /* Modbus transactions */
    int  single_calls;    /* of which one-register reads */
} fake_dev_t;

static uint16_t value_at(int addr) { return (uint16_t)(1000 + addr); }

static int fake_read(void *ctx, int addr, int n, uint16_t *dst, bool *exception)
{
    fake_dev_t *d = ctx;
    d->calls++;
    if (n == 1) d->single_calls++;
    *exception = false;
    if (d->down_after > 0 && d->calls > d->down_after) d->link_down = true;
    if (d->link_down) { errno = ETIMEDOUT; return -1; }
    for (int i = 0; i < n; i++) {
        if (addr + i >= MBB_NREGS || !d->bound[addr + i]) { *exception = true; errno = EIO; return -1; }
    }
    for (int i = 0; i < n; i++) dst[i] = value_at(addr + i);
    return n;
}

static void bind_fw(fake_dev_t *d, int first_fw, int last_fw, bool on)
{
    for (int r = first_fw; r <= last_fw; r++) d->bound[r - 1] = on;
}

/* Bound registers on g0b1-firmware main / 1.1.99 (mb_reg_bind calls): 1-3,
 * 6-49, 51-79. 4 and 5 are unbound; 50 is write-only. */
static fake_dev_t fw_current(void)
{
    fake_dev_t d;
    memset(&d, 0, sizeof d);
    bind_fw(&d, 1, 3, true);
    bind_fw(&d, 6, 49, true);
    bind_fw(&d, 51, 79, true);
    return d;
}

/* v1.1.3 / v1.1.5: no heater coprocessor block (68-75) and no RGB light (76-79). */
static fake_dev_t fw_1_1_5(void)
{
    fake_dev_t d = fw_current();
    bind_fw(&d, 68, 79, false);
    return d;
}

static int run_cycle(mbb_snap_t *s, fake_dev_t *d, int *fail)
{
    int rc = mbb_read_link(s, fake_read, d, fail);
    if (rc == 0) mbb_read_optional(s, fake_read, d);
    return rc;
}

static const int required[] = {
    REG_CABIN_TEMP_F, REG_EXT_TEMP_F, REG_BATT_CV, REG_BATT_SET_CV, REG_RPM,
    REG_ENGINE_HRS, REG_OIL_HRS, REG_MACHINE_HRS, REG_CLMT_SET_F, REG_OIL_OK,
    REG_IGNITION, REG_MODE, REG_ERROR, REG_ENGINE_STATUS, REG_CONTROL_STATUS,
    REG_OIL_CHANGE, REG_FAN_SPEED,
};
static const int optional[] = {
    REG_FW_VERSION, REG_FAN_AUTO, REG_DIAG_STATUS, REG_DIAG_MODE,
    REG_HEATER_REQUEST, REG_HEATER_LEVEL, REG_HEATER_STATE, REG_HEATER_ACTIVE_LVL,
    REG_HEATER_ERROR, REG_HEATER_SUPPLY_MV, REG_HEATER_FAN_RPM, REG_HEATER_PUMP_HZ_X10,
    REG_HEATER_EXCH_RAW, REG_HEATER_STATE_SECS, REG_HEATER_AGE_MS, REG_HEATER_FLAGS,
    REG_HEATER_VALID_FR, REG_HEATER_CSUM_FAIL, REG_HEATER_XPORT_ERR,
    REG_HEATER_TYPE, REG_HEATER_SETPOINT_C, REG_HEATER_CAPS, REG_HEATER_PHASE,
    REG_HEATER_VENDOR_ST, REG_HEATER_COMMAND,
    REG_LED_RED, REG_LED_GREEN, REG_LED_BLUE, REG_LED_STATUS,
};
#define N(a) ((int)(sizeof(a) / sizeof((a)[0])))

static void test_current_firmware_reads_everything_in_eight_transactions(void)
{
    fake_dev_t d = fw_current();
    mbb_snap_t s;
    int fail = -1;
    CHECK(run_cycle(&s, &d, &fail) == 0);
    CHECK(d.calls == 8);
    for (int i = 0; i < N(required); i++) {
        CHECK(mbb_ok(&s, required[i]));
        CHECK(mbb_get(&s, required[i], 0) == value_at(required[i]));
    }
    for (int i = 0; i < N(optional); i++) {
        CHECK(mbb_ok(&s, optional[i]));
        CHECK(mbb_get(&s, optional[i], 0) == value_at(optional[i]));
    }
}

static void test_link_down_fails_on_the_first_read_without_retries(void)
{
    fake_dev_t d = fw_current();
    d.link_down = true;
    mbb_snap_t s;
    int fail = -1;
    CHECK(mbb_read_link(&s, fake_read, &d, &fail) == -1);
    CHECK(d.calls == 1);
    CHECK(fail == REG_CABIN_TEMP_F);
    CHECK(errno == ETIMEDOUT);
}

static void test_unbound_required_register_fails_the_cycle(void)
{
    fake_dev_t d = fw_current();
    bind_fw(&d, 51, 51, false);                /* fw 51 = REG_EXT_TEMP_F */
    mbb_snap_t s;
    int fail = -1;
    CHECK(mbb_read_link(&s, fake_read, &d, &fail) == -1);
    CHECK(fail == REG_EXT_TEMP_F);
}

static void test_missing_optional_register_splits_its_block(void)
{
    fake_dev_t d = fw_current();
    bind_fw(&d, 9, 9, false);                  /* firmware before fan_auto */
    mbb_snap_t s;
    int fail = -1;
    CHECK(run_cycle(&s, &d, &fail) == 0);
    CHECK(!mbb_ok(&s, REG_FAN_AUTO));
    CHECK(mbb_get(&s, REG_FAN_AUTO, 7) == 7);
    for (int i = 0; i < N(required); i++) CHECK(mbb_ok(&s, required[i]));
    CHECK(mbb_get(&s, REG_MODE, 0) == value_at(REG_MODE));
    /* Only registers the agent uses are re-read singly: fw 15, 16 and 19
     * share the block but are never decoded. */
    CHECK(d.single_calls == 2 + 15);   /* fw 51 + fw 49 blocks, then fw 6..23 minus 15,16,19 */
}

static void test_required_register_missing_inside_a_split_block_fails(void)
{
    fake_dev_t d = fw_current();
    bind_fw(&d, 9, 9, false);
    bind_fw(&d, 14, 14, false);                /* fw 14 = REG_CLMT_SET_F */
    mbb_snap_t s;
    int fail = -1;
    CHECK(mbb_read_link(&s, fake_read, &d, &fail) == -1);
    CHECK(fail == REG_CLMT_SET_F);
}

static void test_link_drop_during_a_split_stops_at_one_timeout(void)
{
    fake_dev_t d = fw_current();
    bind_fw(&d, 9, 9, false);
    d.down_after = 5;          /* fw 1..3, fw 6..23 (exception), singles fw 6, 7, 8 */
    mbb_snap_t s;
    int fail = -1;
    CHECK(mbb_read_link(&s, fake_read, &d, &fail) == -1);
    CHECK(d.calls == 6);       /* the optional fw 9 single times out; nothing more is tried */
    CHECK(fail == REG_MODE);   /* the first required register left unread */
    CHECK(errno == ETIMEDOUT);
}

static void test_old_firmware_without_coprocessor_or_light(void)
{
    fake_dev_t d = fw_1_1_5();
    mbb_snap_t s;
    int fail = -1;
    CHECK(run_cycle(&s, &d, &fail) == 0);
    CHECK(d.calls == 8);                       /* the two absent groups cost one read each */
    CHECK(mbb_ok(&s, REG_HEATER_STATE));
    CHECK(mbb_ok(&s, REG_HEATER_XPORT_ERR));
    CHECK(!mbb_ok(&s, REG_HEATER_TYPE));
    CHECK(mbb_get(&s, REG_HEATER_SETPOINT_C, 20) == 20);
    CHECK(!mbb_ok(&s, REG_LED_RED));
    CHECK(!mbb_ok(&s, REG_LED_STATUS));
}

static void test_no_heater_block_skips_the_coprocessor_block(void)
{
    fake_dev_t d = fw_1_1_5();
    bind_fw(&d, 53, 67, false);
    mbb_snap_t s;
    int fail = -1;
    CHECK(run_cycle(&s, &d, &fail) == 0);
    CHECK(d.calls == 7);                       /* heater fails; 68..75 never asked */
    CHECK(!mbb_ok(&s, REG_HEATER_STATE));
    CHECK(!mbb_ok(&s, REG_HEATER_REQUEST));
    CHECK(!mbb_ok(&s, REG_HEATER_TYPE));
}

static void test_a_feature_that_disappears_is_not_reported_stale(void)
{
    fake_dev_t d = fw_current();
    mbb_snap_t s;
    int fail = -1;
    CHECK(run_cycle(&s, &d, &fail) == 0);
    CHECK(mbb_ok(&s, REG_LED_RED) && mbb_ok(&s, REG_HEATER_TYPE));
    bind_fw(&d, 68, 79, false);
    CHECK(run_cycle(&s, &d, &fail) == 0);
    CHECK(!mbb_ok(&s, REG_LED_RED));
    CHECK(!mbb_ok(&s, REG_HEATER_TYPE));
    d.link_down = true;
    CHECK(run_cycle(&s, &d, &fail) == -1);
    CHECK(!mbb_ok(&s, REG_MODE));
}

/* The plan itself: within the firmware's FC03 limit, never spanning a register
 * that is unbound (fw 4, 5), write-only (fw 50) or that reads the I2C RTC
 * (fw 42..48), and covering every register the agent decodes exactly once. */
static void test_plan_respects_the_firmware_map(void)
{
    const mbb_block_t *all[16];
    int n = 0;
    for (size_t i = 0; i < mbb_link_nblocks; i++) all[n++] = &mbb_link_blocks[i];
    all[n++] = &mbb_diag_block;
    all[n++] = &mbb_heater_block;
    all[n++] = &mbb_heater_ext_block;
    all[n++] = &mbb_led_block;

    int cover[MBB_NREGS] = {0};
    for (int i = 0; i < n; i++) {
        const mbb_block_t *b = all[i];
        CHECK(b->count >= 1 && b->count <= 125);
        CHECK(b->first + b->count <= MBB_NREGS);
        for (int a = b->first; a < b->first + b->count; a++) {
            int fw = a + 1;
            CHECK(fw != 4 && fw != 5 && fw != 50);
            CHECK(fw < 42 || fw > 48);
            if (b->kind == MBB_GROUP) CHECK(mbb_role[a] != MBB_REQUIRED);
            cover[a]++;
        }
    }
    for (int i = 0; i < N(required); i++) {
        CHECK(mbb_role[required[i]] == MBB_REQUIRED);
        CHECK(cover[required[i]] == 1);
    }
    for (int i = 0; i < N(optional); i++) {
        CHECK(mbb_role[optional[i]] == MBB_OPTIONAL);
        CHECK(cover[optional[i]] == 1);
    }
    /* Required registers are read in the link phase only. */
    for (int i = 0; i < N(required); i++) {
        bool in_link = false;
        for (size_t j = 0; j < mbb_link_nblocks; j++) {
            const mbb_block_t *b = &mbb_link_blocks[j];
            if (required[i] >= b->first && required[i] < b->first + b->count) in_link = true;
        }
        CHECK(in_link);
    }
}

int main(void)
{
    test_current_firmware_reads_everything_in_eight_transactions();
    test_link_down_fails_on_the_first_read_without_retries();
    test_unbound_required_register_fails_the_cycle();
    test_missing_optional_register_splits_its_block();
    test_required_register_missing_inside_a_split_block_fails();
    test_link_drop_during_a_split_stops_at_one_timeout();
    test_old_firmware_without_coprocessor_or_light();
    test_no_heater_block_skips_the_coprocessor_block();
    test_a_feature_that_disappears_is_not_reported_stale();
    test_plan_respects_the_firmware_map();
    if (fails) { printf("test_mb_blocks: %d failures\n", fails); return 1; }
    printf("test_mb_blocks ok\n");
    return 0;
}
