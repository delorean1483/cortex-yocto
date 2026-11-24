/* tmp05.c — pure TMP05 PWM -> temperature (see tmp05.h). No I/O. */
#include "tmp05.h"

#define NS_PER_MS 1000000ull
#define PERIOD_MIN_NS (15ull * NS_PER_MS)
#define PERIOD_MAX_NS (150ull * NS_PER_MS)

bool tmp05_c_x10(const tmp05_edge_t *e, size_t n, int *c_x10)
{
    if (!e || !c_x10 || n < 2) return false;
    uint64_t th = 0, tl = 0;
    unsigned nh = 0, nl = 0;
    for (size_t i = 1; i < n; i++) {
        const tmp05_edge_t *a = &e[i - 1], *b = &e[i];
        if (b->seq != a->seq + 1u) return false;      /* lost an edge      */
        if (b->rising == a->rising) return false;     /* missed the other  */
        if (b->t_ns <= a->t_ns) return false;
        uint64_t d = b->t_ns - a->t_ns;
        if (d < PERIOD_MIN_NS || d > PERIOD_MAX_NS) return false;
        if (a->rising) { th += d; nh++; }             /* high: rise -> fall */
        else           { tl += d; nl++; }             /* low:  fall -> rise */
    }
    if (nh < TMP05_MIN_PAIRS || nl < TMP05_MIN_PAIRS) return false;
    /* Mean TH / mean TL, in 0.1 degC: 4210 - 7510 * (th/nh) / (tl/nl),
     * rounded to nearest. All terms fit in 64 bits: th, tl < 2^40. */
    uint64_t num = 7510ull * th * nl;
    uint64_t den = tl * nh;
    int64_t sub = (int64_t)((num + den / 2u) / den);
    int64_t t = 4210 - sub;
    if (t < -400 || t > 1250) return false;
    *c_x10 = (int)t;
    return true;
}
