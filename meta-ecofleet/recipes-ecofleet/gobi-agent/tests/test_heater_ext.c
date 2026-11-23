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

    CHECK(strcmp(heater_control_name(HEATER_CAP_LEVEL, -1),"level")==0);
    CHECK(strcmp(heater_control_name(HEATER_CAP_SETPOINT|0x24u, -1),"setpoint")==0);
    CHECK(strcmp(heater_control_name(0, -1),"level")==0);
    /* G0B1 1.3.17 AUTOTERM control mode (caps bit 8, fw 2230 = APPLIED mode):
       power mode is driven by the level, temperature mode by the setpoint */
    unsigned at = HEATER_CAP_SETPOINT | HEATER_CAP_MODE;
    CHECK(strcmp(heater_control_name(at, HEATER_MODE_POWER),"level")==0);
    CHECK(strcmp(heater_control_name(at, HEATER_MODE_TEMPERATURE),"setpoint")==0);
    CHECK(strcmp(heater_control_name(at, -1),"setpoint")==0);      /* mode not read yet */
    CHECK(strcmp(heater_control_name(HEATER_CAP_SETPOINT, HEATER_MODE_POWER),"setpoint")==0); /* no caps bit: mode ignored */
    CHECK(strcmp(heater_mode_name(at, 0),"temperature")==0);
    CHECK(strcmp(heater_mode_name(at, 1),"power")==0);
    CHECK(heater_mode_name(at, -1)==NULL);
    CHECK(heater_mode_name(at, 2)==NULL);                           /* unknown value */
    CHECK(heater_mode_name(HEATER_CAP_SETPOINT, 1)==NULL);          /* not selectable (VEVOR, old fw) */
    CHECK(heater_mode_parse("temperature")==HEATER_MODE_TEMPERATURE);
    CHECK(heater_mode_parse("power")==HEATER_MODE_POWER);
    CHECK(heater_mode_parse("Power")==-1);
    CHECK(heater_mode_parse("")==-1);
    CHECK(heater_mode_parse(NULL)==-1);

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
    /* write plan: safe order clear -> mode -> setpoint -> level -> on, so a
       START goes out with the mode already applied */
    heater_write_t w[HEATER_MAX_WRITES];
    int n = heater_plan_writes(1, 4, 72, true, HEATER_MODE_POWER, true, w);
    CHECK(n==5);
    CHECK(w[0].reg==75 && w[0].value==HEATER_CMD_CLEAR_FAULT);
    CHECK(w[1].reg==HEATER_REG_MODE && w[1].value==1);
    CHECK(w[2].reg==69 && w[2].value==22);
    CHECK(w[3].reg==54 && w[3].value==4);
    CHECK(w[4].reg==53 && w[4].value==1);
    n = heater_plan_writes(-1, -1, -1, false, HEATER_MODE_TEMPERATURE, true, w);
    CHECK(n==1 && w[0].reg==2230 && w[0].value==0);
    /* review #2: old firmware (no ext block) never gets setpoint/clear/mode
       writes, which would fail forever and leave the command (and its ON)
       pending */
    n = heater_plan_writes(0, -1, 72, true, HEATER_MODE_POWER, false, w);
    CHECK(n==1 && w[0].reg==53 && w[0].value==0);
    n = heater_plan_writes(-1, -1, 72, true, HEATER_MODE_POWER, false, w);
    CHECK(n==0);
    /* unset / invalid fields skipped */
    n = heater_plan_writes(-1, 0, 40, false, -1, true, w);
    CHECK(n==0);
    n = heater_plan_writes(2, 11, 87, false, 2, true, w);
    CHECK(n==0);
    /* a command is settled (ack it, never re-send) unless a write got no
       answer; a write the firmware refused is an answer */
    heater_write_t lv_stop[2] = { { 54, 3, "heater_level" }, { 53, 0, "heater_on" } };
    int r_ok[]      = { HEATER_WR_OK, HEATER_WR_OK };
    int r_refused[] = { HEATER_WR_OK, HEATER_WR_REFUSED };
    int r_failed[]  = { HEATER_WR_OK, HEATER_WR_FAILED };
    int r_both[]    = { HEATER_WR_FAILED, HEATER_WR_REFUSED };
    CHECK(heater_cmd_settled(lv_stop, r_ok, 2)==true);
    CHECK(heater_cmd_settled(lv_stop, r_refused, 2)==true);
    CHECK(heater_cmd_settled(lv_stop, r_failed, 2)==false);  /* lost STOP: resend */
    CHECK(heater_cmd_settled(lv_stop, r_both, 2)==false);    /* lost level: resend */
    CHECK(heater_cmd_settled(lv_stop, r_ok, 0)==true);       /* nothing to write */
    /* ON is delivered at most once: a lost ON never holds the command open
       (a lost level beside it still does) */
    heater_write_t lv_on[2] = { { 54, 3, "heater_level" }, { 53, 1, "heater_on" } };
    CHECK(heater_cmd_settled(lv_on, r_failed, 2)==true);
    int r_lv_lost[] = { HEATER_WR_FAILED, HEATER_WR_OK };
    CHECK(heater_cmd_settled(lv_on, r_lv_lost, 2)==false);
    /* a write not tried (behind a lost one) always holds the command open,
       an ON too: it hasn't had its attempt yet */
    int r_skip[] = { HEATER_WR_FAILED, HEATER_WR_SKIPPED };
    CHECK(heater_cmd_settled(lv_on, r_skip, 2)==false);
    int r_ok_skip[] = { HEATER_WR_OK, HEATER_WR_SKIPPED };
    CHECK(heater_cmd_settled(lv_on, r_ok_skip, 2)==false);
    /* "firmware has the coprocessor block" is sticky across a read that got
       no answer; only an exception answer (no such register) clears it */
    CHECK(heater_ext_next(false, true,  false) == true);
    CHECK(heater_ext_next(true,  false, false) == true);   /* timeout: keep */
    CHECK(heater_ext_next(true,  false, true)  == false);  /* exception: gone */
    CHECK(heater_ext_next(false, false, false) == false);

    /* G0B1 1.3.16 L011 diagnostics: fw 2227 = major<<8|minor, 2228 = build */
    char v[16];
    heater_l011_fw_str(0x0002u, 3, v, sizeof v);  CHECK(strcmp(v,"0.2.3")==0);
    heater_l011_fw_str(0x0103u, 12, v, sizeof v); CHECK(strcmp(v,"1.3.12")==0);
    heater_l011_fw_str(0, 0, v, sizeof v);        CHECK(v[0]=='\0');  /* unidentified / maintenance */
    heater_l011_fw_str(0xFFFFu, 0xFFFFu, v, 6);   CHECK(strlen(v)==5); /* truncated, terminated */
    /* fw 2229: last 0xB011 loader-entry rejection */
    CHECK(strcmp(heater_l011_reject_name(0),"none")==0);
    CHECK(strcmp(heater_l011_reject_name(1),"phase_not_off")==0);
    CHECK(strcmp(heater_l011_reject_name(2),"run_request_set")==0);
    CHECK(strcmp(heater_l011_reject_name(3),"lamp_not_off")==0);
    CHECK(strcmp(heater_l011_reject_name(4),"identity_mismatch")==0);
    CHECK(strcmp(heater_l011_reject_name(5),"heater_mode_set")==0);
    CHECK(strcmp(heater_l011_reject_name(6),"loader_error")==0);
    CHECK(strcmp(heater_l011_reject_name(7),"unknown")==0);
    /* read only with the coprocessor block; a G0B1 that refuses the read
       (pre-1.3.16: ILLEGAL_ADDRESS) isn't asked again until its firmware
       version changes */
    heater_l011_probe_t p = { 0 };
    CHECK(heater_l011_probe_due(&p, true,  10315));
    CHECK(!heater_l011_probe_due(&p, false, 10315));
    heater_l011_probe_note(&p, true, 10315);
    CHECK(!heater_l011_probe_due(&p, true, 10315));
    CHECK(heater_l011_probe_due(&p, true, 10316));       /* G0B1 updated */
    heater_l011_probe_note(&p, false, 10316);
    CHECK(heater_l011_probe_due(&p, true, 10316));
    CHECK(heater_l011_probe_due(&p, true, 10315));       /* answered: no memory */
    printf(fails?"test_heater_ext FAILED (%d)\n":"test_heater_ext ok\n", fails);
    return fails?1:0;
}
