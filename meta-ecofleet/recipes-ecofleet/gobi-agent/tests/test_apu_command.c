#include "apu_command.h"
#include <stddef.h>
#include <stdio.h>
static int fails;
#define CHECK(c) do{ if(!(c)){ printf("FAIL %s:%d %s\n",__FILE__,__LINE__,#c); fails++; } }while(0)
int main(void){
    /* Contract vocabulary -> firmware mode reg 10 (0=Off 1=Climate 2=Battery).
     * This is what decides whether/how the diesel APU cranks, so it is the
     * one piece of the remote-control path with its own host test. */
    CHECK(apu_command_to_mode_reg("stop")    == 0);
    CHECK(apu_command_to_mode_reg("climate") == 1);
    CHECK(apu_command_to_mode_reg("battery") == 2);

    /* Legacy "start" (older shadow desired / stale cloud state) maps to the
     * safe common default, Climate — never left pending so a stale command
     * can't wedge the peek/ack loop. */
    CHECK(apu_command_to_mode_reg("start")   == 1);

    /* Anything unrecognised is rejected (-1): the caller acks-and-drops it so
     * it cannot loop, and never writes an out-of-range value to reg 10. */
    CHECK(apu_command_to_mode_reg("")        == -1);
    CHECK(apu_command_to_mode_reg("off")     == -1);   /* not in the contract  */
    CHECK(apu_command_to_mode_reg("crank")   == -1);
    CHECK(apu_command_to_mode_reg("3")       == -1);
    CHECK(apu_command_to_mode_reg(NULL)      == -1);

    printf(fails?"test_apu_command FAILED (%d)\n":"test_apu_command ok\n", fails);
    return fails?1:0;
}
