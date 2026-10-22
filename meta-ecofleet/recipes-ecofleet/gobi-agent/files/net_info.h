#ifndef NET_INFO_H
#define NET_INFO_H

/* The unit's LAN addresses, for the dashboard (shadow reported.network): so a
 * unit can be found on its network for SSH without looking at the router.
 * Host test: tests/test_net_info.c. */

#include <stdbool.h>

struct ifaddrs;
struct in_addr;

/* Which interface the kernel routes the unit's internet traffic through. */
typedef enum {
    NET_PRIMARY_NONE = 0,    /* no route to the internet                     */
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
 * WiFi driver (Linux wireless-extensions ioctl), the signal from
 * /proc/net/wireless, and the primary interface from the kernel's route lookup
 * for an internet address. Fields that can't be read stay empty / invalid /
 * NET_PRIMARY_NONE. */
void net_info_read(net_info_t *out);

/* Clear OUT and fill wifi_ip / eth_ip from the first IPv4 address of wlan0 /
 * eth0 in a getifaddrs() list (LIST may be NULL). */
void net_info_from_ifaddrs(net_info_t *out, const struct ifaddrs *list);

/* Signal level in dBm for IFNAME from the text of /proc/net/wireless. False
 * when the interface isn't listed or its level isn't a real signal (0 or
 * above, as when it isn't associated). */
bool net_wireless_signal_dbm(const char *proc_text, const char *ifname, int *dbm);

/* The interface in a getifaddrs() list that holds SRC, the local address the
 * route lookup picked. NONE when SRC is NULL (no route) or no interface holds
 * it; OTHER when it isn't eth0 or wlan0. */
net_primary_t net_primary_from_ifaddrs(const struct ifaddrs *list, const struct in_addr *src);

#endif
