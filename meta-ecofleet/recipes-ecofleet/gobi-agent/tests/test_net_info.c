/* Host test for net_info.c's pure parts: the WiFi signal level from
 * /proc/net/wireless text, and the wlan0/eth0 IPv4 pick from a getifaddrs()
 * list. (The ioctl that reads the SSID is Linux-only and not run here.) */
#define _DEFAULT_SOURCE
#include <stdio.h>
#include <string.h>
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <ifaddrs.h>

#include "net_info.h"

static int fails;
#define CHECK(c) do{ if(!(c)){ printf("FAIL %s:%d %s\n",__FILE__,__LINE__,#c); fails++; } }while(0)

static const char *PROC_HDR =
    "Inter-| sta-|   Quality        |   Discarded packets               | Missed | WE\n"
    " face | tus | link level noise |  nwid  crypt   frag  retry   misc | beacon | 22\n";

static void signal_tests(void) {
    char buf[512];
    int dbm = 0;

    snprintf(buf, sizeof buf, "%s wlan0: 0000   70.  -58.  -256        0      0      0      0      0        0\n", PROC_HDR);
    CHECK(net_wireless_signal_dbm(buf, "wlan0", &dbm) && dbm == -58);

    /* other interfaces before ours, and a name that only starts the same */
    snprintf(buf, sizeof buf, "%s  uap0: 0000    0.  -90.  -256        0      0      0      0      0        0\n"
                              "wlan01: 0000   10.  -77.  -256        0      0      0      0      0        0\n"
                              " wlan0: 0000   55.  -63.  -256        0      0      0      0      0        0\n", PROC_HDR);
    CHECK(net_wireless_signal_dbm(buf, "wlan0", &dbm) && dbm == -63);

    /* not associated: level 0 (or positive) is not a signal */
    snprintf(buf, sizeof buf, "%s wlan0: 0000    0.    0.     0        0      0      0      0      0        0\n", PROC_HDR);
    CHECK(!net_wireless_signal_dbm(buf, "wlan0", &dbm));

    /* interface missing, empty text, NULL text */
    CHECK(!net_wireless_signal_dbm(PROC_HDR, "wlan0", &dbm));
    CHECK(!net_wireless_signal_dbm("", "wlan0", &dbm));
    CHECK(!net_wireless_signal_dbm(NULL, "wlan0", &dbm));
}

static struct sockaddr_in sa(const char *ip) {
    struct sockaddr_in a;
    memset(&a, 0, sizeof a);
    a.sin_family = AF_INET;
    inet_pton(AF_INET, ip, &a.sin_addr);
    return a;
}

static void ifaddrs_tests(void) {
    struct sockaddr_in lo = sa("127.0.0.1"), w = sa("192.168.0.211"), e = sa("192.168.0.94");
    struct sockaddr_in6 w6;
    memset(&w6, 0, sizeof w6);
    w6.sin6_family = AF_INET6;

    /* list: lo, wlan0 (IPv6 first, then IPv4), eth0 (no address), eth0 IPv4 */
    struct ifaddrs i_e  = { .ifa_next = NULL,  .ifa_name = "eth0",  .ifa_addr = (struct sockaddr *)&e };
    struct ifaddrs i_e0 = { .ifa_next = &i_e,  .ifa_name = "eth0",  .ifa_addr = NULL };
    struct ifaddrs i_w  = { .ifa_next = &i_e0, .ifa_name = "wlan0", .ifa_addr = (struct sockaddr *)&w };
    struct ifaddrs i_w6 = { .ifa_next = &i_w,  .ifa_name = "wlan0", .ifa_addr = (struct sockaddr *)&w6 };
    struct ifaddrs i_lo = { .ifa_next = &i_w6, .ifa_name = "lo",    .ifa_addr = (struct sockaddr *)&lo };

    net_info_t n;
    memset(&n, 0x55, sizeof n);              /* garbage in: must be cleared */
    net_info_from_ifaddrs(&n, &i_lo);
    CHECK(strcmp(n.wifi_ip, "192.168.0.211") == 0);
    CHECK(strcmp(n.eth_ip, "192.168.0.94") == 0);
    CHECK(n.wifi_ssid[0] == '\0' && !n.wifi_signal_valid);

    /* only loopback: both empty */
    i_lo.ifa_next = NULL;
    net_info_from_ifaddrs(&n, &i_lo);
    CHECK(n.wifi_ip[0] == '\0' && n.eth_ip[0] == '\0');

    /* empty list */
    net_info_from_ifaddrs(&n, NULL);
    CHECK(n.wifi_ip[0] == '\0' && n.eth_ip[0] == '\0');
}

static const char *ROUTE_HDR =
    "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT\n";

static void primary_tests(void) {
    char buf[1024];

    /* .86 today: both up, Ethernet metric 10, WiFi 2048 (WiFi listed first) */
    snprintf(buf, sizeof buf, "%s"
        "wlan0\t00000000\t0100A8C0\t0003\t0\t0\t2048\t00000000\t0\t0\t0\n"
        "eth0\t00000000\t0100A8C0\t0003\t0\t0\t10\t00000000\t0\t0\t0\n"
        "eth0\t0000A8C0\t00000000\t0001\t0\t0\t10\t00FFFFFF\t0\t0\t0\n", ROUTE_HDR);
    CHECK(net_primary(buf) == NET_PRIMARY_ETH);

    /* WiFi only (R1 today) */
    snprintf(buf, sizeof buf, "%s"
        "wlan0\t00000000\t0100A8C0\t0003\t0\t0\t2048\t00000000\t0\t0\t0\n", ROUTE_HDR);
    CHECK(net_primary(buf) == NET_PRIMARY_WIFI);

    /* a lower-metric default on another interface (e.g. a future modem) */
    snprintf(buf, sizeof buf, "%s"
        "eth0\t00000000\t0100A8C0\t0003\t0\t0\t10\t00000000\t0\t0\t0\n"
        "wwan0\t00000000\t0101A8C0\t0003\t0\t0\t5\t00000000\t0\t0\t0\n", ROUTE_HDR);
    CHECK(net_primary(buf) == NET_PRIMARY_OTHER);

    /* a default route that isn't up (flags without RTF_UP) doesn't count */
    snprintf(buf, sizeof buf, "%s"
        "eth0\t00000000\t0100A8C0\t0002\t0\t0\t10\t00000000\t0\t0\t0\n"
        "wlan0\t00000000\t0100A8C0\t0003\t0\t0\t2048\t00000000\t0\t0\t0\n", ROUTE_HDR);
    CHECK(net_primary(buf) == NET_PRIMARY_WIFI);

    /* no default route, empty, NULL */
    snprintf(buf, sizeof buf, "%s"
        "eth0\t0000A8C0\t00000000\t0001\t0\t0\t10\t00FFFFFF\t0\t0\t0\n", ROUTE_HDR);
    CHECK(net_primary(buf) == NET_PRIMARY_NONE);
    CHECK(net_primary(ROUTE_HDR) == NET_PRIMARY_NONE);
    CHECK(net_primary("") == NET_PRIMARY_NONE);
    CHECK(net_primary(NULL) == NET_PRIMARY_NONE);
}

int main(void) {
    signal_tests();
    ifaddrs_tests();
    primary_tests();
    printf(fails ? "test_net_info FAILED (%d)\n" : "test_net_info ok\n", fails);
    return fails ? 1 : 0;
}
