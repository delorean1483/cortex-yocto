#include "cmdfile.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>

static int fails;
#define CHECK(c) do{ if(!(c)){ printf("FAIL %s:%d %s\n",__FILE__,__LINE__,#c); fails++; } }while(0)

static char dir[256], path[300], taking[320];

static void put(const char *s, size_t n)
{
    FILE *f = fopen(path, "w");
    if (f) { fwrite(s, 1, n, f); fclose(f); }
}
static int exists(const char *p) { struct stat st; return stat(p, &st) == 0; }

static void test_missing_returns_zero(void)
{
    char buf[64];
    CHECK(cmdfile_take(path, buf, sizeof buf) == 0);
}

static void test_take_reads_and_removes(void)
{
    char buf[64];
    put("{\"fan\":50}", 10);
    CHECK(cmdfile_take(path, buf, sizeof buf) == 10);
    CHECK(strcmp(buf, "{\"fan\":50}") == 0);
    CHECK(!exists(path));
    CHECK(!exists(taking));
}

static void test_new_write_after_take_survives(void)
{
    char buf[64];
    put("A", 1);
    CHECK(cmdfile_take(path, buf, sizeof buf) == 1);
    put("B", 1);
    CHECK(exists(path));
    CHECK(cmdfile_take(path, buf, sizeof buf) == 1);
    CHECK(strcmp(buf, "B") == 0);
    CHECK(!exists(path));
}

static void test_truncates_to_cap(void)
{
    char big[2000], buf[1024];
    memset(big, 'x', sizeof big);
    put(big, sizeof big);
    CHECK(cmdfile_take(path, buf, sizeof buf) == 1023);
    CHECK(buf[1023] == '\0');
    CHECK(!exists(path));
    CHECK(!exists(taking));
}

int main(void)
{
    snprintf(dir, sizeof dir, "/tmp/cmdfile.XXXXXX");
    if (!mkdtemp(dir)) { perror("mkdtemp"); return 1; }
    snprintf(path, sizeof path, "%s/command.json", dir);
    snprintf(taking, sizeof taking, "%s.taking", path);

    test_missing_returns_zero();
    test_take_reads_and_removes();
    test_new_write_after_take_survives();
    test_truncates_to_cap();

    unlink(path); unlink(taking); rmdir(dir);
    if (fails) { printf("%d failure(s)\n", fails); return 1; }
    printf("test_cmdfile: ok\n");
    return 0;
}
