#include "stm32_update.h"
#include <string.h>
#include <stdio.h>
static int fails;
#define CHECK(c) do{ if(!(c)){ printf("FAIL %s:%d %s\n",__FILE__,__LINE__,#c); fails++; } }while(0)
int main(void){
    CHECK(stu_encode_version(1,1,0)==10100);
    CHECK(stu_encode_version(1,0,0)==10000);
    CHECK(stu_is_newer(10000,10100)==1);
    CHECK(stu_is_newer(10100,10100)==0);
    CHECK(stu_is_newer(0,10100)==0);            /* running unknown (reg read failed) -> don't flash */
    CHECK(stu_should_flash(10000,10100,0,0,1)==1);
    CHECK(stu_should_flash(10000,10100,1,0,1)==0); /* mode on */
    CHECK(stu_should_flash(10000,10100,0,1,1)==0); /* engine running */
    CHECK(stu_should_flash(10000,10100,0,0,0)==0); /* auto disabled */
    /* Explicit web-triggered request: flashes the BUNDLED image only, no
     * auto_enabled gate (the request itself is the enable), but the same
     * idle + newer safety conditions still apply. */
    CHECK(stu_should_flash_request(10000,10100,10100,0,0)==1); /* target==bundled, newer, idle */
    CHECK(stu_should_flash_request(10000,10100,10100,1,0)==0); /* mode on */
    CHECK(stu_should_flash_request(10000,10100,10100,0,1)==0); /* engine running */
    CHECK(stu_should_flash_request(10000,10100,10000,0,0)==0); /* target != bundled (only bundled is on device) */
    CHECK(stu_should_flash_request(10100,10100,10100,0,0)==0); /* not newer (already running it) */
    CHECK(stu_should_flash_request(0,10100,10100,0,0)==0);     /* running unknown -> never flash */
    CHECK(stu_should_flash_request(10000,10100,0,0,0)==0);     /* target unparsed (0) -> no match */
    /* Parse the shadow-supplied target "M.m.p" string to the reg-2 encoding
     * (agent re-validates rather than trusting the cloud). */
    { uint16_t e=0;
      CHECK(stu_parse_version("1.1.1",&e)==1 && e==10101);
      CHECK(stu_parse_version("1.2.41",&e)==1 && e==(uint16_t)(1*10000u+2*100u+41u));
      CHECK(stu_parse_version("1.1.1 ",&e)==0);  /* trailing garbage */
      CHECK(stu_parse_version("1.1",&e)==0);     /* not M.m.p */
      CHECK(stu_parse_version("",&e)==0);
      CHECK(stu_parse_version(0,&e)==0); }
    { uint16_t v=0; char a[64]={0},b[64]={0};
      const char *j="{\"version\":\"1.1.0\",\"slotA\":\"g0b1-apu-1.1.0-slotA.bin\",\"slotB\":\"g0b1-apu-1.1.0-slotB.bin\"}";
      CHECK(stu_parse_manifest(j,&v,a,b,sizeof a)==0 && v==10100 && strcmp(a,"g0b1-apu-1.1.0-slotA.bin")==0 && strstr(b,"slotB")); }
    { uint16_t v=0; char a[64],b[64]; CHECK(stu_parse_manifest("{}",&v,a,b,sizeof a)==-1); }
    printf(fails?"test_stm32_update FAILED (%d)\n":"test_stm32_update ok\n",fails);
    return fails?1:0;
}
