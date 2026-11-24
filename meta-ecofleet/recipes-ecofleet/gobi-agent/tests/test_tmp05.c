#include "tmp05.h"
#include <stdio.h>
static int fails;
#define CHECK(c) do{ if(!(c)){ printf("FAIL %s:%d %s\n",__FILE__,__LINE__,#c); fails++; } }while(0)

#define MS 1000000ull

/* Build a PWM edge train: starts with a rising edge at t0, `periods` full
 * high+low periods, then one more rising edge. */
static size_t train(tmp05_edge_t *e, unsigned periods, double th_ms, double tl_ms)
{
    size_t n = 0;
    uint64_t t = 5000 * MS;
    uint32_t seq = 41;
    for (unsigned p = 0; p < periods; p++) {
        e[n++] = (tmp05_edge_t){ true,  t, seq++ }; t += (uint64_t)(th_ms * MS);
        e[n++] = (tmp05_edge_t){ false, t, seq++ }; t += (uint64_t)(tl_ms * MS);
    }
    e[n++] = (tmp05_edge_t){ true, t, seq++ };
    return n;
}

/* T = 421 - 751 * TH / TL */
static void test_known_points(void)
{
    tmp05_edge_t e[32];
    int c = 9999;
    /* 25.0 C: TH/TL = 396/751 -> TL = 40 * 751 / 396 = 75.859 ms */
    size_t n = train(e, 4, 40.0, 40.0 * 751.0 / 396.0);
    CHECK(tmp05_c_x10(e, n, &c));
    CHECK(c == 250);
    /* -20.0 C: TL = 40 * 751 / 441 */
    n = train(e, 4, 40.0, 40.0 * 751.0 / 441.0);
    CHECK(tmp05_c_x10(e, n, &c));
    CHECK(c == -200);
    /* 70.5 C: TL = 40 * 751 / 350.5 */
    n = train(e, 4, 40.0, 40.0 * 751.0 / 350.5);
    CHECK(tmp05_c_x10(e, n, &c));
    CHECK(c == 705);
}

static void test_starting_on_a_falling_edge(void)
{
    tmp05_edge_t e[32];
    int c = 0;
    size_t n = train(e, 5, 40.0, 40.0 * 751.0 / 396.0);
    CHECK(tmp05_c_x10(e + 1, n - 1, &c));      /* fall, rise, fall, ... */
    CHECK(c == 250);
}

static void test_too_few_periods(void)
{
    tmp05_edge_t e[32];
    int c = 1234;
    size_t n = train(e, 2, 40.0, 76.0);         /* 2 high, 2 low */
    CHECK(!tmp05_c_x10(e, n, &c));
    CHECK(c == 1234);
    CHECK(!tmp05_c_x10(e, 0, &c));
    CHECK(!tmp05_c_x10(e, 1, &c));
    CHECK(!tmp05_c_x10(NULL, 5, &c));
    CHECK(!tmp05_c_x10(e, n, NULL));
}

static void test_lost_or_repeated_edge(void)
{
    tmp05_edge_t e[32];
    int c = 0;
    size_t n = train(e, 4, 40.0, 76.0);
    e[5].seq += 1;                                /* gap before edge 5 */
    for (size_t i = 6; i < n; i++) e[i].seq += 1;
    CHECK(!tmp05_c_x10(e, n, &c));
    n = train(e, 4, 40.0, 76.0);
    e[4].rising = !e[4].rising;                   /* two of a kind */
    CHECK(!tmp05_c_x10(e, n, &c));
    n = train(e, 4, 40.0, 76.0);
    e[3].t_ns = e[2].t_ns;                        /* time not increasing */
    CHECK(!tmp05_c_x10(e, n, &c));
}

static void test_implausible(void)
{
    tmp05_edge_t e[32];
    int c = 0;
    size_t n = train(e, 4, 1.0, 2.0);             /* noise, not a TMP05 */
    CHECK(!tmp05_c_x10(e, n, &c));
    n = train(e, 4, 40.0, 200.0);                 /* stuck-ish low */
    CHECK(!tmp05_c_x10(e, n, &c));
    n = train(e, 4, 40.0, 40.0 * 751.0 / 500.0);  /* would be -79 C */
    CHECK(!tmp05_c_x10(e, n, &c));
    n = train(e, 4, 40.0, 40.0 * 751.0 / 280.0);  /* would be +141 C */
    CHECK(!tmp05_c_x10(e, n, &c));
}

/* The R1 bench reading (2026-10-19, r1-test.sh): about 26 C. */
static void test_jitter_averages(void)
{
    tmp05_edge_t e[32];
    int c = 0;
    size_t n = train(e, 6, 40.0, 40.0 * 751.0 / 395.0);
    for (size_t i = 1; i < n; i += 2) e[i].t_ns += (i % 4 == 1) ? 30000 : 0;  /* +30 us on some falls */
    CHECK(tmp05_c_x10(e, n, &c));
    CHECK(c >= 258 && c <= 262);
}

int main(void)
{
    test_known_points();
    test_starting_on_a_falling_edge();
    test_too_few_periods();
    test_lost_or_repeated_edge();
    test_implausible();
    test_jitter_averages();
    if (fails) { printf("test_tmp05: %d FAILED\n", fails); return 1; }
    printf("test_tmp05: all passed\n");
    return 0;
}
