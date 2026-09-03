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
