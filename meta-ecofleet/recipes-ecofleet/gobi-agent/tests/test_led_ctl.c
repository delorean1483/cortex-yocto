#include "led_ctl.h"
#include <cjson/cJSON.h>
#include <stdio.h>
static int fails;
#define CHECK(c) do{ if(!(c)){ printf("FAIL %s:%d %s\n",__FILE__,__LINE__,#c); fails++; } }while(0)

static bool parse_cmd(const char *json, led_color_t *out){
    cJSON *it = cJSON_Parse(json);
    bool ok = led_parse_cmd(it, out);
    cJSON_Delete(it);
    return ok;
}

static void test_parse_cmd_ok(void){
    led_color_t c = {0};
    CHECK(parse_cmd("[255,128,0]", &c));
    CHECK(c.have && c.r==255 && c.g==128 && c.b==0);
}

static void test_parse_cmd_rejects(void){
    const char *bad[] = {"[256,0,0]","[-1,0,0]","[1,2]","[1,2,3,4]","\"red\"","[1.5,0,0]","null","[1,\"2\",3]"};
    for (size_t i = 0; i < sizeof bad/sizeof bad[0]; i++){
        led_color_t c = {0};
        CHECK(!parse_cmd(bad[i], &c));
        CHECK(!c.have);
    }
    led_color_t c = {0};
    CHECK(!led_parse_cmd(NULL, &c));
    CHECK(!led_parse_cmd(NULL, NULL));
}

static void test_parse_saved_ok(void){
    led_color_t c = {0};
    CHECK(led_parse_saved("{\"h\":30,\"s\":1,\"v\":1,\"r\":255,\"g\":128,\"b\":0}", &c));
    CHECK(c.have && c.r==255 && c.g==128 && c.b==0);
}

static void test_parse_saved_rejects_bad(void){
    const char *bad[] = {"","{","{\"r\":1,\"g\":2}","{\"r\":300,\"g\":0,\"b\":0}","{\"r\":1.5,\"g\":0,\"b\":0}"};
    for (size_t i = 0; i < sizeof bad/sizeof bad[0]; i++){
        led_color_t c = {0};
        CHECK(!led_parse_saved(bad[i], &c));
        CHECK(!c.have);
    }
    CHECK(!led_parse_saved(NULL, &(led_color_t){0}));
}

static void test_should_write_needs_present_read(void){
    led_color_t d = {true,1,2,3};
    led_hw_t hw = {false,0,0,0,LED_ST_PRESENT};
    CHECK(!led_should_write(&d,&hw));            /* read failed */
    hw = (led_hw_t){true,0,0,0,0};
    CHECK(!led_should_write(&d,&hw));            /* driver absent */
    CHECK(!led_present(&hw));
    hw = (led_hw_t){true,1,2,3,LED_ST_PRESENT|LED_ST_APPLY_OK};
    CHECK(led_present(&hw));
    CHECK(!led_should_write(&d,&hw));            /* already applied */
    hw = (led_hw_t){true,0,0,0,LED_ST_PRESENT};
    CHECK(led_should_write(&d,&hw));             /* differs */
    hw = (led_hw_t){true,1,2,4,LED_ST_PRESENT};
    CHECK(led_should_write(&d,&hw));             /* one channel differs */
    d.have = false;
    CHECK(!led_should_write(&d,&hw));            /* nothing desired */
}

int main(void){
    test_parse_cmd_ok();
    test_parse_cmd_rejects();
    test_parse_saved_ok();
    test_parse_saved_rejects_bad();
    test_should_write_needs_present_read();
    printf(fails?"test_led_ctl FAILED (%d)\n":"test_led_ctl ok\n", fails);
    return fails?1:0;
}
