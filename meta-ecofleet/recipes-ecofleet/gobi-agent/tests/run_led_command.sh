#!/bin/sh
# Runs the real command-file handler against fake Modbus calls. No bench needed.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
files="$here/../files"
build=$(mktemp -d "${TMPDIR:-/tmp}/gobi-led-command-test.XXXXXX")
trap 'rm -f "$build/test_led_command"; rmdir "$build"' EXIT
set -- "$here/test_led_command.c"
for unit in shadow location state_path reboot_guard event_log bl_crc32 bl_frame bl_session stm32_update bl_transport_serial stm32_flash_task heater_fields heater_ext apu_command ota_status ota_offer net_info cmdfile led_ctl; do
    set -- "$@" "$files/$unit.c"
done
# CC may be a compiler command with flags, as in the other host runners.
${CC:-cc} -std=gnu11 -O2 -g -Wall -Wextra -Wpedantic -fstack-protector-strong \
    -DMQTT_ENDPOINT='"test.invalid"' -DFIRMWARE_VERSION='"test"' \
    -I"$files" $(pkg-config --cflags libmodbus libmosquitto sqlite3 libcjson libcurl) \
    "$@" $(pkg-config --libs libmodbus libmosquitto sqlite3 libcjson libcurl) \
    -lpthread -o "$build/test_led_command"
"$build/test_led_command"
