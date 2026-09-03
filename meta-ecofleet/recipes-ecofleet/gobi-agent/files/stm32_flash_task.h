/* stm32_flash_task.h — STM32 (gobi/APU) remote firmware update: poll-loop
 * facing orchestration glue.
 *
 * Reads the bundled manifest + .bin images from G0B1_FW_DIR, applies the
 * idle-safety gate (stm32_update.h's pure decision logic), drives the
 * transfer session (bl_session.h) over the raw-fd serial transport
 * (bl_transport_serial.h), and owns the observable status/progress that
 * main.c's telemetry snapshot surfaces to the UI/shadow.
 *
 * This module never includes main.c. The telemetry values the decision
 * logic needs (the APU's running firmware version, mode, engine-running
 * flag) are passed into stm32_flash_tick() by the caller each poll
 * iteration instead.
 */
#ifndef STM32_FLASH_TASK_H
#define STM32_FLASH_TASK_H

#include <stdint.h>
#include <modbus.h>

#include "stm32_update.h"

/* Stores ctx for later transport construction. Must be called once,
 * after the agent's modbus_t is connected, before the first
 * stm32_flash_tick(). Does not touch the bus itself. */
void stm32_flash_task_init(modbus_t *ctx);

/* Current lifecycle status, for the telemetry snapshot
 * (stu_status_str() gives the wire string). */
stu_status_t stm32_flash_status(void);

/* Flash progress, 0-100, while stm32_flash_status() == STU_FLASHING (and
 * the last value reached for a short while after, whether the flash
 * succeeded or failed). -1 before any flash attempt has ever started. */
int stm32_flash_status_pct(void);

/* Called once per poll iteration.
 *
 * running_ver_enc: the APU's reg-2 firmware version as read this cycle,
 *   already stu_encode_version()-shaped (0 if the register read failed --
 *   see stu_is_newer(), which never treats 0 as "older").
 * mode / engine: the APU's current mode / engine-running flags this
 *   cycle (0 == idle/off), as used by the idle-safety gate
 *   (stu_should_flash()).
 *
 * May block for the duration of an entire flash (tens of seconds to
 * about a minute) -- acceptable because the gate only allows starting
 * one while mode==0 and engine==0, i.e. the APU's compressor/engine are
 * not running.
 */
void stm32_flash_tick(uint16_t running_ver_enc, uint8_t mode, uint8_t engine);

#endif /* STM32_FLASH_TASK_H */
