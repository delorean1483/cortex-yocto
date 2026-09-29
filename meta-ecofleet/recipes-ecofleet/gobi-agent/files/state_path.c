/* state_path.c — see state_path.h. */
#include "state_path.h"

#include <limits.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

const char *state_write_path(const char *shared, const char *legacy)
{
    char dir[PATH_MAX];
    snprintf(dir, sizeof dir, "%s", shared);
    char *slash = strrchr(dir, '/');
    if (slash) *slash = '\0';
    /* access() also reports EROFS inside a ProtectSystem=strict sandbox that
     * doesn't list the directory, so a missing ReadWritePaths degrades safely. */
    return access(dir, W_OK) == 0 ? shared : legacy;
}

const char *state_read_path(const char *shared, const char *legacy)
{
    if (access(shared, F_OK) == 0) return shared;
    if (access(legacy, F_OK) == 0) return legacy;
    return shared;
}

void state_retire_legacy(const char *used, const char *legacy)
{
    if (strcmp(used, legacy) != 0) unlink(legacy);
}
