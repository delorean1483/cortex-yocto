# Host unit tests for gobi-ui C++ models. Dev tooling only; not built by the recipe.
#   cmake -S . -B /tmp/gobi-ui-tests -DCMAKE_PREFIX_PATH=/opt/homebrew/opt/qt
#   cmake --build /tmp/gobi-ui-tests && ctest --test-dir /tmp/gobi-ui-tests --output-on-failure
cmake_minimum_required(VERSION 3.18)
project(gobi-ui-tests CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

find_package(Qt6 6.2 REQUIRED COMPONENTS Core Gui Network Test)
enable_testing()

add_executable(tst_displaymodel tst_displaymodel.cpp ../DisplayModel.h ../DisplayModel.cpp)
target_link_libraries(tst_displaymodel PRIVATE Qt6::Core Qt6::Gui Qt6::Test)
target_compile_options(tst_displaymodel PRIVATE -Wall -Wextra)
add_test(NAME tst_displaymodel COMMAND tst_displaymodel)
set_tests_properties(tst_displaymodel PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=offscreen")

add_executable(tst_updatenotice tst_updatenotice.cpp ../UpdateNotice.h ../UpdateNotice.cpp)
target_link_libraries(tst_updatenotice PRIVATE Qt6::Core Qt6::Test)
target_compile_options(tst_updatenotice PRIVATE -Wall -Wextra)
add_test(NAME tst_updatenotice COMMAND tst_updatenotice)

add_executable(tst_wpaparse tst_wpaparse.cpp ../WpaParse.h ../WpaParse.cpp)
target_link_libraries(tst_wpaparse PRIVATE Qt6::Core Qt6::Network Qt6::Test)
target_compile_options(tst_wpaparse PRIVATE -Wall -Wextra)
add_test(NAME tst_wpaparse COMMAND tst_wpaparse)
