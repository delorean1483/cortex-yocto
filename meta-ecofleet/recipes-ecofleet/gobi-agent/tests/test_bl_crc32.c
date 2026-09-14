#include "bl_crc32.h"
#include <string.h>
#include <stdio.h>
static int fails;
#define CHECK_EQ_HEX(a,b) do{ if((a)!=(b)){ printf("FAIL %s:%d %08x != %08x\n",__FILE__,__LINE__,(unsigned)(a),(unsigned)(b)); fails++; } }while(0)
int main(void){
    CHECK_EQ_HEX(bl_crc32((const uint8_t*)"",0), 0x00000000u);
    CHECK_EQ_HEX(bl_crc32((const uint8_t*)"123456789",9), 0xCBF43926u); /* standard check value */
    CHECK_EQ_HEX(bl_crc32((const uint8_t*)"The quick brown fox jumps over the lazy dog",43), 0x414FA339u);
    printf(fails? "test_bl_crc32 FAILED (%d)\n":"test_bl_crc32 ok\n", fails);
    return fails?1:0;
}
