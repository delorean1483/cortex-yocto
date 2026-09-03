/* stm32_flash_task.c — STM32 (gobi/APU) remote firmware update: poll-loop
 * facing orchestration glue (see stm32_flash_task.h).
 *
 * File I/O + orchestration only -- the actual version-compare / idle-gate
 * decisions live in stm32_update.c (host-unit-tested) and the wire
 * protocol lives in bl_session.c / bl_transport_serial.c. This file reads
 * the manifest + .bin images off the read-only rootfs, calls those, and
 * owns the module-global status/progress the rest of the agent observes.
 */
#include "config.h"
#include "stm32_flash_task.h"
#include "stm32_update.h"
#include "bl_session.h"
#include "bl_transport_serial.h"

#include <modbus.h>

#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include <syslog.h>
#include <sys/stat.h>
#include <errno.h>

/* Manifest filenames ("slotA"/"slotB") are short basenames by contract
 * (see stm32_update.h's stu_parse_manifest doc); 128 bytes is generous
 * headroom without inviting an oversized static buffer. */
#define STU_NAME_CAP 128

/* Manifest JSON is a handful of short string fields -- a few hundred
 * bytes in practice. 4 KiB is a generous, still-bounded ceiling. */
#define STM32_MANIFEST_BUF_SIZE 4096

/* ── Module state ─────────────────────────────────────────────────────── */

static modbus_t   *g_ctx = NULL;
static stu_status_t g_status = STU_IDLE;
static int          g_pct = -1;             /* -1 == no flash attempted yet */

/* Manifest cache: re-parsed only when the file's mtime changes. */
static int          g_manifest_valid = 0;
static time_t       g_manifest_mtime;
static char         g_manifest_buf[STM32_MANIFEST_BUF_SIZE];
static uint16_t     g_bundled_ver_enc = 0;
static char         g_slotA_name[STU_NAME_CAP];
static char         g_slotB_name[STU_NAME_CAP];

/* Outcome of the most recent flash attempt made by this process, kept
 * visible (STU_OK/STU_FAILED) until a manifest carrying a different
 * bundled version supersedes it. This also gates re-attempts: a given
 * bundled version is only ever attempted once per process per version
 * (see the retry-guard note in stm32_flash_tick()). */
static int           g_have_outcome = 0;
static uint16_t      g_outcome_ver_enc = 0;
static stu_status_t  g_outcome_status = STU_IDLE;   /* valid iff g_have_outcome */

/* Image buffers for the two A/B slots, sized to the max a slot can hold.
 * Static (not malloc'd): the agent flashes at most one STM32 at a time,
 * single-threaded, and a fixed ~448 KiB of BSS is inconsequential on this
 * target -- and it sidesteps allocation-failure handling entirely. */
static uint8_t g_img_slotA[G0B1_APP_SLOT_SIZE];
static uint8_t g_img_slotB[G0B1_APP_SLOT_SIZE];

/* ── Helpers ──────────────────────────────────────────────────────────── */

/* Loads dir/name into buf (capacity cap), bounded by a stat() size check
 * before ever reading -- never reads past cap. Returns 0 and sets
 * *out_len on success; on any failure (path too long, stat/open/read
 * failure, empty file, or file larger than cap) logs a warning and
 * returns -1 without touching *out_len. */
static int load_bin(const char *dir, const char *name, uint8_t *buf,
                     size_t cap, uint32_t *out_len)
{
    char path[256];
    struct stat st;
    FILE *f;
    size_t n;
    int written;

    if (name[0] == '\0') {
        syslog(LOG_WARNING, "stm32_flash: empty image filename");
        return -1;
    }

    written = snprintf(path, sizeof(path), "%s/%s", dir, name);
    if (written < 0 || (size_t)written >= sizeof(path)) {
        syslog(LOG_WARNING, "stm32_flash: image path too long: %s/%s", dir, name);
        return -1;
    }

    if (stat(path, &st) != 0) {
        syslog(LOG_WARNING, "stm32_flash: cannot stat %s: %s", path, strerror(errno));
        return -1;
    }
    if (!S_ISREG(st.st_mode) || st.st_size <= 0 || (size_t)st.st_size > cap) {
        syslog(LOG_WARNING, "stm32_flash: %s size %lld exceeds slot bound %zu",
               path, (long long)st.st_size, cap);
        return -1;
    }

    f = fopen(path, "rb");
    if (!f) {
        syslog(LOG_WARNING, "stm32_flash: cannot open %s: %s", path, strerror(errno));
        return -1;
    }
    n = fread(buf, 1, (size_t)st.st_size, f);
    fclose(f);
    if (n != (size_t)st.st_size) {
        syslog(LOG_WARNING, "stm32_flash: short read on %s (%zu/%lld)",
               path, n, (long long)st.st_size);
        return -1;
    }

    *out_len = (uint32_t)st.st_size;
    return 0;
}

