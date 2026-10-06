#include "heater_ext.h"
#include <string.h>
#include <stdio.h>
static int fails;
#define CHECK(c) do{ if(!(c)){ printf("FAIL %s:%d %s\n",__FILE__,__LINE__,#c); fails++; } }while(0)
int main(void){
    CHECK(strcmp(heater_type_name(0),"none")==0);
    CHECK(strcmp(heater_type_name(1),"vevor")==0);
    CHECK(strcmp(heater_type_name(2),"autoterm")==0);
    CHECK(strcmp(heater_type_name(7),"unknown")==0);

    CHECK(strcmp(heater_phase_name(0),"off")==0);
    CHECK(strcmp(heater_phase_name(1),"detecting")==0);
    CHECK(strcmp(heater_phase_name(2),"starting")==0);
    CHECK(strcmp(heater_phase_name(3),"running")==0);
    CHECK(strcmp(heater_phase_name(4),"stopping")==0);
    CHECK(strcmp(heater_phase_name(5),"cooldown")==0);
    CHECK(strcmp(heater_phase_name(6),"fault")==0);
    CHECK(strcmp(heater_phase_name(7),"unknown")==0);

    CHECK(strcmp(heater_control_name(HEATER_CAP_LEVEL),"level")==0);
    CHECK(strcmp(heater_control_name(HEATER_CAP_SETPOINT|0x24u),"setpoint")==0);
    CHECK(strcmp(heater_control_name(0),"level")==0);

    /* degC <-> degF: firmware range ends + a typical cabin setting */
    CHECK(heater_c_to_f(5)==41);  CHECK(heater_c_to_f(30)==86);
    CHECK(heater_c_to_f(22)==72); CHECK(heater_c_to_f(-10)==14);
    CHECK(heater_f_to_c(41)==5);  CHECK(heater_f_to_c(86)==30);
    CHECK(heater_f_to_c(72)==22); CHECK(heater_f_to_c(73)==23);
    CHECK(heater_f_to_c(0)==5);   CHECK(heater_f_to_c(120)==30);   /* clamped */
    for (int c = 5; c <= 30; c++) CHECK(heater_f_to_c(heater_c_to_f(c))==c);  /* round-trip */

    char b[8];
    heater_vendor_state_str(0x0400u,b,sizeof b); CHECK(strcmp(b,"4.0")==0);
    heater_vendor_state_str(0x0204u,b,sizeof b); CHECK(strcmp(b,"2.4")==0);
    heater_vendor_state_str(0xFFFFu,b,4);        CHECK(strlen(b)==3);     /* truncated, terminated */

    /* present gate truth table */
    CHECK(heater_present_from(false,false,0)==false);  /* no heater block at all */
    CHECK(heater_present_from(true, false,0)==true);   /* old firmware: legacy rule */
    CHECK(heater_present_from(true, true, 0)==false);  /* new fw, nothing detected */
    CHECK(heater_present_from(true, true, 2)==true);   /* new fw, AUTOTERM */
    CHECK(heater_present_from(false,true, 1)==false);  /* state read failed */
    printf(fails?"test_heater_ext FAILED (%d)\n":"test_heater_ext ok\n", fails);
    return fails?1:0;
}
