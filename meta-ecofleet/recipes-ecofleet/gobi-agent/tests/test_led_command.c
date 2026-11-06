
/* Exercise the actual command-file handler with a fake Modbus boundary.
 * No device, service, MQTT connection or production file is touched. */
#include "../files/config.h"
static char test_command_path[128], test_latest_path[128];
#undef COMMAND_JSON_PATH
#undef LATEST_JSON_PATH
#define COMMAND_JSON_PATH test_command_path
#define LATEST_JSON_PATH test_latest_path
#ifndef AGENT_MAIN_SOURCE
#define AGENT_MAIN_SOURCE "../files/main.c"
#endif
#define modbus_write_registers __wrap_modbus_write_registers
#define modbus_read_registers __wrap_modbus_read_registers
#define modbus_write_register __wrap_modbus_write_register
#define modbus_connect __wrap_modbus_connect
#define main agent_unused_program_main
#include AGENT_MAIN_SOURCE
#undef main
static int writes, reads, unexpected;
static uint16_t sent[3];
int __wrap_modbus_write_registers(modbus_t *ctx, int addr, int n, const uint16_t *v) {
    (void)ctx;
    if (addr != REG_LED_RED || n != 3) { unexpected++; return -1; }
    writes++;
    memcpy(sent,v,sizeof sent);
    return 3;
}
int __wrap_modbus_read_registers(modbus_t *ctx,int addr,int n,uint16_t *v) {
    (void)ctx;
    if(addr != REG_LED_RED || n != 4){unexpected++;return -1;}
    reads++;
    v[0]=sent[0];v[1]=sent[1];v[2]=sent[2];v[3]=LED_ST_PRESENT|LED_ST_APPLY_OK;
    return 4;
}
int __wrap_modbus_write_register(modbus_t *ctx,int addr,const uint16_t v) {
    (void)ctx;(void)addr;(void)v;unexpected++;return -1;
}
int __wrap_modbus_connect(modbus_t *ctx) {(void)ctx;unexpected++;return -1;}
static int fails;
#define CHECK(x) do {if(!(x)){printf("FAIL line %d: %s\n",__LINE__,#x);fails++;}}while(0)
static void command(const char *json,bool link,bool supported,uint16_t status) {
    g_link_ok=link;
    memset(&g_last_t,0,sizeof g_last_t);
    g_last_t.led.read_ok=supported;g_last_t.led.status=status;
    writes=reads=unexpected=0;
    FILE *f=fopen(COMMAND_JSON_PATH,"w");
    if (!f) { perror("test command fopen"); exit(2); }
    fputs(json,f);fclose(f);
    apply_command_file();
    CHECK(access(COMMAND_JSON_PATH,F_OK)!=0);
    CHECK(unexpected==0);
}
int main(void) {
    char test_dir[] = "/tmp/gobi-led-command-XXXXXX";
    if (mkdtemp(test_dir) == NULL) { perror("mkdtemp"); return 2; }
    snprintf(test_command_path, sizeof test_command_path, "%s/command.json", test_dir);
    snprintf(test_latest_path, sizeof test_latest_path, "%s/latest.json", test_dir);
    command("{\"led_rgb\":[64,12,0]}",true,true,0);
    CHECK(writes==1 && reads==1);
    CHECK(sent[0]==64 && sent[1]==12 && sent[2]==0);
    CHECK(g_led_desired.have && g_led_desired.r==64 && g_led_desired.b==0);
    command("{\"led_rgb\":[32,6,0]}",true,true,LED_ST_PRESENT);
    CHECK(writes==1 && reads==1);
    CHECK(sent[0]==32 && sent[1]==6 && sent[2]==0);
    command("{\"led_rgb\":[16,3,0]}",false,true,0);
    CHECK(writes==0 && reads==0);
    CHECK(g_led_desired.r==16);
    command("{\"led_rgb\":[8,2,0]}",true,false,0);
    CHECK(writes==0 && reads==0);
    CHECK(g_led_desired.r==8);
    command("{\"led_rgb\":[256,0,0]}",true,true,LED_ST_PRESENT);
    CHECK(writes==0 && reads==0);
    CHECK(g_led_desired.r==8);
    unlink(LATEST_JSON_PATH);
    rmdir(test_dir);
    printf("test_led_command: 5 scenarios, %d failures\n",fails);
    return fails?1:0;
}
