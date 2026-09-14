#include "bl_session.h"
#include "fake_bootloader.h"
#include <string.h>
#include <stdio.h>

static int fails;
#define CHECK(c) do{ if(!(c)){ printf("FAIL %s:%d %s\n",__FILE__,__LINE__,#c); fails++; } }while(0)

static void fill_pattern(uint8_t *buf, size_t n, uint8_t seed){
    size_t i;
    for(i = 0; i < n; i++) buf[i] = (uint8_t)(seed + i);
}

static int all_zero(const uint8_t *buf, size_t n){
    size_t i;
    for(i = 0; i < n; i++) if(buf[i] != 0) return 0;
    return 1;
}

int main(void){
    /* ---- happy path: 300-byte image -> BLR_OK, slot buffer matches image,
     * target slot flipped active. ---- */
    {
        fake_bootloader_t fb;
        fake_bl_init(&fb);
        fb.reg2_after_commit = 200u; /* the version the new image reports */

        uint8_t img[300];
        fill_pattern(img, sizeof(img), 0x01u);

        bl_transport_t t = { fake_bl_xfer, fake_bl_wait_reset, &fb };
        bl_flash_params_t p;
        memset(&p, 0, sizeof(p));
        p.img_slotA = img;
        p.len_slotA = sizeof(img);
        p.expected_ver_enc = 200u;

        bl_result_t r = bl_session_flash(&t, &p);
        CHECK(r == BLR_OK);
        CHECK(memcmp(fb.slotA, img, sizeof(img)) == 0);
        CHECK(fb.committed == 1);
        CHECK(fb.active_slot == 0u); /* inactive_slot (target) was 0 -> flipped active */
    }

    /* ---- enter refused -> BLR_ENTER_REFUSED, no slot written. ---- */
    {
        fake_bootloader_t fb;
        fake_bl_init(&fb);
        fake_bl_refuse_enter(&fb);

        uint8_t img[300];
        fill_pattern(img, sizeof(img), 0x02u);

        bl_transport_t t = { fake_bl_xfer, fake_bl_wait_reset, &fb };
        bl_flash_params_t p;
        memset(&p, 0, sizeof(p));
        p.img_slotA = img;
        p.len_slotA = sizeof(img);
        p.expected_ver_enc = 200u;

        bl_result_t r = bl_session_flash(&t, &p);
        CHECK(r == BLR_ENTER_REFUSED);
        CHECK(fb.written_len == 0u);
        CHECK(all_zero(fb.slotA, sizeof(img)));
    }

    /* ---- bad VERIFY crc -> BLR_VERIFY_CRC, NOT committed (old slot intact). ---- */
    {
        fake_bootloader_t fb;
        fake_bl_init(&fb);
        fake_bl_fail_verify_crc(&fb);
        fb.reg2_after_commit = 200u;

        uint8_t img[300];
        fill_pattern(img, sizeof(img), 0x03u);

        bl_transport_t t = { fake_bl_xfer, fake_bl_wait_reset, &fb };
        bl_flash_params_t p;
        memset(&p, 0, sizeof(p));
        p.img_slotA = img;
        p.len_slotA = sizeof(img);
        p.expected_ver_enc = 200u;

        bl_result_t r = bl_session_flash(&t, &p);
        CHECK(r == BLR_VERIFY_CRC);
        CHECK(fb.committed == 0);
        CHECK(fb.active_slot == 1u); /* unchanged from fake_bl_init's default */
    }

    /* ---- data retry: one transient NAK on the 3rd chunk -> still BLR_OK. ---- */
    {
        fake_bootloader_t fb;
        fake_bl_init(&fb);
        fb.chunk_max = 100u; /* 300-byte image / 100 = exactly 3 chunks */
        fake_bl_fail_nth_data(&fb, 3);
        fb.reg2_after_commit = 200u;

        uint8_t img[300];
        fill_pattern(img, sizeof(img), 0x04u);

        bl_transport_t t = { fake_bl_xfer, fake_bl_wait_reset, &fb };
        bl_flash_params_t p;
        memset(&p, 0, sizeof(p));
        p.img_slotA = img;
        p.len_slotA = sizeof(img);
        p.expected_ver_enc = 200u;

        bl_result_t r = bl_session_flash(&t, &p);
        CHECK(r == BLR_OK);
        CHECK(memcmp(fb.slotA, img, sizeof(img)) == 0);
        CHECK(fb.committed == 1);
    }

    /* ---- data-chunk retry budget, lower boundary: NAK the chunk 3 times,
     * succeed on the 4th (initial attempt + 3 retries) -> still BLR_OK. ---- */
    {
        fake_bootloader_t fb;
        fake_bl_init(&fb);
        fake_bl_fail_data_times(&fb, 1, 3); /* single chunk (default chunk_max) */
        fb.reg2_after_commit = 200u;

        uint8_t img[64];
        fill_pattern(img, sizeof(img), 0x07u);

        bl_transport_t t = { fake_bl_xfer, fake_bl_wait_reset, &fb };
        bl_flash_params_t p;
        memset(&p, 0, sizeof(p));
        p.img_slotA = img;
        p.len_slotA = sizeof(img);
        p.expected_ver_enc = 200u;

        bl_result_t r = bl_session_flash(&t, &p);
        CHECK(r == BLR_OK);
        CHECK(memcmp(fb.slotA, img, sizeof(img)) == 0);
        CHECK(fb.committed == 1);
    }

    /* ---- data-chunk retry budget, upper boundary: NAK the chunk 4 times
     * (more than the retry budget can absorb) -> BLR_WRITE_FAIL. ---- */
    {
        fake_bootloader_t fb;
        fake_bl_init(&fb);
        fake_bl_fail_data_times(&fb, 1, 4);
        fb.reg2_after_commit = 200u;

        uint8_t img[64];
        fill_pattern(img, sizeof(img), 0x08u);

        bl_transport_t t = { fake_bl_xfer, fake_bl_wait_reset, &fb };
        bl_flash_params_t p;
        memset(&p, 0, sizeof(p));
        p.img_slotA = img;
        p.len_slotA = sizeof(img);
        p.expected_ver_enc = 200u;

        bl_result_t r = bl_session_flash(&t, &p);
        CHECK(r == BLR_WRITE_FAIL);
        CHECK(fb.committed == 0);
    }

    /* ---- slot pick: inactive_slot=1 -> slotB bytes streamed, not slotA. ---- */
    {
        fake_bootloader_t fb;
        fake_bl_init(&fb);
        fb.inactive_slot = 1u;
        fb.active_slot = 0u; /* force away from fake_bl_init's default of 1, so the
                               * post-commit flip to 1 below is actually exercised
                               * (fake_bl_init already defaults active_slot=1, which
                               * would make CHECK(active_slot==1) pass vacuously). */
        fb.reg2_after_commit = 200u;

        uint8_t imgA[300];
        uint8_t imgB[300];
        fill_pattern(imgA, sizeof(imgA), 0x05u);
        fill_pattern(imgB, sizeof(imgB), 0x55u);

        bl_transport_t t = { fake_bl_xfer, fake_bl_wait_reset, &fb };
        bl_flash_params_t p;
        memset(&p, 0, sizeof(p));
        p.img_slotA = imgA;
        p.len_slotA = sizeof(imgA);
        p.img_slotB = imgB;
        p.len_slotB = sizeof(imgB);
        p.expected_ver_enc = 200u;

        bl_result_t r = bl_session_flash(&t, &p);
        CHECK(r == BLR_OK);
        CHECK(memcmp(fb.slotB, imgB, sizeof(imgB)) == 0);
        CHECK(all_zero(fb.slotA, sizeof(imgA)));
        CHECK(fb.active_slot == 1u);
    }

    /* ---- version mismatch: reg2 stays old after commit -> BLR_VERSION_MISMATCH. ---- */
    {
        fake_bootloader_t fb;
        fake_bl_init(&fb);
        /* reg2_after_commit left equal to current_reg2 (fake_bl_init default) */

        uint8_t img[300];
        fill_pattern(img, sizeof(img), 0x06u);

        bl_transport_t t = { fake_bl_xfer, fake_bl_wait_reset, &fb };
        bl_flash_params_t p;
        memset(&p, 0, sizeof(p));
        p.img_slotA = img;
        p.len_slotA = sizeof(img);
        p.expected_ver_enc = 200u; /* fake reports its unchanged 100 -> mismatch */

        bl_result_t r = bl_session_flash(&t, &p);
        CHECK(r == BLR_VERSION_MISMATCH);
        CHECK(fb.committed == 1);
    }

    printf(fails ? "test_bl_session FAILED (%d)\n" : "test_bl_session ok\n", fails);
    return fails ? 1 : 0;
}