/* Records the terminal outcome of a flash attempt and reflects it into
 * the live status immediately (before the next tick recomputes it). */
static void record_outcome(uint16_t ver_enc, stu_status_t outcome)
{
    g_have_outcome = 1;
    g_outcome_ver_enc = ver_enc;
    g_outcome_status = outcome;
    g_status = outcome;
}

static void progress_cb(void *ud, const char *phase, int pct)
{
    (void)ud;
    (void)phase;   /* phase transitions aren't syslogged -- see do_flash() */
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    g_pct = pct;
}

/* Runs one synchronous flash attempt for bundled_ver_enc. Blocks for the
 * duration of the whole transfer (tens of seconds to about a minute).
 * Always leaves g_status at a terminal value (STU_OK/STU_FAILED) and
 * records the outcome so stm32_flash_tick() won't re-attempt the same
 * bundled version again this process. */
static void do_flash(uint16_t bundled_ver_enc, const char *slotA_name,
                      const char *slotB_name)
{
    bl_transport_t t;
    bl_flash_params_t params;
    bl_result_t result;
    uint32_t len_a = 0;
    uint32_t len_b = 0;

    g_status = STU_FLASHING;
    g_pct = 0;

    if (g_ctx == NULL) {
        syslog(LOG_ERR, "stm32_flash: stm32_flash_task_init() was never called -- aborting flash");
        record_outcome(bundled_ver_enc, STU_FAILED);
        return;
    }

    if (load_bin(G0B1_FW_DIR, slotA_name, g_img_slotA, sizeof(g_img_slotA), &len_a) != 0 ||
        load_bin(G0B1_FW_DIR, slotB_name, g_img_slotB, sizeof(g_img_slotB), &len_b) != 0) {
        syslog(LOG_WARNING, "stm32_flash: could not load slot image(s) for v%u -- aborting flash",
               (unsigned)bundled_ver_enc);
        record_outcome(bundled_ver_enc, STU_FAILED);
        return;
    }

    if (bl_transport_serial_init(&t, g_ctx) != 0) {
        syslog(LOG_ERR, "stm32_flash: bl_transport_serial_init failed -- aborting flash");
        record_outcome(bundled_ver_enc, STU_FAILED);
        return;
    }

    memset(&params, 0, sizeof(params));
    params.img_slotA = g_img_slotA;
    params.len_slotA = len_a;
    params.img_slotB = g_img_slotB;
    params.len_slotB = len_b;
    params.expected_ver_enc = bundled_ver_enc;
    params.progress = progress_cb;
    params.progress_ud = NULL;

    result = bl_session_flash(&t, &params);

    if (result == BLR_OK) {
        g_pct = 100;
        syslog(LOG_INFO, "stm32_flash: flash to v%u succeeded (%s)",
               (unsigned)bundled_ver_enc, bl_result_str(result));
        record_outcome(bundled_ver_enc, STU_OK);
    } else {
        syslog(LOG_WARNING, "stm32_flash: flash to v%u failed: %s",
               (unsigned)bundled_ver_enc, bl_result_str(result));
        record_outcome(bundled_ver_enc, STU_FAILED);
    }
}

/* Re-reads and re-parses G0B1_FW_DIR "/manifest.json" iff its mtime has
 * changed since the last successful parse (or it has never been parsed).
 * Leaves g_manifest_valid at 0 on any missing/oversized/unreadable/
 * malformed manifest -- stm32_flash_tick() maps that straight to
 * STU_IDLE. A plain "file does not exist" is the expected steady state
 * on units that have never received an STM32 update, so it is not
 * syslogged; every other failure mode (present but invalid) is. */
