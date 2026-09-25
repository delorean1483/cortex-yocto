#!/bin/sh
# Host test runner for the pure weather transforms. Uses the Mac's Homebrew
# cJSON. No device or network involved.
set -e
here=$(cd "$(dirname "$0")" && pwd)
files="$here/../files"
cjson=$(brew --prefix cjson 2>/dev/null || echo /opt/homebrew/opt/cjson)

cc -std=c11 -Wall -Wextra -Wpedantic -g \
   -fsanitize=address,undefined \
   -I"$files" -I"$cjson/include" \
   "$here/test_weather.c" "$files/weather.c" \
   -L"$cjson/lib" -lcjson \
   -o "$here/test_weather"

"$here/test_weather"

cc -std=c11 -Wall -Wextra -Wpedantic -g -fsanitize=address,undefined \
   -I"$files" "$here/test_bl_crc32.c" "$files/bl_crc32.c" -o "$here/test_bl_crc32" && "$here/test_bl_crc32"

cc -std=c11 -Wall -Wextra -Wpedantic -g -fsanitize=address,undefined \
   -I"$files" "$here/test_bl_frame.c" "$files/bl_frame.c" -o "$here/test_bl_frame" && "$here/test_bl_frame"

cc -std=c11 -Wall -Wextra -Wpedantic -g -fsanitize=address,undefined \
   -I"$files" "$here/test_bl_session.c" "$files/bl_session.c" "$files/bl_frame.c" "$files/bl_crc32.c" "$here/fake_bootloader.c" \
   -o "$here/test_bl_session" && "$here/test_bl_session"

# Transport-layer test: drives the REAL bl_transport_serial_xfer byte-framing
# loop over a pty (txstub/modbus.h stands in for libmodbus on the host). Covers
# the delayed-reply fragmentation that caused the remote-flash VERIFY failures.
cc -std=c11 -Wall -Wextra -Wpedantic -g -fsanitize=address,undefined \
   -I"$here/txstub" -I"$files" "$here/test_bl_transport_serial.c" "$files/bl_frame.c" \
   -lpthread -o "$here/test_bl_transport_serial" && "$here/test_bl_transport_serial"

cc -std=c11 -Wall -Wextra -Wpedantic -g \
   -fsanitize=address,undefined \
   -I"$files" -I"$cjson/include" \
   "$here/test_stm32_update.c" "$files/stm32_update.c" \
   -L"$cjson/lib" -lcjson \
   -o "$here/test_stm32_update"

"$here/test_stm32_update"

# Host test runner for the pure heater field helpers (no cJSON dependency).
cc -std=c11 -Wall -Wextra -Wpedantic -g \
   -fsanitize=address,undefined \
   -I"$files" \
   "$here/test_heater_fields.c" "$files/heater_fields.c" \
   -o "$here/test_heater_fields"

"$here/test_heater_fields"

# Host test runner for the pure APU-command mapping (no cJSON dependency).
cc -std=c11 -Wall -Wextra -Wpedantic -g \
   -fsanitize=address,undefined \
   -I"$files" \
   "$here/test_apu_command.c" "$files/apu_command.c" \
   -o "$here/test_apu_command"

"$here/test_apu_command"

# Host test runner for the pure OTA-status aging policy (no cJSON dependency).
cc -std=c11 -Wall -Wextra -Wpedantic -g \
   -fsanitize=address,undefined \
   -I"$files" \
   "$here/test_ota_status.c" "$files/ota_status.c" \
   -o "$here/test_ota_status"

"$here/test_ota_status"

# Shadow firmware_target compare-and-clear: drives the REAL shadow.c state logic
# (apply_desired + shadow_clear_firmware_target) with tests/mqstub/ standing in
# for libmosquitto. Guards the standing-delta regression (a satisfied
# desired.firmware_target must be nulled once the OTA converges).
cc -std=c11 -Wall -Wextra -Wpedantic -g \
   -fsanitize=address,undefined \
   -DLOCATION_JSON_PATH='"/tmp/test_shadow_fw_target_location.json"' \
   -I"$here/mqstub" -I"$files" -I"$cjson/include" \
   "$here/test_shadow_fw_target.c" "$files/location.c" \
   -L"$cjson/lib" -lcjson -lpthread \
   -o "$here/test_shadow_fw_target" && "$here/test_shadow_fw_target"

# Assigned-location helpers (location.c): desired.location parse, file form,
# change-only store.
cc -std=c11 -Wall -Wextra -Wpedantic -g -fsanitize=address,undefined \
   -I"$files" -I"$cjson/include" \
   "$here/test_location.c" "$files/location.c" \
   -L"$cjson/lib" -lcjson \
   -o "$here/test_location" && "$here/test_location"

# desired.location through the REAL shadow.c: partial-delta merge, clear, and
# reported.location echo (no standing delta).
cc -std=c11 -Wall -Wextra -Wpedantic -g -fsanitize=address,undefined \
   -DLOCATION_JSON_PATH='"/tmp/test_shadow_location.json"' \
   -I"$here/mqstub" -I"$files" -I"$cjson/include" \
   "$here/test_shadow_location.c" "$files/location.c" \
   -L"$cjson/lib" -lcjson -lpthread \
   -o "$here/test_shadow_location" && "$here/test_shadow_location"

# Remote-reboot loop guard: honor each desired.reboot (by AWS metadata
# timestamp) only once across the cold reset it triggers.
cc -std=c11 -Wall -Wextra -Wpedantic -g -fsanitize=address,undefined \
   -I"$files" "$here/test_reboot_guard.c" "$files/reboot_guard.c" \
   -o "$here/test_reboot_guard" && "$here/test_reboot_guard"

cc -std=c11 -Wall -Wextra -Wpedantic -g -fsanitize=address,undefined \
   -DLOCATION_JSON_PATH='"/tmp/test_shadow_reboot_location.json"' \
   -I"$here/mqstub" -I"$files" -I"$cjson/include" \
   "$here/test_shadow_reboot.c" "$files/location.c" \
   -L"$cjson/lib" -lcjson -lpthread \
   -o "$here/test_shadow_reboot" && "$here/test_shadow_reboot"
