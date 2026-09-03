#include "bl_frame.h"
#include <string.h>
#include <stdio.h>
static int fails;
#define CHECK(c) do{ if(!(c)){ printf("FAIL %s:%d %s\n",__FILE__,__LINE__,#c); fails++; } }while(0)
int main(void){
    uint8_t f[300];
    /* CRC16/Modbus known vector: 01 03 00 00 00 0A -> CRC 0xC5CD (lo C5, hi CD)... use libmodbus-standard 01 04 02 FF FF -> B880? use the textbook 01 03 00 00 00 0A -> CDC5 */
    { uint8_t m[]={0x01,0x03,0x00,0x00,0x00,0x0A}; uint16_t c=bl_crc16(m,6); CHECK(c==0xCDC5u); }
    /* read reg 2 -> FC 0x03 start=1 qty=1 */
    { uint16_t n=mb_req_read_reg(f,2); n=bl_frame_finalize(f,n);
      CHECK(f[0]==1&&f[1]==0x03&&f[2]==0x00&&f[3]==0x01&&f[4]==0x00&&f[5]==0x01&&n==8); }
    /* write reg 35 = 0x00A5 -> FC 0x06 addr=34 val=0x00A5 */
    { uint16_t n=mb_req_write_reg(f,35,0x00A5); (void)bl_frame_finalize(f,n);
      CHECK(f[1]==0x06&&f[2]==0x00&&f[3]==0x22&&f[4]==0x00&&f[5]==0xA5); }
    /* INFO req */
    { uint16_t n=bl_req_ctrl(f,BL_SUB_INFO); CHECK(n==3&&f[1]==0x41&&f[2]==0x01); }
    /* VERIFY req: length + crc32 big-endian */
    { uint16_t n=bl_req_verify(f,0x00000100u,0xDEADBEEFu);
      CHECK(n==11&&f[2]==0x03&&f[3]==0&&f[4]==0&&f[5]==1&&f[6]==0&&f[7]==0xDE&&f[8]==0xAD&&f[9]==0xBE&&f[10]==0xEF); }
    /* DATA req: offset BE + len + data */
    { uint8_t d[4]={0xA,0xB,0xC,0xD}; uint16_t n=bl_req_data(f,0x1000u,d,4);
      CHECK(n==11&&f[1]==0x42&&f[2]==0&&f[3]==0&&f[4]==0x10&&f[5]==0&&f[6]==4&&f[7]==0xA&&f[10]==0xD); }
    /* parse INFO reply (12-byte body + crc) */
    { uint8_t r[]={1,0x41,0x01, 1, 1, 0x00,0x03,0x80,0x00, 0x00,0xF0, 1, 0,0}; /* slot B, size 0x38000, chunk 0x00F0=240 */
      uint16_t rl=bl_frame_finalize(r,12); bl_info_t info;
      CHECK(bl_resp_info(r,rl,&info)==0 && info.inactive_slot==1 && info.slot_size==0x38000u && info.chunk_max==240 && info.crc_algo==1); }
    /* parse ACK vs NAK */
    { uint8_t a[]={1,0x41,0x02,0x00,0,0}; uint16_t al=bl_frame_finalize(a,4); uint8_t e=0;
      CHECK(bl_resp_ack(a,al,0x41,&e)==0); }
    { uint8_t nk[]={1,0xC1,BL_ERR_CRC,0,0}; uint16_t nl=bl_frame_finalize(nk,3); uint8_t e=0;
      CHECK(bl_resp_ack(nk,nl,0x41,&e)==1 && e==BL_ERR_CRC); }
    /* read-reg reply parse: reg 2 = 10100 */
    { uint8_t rr[]={1,0x03,0x02,0x27,0x74,0,0}; uint16_t rl=bl_frame_finalize(rr,5); uint16_t v=0;
      CHECK(mb_resp_read_reg(rr,rl,&v)==0 && v==10100); }
    printf(fails?"test_bl_frame FAILED (%d)\n":"test_bl_frame ok\n",fails);
    return fails?1:0;
}
