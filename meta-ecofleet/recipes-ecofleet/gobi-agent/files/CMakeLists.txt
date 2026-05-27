cmake_minimum_required(VERSION 3.16)
project(gobi-agent C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

# ── MQTT_ENDPOINT guard ───────────────────────────────────────────────────────
# The Yocto recipe passes -DMQTT_ENDPOINT=<host> via EXTRA_OECMAKE.
# If it's missing the build fails here, preventing placeholder images shipping.
if(NOT DEFINED MQTT_ENDPOINT OR MQTT_ENDPOINT STREQUAL "")
  message(FATAL_ERROR
    "MQTT_ENDPOINT is not set. Pass -DMQTT_ENDPOINT=<iot-endpoint> to cmake.\n"
    "In Yocto: set EXTRA_OECMAKE:pn-gobi-agent in local.conf or kas yaml.")
endif()

# ── FIRMWARE_VERSION (optional, defaults to 1.0.0) ───────────────────────────
if(NOT DEFINED FIRMWARE_VERSION OR FIRMWARE_VERSION STREQUAL "")
  set(FIRMWARE_VERSION "1.0.0")
endif()

# ── Find dependencies ─────────────────────────────────────────────────────────
find_library(MODBUS_LIB  modbus  REQUIRED)
find_library(MOSQUITTO_LIB mosquitto REQUIRED)
find_library(SQLITE3_LIB sqlite3 REQUIRED)
find_library(CJSON_LIB   cjson  REQUIRED)

find_path(MODBUS_INCLUDE_DIR   modbus.h        PATH_SUFFIXES modbus REQUIRED)
find_path(MOSQUITTO_INCLUDE_DIR mosquitto.h     REQUIRED)
find_path(SQLITE3_INCLUDE_DIR  sqlite3.h        REQUIRED)
find_path(CJSON_INCLUDE_DIR    cjson/cJSON.h    REQUIRED)

# ── Target ────────────────────────────────────────────────────────────────────
add_executable(gobi-agent)

target_sources(gobi-agent PRIVATE
    main.c
    shadow.c
)

target_include_directories(gobi-agent PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${MODBUS_INCLUDE_DIR}
    ${MOSQUITTO_INCLUDE_DIR}
    ${SQLITE3_INCLUDE_DIR}
    ${CJSON_INCLUDE_DIR}
)

target_link_libraries(gobi-agent PRIVATE
    ${MODBUS_LIB}
    ${MOSQUITTO_LIB}
    ${SQLITE3_LIB}
    ${CJSON_LIB}
    pthread
)

# ── Compile definitions (injected from CMake -D flags) ───────────────────────
target_compile_definitions(gobi-agent PRIVATE
    MQTT_ENDPOINT="${MQTT_ENDPOINT}"
    FIRMWARE_VERSION="${FIRMWARE_VERSION}"
)

# ── Compiler flags ────────────────────────────────────────────────────────────
target_compile_options(gobi-agent PRIVATE
    -Wall -Wextra -Wpedantic
    -Wformat=2 -Wstrict-prototypes
    -fstack-protector-strong
    $<$<CONFIG:Release>:-O2>
    $<$<CONFIG:Debug>:-g -O0 -fsanitize=address>
)

target_link_options(gobi-agent PRIVATE
    $<$<CONFIG:Debug>:-fsanitize=address>
)

# ── Install ───────────────────────────────────────────────────────────────────
include(GNUInstallDirs)
install(TARGETS gobi-agent
    RUNTIME DESTINATION ${CMAKE_INSTALL_SBINDIR}
)
