/* Feature-test macro must precede all includes: needed for
 * clock_gettime()/CLOCK_MONOTONIC and nanosleep() under -std=c11 on
 * glibc (the Yocto target); harmless on the macOS/BSD host used for the
 * compile-only check, where these are visible unconditionally. */
#define _POSIX_C_SOURCE 200809L

#include "bl_transport_serial.h"
#include "bl_frame.h"

#include <modbus.h>

#include <termios.h>
#include <poll.h>
#include <unistd.h>
#include <string.h>
#include <time.h>
#include <errno.h>

/* RTU inter-byte idle gap used to delimit a response frame: >= 3.5 char
 * times at 9600 8N1 (1 char ~= 1.146 ms, 3.5 chars ~= 4.01 ms). 5 ms adds
 * a little scheduling-jitter margin without meaningfully eating into the
 * overall timeout_ms budget. */
#define BL_IDLE_GAP_MS 5

/* Bounded settle after COMMIT/enter-bootloader before resuming polling;
 * the session's own INFO/reg-2 retry loops cover the rest of the actual
 * reset wait, so this is deliberately not a "wait until really back". */
#define BL_RESET_SETTLE_NS (300L * 1000L * 1000L) /* 300 ms */

/* Per-transport state, reached by xfer()/wait_reset() only via their
 * void *ctx argument -- never referenced by name from those callbacks --
 * so this module-level instance is just storage, not a hidden global
 * dependency. One instance is sufficient: gobi-agent flashes one STM32
 * device at a time, single-threaded, via a single bl_transport_t. */
typedef struct {
    int fd;
} bl_transport_serial_ctx_t;

static bl_transport_serial_ctx_t g_serial_ctx;

/* Send req (retrying the write on EINTR/partial write) and collect
 * exactly one RTU response frame, delimited by an inter-byte idle gap of
 * >= BL_IDLE_GAP_MS. timeout_ms is one deadline for the whole exchange --
 * send plus how long we wait for the response to begin and complete.
 * Returns the framed response length (bl_frame_check() already
 * validated) or -1 on timeout / bus error / invalid frame / overflow. */
