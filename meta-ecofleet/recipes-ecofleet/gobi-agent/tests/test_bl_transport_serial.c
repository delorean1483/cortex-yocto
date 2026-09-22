/* Host test for the raw-fd RS-485 transport (bl_transport_serial_xfer),
 * driven over a real pty by a device-model thread that reproduces the wire
 * behaviours seen on-silicon during the STM32 remote flash.
 *
 * WHY THIS EXISTS: the flash intermittently failed at VERIFY on real hardware
 * for weeks. A 2026-09-22 on-device byte capture ([BLTRACE]) proved the delayed
 * bootloader replies (INFO/VERIFY/STATUS) arrive with an inter-byte gap that
 * exceeds the 5 ms idle-gap, so the idle-gap framer TRUNCATED the frame; the
 * split-off tail then desynced the next exchange. Nothing exercised this code
 * path (every bl_session test uses a frame-level fake), so the bug shipped.
 * These tests drive the real byte-framing loop against a pty.
 */
#define _POSIX_C_SOURCE 200809L
#define _DARWIN_C_SOURCE   /* cfmakeraw, openpty on macOS/BSD */
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <time.h>
#include <poll.h>
#include <termios.h>
#include <pthread.h>
#include <util.h>   /* openpty() */

#include "bl_session.h"
#include "bl_frame.h"
#include "bl_proto.h"

/* Compile the transport under test into this TU so we can reach its static
 * xfer + g_serial_ctx. Its `#include <modbus.h>` resolves to tests/txstub. */
#include "bl_transport_serial.c"

/* Satisfy the link reference from bl_transport_serial_init (never called). */
int modbus_get_socket(modbus_t *ctx){ (void)ctx; return -1; }

static int fails;
#define CHECK(c) do{ if(!(c)){ printf("FAIL %s:%d %s\n",__FILE__,__LINE__,#c); fails++; } }while(0)

/* ---- device model: replies in scripted segments, each after a pre-gap ---- */

#define MAX_SEG 4
typedef struct {
    int master;
    int nseg;
    int      gap_ms[MAX_SEG];   /* silence BEFORE emitting this segment */
    uint8_t  data[MAX_SEG][64];
    int      len[MAX_SEG];
} dev_model_t;

static void sleep_ms(int ms){
    struct timespec ts = { ms/1000, (long)(ms%1000)*1000000L };
    nanosleep(&ts, NULL);
}

static void *dev_thread(void *arg){
    dev_model_t *d = (dev_model_t *)arg;
    /* Consume the request first (best-effort, idle-delimited) so timing of the
     * reply is measured from after the master has sent its request. */
    uint8_t junk[256];
    for(;;){
        struct pollfd p = { d->master, POLLIN, 0 };
        int rc = poll(&p, 1, 500);
        if(rc <= 0) break;
        if(read(d->master, junk, sizeof(junk)) <= 0) break;
        /* one more short wait to catch the whole request, then stop */
        struct pollfd p2 = { d->master, POLLIN, 0 };
        if(poll(&p2, 1, 10) <= 0) break;
    }
    for(int i = 0; i < d->nseg; i++){
        if(d->gap_ms[i] > 0) sleep_ms(d->gap_ms[i]);
        ssize_t w = write(d->master, d->data[i], (size_t)d->len[i]);
        (void)w;
    }
    return NULL;
}

static void set_raw(int fd){
    struct termios tio;
    if(tcgetattr(fd, &tio) != 0) return;
    cfmakeraw(&tio);
    tio.c_cc[VMIN] = 1;
    tio.c_cc[VTIME] = 0;
    tcsetattr(fd, TCSANOW, &tio);
}

/* Run one xfer against a fresh pty whose far end is driven by `d`. Returns the
 * xfer() result; on success the framed response is copied into out/out_len. */
static int run_xfer(dev_model_t *d, uint8_t *out, int outcap, int *out_len,
                    uint32_t timeout_ms){
    int master = -1, slave = -1;
    if(openpty(&master, &slave, NULL, NULL, NULL) != 0){
        printf("FAIL openpty: %s\n", strerror(errno));
        fails++;
        return -1;
    }
    set_raw(master);
    set_raw(slave);
    d->master = master;

    pthread_t th;
    pthread_create(&th, NULL, dev_thread, d);

    g_serial_ctx.fd = slave;

    /* A realistic VERIFY request; the device model ignores its content. */
    uint8_t req[32];
    uint16_t rn = bl_req_verify(req, 0x0001A054u, 0xDEADBEEFu);
    rn = bl_frame_finalize(req, rn);

    uint8_t rbuf[256];
    int rlen = bl_transport_serial_xfer(&g_serial_ctx, req, rn, rbuf,
                                        sizeof(rbuf), timeout_ms);

    pthread_join(th, NULL);
    close(master);
    close(slave);

    if(rlen > 0 && out){
        int n = (rlen < outcap) ? rlen : outcap;
        memcpy(out, rbuf, (size_t)n);
        if(out_len) *out_len = rlen;
    }
    return rlen;
}

/* The 6-byte VERIFY ACK captured on silicon: body [01 41 03 00] + CRC [51 3C]. */
static const uint8_t VERIFY_ACK[6] = { 0x01, 0x41, 0x03, 0x00, 0x51, 0x3C };

int main(void){
    /* ---- regression: a clean contiguous reply frames correctly. ---- */
    {
        dev_model_t d; memset(&d, 0, sizeof(d));
        d.nseg = 1; d.gap_ms[0] = 0; d.len[0] = 6;
        memcpy(d.data[0], VERIFY_ACK, 6);

        uint8_t out[16]; int outn = 0;
        int rlen = run_xfer(&d, out, sizeof(out), &outn, 1000);
        CHECK(rlen == 6);
        CHECK(outn == 6 && memcmp(out, VERIFY_ACK, 6) == 0);
    }

    /* ---- THE BUG: a delayed reply fragmented by a >5 ms inter-byte gap.
     * The device sends the 4-byte header, then (after 15 ms) the 2 CRC bytes,
     * mimicking the on-silicon VERIFY ACK. The framer must NOT truncate at the
     * gap -- it must read the whole 6-byte frame. Fails with BL_IDLE_GAP_MS=5
     * (idle-gaps out after the header, drops the CRC -> framecheck-fail). ---- */
    {
        dev_model_t d; memset(&d, 0, sizeof(d));
        d.nseg = 2;
        d.gap_ms[0] = 0;  d.len[0] = 4; memcpy(d.data[0], VERIFY_ACK, 4);
        d.gap_ms[1] = 15; d.len[1] = 2; memcpy(d.data[1], VERIFY_ACK + 4, 2);

        uint8_t out[16]; int outn = 0;
        int rlen = run_xfer(&d, out, sizeof(out), &outn, 2000);
        CHECK(rlen == 6);
        CHECK(outn == 6 && memcmp(out, VERIFY_ACK, 6) == 0);
    }

    /* ---- regression: a genuinely silent bus still times out to -1 (must not
     * hang, and the wider idle-gap must not turn a no-reply into a false read). */
    {
        dev_model_t d; memset(&d, 0, sizeof(d));
        d.nseg = 0;
        int rlen = run_xfer(&d, NULL, 0, NULL, 400);
        CHECK(rlen == -1);
    }

    /* keep the unused-transport-symbols quiet without exercising real I/O */
    (void)bl_transport_serial_init;
    (void)bl_transport_serial_wait_reset;

    printf(fails ? "test_bl_transport_serial FAILED (%d)\n"
                 : "test_bl_transport_serial ok\n", fails);
    return fails ? 1 : 0;
}
