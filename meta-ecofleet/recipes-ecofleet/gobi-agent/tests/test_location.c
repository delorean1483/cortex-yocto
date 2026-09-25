/* test_location.c — host tests for the assigned-location helpers (location.c).
 *
 * The dashboard's Fleet-map location reaches the unit as shadow
 * desired.location = {"assigned":true,"lat":..,"lon":..,"label":".."} or
 * {"assigned":false} when cleared (a deleted desired key never produces a
 * delta, so clearing is explicit). The agent stores it in a small JSON file
 * that weather-fetch prefers over IP geolocation for the forecast + time zone.
 */
#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <cjson/cJSON.h>

#include "location.h"

static int g_fail, g_checks;
#define CHECK(c, msg) do { g_checks++; if (!(c)) { g_fail++; \
    printf("  FAIL: %s  (%s:%d)\n", (msg), __FILE__, __LINE__); } } while (0)

static int from_desired(const char *json, unit_location_t *out) {
    cJSON *o = cJSON_Parse(json);
    int r = location_from_desired(o, out);
    cJSON_Delete(o);
    return r;
}

static void test_from_desired(void) {
    unit_location_t l;
    printf("location_from_desired\n");
    CHECK(from_desired("{\"assigned\":true,\"lat\":37.7306,\"lon\":-88.9331,\"label\":\"Marion, IL\"}", &l) == 1,
          "assigned accepted");
    CHECK(l.lat == 37.7306 && l.lon == -88.9331, "lat/lon copied");
    CHECK(strcmp(l.label, "Marion, IL") == 0, "label copied");
    CHECK(from_desired("{\"assigned\":true,\"lat\":10,\"lon\":20}", &l) == 1 && l.label[0] == '\0',
          "label optional");
    CHECK(from_desired("{\"assigned\":false}", &l) == 0, "explicit clear");
    CHECK(from_desired("{\"assigned\":true,\"lat\":91,\"lon\":0}", &l) == -1, "lat out of range");
    CHECK(from_desired("{\"assigned\":true,\"lat\":0,\"lon\":-181}", &l) == -1, "lon out of range");
    CHECK(from_desired("{\"assigned\":true,\"lat\":\"37\",\"lon\":0}", &l) == -1, "lat not number");
    CHECK(from_desired("{\"lat\":1,\"lon\":2}", &l) == -1, "missing assigned flag");
    CHECK(from_desired("[1,2]", &l) == -1, "not an object");
    CHECK(location_from_desired(NULL, &l) == -1, "NULL");
    CHECK(from_desired("{\"assigned\":true,\"lat\":1,\"lon\":2,\"label\":\"a\\nb\\tc\"}", &l) == 1
          && strcmp(l.label, "a b c") == 0, "control chars in label become spaces");
    char longl[200]; memset(longl, 'x', sizeof longl); longl[199] = 0;
    char js[400]; snprintf(js, sizeof js, "{\"assigned\":true,\"lat\":1,\"lon\":2,\"label\":\"%s\"}", longl);
    CHECK(from_desired(js, &l) == 1 && strlen(l.label) == sizeof(l.label) - 1, "long label truncated");
}

static void test_json_roundtrip(void) {
    unit_location_t a = { 37.7306, -88.9331, "Marion, IL" }, b;
    printf("location json round-trip\n");
    char *j = location_to_json(&a);
    CHECK(j != NULL, "serialized");
    CHECK(location_from_json(j, &b) == 1, "parsed back");
    CHECK(b.lat == a.lat && b.lon == a.lon && strcmp(b.label, a.label) == 0, "round-trip equal");
    free(j);
    CHECK(location_from_json("{\"lat\":100,\"lon\":0}", &b) == 0, "file with bad lat rejected");
    CHECK(location_from_json("garbage", &b) == 0, "garbage rejected");
    CHECK(location_from_json(NULL, &b) == 0, "NULL rejected");
}

static void test_store(void) {
    char path[] = "/tmp/test_location_XXXXXX";
    int fd = mkstemp(path); close(fd); unlink(path);
    unit_location_t a = { 1.5, 2.5, "Here" }, b = { 3.5, 4.5, "There" }, r;
    printf("location_store\n");
    CHECK(location_store(path, &a) == 1, "first write changes file");
    CHECK(location_store(path, &a) == 0, "same location: no rewrite");
    CHECK(location_load(path, &r) == 1 && r.lat == 1.5 && strcmp(r.label, "Here") == 0, "load");
    CHECK(location_store(path, &b) == 1, "new location rewrites");
    CHECK(location_store(path, NULL) == 1, "clear removes file");
    CHECK(access(path, F_OK) != 0, "file gone");
    CHECK(location_store(path, NULL) == 0, "clear again: nothing to do");
    CHECK(location_load(path, &r) == 0, "load with no file");
}

int main(void) {
    test_from_desired();
    test_json_roundtrip();
    test_store();
    printf("\n%d checks, %d failures\n", g_checks, g_fail);
    if (g_fail == 0) printf("ALL GREEN\n");
    return g_fail ? 1 : 0;
}
