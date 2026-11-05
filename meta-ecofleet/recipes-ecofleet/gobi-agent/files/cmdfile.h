/* cmdfile.h - atomically take the touchscreen command file.
 *
 * The UI merges commands into a JSON file; the agent consumes it. Renaming
 * the file aside before reading means a UI write that lands mid-read creates
 * a fresh file instead of being lost to a later unlink. */
#ifndef CMDFILE_H
#define CMDFILE_H

#include <stddef.h>

/* Rename `path` to "<path>.taking", read at most cap-1 bytes into buf,
 * NUL-terminate, then unlink the taken copy.
 * Returns the byte count, 0 when there is no file, or -1 on error. */
long cmdfile_take(const char *path, char *buf, size_t cap);

#endif
