/* led_ctl.c — see led_ctl.h. */
#include "led_ctl.h"
#include <stddef.h>

static bool chan(const cJSON *n, uint8_t *v)
{
    if (!cJSON_IsNumber(n)) return false;
    double d = n->valuedouble;
    if (!(d >= 0.0 && d <= 255.0) || d != (double)(int)d) return false;
    *v = (uint8_t)d;
    return true;
}

bool led_parse_cmd(const cJSON *item, led_color_t *out)
{
    if (!out) return false;
    out->have = false;
    if (!cJSON_IsArray(item) || cJSON_GetArraySize(item) != 3) return false;
    uint8_t c[3];
    for (int i = 0; i < 3; i++)
        if (!chan(cJSON_GetArrayItem(item, i), &c[i])) return false;
    out->r = c[0]; out->g = c[1]; out->b = c[2];
    out->have = true;
    return true;
}

bool led_parse_saved(const char *json, led_color_t *out)
{
    if (!out) return false;
    out->have = false;
    if (!json) return false;
    cJSON *root = cJSON_Parse(json);
    if (!root) return false;
    uint8_t r, g, b;
    bool ok = cJSON_IsObject(root)
           && chan(cJSON_GetObjectItemCaseSensitive(root, "r"), &r)
           && chan(cJSON_GetObjectItemCaseSensitive(root, "g"), &g)
           && chan(cJSON_GetObjectItemCaseSensitive(root, "b"), &b);
    if (ok) { out->r = r; out->g = g; out->b = b; out->have = true; }
    cJSON_Delete(root);
    return ok;
}

bool led_present(const led_hw_t *hw)
{
    return hw && hw->read_ok && (hw->status & LED_ST_PRESENT);
}

bool led_should_write(const led_color_t *desired, const led_hw_t *hw)
{
    if (!desired || !desired->have || !led_present(hw)) return false;
    return hw->r != desired->r || hw->g != desired->g || hw->b != desired->b;
}
