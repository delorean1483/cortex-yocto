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

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_enter_from_off_ok);
    RUN_TEST(test_enter_refused_when_ignition_on);
    RUN_TEST(test_enter_allowed_ignition_on_with_override);
    RUN_TEST(test_enter_refused_when_not_off);
    RUN_TEST(test_exit_returns_to_off);
    RUN_TEST(test_bad_mode_value_illegal);
    return UNITY_END();
}
