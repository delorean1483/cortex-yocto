#include "unity.h"
#include "mb_regmodel.h"
#include "control.h"
#include "app_timers.h"
#include "board_pins.h"

static apu_ctx_t ctx;

/* Put ctx in the exact state Component Test entry requires. */
static void ctx_ready_off(void) {
    control_init(&ctx);
    app_timers_init();
    ctx.op_state = OP_OFF;
    ctx.engine_op_status = ST_OFF;
    ctx.out.fuel_pump = false;
    ctx.in_truck_ignition = false;
    ctx.standby_override = false;
}

void setUp(void) {
    mb_reg_reset();
    ctx_ready_off();
    control_diag_register(&ctx);
}
void tearDown(void) {}

static void test_enter_from_off_ok(void) {
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(49, 1));
    TEST_ASSERT_EQUAL_INT(OP_DIAG, ctx.op_state);
    uint16_t o = 0;
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_read(49, &o));
    TEST_ASSERT_EQUAL_UINT16(1, o);
}

static void test_enter_refused_when_ignition_on(void) {
    ctx.in_truck_ignition = true;
    TEST_ASSERT_EQUAL_INT(MB_EXC_ILLEGAL_VALUE, mb_reg_write(49, 1));
    TEST_ASSERT_EQUAL_INT(OP_OFF, ctx.op_state);
}

static void test_enter_allowed_ignition_on_with_override(void) {
    ctx.in_truck_ignition = true;
    ctx.standby_override = true;
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(49, 1));
    TEST_ASSERT_EQUAL_INT(OP_DIAG, ctx.op_state);
}

static void test_enter_refused_when_not_off(void) {
    ctx.op_state = OP_CLIMATE;
    TEST_ASSERT_EQUAL_INT(MB_EXC_ILLEGAL_VALUE, mb_reg_write(49, 1));
    TEST_ASSERT_EQUAL_INT(OP_CLIMATE, ctx.op_state);
}

static void test_exit_returns_to_off(void) {
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(49, 1));
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(49, 0));
    TEST_ASSERT_EQUAL_INT(OP_OFF, ctx.op_state);
    uint16_t o = 1;
    mb_reg_read(49, &o);
    TEST_ASSERT_EQUAL_UINT16(0, o);
}

static void test_bad_mode_value_illegal(void) {
    TEST_ASSERT_EQUAL_INT(MB_EXC_ILLEGAL_VALUE, mb_reg_write(49, 2));
}

static void test_out_refused_when_not_in_diag(void) {
    /* not entered */
    TEST_ASSERT_EQUAL_INT(MB_EXC_ILLEGAL_VALUE, mb_reg_write(50, (OUT_CONDENSER_FAN << 8) | 1));
}

static void test_low_risk_energize_sets_output_and_status(void) {
    mb_reg_write(49, 1);
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(50, (OUT_CONDENSER_FAN << 8) | 1));
    control_diag_mode(&ctx);
    TEST_ASSERT_TRUE(ctx.out.condenser_fan);
    TEST_ASSERT_EQUAL_UINT16(1000, ctx.out.condenser_duty);
    uint16_t o = 0;
    mb_reg_read(41, &o);
    TEST_ASSERT_EQUAL_UINT16((1u << OUT_CONDENSER_FAN), o);
}

static void test_single_active_releases_previous(void) {
    mb_reg_write(49, 1);
    mb_reg_write(50, (OUT_CONDENSER_FAN << 8) | 1);
    control_diag_mode(&ctx);
    TEST_ASSERT_TRUE(ctx.out.condenser_fan);
    mb_reg_write(50, (OUT_HEAT_REVERSER << 8) | 1);
    control_diag_mode(&ctx);
    TEST_ASSERT_FALSE(ctx.out.condenser_fan);
    TEST_ASSERT_TRUE(ctx.out.heat_reverse);
    uint16_t o = 0;
    mb_reg_read(41, &o);
    TEST_ASSERT_EQUAL_UINT16((1u << OUT_HEAT_REVERSER), o);
}

static void test_off_clears_active(void) {
    mb_reg_write(49, 1);
    mb_reg_write(50, (OUT_EVAP_FAN << 8) | 1);
    control_diag_mode(&ctx);
    TEST_ASSERT_TRUE(ctx.out.evap_fan);
    mb_reg_write(50, (OUT_EVAP_FAN << 8) | 0);
    control_diag_mode(&ctx);
    TEST_ASSERT_FALSE(ctx.out.evap_fan);
    uint16_t o = 9;
    mb_reg_read(41, &o);
    TEST_ASSERT_EQUAL_UINT16(0, o);
}

static void test_index_out_of_range_illegal(void) {
    mb_reg_write(49, 1);
    TEST_ASSERT_EQUAL_INT(MB_EXC_ILLEGAL_VALUE, mb_reg_write(50, (OUT_COUNT << 8) | 1));
}

static void test_engine_relay_refused_when_ignition_on(void) {
    mb_reg_write(49, 1);
    ctx.in_truck_ignition = true;   /* becomes true after entry */
    TEST_ASSERT_EQUAL_INT(MB_EXC_ILLEGAL_VALUE, mb_reg_write(50, (OUT_STARTER << 8) | 1));
}

static void test_engine_relay_allowed_when_off(void) {
    mb_reg_write(49, 1);
    TEST_ASSERT_EQUAL_INT(MB_EXC_NONE, mb_reg_write(50, (OUT_STARTER << 8) | 1));
    control_diag_mode(&ctx);
    TEST_ASSERT_TRUE(ctx.out.starter);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_enter_from_off_ok);
    RUN_TEST(test_enter_refused_when_ignition_on);
    RUN_TEST(test_enter_allowed_ignition_on_with_override);
    RUN_TEST(test_enter_refused_when_not_off);
    RUN_TEST(test_exit_returns_to_off);
    RUN_TEST(test_bad_mode_value_illegal);
    RUN_TEST(test_out_refused_when_not_in_diag);
    RUN_TEST(test_low_risk_energize_sets_output_and_status);
    RUN_TEST(test_single_active_releases_previous);
    RUN_TEST(test_off_clears_active);
    RUN_TEST(test_index_out_of_range_illegal);
    RUN_TEST(test_engine_relay_refused_when_ignition_on);
    RUN_TEST(test_engine_relay_allowed_when_off);
    return UNITY_END();
}
