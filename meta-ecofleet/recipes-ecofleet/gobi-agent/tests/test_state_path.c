/* test_state_path.c — host tests for state_path.c: choosing between the
 * slot-shared /data copy of a state file and the per-slot legacy copy. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "state_path.h"

static int fails;
#define CHECK(c, msg) do { if (c) printf("  ok   %s\n", msg); \
                           else { printf("  FAIL %s\n", msg); fails++; } } while (0)

static void touch(const char *p) { FILE *f = fopen(p, "w"); if (f) { fputs("x\n", f); fclose(f); } }

int main(void)
{
    char root[] = "/tmp/test_state_path_XXXXXX";
    if (!mkdtemp(root)) { perror("mkdtemp"); return 1; }

    char shared_dir[256], legacy_dir[256], shared[300], legacy[300], nodir[300];
    snprintf(shared_dir, sizeof shared_dir, "%s/data", root);
    snprintf(legacy_dir, sizeof legacy_dir, "%s/var", root);
    snprintf(shared, sizeof shared, "%s/timezone", shared_dir);
    snprintf(legacy, sizeof legacy, "%s/timezone", legacy_dir);
    snprintf(nodir, sizeof nodir, "%s/missing/timezone", root);
    mkdir(legacy_dir, 0755);

    printf("state_write_path\n");
    CHECK(state_write_path(nodir, legacy) == legacy, "no shared dir -> legacy");
    mkdir(shared_dir, 0755);
    CHECK(state_write_path(shared, legacy) == shared, "writable shared dir -> shared");
    chmod(shared_dir, 0555);
    if (geteuid() != 0)
        CHECK(state_write_path(shared, legacy) == legacy, "read-only shared dir -> legacy");
    chmod(shared_dir, 0755);

    printf("state_read_path\n");
    CHECK(state_read_path(shared, legacy) == shared, "neither exists -> shared (reader finds nothing)");
    touch(legacy);
    CHECK(state_read_path(shared, legacy) == legacy, "only legacy exists -> legacy (unit just updated)");
    touch(shared);
    CHECK(state_read_path(shared, legacy) == shared, "shared exists -> shared wins over stale legacy");

    printf("state_retire_legacy\n");
    state_retire_legacy(shared, legacy);
    CHECK(access(legacy, F_OK) != 0, "legacy removed once shared is in use");
    touch(legacy);
    state_retire_legacy(legacy, legacy);
    CHECK(access(legacy, F_OK) == 0, "legacy kept when it is the path in use");
    unlink(legacy);
    state_retire_legacy(shared, legacy);   /* already gone: harmless */
    CHECK(1, "retire with no legacy file is harmless");

    unlink(shared); unlink(legacy); rmdir(shared_dir); rmdir(legacy_dir); rmdir(root);
    printf(fails ? "FAILED (%d)\n" : "all passed\n", fails);
    return fails ? 1 : 0;
}
