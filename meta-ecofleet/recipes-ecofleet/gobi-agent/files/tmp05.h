/* tmp05.h — Cortex cab temperature from the carrier's TMP05 (EF-MX8MM R1/R2:
 * TMP1 -> CAB_TEMP -> GPIO4_IO27; the dev kit has none).
 *
 * The TMP05 free-runs a PWM whose high time TH (~40 ms) and low time TL give
 * T = 421 - 751 * TH / TL degC (datasheet). tmp05_c_x10() is the pure part,
 * host-tested by ../tests/test_tmp05.c. tmp05_start()/tmp05_latest() are the
 * Linux sampler (tmp05_gpio.c): a thread that, every TMP05_PERIOD_S, claims the
 * GPIO line named "CAB_TEMP" for edge events, times a few PWM periods, releases
 * the line and keeps the result.
 */
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define TMP05_PERIOD_S   10u     /* one measurement every 10 s            */
#define TMP05_MIN_PAIRS  3u      /* complete high + low periods to average */

typedef struct {
    bool     rising;   /* true: low -> high                     */
    uint64_t t_ns;     /* kernel event timestamp (monotonic)    */
    uint32_t seq;      /* per-line sequence number (gap = lost) */
} tmp05_edge_t;

/* Temperature in 0.1 degC from edges in time order. Uses every complete high
 * period (rising -> falling) and low period (falling -> rising) and the ratio
 * of their sums. Returns false (and leaves *c_x10 alone) when there are fewer
 * than TMP05_MIN_PAIRS of either, an edge was lost (sequence gap) or repeated
 * (two of the same direction in a row), a period is outside 15..150 ms, or the
 * result is outside -40..+125 degC. */
bool tmp05_c_x10(const tmp05_edge_t *e, size_t n, int *c_x10);

/* Start the sampler thread. false when there is no "CAB_TEMP" line (dev kit,
 * or a DTB without the name): nothing is started and tmp05_latest() stays
 * false. */
bool tmp05_start(void);

/* The last good reading and its age. false before the first good reading or
 * when the last one is older than max_age_ms (sensor stopped, or every
 * measurement since was rejected). */
bool tmp05_latest(uint32_t max_age_ms, int *c_x10);
