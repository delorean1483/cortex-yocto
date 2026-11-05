/* led_ctl.h — pure helpers for the external RGB light (EF-G0B1R firmware regs
 * 76-78 red/green/blue 0-255, write = requested, read = applied; reg 79 status).
 * Parse the "led_rgb": [r,g,b] command and the saved led.json, and decide
 * whether the agent must (re)write the color. No I/O; host-tested by
 * ../tests/test_led_ctl.c.
 */
#pragma once
#include <stdbool.h>
#include <stdint.h>
#include <cjson/cJSON.h>

#define LED_ST_PRESENT  0x0001u   /* fw reg 79 bit0: driver present */
#define LED_ST_APPLY_OK 0x0002u   /* fw reg 79 bit1: last apply OK  */

typedef struct { bool have; uint8_t r, g, b; } led_color_t;
/* fw regs 76-79 as last read */
typedef struct { bool read_ok; uint16_t r, g, b, status; } led_hw_t;

/* item: array of 3 whole numbers 0..255. On failure *out is left with have=false. */
bool led_parse_cmd(const cJSON *item, led_color_t *out);
/* json: led.json text; reads "r","g","b" (whole numbers 0..255). */
bool led_parse_saved(const char *json, led_color_t *out);
/* read_ok && (status & LED_ST_PRESENT) */
bool led_present(const led_hw_t *hw);
/* desired->have, driver present, and applied rgb differs from desired. */
bool led_should_write(const led_color_t *desired, const led_hw_t *hw);
