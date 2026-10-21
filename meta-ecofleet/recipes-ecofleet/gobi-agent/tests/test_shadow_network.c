/* Host test for reported.network in shadow.c: the unit's LAN addresses for the
 * dashboard. AWS merges reported updates key by key, so an interface that
 * loses its address (or WiFi that drops) must be sent as null, or the old
 * value stays in the shadow for good.
 *
 * shadow.c is compiled in (via #include); tests/mqstub/ stands in for
 * libmosquitto and the publish stub captures the payload.
 */
#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <string.h>
#include <stdbool.h>
#include <cjson/cJSON.h>

#include "shadow.h"
#include "shadow.c"

static char last_payload[4096];
int mosquitto_publish(struct mosquitto *m, int *mid, const char *topic,
                      int payloadlen, const void *payload, int qos, bool retain) {
    (void)m; (void)mid; (void)topic; (void)qos; (void)retain;
    if (payloadlen > 0 && (size_t)payloadlen < sizeof(last_payload)) {
        memcpy(last_payload, payload, (size_t)payloadlen);
        last_payload[payloadlen] = '\0';
    }
    return MOSQ_ERR_SUCCESS;
}
int mosquitto_subscribe(struct mosquitto *m, int *mid, const char *sub, int qos) {
    (void)m; (void)mid; (void)sub; (void)qos; return MOSQ_ERR_SUCCESS;
}

static int fails;
#define CHECK(c) do{ if(!(c)){ printf("FAIL %s:%d %s\n",__FILE__,__LINE__,#c); fails++; } }while(0)

/* reported.network of the last publish (owned by *root) */
static cJSON *network(cJSON **root) {
    *root = cJSON_Parse(last_payload);
    cJSON *rep = cJSON_GetObjectItem(cJSON_GetObjectItem(*root, "state"), "reported");
    return cJSON_GetObjectItem(rep, "network");
}

int main(void) {
    shadow_init("TEST-001", "1.2.79", NULL, NULL);
    shadow_reported_t r;
    cJSON *root, *net, *wifi, *eth;

    /* WiFi and Ethernet both up */
    memset(&r, 0, sizeof r);
    strcpy(r.network.wifi_ip, "192.168.0.211");
    strcpy(r.network.wifi_ssid, "HomeNet");
    r.network.wifi_signal_dbm = -58; r.network.wifi_signal_valid = true;
    strcpy(r.network.eth_ip, "192.168.0.94");
    shadow_publish_reported((struct mosquitto *)0x1, &r);
    net = network(&root);
    wifi = cJSON_GetObjectItem(net, "wifi"); eth = cJSON_GetObjectItem(net, "eth");
    CHECK(cJSON_IsObject(net) && cJSON_IsObject(wifi) && cJSON_IsObject(eth));
    CHECK(strcmp(cJSON_GetStringValue(cJSON_GetObjectItem(wifi, "ip")), "192.168.0.211") == 0);
    CHECK(strcmp(cJSON_GetStringValue(cJSON_GetObjectItem(wifi, "ssid")), "HomeNet") == 0);
    CHECK(cJSON_GetNumberValue(cJSON_GetObjectItem(wifi, "signal_dbm")) == -58);
    CHECK(strcmp(cJSON_GetStringValue(cJSON_GetObjectItem(eth, "ip")), "192.168.0.94") == 0);
    CHECK(cJSON_IsNull(cJSON_GetObjectItem(net, "primary")));   /* not known: null, not omitted */
    cJSON_Delete(root);

    /* the interface carrying the default route */
    r.network.primary = NET_PRIMARY_ETH;
    shadow_publish_reported((struct mosquitto *)0x1, &r);
    net = network(&root);
    CHECK(strcmp(cJSON_GetStringValue(cJSON_GetObjectItem(net, "primary")), "eth") == 0);
    cJSON_Delete(root);
    r.network.primary = NET_PRIMARY_WIFI;
    shadow_publish_reported((struct mosquitto *)0x1, &r);
    net = network(&root);
    CHECK(strcmp(cJSON_GetStringValue(cJSON_GetObjectItem(net, "primary")), "wifi") == 0);
    cJSON_Delete(root);
    /* some other interface (e.g. a modem) carries it: not one we list */
    r.network.primary = NET_PRIMARY_OTHER;
    shadow_publish_reported((struct mosquitto *)0x1, &r);
    net = network(&root);
    CHECK(strcmp(cJSON_GetStringValue(cJSON_GetObjectItem(net, "primary")), "other") == 0);
    cJSON_Delete(root);
    r.network.primary = NET_PRIMARY_NONE;

    /* Ethernet gone: eth is null, not omitted */
    r.network.eth_ip[0] = '\0';
    shadow_publish_reported((struct mosquitto *)0x1, &r);
    net = network(&root);
    CHECK(cJSON_IsNull(cJSON_GetObjectItem(net, "eth")));
    CHECK(cJSON_IsObject(cJSON_GetObjectItem(net, "wifi")));
    cJSON_Delete(root);

    /* WiFi has an address but no SSID / signal yet: those two are null */
    r.network.wifi_ssid[0] = '\0'; r.network.wifi_signal_valid = false;
    shadow_publish_reported((struct mosquitto *)0x1, &r);
    net = network(&root);
    wifi = cJSON_GetObjectItem(net, "wifi");
    CHECK(cJSON_IsNull(cJSON_GetObjectItem(wifi, "ssid")));
    CHECK(cJSON_IsNull(cJSON_GetObjectItem(wifi, "signal_dbm")));
    CHECK(strcmp(cJSON_GetStringValue(cJSON_GetObjectItem(wifi, "ip")), "192.168.0.211") == 0);
    cJSON_Delete(root);

    /* associated but no address yet: wifi still reported (ssid), ip null */
    r.network.wifi_ip[0] = '\0'; strcpy(r.network.wifi_ssid, "HomeNet");
    shadow_publish_reported((struct mosquitto *)0x1, &r);
    net = network(&root);
    wifi = cJSON_GetObjectItem(net, "wifi");
    CHECK(cJSON_IsObject(wifi) && cJSON_IsNull(cJSON_GetObjectItem(wifi, "ip")));
    cJSON_Delete(root);

    /* nothing up: both null, network itself still present */
    memset(&r.network, 0, sizeof r.network);
    shadow_publish_reported((struct mosquitto *)0x1, &r);
    net = network(&root);
    CHECK(cJSON_IsObject(net));
    CHECK(cJSON_IsNull(cJSON_GetObjectItem(net, "wifi")) && cJSON_IsNull(cJSON_GetObjectItem(net, "eth")));
    cJSON_Delete(root);

    printf(fails ? "test_shadow_network FAILED (%d)\n" : "test_shadow_network ok\n", fails);
    return fails ? 1 : 0;
}
