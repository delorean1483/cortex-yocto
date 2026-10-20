#define _DEFAULT_SOURCE
#include "net_info.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <ifaddrs.h>

#ifdef __linux__
#include <sys/ioctl.h>
#include <linux/wireless.h>
#endif

#define WIFI_IF "wlan0"
#define ETH_IF  "eth0"

void net_info_from_ifaddrs(net_info_t *out, const struct ifaddrs *list)
{
    memset(out, 0, sizeof(*out));
    for (const struct ifaddrs *i = list; i; i = i->ifa_next) {
        if (!i->ifa_name || !i->ifa_addr || i->ifa_addr->sa_family != AF_INET)
            continue;
        char *dst = NULL;
        if (strcmp(i->ifa_name, WIFI_IF) == 0)     dst = out->wifi_ip;
        else if (strcmp(i->ifa_name, ETH_IF) == 0) dst = out->eth_ip;
        if (!dst || dst[0])
            continue;                          /* not ours, or already have one */
        const struct sockaddr_in *a = (const struct sockaddr_in *)(const void *)i->ifa_addr;
        if (!inet_ntop(AF_INET, &a->sin_addr, dst, sizeof(out->wifi_ip)))
            dst[0] = '\0';
    }
}

bool net_wireless_signal_dbm(const char *proc_text, const char *ifname, int *dbm)
{
    if (!proc_text || !ifname || !dbm)
        return false;
    size_t n = strlen(ifname);
    for (const char *line = proc_text; *line; ) {
        const char *p = line;
        while (*p == ' ') p++;
        if (strncmp(p, ifname, n) == 0 && p[n] == ':') {
            /* "wlan0: <status> <link>. <level>. <noise> ..." */
            float link, level;
            if (sscanf(p + n + 1, " %*s %f %f", &link, &level) == 2 && level < 0) {
                *dbm = (int)level;
                return true;
            }
            return false;
        }
        const char *nl = strchr(line, '\n');
        if (!nl) break;
        line = nl + 1;
    }
    return false;
}

static void read_ssid(char *ssid, size_t len)
{
    ssid[0] = '\0';
#ifdef __linux__
    int fd = socket(AF_INET, SOCK_DGRAM, 0);
    if (fd < 0)
        return;
    struct iwreq req;
    char buf[IW_ESSID_MAX_SIZE + 1];
    memset(&req, 0, sizeof(req));
    memset(buf, 0, sizeof(buf));
    strncpy(req.ifr_name, WIFI_IF, IFNAMSIZ - 1);
    req.u.essid.pointer = buf;
    req.u.essid.length  = IW_ESSID_MAX_SIZE;
    if (ioctl(fd, SIOCGIWESSID, &req) == 0 && req.u.essid.length > 0) {
        size_t n = req.u.essid.length < len - 1 ? req.u.essid.length : len - 1;
        memcpy(ssid, buf, n);
        ssid[n] = '\0';
    }
    close(fd);
#else
    (void)len;
#endif
}

void net_info_read(net_info_t *out)
{
    struct ifaddrs *list = NULL;
    if (getifaddrs(&list) == 0) {
        net_info_from_ifaddrs(out, list);
        freeifaddrs(list);
    } else {
        memset(out, 0, sizeof(*out));
    }

    read_ssid(out->wifi_ssid, sizeof(out->wifi_ssid));

    FILE *f = fopen("/proc/net/wireless", "r");
    if (f) {
        char text[1024];
        size_t n = fread(text, 1, sizeof(text) - 1, f);
        text[n] = '\0';
        fclose(f);
        out->wifi_signal_valid = net_wireless_signal_dbm(text, WIFI_IF, &out->wifi_signal_dbm);
    }
}
