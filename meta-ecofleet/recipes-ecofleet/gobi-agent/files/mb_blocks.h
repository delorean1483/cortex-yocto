/* mb_blocks.h - read the EF-G0B1R holding registers in a few FC03 blocks.
 *
 * At 9600 baud each Modbus round trip costs ~25 ms, so the old one-register-
 * at-a-time poll (~40 reads) kept the agent busy for about a second per cycle,
 * and a touchscreen command waited that long before the agent saw it. The
 * firmware map is sparse and rejects a read that spans an unbound register
 * (exception 0x02), so the blocks below cover only registers bound on current
 * firmware, and older firmware falls back the way the single reads did:
 *
 *   SPLIT  - mixes required and optional registers. On an exception it re-reads
 *            the registers the agent uses one at a time (required failures still
 *            fail the cycle; optional ones fall back to their default).
 *   GROUP  - one optional feature block that firmware binds all or nothing
 *            (heater 53..67, heater coprocessor 68..75, RGB light 76..79). An
 *            exception means the feature is absent.
 *
 * A failure that is not an exception (timeout, CRC, I/O) is a link failure: no
 * per-register retries, which would each wait out the response timeout.
 * Addresses are 0-based wire addresses (firmware register number - 1). */
#ifndef MB_BLOCKS_H
#define MB_BLOCKS_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define MBB_NREGS 80   /* wire 0..79 = firmware regs 1..80 */

typedef enum { MBB_UNUSED = 0, MBB_REQUIRED, MBB_OPTIONAL } mbb_role_t;
typedef enum { MBB_SPLIT = 0, MBB_GROUP } mbb_kind_t;

typedef struct { uint8_t first; uint8_t count; uint8_t kind; } mbb_block_t;

typedef struct {
    uint16_t val[MBB_NREGS];
    bool     ok[MBB_NREGS];
} mbb_snap_t;

/* Read n holding registers from wire address addr into dst. Returns n, or -1
 * with errno set; *exception is true when the device answered with a Modbus
 * exception rather than not answering correctly at all. */
typedef int (*mbb_read_fn)(void *ctx, int addr, int n, uint16_t *dst, bool *exception);

/* The plan for the EF-G0B1R map (mb_blocks.c). */
extern const mbb_block_t mbb_link_blocks[];
extern const size_t      mbb_link_nblocks;
extern const mbb_block_t mbb_diag_block, mbb_heater_block, mbb_heater_ext_block, mbb_led_block;
extern const uint8_t     mbb_role[MBB_NREGS];   /* mbb_role_t per wire address */

/* Read one block into s (its registers start out not-ok). Returns false only
 * when a REQUIRED register could not be read; *fail_addr then names it and
 * errno holds that read's error. */
bool mbb_read_block(mbb_snap_t *s, const mbb_block_t *b, mbb_read_fn rd, void *ctx,
                    int *fail_addr);

/* Link-health phase: clears s, then reads the blocks holding the required
 * registers (and the optional ones they share a block with). 0, or -1 at the
 * first required register that could not be read. */
int mbb_read_link(mbb_snap_t *s, mbb_read_fn rd, void *ctx, int *fail_addr);

/* Optional phase, after a successful mbb_read_link: component-test mode, the
 * heater block, the coprocessor block (only when the heater block answered)
 * and the RGB light. Never fails; absent registers are left not-ok. */
void mbb_read_optional(mbb_snap_t *s, mbb_read_fn rd, void *ctx);

static inline bool     mbb_ok(const mbb_snap_t *s, int addr) { return s->ok[addr]; }
static inline uint16_t mbb_get(const mbb_snap_t *s, int addr, uint16_t dflt)
{
    return s->ok[addr] ? s->val[addr] : dflt;
}

#endif /* MB_BLOCKS_H */
