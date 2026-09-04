#include "heater_fields.h"
#include <string.h>
#include <stdio.h>
static int fails;
#define CHECK(c) do{ if(!(c)){ printf("FAIL %s:%d %s\n",__FILE__,__LINE__,#c); fails++; } }while(0)
int main(void){
    CHECK(strcmp(heater_state_name(0),"off")==0);
    CHECK(strcmp(heater_state_name(3),"running")==0);
    CHECK(strcmp(heater_state_name(4),"cooldown")==0);
    CHECK(strcmp(heater_state_name(9),"unknown")==0);
    CHECK(heater_flag(0x04u, HEATER_FLAG_SAFE_OFF)==1);   /* bit2 */
    CHECK(heater_flag(0x04u, HEATER_FLAG_COMMS_FAULT)==0);/* bit3 */
    CHECK(heater_supply_volts(13800u) > 13.79 && heater_supply_volts(13800u) < 13.81);
    CHECK(heater_pump_hz(51u) > 5.09 && heater_pump_hz(51u) < 5.11);
    printf(fails?"test_heater_fields FAILED (%d)\n":"test_heater_fields ok\n", fails);
    return fails?1:0;
}
