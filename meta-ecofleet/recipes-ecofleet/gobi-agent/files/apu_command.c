#include "apu_command.h"
#include <string.h>

int apu_command_to_mode_reg(const char *cmd)
{
    if (!cmd)                          return -1;
    if (strcmp(cmd, "stop")    == 0)   return 0;   /* Off     */
    if (strcmp(cmd, "climate") == 0)   return 1;   /* Climate */
    if (strcmp(cmd, "battery") == 0)   return 2;   /* Battery */
    if (strcmp(cmd, "start")   == 0)   return 1;   /* legacy alias -> Climate */
    return -1;
}
