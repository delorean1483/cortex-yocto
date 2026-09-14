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
    { uint16_t v=0; char a[64]={0},b[64]={0};
      const char *j="{\"version\":\"1.1.0\",\"slotA\":\"g0b1-apu-1.1.0-slotA.bin\",\"slotB\":\"g0b1-apu-1.1.0-slotB.bin\"}";
      CHECK(stu_parse_manifest(j,&v,a,b,sizeof a)==0 && v==10100 && strcmp(a,"g0b1-apu-1.1.0-slotA.bin")==0 && strstr(b,"slotB")); }
    { uint16_t v=0; char a[64],b[64]; CHECK(stu_parse_manifest("{}",&v,a,b,sizeof a)==-1); }
    printf(fails?"test_stm32_update FAILED (%d)\n":"test_stm32_update ok\n",fails);
    return fails?1:0;
}
