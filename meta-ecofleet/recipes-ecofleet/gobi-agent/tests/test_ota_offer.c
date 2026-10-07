#include "ota_offer.h"
#include <stdio.h>
#include <string.h>
static int fails;
#define CHECK(c) do{ if(!(c)){ printf("FAIL %s:%d %s\n",__FILE__,__LINE__,#c); fails++; } }while(0)
int main(void){
    char v[16];
    /* version validity */
    CHECK(ota_ver_valid("1.2.73"));
    CHECK(!ota_ver_valid("1.2"));       CHECK(!ota_ver_valid("1.2.3.4"));
    CHECK(!ota_ver_valid("v1.2.3"));    CHECK(!ota_ver_valid("1.2.3-rc1"));
    CHECK(!ota_ver_valid("1..3"));      CHECK(!ota_ver_valid(""));
    CHECK(!ota_ver_valid("123456.1.1")); CHECK(!ota_ver_valid(NULL));

    /* compare: numeric, not lexical */
    CHECK(ota_ver_cmp("1.2.9","1.2.10") < 0);
    CHECK(ota_ver_cmp("1.10.0","1.9.9") > 0);
    CHECK(ota_ver_cmp("1.2.73","1.2.73") == 0);
    CHECK(ota_ver_cmp("garbage","1.0.0") < 0);
    CHECK(ota_ver_cmp("1.0.0","garbage") > 0);

    /* manifest parse */
    CHECK(ota_parse_latest("{\"version\":\"1.2.74\",\"published\":\"x\"}", v, sizeof v) && strcmp(v,"1.2.74")==0);
    CHECK(!ota_parse_latest("{\"published\":\"x\"}", v, sizeof v));
    CHECK(!ota_parse_latest("{\"version\":174}", v, sizeof v));
    CHECK(!ota_parse_latest("{\"version\":\"1.2.74-rc1\"}", v, sizeof v));
    CHECK(!ota_parse_latest("<html>404</html>", v, sizeof v));
    CHECK(!ota_parse_latest("{\"version\":\"1.2.74\"}", v, 4));   /* too small buffer */
    CHECK(!ota_parse_latest(NULL, v, sizeof v));

    /* busy */
    CHECK(ota_status_busy("downloading 1.2.74"));
    CHECK(ota_status_busy("installing 1.2.74"));
    CHECK(!ota_status_busy("idle")); CHECK(!ota_status_busy("failed: install 1.2.74 (rc 1)"));
    CHECK(!ota_status_busy("success 1.2.74")); CHECK(!ota_status_busy(NULL));

    /* decide */
    CHECK(ota_decide("1.2.73","1.2.74",false,false) == OTA_OFFER_AVAILABLE);
    CHECK(ota_decide("1.2.73","1.2.73",false,false) == OTA_OFFER_NONE);   /* same */
    CHECK(ota_decide("1.2.74","1.2.73",false,false) == OTA_OFFER_NONE);   /* no downgrade */
    CHECK(ota_decide("1.2.73","bad",false,false)    == OTA_OFFER_NONE);
    CHECK(ota_decide("1.2.73","1.2.74",true,false)  == OTA_OFFER_BLOCKED_BUSY);
    CHECK(ota_decide("1.2.73","1.2.74",false,true)  == OTA_OFFER_BLOCKED_BUSY);
    CHECK(ota_decide("","1.2.74",false,false)       == OTA_OFFER_AVAILABLE); /* unknown running */
    CHECK(ota_decide("1.2.73","",false,false)       == OTA_OFFER_NONE);

    printf(fails?"test_ota_offer FAILED (%d)\n":"test_ota_offer ok\n", fails);
    return fails?1:0;
}
