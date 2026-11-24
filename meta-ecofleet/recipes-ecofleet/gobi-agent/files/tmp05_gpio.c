/* tmp05_gpio.c — Linux sampler for the TMP05 cab sensor (see tmp05.h).
 * GPIO character device v2 uAPI only (no libgpiod): find the line named
 * "CAB_TEMP", then every TMP05_PERIOD_S claim it for both edges, collect about
 * a second of events, release it and convert. Claiming per measurement keeps
 * the kernel's event FIFO from overflowing between reads (~17 edges/s). */
#define _GNU_SOURCE
#include "tmp05.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/gpio.h>
#include <poll.h>
#include <pthread.h>
#include <stdio.h>
#include <string.h>
#include <sys/ioctl.h>
#include <syslog.h>
#include <time.h>
#include <unistd.h>

#define LINE_NAME   "CAB_TEMP"
#define MAX_EDGES   16u          /* ~7 periods at 25 degC                 */
#define WINDOW_MS   1200         /* enough for MAX_EDGES at -40 degC       */

static char            s_chip[64];
static unsigned        s_offset;
static pthread_mutex_t s_lock = PTHREAD_MUTEX_INITIALIZER;
static bool            s_have;
static int             s_c_x10;
static uint64_t        s_at_ms;

static uint64_t now_ms(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000u + (uint64_t)ts.tv_nsec / 1000000u;
}

/* Find LINE_NAME on any /dev/gpiochipN; fills s_chip / s_offset. */
static bool find_line(void)
{
    DIR *d = opendir("/dev");
    if (!d) return false;
    bool found = false;
    struct dirent *de;
    while (!found && (de = readdir(d)) != NULL) {
        if (strncmp(de->d_name, "gpiochip", 8) != 0) continue;
        char path[sizeof s_chip];
        snprintf(path, sizeof path, "/dev/%s", de->d_name);
        int fd = open(path, O_RDONLY | O_CLOEXEC);
        if (fd < 0) continue;
        struct gpiochip_info ci;
        memset(&ci, 0, sizeof ci);
        if (ioctl(fd, GPIO_GET_CHIPINFO_IOCTL, &ci) == 0) {
            for (unsigned i = 0; i < ci.lines; i++) {
                struct gpio_v2_line_info li;
                memset(&li, 0, sizeof li);
                li.offset = i;
                if (ioctl(fd, GPIO_V2_GET_LINEINFO_IOCTL, &li) == 0 &&
                    strcmp(li.name, LINE_NAME) == 0) {
                    snprintf(s_chip, sizeof s_chip, "%s", path);
                    s_offset = i;
                    found = true;
                    break;
                }
            }
        }
        close(fd);
    }
    closedir(d);
    return found;
}

/* One measurement: claim, collect, release. false + errno-ish log on failure. */
static bool measure(int *c_x10)
{
    int cfd = open(s_chip, O_RDONLY | O_CLOEXEC);
    if (cfd < 0) return false;
    struct gpio_v2_line_request rq;
    memset(&rq, 0, sizeof rq);
    rq.offsets[0] = s_offset;
    rq.num_lines = 1;
    snprintf(rq.consumer, sizeof rq.consumer, "gobi-agent-tmp05");
    rq.config.flags = GPIO_V2_LINE_FLAG_INPUT | GPIO_V2_LINE_FLAG_EDGE_RISING |
                      GPIO_V2_LINE_FLAG_EDGE_FALLING;
    rq.event_buffer_size = 2u * MAX_EDGES;
    int rc = ioctl(cfd, GPIO_V2_GET_LINE_IOCTL, &rq);
    close(cfd);
    if (rc < 0) return false;

    tmp05_edge_t e[MAX_EDGES];
    size_t n = 0;
    uint64_t end = now_ms() + WINDOW_MS;
    while (n < MAX_EDGES) {
        uint64_t t = now_ms();
        if (t >= end) break;
        struct pollfd p = { .fd = rq.fd, .events = POLLIN };
        if (poll(&p, 1, (int)(end - t)) <= 0) break;
        struct gpio_v2_line_event ev[MAX_EDGES];
        ssize_t got = read(rq.fd, ev, sizeof ev);
        if (got <= 0) break;
        for (size_t i = 0; i < (size_t)got / sizeof ev[0] && n < MAX_EDGES; i++) {
            e[n].rising = ev[i].id == GPIO_V2_LINE_EVENT_RISING_EDGE;
            e[n].t_ns   = ev[i].timestamp_ns;
            e[n].seq    = ev[i].line_seqno;
            n++;
        }
    }
    close(rq.fd);
    return tmp05_c_x10(e, n, c_x10);
}

static void *sampler(void *arg)
{
    (void)arg;
    unsigned bad = 0;
    for (;;) {
        int c;
        if (measure(&c)) {
            pthread_mutex_lock(&s_lock);
            bool first = !s_have;
            s_have = true;
            s_c_x10 = c;
            s_at_ms = now_ms();
            pthread_mutex_unlock(&s_lock);
            if (first || bad >= 3u)
                syslog(LOG_INFO, "tmp05: cab temperature %d.%d C", c / 10, (c < 0 ? -c : c) % 10);
            bad = 0;
        } else if (++bad == 3u) {
            syslog(LOG_WARNING, "tmp05: 3 measurements in a row rejected (no PWM on %s line %u?)",
                   s_chip, s_offset);
        }
        sleep(TMP05_PERIOD_S);
    }
    return NULL;
}

bool tmp05_start(void)
{
    if (!find_line()) {
        syslog(LOG_INFO, "tmp05: no %s GPIO line (no cab sensor on this board)", LINE_NAME);
        return false;
    }
    pthread_t th;
    if (pthread_create(&th, NULL, sampler, NULL) != 0) {
        syslog(LOG_ERR, "tmp05: sampler thread: %s", strerror(errno));
        return false;
    }
    pthread_detach(th);
    syslog(LOG_INFO, "tmp05: sampling %s line %u every %u s", s_chip, s_offset, TMP05_PERIOD_S);
    return true;
}

bool tmp05_latest(uint32_t max_age_ms, int *c_x10)
{
    pthread_mutex_lock(&s_lock);
    bool ok = s_have && now_ms() - s_at_ms <= max_age_ms;
    if (ok && c_x10) *c_x10 = s_c_x10;
    pthread_mutex_unlock(&s_lock);
    return ok;
}
