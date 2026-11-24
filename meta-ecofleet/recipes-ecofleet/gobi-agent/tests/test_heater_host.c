/* Host-owned heater settings (fw 54/69/2230): seed, remember, re-assert
 * after a G0B1 reboot. */
#include "heater_host.h"
#include <stdio.h>
#include <string.h>
#include <unistd.h>

static int fails;
#define CHECK(c) do{ if(!(c)){ printf("FAIL %s:%d %s\n",__FILE__,__LINE__,#c); fails++; } }while(0)

#define AT (HEATER_CAP_SETPOINT | HEATER_CAP_MODE)   /* AUTOTERM, mode selectable */

static heater_host_readback_t rb(int level, int sp, int mode, unsigned caps)
{
    heater_host_readback_t r = { level, sp, mode, caps };
    return r;
}

static int plan(heater_host_t *h, heater_host_readback_t r, bool pending, uint64_t now,
                heater_write_t *w, heater_host_reason_t *why)
{
    return heater_host_plan(h, &r, pending, now, w, why);
}

static void all_ok(heater_host_t *h, const heater_write_t *w, int n, uint64_t now)
{
    int res[HEATER_HOST_MAX_WRITES] = { 0 };
    heater_host_done(h, w, res, n, now);
}

int main(void)
{
    heater_write_t w[HEATER_HOST_MAX_WRITES];
    heater_host_reason_t why;
    heater_host_t h;
    uint64_t t = 1000000;

    /* No file: nothing owned, nothing written; the first good readback seeds
       every setting (mode only from a trusted read with CAP_MODE). */
    heater_host_init(&h, NULL);
    CHECK(!h.startup);
    CHECK(plan(&h, rb(1, 20, 0, AT), false, t, w, &why) == 0 && why == HEATER_HOST_NONE);
    heater_host_readback_t r0 = rb(4, 22, 1, AT);
    CHECK(heater_host_adopt(&h, &r0));
    CHECK(h.want.level == 4 && h.want.setpoint_c == 22 && h.want.mode == 1);
    CHECK(!heater_host_adopt(&h, &r0));                       /* seeded once */
    CHECK(plan(&h, r0, false, t, w, &why) == 0);              /* equal: nothing */
    heater_host_readback_t r1 = rb(7, 25, 0, AT);
    CHECK(!heater_host_adopt(&h, &r1));                       /* known: never re-seeded */

    /* Seeding without CAP_MODE leaves the mode unknown; an untrusted (-1)
       mode is not adopted either. */
    heater_host_init(&h, NULL);
    heater_host_readback_t r2 = rb(3, 21, 1, HEATER_CAP_SETPOINT);
    CHECK(heater_host_adopt(&h, &r2) && h.want.mode == -1);
    heater_host_readback_t r3 = rb(3, 21, -1, AT);
    CHECK(!heater_host_adopt(&h, &r3) && h.want.mode == -1);

    /* Accepted command writes become the remembered values; refused or
       unanswered ones don't; 53 and 75 are never remembered. */
    heater_host_init(&h, NULL);
    CHECK(heater_host_note_write(&h, 54, 6, HEATER_WR_OK) && h.want.level == 6);
    CHECK(!heater_host_note_write(&h, 54, 6, HEATER_WR_OK));  /* unchanged */
    CHECK(!heater_host_note_write(&h, 54, 8, HEATER_WR_REFUSED) && h.want.level == 6);
    CHECK(!heater_host_note_write(&h, 54, 8, HEATER_WR_FAILED) && h.want.level == 6);
    CHECK(heater_host_note_write(&h, 69, 23, HEATER_WR_OK) && h.want.setpoint_c == 23);
    CHECK(heater_host_note_write(&h, HEATER_REG_MODE, 1, HEATER_WR_OK) && h.want.mode == 1);
    CHECK(!heater_host_note_write(&h, 53, 1, HEATER_WR_OK));
    CHECK(!heater_host_note_write(&h, 75, 3, HEATER_WR_OK));
    CHECK(!heater_host_note_write(&h, 54, 11, HEATER_WR_OK) && h.want.level == 6);

    /* Agent start with a file: the first good poll re-asserts 54, 69, 2230
       in that order, even when they already match (G0B1 s_control_mode sync). */
    heater_host_settings_t saved = { 6, 23, 1 };
    heater_host_init(&h, &saved);
    CHECK(h.startup);
    int n = plan(&h, rb(6, 23, 1, AT), false, t, w, &why);
    CHECK(n == 3 && why == HEATER_HOST_STARTUP);
    CHECK(w[0].reg == 54 && w[0].value == 6);
    CHECK(w[1].reg == 69 && w[1].value == 23);
    CHECK(w[2].reg == HEATER_REG_MODE && w[2].value == 1);
    for (int i = 0; i < n; i++) CHECK(w[i].reg != 53 && w[i].reg != 75);
    all_ok(&h, w, n, t);
    CHECK(plan(&h, rb(6, 23, 1, AT), false, t + 20000, w, &why) == 0);   /* settled */

    /* G0B1 reboot: 54/69 back at 1/20 -> re-assert (after the 10 s gap). */
    t += 20000;
    CHECK(plan(&h, rb(1, 20, 0, AT), false, t, w, &why) == 3 && why == HEATER_HOST_MISMATCH);
    all_ok(&h, w, 3, t);

    /* Rate limit: a fresh trigger within 10 s waits, then fires. */
    heater_host_note_link_down(&h);
    CHECK(plan(&h, rb(6, 23, 1, AT), false, t + 5000, w, &why) == 0);
    CHECK(plan(&h, rb(6, 23, 1, AT), false, t + 10000, w, &why) == 3 && why == HEATER_HOST_LINK);
    all_ok(&h, w, 3, t + 10000);
    t += 10000;

    /* A mismatch the last re-assert didn't fix: 60 s, not 10 s. */
    CHECK(plan(&h, rb(1, 20, 0, AT), false, t + 20000, w, &why) == 3 && why == HEATER_HOST_MISMATCH);
    all_ok(&h, w, 3, t + 20000);
    t += 20000;
    CHECK(plan(&h, rb(1, 20, 0, AT), false, t + 20000, w, &why) == 0);
    CHECK(plan(&h, rb(1, 20, 0, AT), false, t + HEATER_HOST_BACKOFF_MS, w, &why) == 3);
    all_ok(&h, w, 3, t + HEATER_HOST_BACKOFF_MS);
    t += HEATER_HOST_BACKOFF_MS;
    CHECK(plan(&h, rb(6, 23, 1, AT), false, t + 20000, w, &why) == 0);   /* fixed */
    /* ...and once fixed, the next reboot gets the normal 10 s gap again. */
    CHECK(plan(&h, rb(1, 20, 0, AT), false, t + 20000, w, &why) == 3 && why == HEATER_HOST_MISMATCH);
    all_ok(&h, w, 3, t + 20000);
    t += 20000;

    /* Link recovery alone (values equal) re-asserts. */
    heater_host_note_link_down(&h);
    CHECK(plan(&h, rb(6, 23, 1, AT), false, t + 15000, w, &why) == 3 && why == HEATER_HOST_LINK);
    all_ok(&h, w, 3, t + 15000);
    t += 15000;

    /* A pending heater command holds the re-assert; the trigger stays armed. */
    heater_host_note_link_down(&h);
    CHECK(plan(&h, rb(6, 23, 1, AT), true, t + 15000, w, &why) == 0);
    CHECK(plan(&h, rb(6, 23, 1, AT), false, t + 16000, w, &why) == 3 && why == HEATER_HOST_LINK);
    t += 16000;

    /* Refused write (2230 in maintenance): back off 60 s, then retry. */
    {
        int res[3] = { HEATER_WR_OK, HEATER_WR_OK, HEATER_WR_REFUSED };
        heater_host_done(&h, w, res, 3, t);
    }
    CHECK(plan(&h, rb(6, 23, 1, AT), false, t + 30000, w, &why) == 0);
    CHECK(plan(&h, rb(6, 23, 1, AT), false, t + HEATER_HOST_BACKOFF_MS, w, &why) == 3 &&
          why == HEATER_HOST_RETRY);
    all_ok(&h, w, 3, t + HEATER_HOST_BACKOFF_MS);
    t += HEATER_HOST_BACKOFF_MS;

    /* A write with no answer: retried after the normal gap. */
    {
        heater_host_note_link_down(&h);
        CHECK(plan(&h, rb(6, 23, 1, AT), false, t + 10000, w, &why) == 3);
        int res[3] = { HEATER_WR_FAILED, HEATER_WR_SKIPPED, HEATER_WR_SKIPPED };
        heater_host_done(&h, w, res, 3, t + 10000);
        t += 10000;
        CHECK(plan(&h, rb(6, 23, 1, AT), false, t + 5000, w, &why) == 0);
        CHECK(plan(&h, rb(6, 23, 1, AT), false, t + 10000, w, &why) == 3 && why == HEATER_HOST_RETRY);
        all_ok(&h, w, 3, t + 10000);
        t += 10000;
    }

    /* Mode remembered but not selectable (caps bit 8 clear while the L011
       re-identifies): 54/69 only, mode owed; written once the bit is back. */
    heater_host_init(&h, &saved);
    n = plan(&h, rb(1, 20, 0, HEATER_CAP_SETPOINT), false, t, w, &why);
    CHECK(n == 2 && w[0].reg == 54 && w[1].reg == 69);
    all_ok(&h, w, n, t);
    CHECK(h.mode_owed);
    CHECK(plan(&h, rb(6, 23, 0, HEATER_CAP_SETPOINT), false, t + 20000, w, &why) == 0);
    n = plan(&h, rb(6, 23, 0, AT), false, t + 20000, w, &why);
    CHECK(n == 3 && why == HEATER_HOST_MODE && w[2].reg == HEATER_REG_MODE && w[2].value == 1);
    all_ok(&h, w, n, t + 20000);
    CHECK(!h.mode_owed);
    t += 20000;

    /* Mode unset: never written, even with CAP_MODE. */
    heater_host_settings_t no_mode = { 5, 21, -1 };
    heater_host_init(&h, &no_mode);
    n = plan(&h, rb(5, 21, 1, AT), false, t, w, &why);
    CHECK(n == 2 && w[0].reg == 54 && w[1].reg == 69);
    for (int i = 0; i < n; i++) CHECK(w[i].reg != HEATER_REG_MODE);

    /* Only a mode remembered and not selectable: nothing to write, no gap used. */
    heater_host_settings_t only_mode = { 0, 0, 1 };
    heater_host_init(&h, &only_mode);
    CHECK(plan(&h, rb(1, 20, 0, 0), false, t, w, &why) == 0 && h.mode_owed && !h.ever);
    CHECK(plan(&h, rb(1, 20, 0, AT), false, t + 1, w, &why) == 1 && why == HEATER_HOST_MODE);

    /* File round trip, partial files, junk. */
    char buf[96];
    heater_host_settings_t s = { 7, 24, 0 }, back;
    CHECK(heater_host_format(&s, buf, sizeof buf) > 0);
    CHECK(strcmp(buf, "{\"level\":7,\"setpoint_c\":24,\"mode\":0}\n") == 0);
    CHECK(heater_host_parse(buf, &back) && back.level == 7 && back.setpoint_c == 24 && back.mode == 0);
    heater_host_settings_t part = { 0, 22, -1 };
    CHECK(heater_host_format(&part, buf, sizeof buf) > 0 && strcmp(buf, "{\"setpoint_c\":22}\n") == 0);
    CHECK(heater_host_parse("{\"level\":12,\"setpoint_c\":40,\"mode\":3}", &back) == false);
    CHECK(back.level == 0 && back.setpoint_c == 0 && back.mode == -1);
    CHECK(!heater_host_parse("not json", &back));
    CHECK(!heater_host_parse(NULL, &back));

    char path[] = "/tmp/test_heater_host.json";
    unlink(path);
    CHECK(!heater_host_load(path, &back) && back.mode == -1);
    CHECK(heater_host_save(path, &s) == 0);
    CHECK(heater_host_load(path, &back) && back.level == 7 && back.setpoint_c == 24 && back.mode == 0);
    CHECK(access("/tmp/test_heater_host.json.tmp", F_OK) != 0);
    unlink(path);

    CHECK(strcmp(heater_host_reason_name(HEATER_HOST_MISMATCH), "G0B1 lost settings") == 0);
    CHECK(strcmp(heater_host_reason_name(HEATER_HOST_MODE_LOST), "mode not applied") == 0);

    /* Mode not applied: the L011 reset alone and came back in temperature
       mode (54/69 live on the G0B1 and still match). Only a difference that
       lasts HEATER_HOST_MODE_HOLD_MS counts: 2230 lags a write. */
    {
        heater_host_settings_t want = { 5, 22, 1 };
        heater_host_init(&h, &want);
        uint64_t m = 5000000;
        heater_host_readback_t ok = rb(5, 22, 1, AT), lost = rb(5, 22, 0, AT);
        CHECK(plan(&h, ok, false, m, w, &why) == 3 && why == HEATER_HOST_STARTUP);
        all_ok(&h, w, 3, m);
        m += 20000;
        CHECK(plan(&h, ok, false, m, w, &why) == 0);
        CHECK(plan(&h, lost, false, m, w, &why) == 0);                 /* starts the hold */
        CHECK(plan(&h, lost, false, m + HEATER_HOST_MODE_HOLD_MS - 1, w, &why) == 0);
        int n = plan(&h, lost, false, m + HEATER_HOST_MODE_HOLD_MS, w, &why);
        CHECK(n == 3 && why == HEATER_HOST_MODE_LOST);
        CHECK(w[2].reg == HEATER_REG_MODE && w[2].value == 1);
        for (int i = 0; i < n; i++) CHECK(w[i].reg != 53 && w[i].reg != 75);
        all_ok(&h, w, n, m + HEATER_HOST_MODE_HOLD_MS);
        /* Still not applied: the next try waits out the back-off. */
        uint64_t m2 = m + HEATER_HOST_MODE_HOLD_MS;
        CHECK(plan(&h, lost, false, m2 + HEATER_HOST_BACKOFF_MS - 1, w, &why) == 0);
        CHECK(plan(&h, lost, false, m2 + HEATER_HOST_BACKOFF_MS, w, &why) == 3 &&
              why == HEATER_HOST_MODE_LOST);
        all_ok(&h, w, 3, m2 + HEATER_HOST_BACKOFF_MS);

        /* Applied again: the hold resets; a later loss starts a new hold and
           gets the short gap (it was fixed in between). */
        uint64_t m3 = m2 + HEATER_HOST_BACKOFF_MS + 1000;
        CHECK(plan(&h, ok, false, m3, w, &why) == 0);
        CHECK(plan(&h, lost, false, m3 + 1, w, &why) == 0);
        CHECK(plan(&h, lost, false, m3 + 1 + HEATER_HOST_MODE_HOLD_MS, w, &why) == 3 &&
              why == HEATER_HOST_MODE_LOST);
        all_ok(&h, w, 3, m3 + 1 + HEATER_HOST_MODE_HOLD_MS);

        /* Untrusted readback (-1), a pending command, or no CAP_MODE: no hold. */
        heater_host_init(&h, &want);
        CHECK(plan(&h, ok, false, m, w, &why) == 3);
        all_ok(&h, w, 3, m);
        uint64_t m4 = m + 20000;
        CHECK(plan(&h, lost, false, m4, w, &why) == 0);
        CHECK(plan(&h, rb(5, 22, -1, AT), false, m4 + 1000, w, &why) == 0);   /* hold reset */
        CHECK(plan(&h, lost, false, m4 + 2000, w, &why) == 0);
        CHECK(plan(&h, lost, false, m4 + 2000 + HEATER_HOST_MODE_HOLD_MS - 1, w, &why) == 0);
        CHECK(plan(&h, lost, true, m4 + 2000 + HEATER_HOST_MODE_HOLD_MS, w, &why) == 0);  /* pending */
        CHECK(plan(&h, rb(5, 22, 0, HEATER_CAP_SETPOINT), false,
                   m4 + 3000 + 2 * HEATER_HOST_MODE_HOLD_MS, w, &why) == 0);           /* no cap */
    }

    printf(fails ? "test_heater_host FAILED (%d)\n" : "test_heater_host ok\n", fails);
    return fails ? 1 : 0;
}
