#include "cmdfile.h"

#include <errno.h>
#include <stdio.h>
#include <unistd.h>

long cmdfile_take(const char *path, char *buf, size_t cap)
{
    if (!path || !buf || cap < 2) return -1;

    char taking[512];
    int w = snprintf(taking, sizeof taking, "%s.taking", path);
    if (w < 0 || (size_t)w >= sizeof taking) return -1;

    if (rename(path, taking) != 0)
        return errno == ENOENT ? 0 : -1;   /* no pending command is the norm */

    FILE *f = fopen(taking, "r");
    if (!f) { unlink(taking); return -1; }

    size_t n = fread(buf, 1, cap - 1, f);
    int err = ferror(f);
    fclose(f);
    unlink(taking);                         /* consume it regardless of outcome */
    if (err) return -1;

    buf[n] = '\0';
    return (long)n;
}
