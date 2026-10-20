#ifndef NET_INFO_H
#define NET_INFO_H

/* The unit's LAN addresses, for the dashboard (shadow reported.network): so a
 * unit can be found on its network for SSH without looking at the router.
 * Host test: tests/test_net_info.c. */

#include <stdbool.h>

struct ifaddrs;

/* Which interface carries the default route (lowest metric wins). */
typedef enum {
    NET_PRIMARY_NONE = 0,    /* no default route                             */
    NET_PRIMARY_WIFI,        /* wlan0                                        */
    NET_PRIMARY_ETH,         /* eth0                                         */
    NET_PRIMARY_OTHER,       /* some other interface (e.g. a modem)          */
} net_primary_t;

typedef struct {
    char wifi_ip[16];        /* wlan0 IPv4, "" = none                        */
    char wifi_ssid[33];      /* associated network, "" = not associated      */
    int  wifi_signal_dbm;    /* valid only when wifi_signal_valid            */
    bool wifi_signal_valid;
    char eth_ip[16];         /* eth0 IPv4, "" = none                         */
    net_primary_t primary;   /* interface the unit's traffic goes out on     */
} net_info_t;

/* Read everything from the running system: getifaddrs(), the SSID from the
 * WiFi driver (Linux wireless-extensions ioctl) and the signal from
 * /proc/net/wireless. Fields that can't be read stay empty / invalid. */
void net_info_read(net_info_t *out);

/* Clear OUT and fill wifi_ip / eth_ip from the first IPv4 address of wlan0 /
 * eth0 in a getifaddrs() list (LIST may be NULL). */
void net_info_from_ifaddrs(net_info_t *out, const struct ifaddrs *list);

/* Signal level in dBm for IFNAME from the text of /proc/net/wireless. False
 * when the interface isn't listed or its level isn't a real signal (0 or
 * above, as when it isn't associated). */
bool net_wireless_signal_dbm(const char *proc_text, const char *ifname, int *dbm);

/* The interface holding the lowest-metric default route that is up, from the
 * text of /proc/net/route. */
net_primary_t net_primary(const char *proc_route_text);

#endif
