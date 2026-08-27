/* test_weather.c — host unit tests for the pure weather transforms.
 *
 * Build & run with ./run.sh (uses the host's cJSON). No device, no network.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <cjson/cJSON.h>

#include "weather.h"

static int g_fail = 0;
static int g_checks = 0;

#define CHECK(cond, msg) do {                                      \
    g_checks++;                                                    \
    if (!(cond)) { g_fail++;                                       \
        printf("  FAIL: %s  (%s:%d)\n", (msg), __FILE__, __LINE__);\
    }                                                              \
} while (0)

#define CHECK_EQ_INT(got, want, msg) do {                          \
    g_checks++;                                                    \
    long _g = (long)(got), _w = (long)(want);                     \
    if (_g != _w) { g_fail++;                                      \
        printf("  FAIL: %s  expected %ld got %ld  (%s:%d)\n",      \
               (msg), _w, _g, __FILE__, __LINE__);                 \
    }                                                              \
} while (0)

#define CHECK_EQ_STR(got, want, msg) do {                          \
    g_checks++;                                                    \
    const char *_g = (got), *_w = (want);                         \
    if (!_g || strcmp(_g, _w) != 0) { g_fail++;                    \
        printf("  FAIL: %s  expected \"%s\" got \"%s\"  (%s:%d)\n",\
               (msg), _w, _g ? _g : "(null)", __FILE__, __LINE__); \
    }                                                              \
} while (0)

static void test_wmo_to_category(void)
{
    printf("wmo_to_category / slug\n");
    CHECK(wmo_to_category(0)  == WCAT_CLEAR,  "0 clear");
    CHECK(wmo_to_category(1)  == WCAT_CLEAR,  "1 mainly clear");
    CHECK(wmo_to_category(2)  == WCAT_PARTLY, "2 partly");
    CHECK(wmo_to_category(3)  == WCAT_CLOUDY, "3 overcast");
    CHECK(wmo_to_category(45) == WCAT_FOG,    "45 fog");
    CHECK(wmo_to_category(48) == WCAT_FOG,    "48 rime fog");
    CHECK(wmo_to_category(51) == WCAT_RAIN,   "51 drizzle");
    CHECK(wmo_to_category(61) == WCAT_RAIN,   "61 rain");
    CHECK(wmo_to_category(65) == WCAT_RAIN,   "65 heavy rain");
    CHECK(wmo_to_category(80) == WCAT_RAIN,   "80 rain showers");
    CHECK(wmo_to_category(71) == WCAT_SNOW,   "71 snow");
    CHECK(wmo_to_category(75) == WCAT_SNOW,   "75 heavy snow");
    CHECK(wmo_to_category(85) == WCAT_SNOW,   "85 snow showers");
    CHECK(wmo_to_category(95) == WCAT_STORM,  "95 thunderstorm");
    CHECK(wmo_to_category(96) == WCAT_STORM,  "96 storm w/ hail");
    CHECK(wmo_to_category(99) == WCAT_STORM,  "99 storm w/ hail");
    CHECK(wmo_to_category(4)   == WCAT_UNKNOWN, "4 unassigned");
    CHECK(wmo_to_category(100) == WCAT_UNKNOWN, "100 out of range");
    CHECK(wmo_to_category(-1)  == WCAT_UNKNOWN, "-1 out of range");

    CHECK_EQ_STR(weather_cat_slug(WCAT_CLEAR),  "clear",   "slug clear");
    CHECK_EQ_STR(weather_cat_slug(WCAT_PARTLY), "partly",  "slug partly");
    CHECK_EQ_STR(weather_cat_slug(WCAT_STORM),  "storm",   "slug storm");
    CHECK_EQ_STR(weather_cat_slug(WCAT_UNKNOWN),"unknown", "slug unknown");
}

static void test_weekday(void)
{
    printf("weekday_abbrev\n");
    CHECK_EQ_STR(weekday_abbrev("2000-01-01"), "Sat", "2000-01-01 Sat");
    CHECK_EQ_STR(weekday_abbrev("2021-01-01"), "Fri", "2021-01-01 Fri");
    CHECK_EQ_STR(weekday_abbrev("2024-02-29"), "Thu", "2024-02-29 Thu (leap)");
    CHECK_EQ_STR(weekday_abbrev("2026-08-27"), "Thu", "2026-08-27 Thu");
    CHECK_EQ_STR(weekday_abbrev("not-a-date"), "?",   "garbage -> ?");
}

static const char *CANNED =
    "{"
    "\"latitude\":40.71,\"longitude\":-74.0,\"timezone\":\"America/New_York\","
    "\"daily\":{"
    "\"time\":[\"2026-08-27\",\"2026-08-28\",\"2026-08-29\",\"2026-08-30\",\"2026-08-31\"],"
    "\"weather_code\":[2,61,0,95,71],"
    "\"temperature_2m_max\":[78.4,72.1,81.6,69.9,30.2],"
    "\"temperature_2m_min\":[61.2,59.8,63.3,58.0,19.7],"
    "\"precipitation_probability_max\":[10,80,null,90,0]"
    "}}";

static cJSON *day_at(cJSON *root, int i)
{
    cJSON *days = cJSON_GetObjectItemCaseSensitive(root, "days");
    return cJSON_GetArrayItem(days, i);
}
static int di(cJSON *day, const char *k)
{
    return (int)cJSON_GetNumberValue(cJSON_GetObjectItemCaseSensitive(day, k));
}
static const char *ds(cJSON *day, const char *k)
{
    return cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(day, k));
}

static void test_build_json(void)
{
    printf("weather_build_json\n");
    char *out = weather_build_json(CANNED, "Test City", 1756300000000LL, 4);
    CHECK(out != NULL, "build returns non-null");
    if (!out) return;

    cJSON *root = cJSON_Parse(out);
    CHECK(root != NULL, "output parses as JSON");
    if (!root) { free(out); return; }

    CHECK_EQ_STR(cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(root, "location")),
                 "Test City", "location embedded");
    CHECK((long long)cJSON_GetNumberValue(cJSON_GetObjectItemCaseSensitive(root, "fetched_ts"))
              == 1756300000000LL, "fetched_ts stamped");

    cJSON *days = cJSON_GetObjectItemCaseSensitive(root, "days");
    CHECK_EQ_INT(cJSON_GetArraySize(days), 4, "capped to max_days=4");

    cJSON *d0 = day_at(root, 0);
    CHECK_EQ_STR(ds(d0, "date"), "2026-08-27", "d0 date");
    CHECK_EQ_STR(ds(d0, "label"), "Thu",       "d0 weekday");
    CHECK_EQ_INT(di(d0, "hi_f"), 78,           "d0 hi rounded");
    CHECK_EQ_INT(di(d0, "lo_f"), 61,           "d0 lo rounded");
    CHECK_EQ_INT(di(d0, "code"), 2,            "d0 code");
    CHECK_EQ_STR(ds(d0, "cat"), "partly",      "d0 category");
    CHECK_EQ_INT(di(d0, "precip_pct"), 10,     "d0 precip");

    cJSON *d1 = day_at(root, 1);
    CHECK_EQ_STR(ds(d1, "label"), "Fri",  "d1 weekday");
    CHECK_EQ_STR(ds(d1, "cat"), "rain",   "d1 category");
    CHECK_EQ_INT(di(d1, "hi_f"), 72,      "d1 hi");
    CHECK_EQ_INT(di(d1, "precip_pct"), 80,"d1 precip");

    cJSON *d2 = day_at(root, 2);
    CHECK_EQ_STR(ds(d2, "cat"), "clear",  "d2 category");
    CHECK_EQ_INT(di(d2, "hi_f"), 82,      "d2 hi rounded up");
    CHECK_EQ_INT(di(d2, "precip_pct"), 0, "d2 null precip -> 0");

    cJSON *d3 = day_at(root, 3);
    CHECK_EQ_STR(ds(d3, "label"), "Sun",  "d3 weekday");
    CHECK_EQ_STR(ds(d3, "cat"), "storm",  "d3 category");
    CHECK_EQ_INT(di(d3, "lo_f"), 58,      "d3 lo");

    cJSON_Delete(root);
    free(out);
}

static void test_build_json_bad_input(void)
{
    printf("weather_build_json bad input\n");
    CHECK(weather_build_json("not json", "X", 0, 4) == NULL, "garbage -> NULL");
    CHECK(weather_build_json("{\"daily\":{}}", "X", 0, 4) == NULL, "missing arrays -> NULL");
}

int main(void)
{
    test_wmo_to_category();
    test_weekday();
    test_build_json();
    test_build_json_bad_input();

    printf("\n%d checks, %d failures\n", g_checks, g_fail);
    if (g_fail == 0) printf("ALL GREEN\n");
    return g_fail ? 1 : 0;
}