static void refresh_manifest(void)
{
    const char *path = G0B1_FW_DIR "/manifest.json";
    struct stat st;

    if (stat(path, &st) != 0) {
        g_manifest_valid = 0;
        return;
    }

    if (g_manifest_valid && st.st_mtime == g_manifest_mtime) {
        return;   /* unchanged since the last successful parse */
    }

    if (!S_ISREG(st.st_mode) || st.st_size <= 0 ||
        (size_t)st.st_size >= sizeof(g_manifest_buf)) {
        syslog(LOG_WARNING, "stm32_flash: manifest %s has invalid size %lld",
               path, (long long)st.st_size);
        g_manifest_valid = 0;
        return;
    }

    {
        FILE *f = fopen(path, "rb");
        size_t n;

        if (!f) {
            syslog(LOG_WARNING, "stm32_flash: cannot open %s: %s", path, strerror(errno));
            g_manifest_valid = 0;
            return;
        }
        n = fread(g_manifest_buf, 1, (size_t)st.st_size, f);
        fclose(f);
        if (n != (size_t)st.st_size) {
            syslog(LOG_WARNING, "stm32_flash: short read on %s (%zu/%lld)",
                   path, n, (long long)st.st_size);
            g_manifest_valid = 0;
            return;
        }
        g_manifest_buf[n] = '\0';
    }

    {
        uint16_t ver_enc;
        char slot_a[STU_NAME_CAP];
        char slot_b[STU_NAME_CAP];

        if (stu_parse_manifest(g_manifest_buf, &ver_enc, slot_a, slot_b,
                                sizeof(slot_a)) != 0) {
            syslog(LOG_WARNING, "stm32_flash: malformed manifest %s", path);
            g_manifest_valid = 0;
            return;
        }

        if (ver_enc != g_bundled_ver_enc) {
            /* A newly-bundled version supersedes any outcome recorded
             * against the old one, so it can always be attempted. */
            g_have_outcome = 0;
        }

        g_bundled_ver_enc = ver_enc;
        memcpy(g_slotA_name, slot_a, sizeof(g_slotA_name));
        memcpy(g_slotB_name, slot_b, sizeof(g_slotB_name));
    }

    g_manifest_mtime = st.st_mtime;
    g_manifest_valid = 1;
}

/* ── Public API ───────────────────────────────────────────────────────── */

void stm32_flash_task_init(modbus_t *ctx)
{
    g_ctx = ctx;
}

stu_status_t stm32_flash_status(void)
{
    return g_status;
}

int stm32_flash_status_pct(void)
{
    return g_pct;
}

void stm32_flash_tick(uint16_t running_ver_enc, uint8_t mode, uint8_t engine)
{
    int newer;
    int have_outcome_for_current;
    int should_flash;

    refresh_manifest();

    if (!g_manifest_valid) {
        g_status = STU_IDLE;
        return;
    }

    newer = stu_is_newer(running_ver_enc, g_bundled_ver_enc);
    have_outcome_for_current = g_have_outcome && (g_outcome_ver_enc == g_bundled_ver_enc);
    should_flash = stu_should_flash(running_ver_enc, g_bundled_ver_enc, mode, engine,
                                     G0B1_AUTO_FLASH_DEFAULT);

    /* Retry guard: never re-attempt the same bundled version once this
     * process has recorded an outcome (OK or FAILED) for it -- a failed
     * flash of v1.1.0 will not be retried every tick, only after the
     * manifest is updated to a different encoded version. */
    if (should_flash && !have_outcome_for_current) {
        do_flash(g_bundled_ver_enc, g_slotA_name, g_slotB_name);
        return;   /* do_flash() already left g_status/g_pct at the result */
    }

    if (have_outcome_for_current) {
        g_status = g_outcome_status;      /* persist last OK/FAILED outcome */
    } else if (newer) {
        g_status = G0B1_AUTO_FLASH_DEFAULT ? STU_AVAILABLE : STU_DISABLED;
    } else {
        g_status = STU_IDLE;
    }
}
