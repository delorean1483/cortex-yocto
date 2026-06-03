cmake_minimum_required(VERSION 3.18)
project(gobi-ui CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

find_package(Qt6 6.2 REQUIRED COMPONENTS Core Gui Quick QuickControls2 Network)
find_library(SQLITE3_LIB sqlite3 REQUIRED)
find_path(SQLITE3_INCLUDE_DIR sqlite3.h REQUIRED)

qt_standard_project_setup()

qt_add_executable(gobi-ui
    main.cpp
    TelemetryModel.h
    TelemetryModel.cpp
    DeviceInfoModel.h
    DeviceInfoModel.cpp
)

target_include_directories(gobi-ui PRIVATE ${SQLITE3_INCLUDE_DIR})

target_link_libraries(gobi-ui PRIVATE
    Qt6::Core
    Qt6::Gui
    Qt6::Quick
    Qt6::QuickControls2
    Qt6::Network
    ${SQLITE3_LIB}
)

target_compile_options(gobi-ui PRIVATE
    -Wall -Wextra
    $<$<CONFIG:Release>:-O2>
)

include(GNUInstallDirs)
install(TARGETS gobi-ui RUNTIME DESTINATION ${CMAKE_INSTALL_SBINDIR})