static int bl_transport_serial_xfer(void *ctx_, const uint8_t *req,
                                     uint16_t req_len, uint8_t *resp,
                                     uint16_t resp_cap, uint32_t timeout_ms)
{
    const bl_transport_serial_ctx_t *sc = (const bl_transport_serial_ctx_t *)ctx_;
    int fd;
    uint16_t n = 0u;
    struct timespec t0;

    if (sc == NULL || req == NULL || resp == NULL || resp_cap == 0u) {
        return -1;
    }
    fd = sc->fd;

    if (tcflush(fd, TCIOFLUSH) != 0) {
        return -1;
    }

    /* Captured once, up front, and reused by both the write loop below
     * and the read loop further down: timeout_ms bounds the whole xfer
     * (send + receive), not each phase separately. */
    if (clock_gettime(CLOCK_MONOTONIC, &t0) != 0) {
        return -1;
    }

    {
        const uint8_t *wp = req;
        size_t wremaining = (size_t)req_len;

        while (wremaining > 0u) {
            struct timespec tnow;
            long elapsed_ms;
            long left_ms;
            ssize_t wn;

            if (clock_gettime(CLOCK_MONOTONIC, &tnow) != 0) {
                return -1;
            }
            elapsed_ms = (tnow.tv_sec - t0.tv_sec) * 1000L +
                         (tnow.tv_nsec - t0.tv_nsec) / 1000000L;
            left_ms = (long)timeout_ms - elapsed_ms;
            if (left_ms <= 0L) {
                /* Deadline elapsed while still trying to get the request
                 * out -- a wedged write must not loop forever. */
                return -1;
            }

            wn = write(fd, wp, wremaining);
            if (wn < 0) {
                if (errno == EINTR) {
                    continue;
                }
                return -1;
            }
            if (wn == 0) {
                /* No forward progress; avoid spinning. */
                return -1;
            }
            wp += wn;
            wremaining -= (size_t)wn;
        }
    }

    for (;;) {
        struct timespec tnow;
        long elapsed_ms;
        long overall_left_ms;
        int wait_ms;
        struct pollfd pfd;
        int rc;

        if (clock_gettime(CLOCK_MONOTONIC, &tnow) != 0) {
            return -1;
        }
        elapsed_ms = (tnow.tv_sec - t0.tv_sec) * 1000L +
                     (tnow.tv_nsec - t0.tv_nsec) / 1000000L;
        overall_left_ms = (long)timeout_ms - elapsed_ms;
        if (overall_left_ms <= 0L) {
            /* Overall deadline expired: either no bytes ever arrived, or
             * they arrived but the frame never idled out in time. Either
             * way, this xfer failed. */
            return -1;
        }

        /* Wait the full remaining deadline for the first byte (the
         * response-latency wait); once at least one byte is in hand,
         * only wait the short idle-gap -- that gap elapsing IS the
         * frame-complete signal. Never wait past the overall deadline. */
        wait_ms = (n > 0u) ? BL_IDLE_GAP_MS : (int)overall_left_ms;
        if ((long)wait_ms > overall_left_ms) {
            wait_ms = (int)overall_left_ms;
        }

        pfd.fd = fd;
        pfd.events = POLLIN;
        pfd.revents = 0;

        rc = poll(&pfd, 1, wait_ms);
        if (rc < 0) {
            if (errno == EINTR) {
                continue;
            }
            return -1;
        }
        if (rc == 0) {
            /* Nothing arrived within wait_ms. If we already have bytes,
             * this is the idle gap -- the frame is complete. Otherwise
             * it's a genuine no-response timeout. */
            if (n > 0u) {
                break;
            }
            return -1;
        }

        if (pfd.revents & (POLLERR | POLLNVAL)) {
            return -1;
        }
        if (pfd.revents & (POLLIN | POLLHUP)) {
            ssize_t rn;

            if (n >= resp_cap) {
                /* More data is arriving than the caller's buffer can
                 * hold -- can't be a valid frame for this exchange. */
                return -1;
            }
            rn = read(fd, resp + n, (size_t)(resp_cap - n));
            if (rn < 0) {
                if (errno == EINTR) {
                    continue;
                }
                return -1;
            }
            if (rn == 0) {
                /* EOF on a serial fd is not expected in normal
                 * operation; treat it as a bus error rather than
                 * spinning on repeated zero-length reads. */
                return -1;
            }
            n = (uint16_t)(n + (uint16_t)rn);
        }
    }

    if (n == 0u) {
        return -1;
    }
    if (bl_frame_check(resp, n) != 0) {
        return -1;
    }
    return (int)n;
}

/* Bounded settle after a device reset (post-enter-bootloader or
 * post-COMMIT): sleep briefly for the device to finish resetting, then
 * flush whatever noise landed on the line while it was down. Does not
 * itself confirm the device is back -- bl_session's own INFO / reg-2
 * retry loops do that. */
static int bl_transport_serial_wait_reset(void *ctx_, uint32_t timeout_ms)
{
    const bl_transport_serial_ctx_t *sc = (const bl_transport_serial_ctx_t *)ctx_;
    struct timespec req;
    struct timespec rem;

    (void)timeout_ms; /* deliberately not used for a bounded, best-effort settle */

    if (sc == NULL) {
        return -1;
    }

    req.tv_sec = 0;
    req.tv_nsec = BL_RESET_SETTLE_NS;
    while (nanosleep(&req, &rem) != 0) {
        if (errno != EINTR) {
            /* Non-EINTR nanosleep failure is not expected on a plain
             * relative sleep; give up on the settle rather than loop
             * forever, and still flush below. */
            break;
        }
        req = rem;
    }

    if (tcflush(sc->fd, TCIOFLUSH) != 0) {
        return -1;
    }
    return 0;
}

int bl_transport_serial_init(bl_transport_t *out, modbus_t *ctx)
{
    int fd;

    if (out == NULL || ctx == NULL) {
        return -1;
    }

    fd = modbus_get_socket(ctx);
    if (fd < 0) {
        return -1;
    }

    memset(&g_serial_ctx, 0, sizeof(g_serial_ctx));
    g_serial_ctx.fd = fd;

    out->xfer = bl_transport_serial_xfer;
    out->wait_reset = bl_transport_serial_wait_reset;
    out->ctx = &g_serial_ctx;

    return 0;
}
