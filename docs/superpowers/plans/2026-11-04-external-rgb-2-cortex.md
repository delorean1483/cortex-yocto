# External RGB Light — Plan 2: Cortex Agent and UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user picks the external lamp's color on a Settings color page. The agent delivers it to the G0B1, shows whether it was applied, and restores it after restarts.

**Architecture:**
- The UI turns wheel and slider input into logical RGB and merges `led_rgb` into `command.json`, throttled.
- The agent picks commands up every 200 ms and writes G0B1 registers 76-78 in one FC16 request. It reads 76-79 back into `latest.json`, and keeps the lamp at the desired color (from the last command, or the saved `led.json` at start).
- Pure helpers (command-file take, LED parse and reconcile, color math) carry the logic so it is host-tested.

**Tech Stack:** C11 + libmodbus + cJSON (gobi-agent), Qt 6 C++/QML (gobi-ui), QtTest, qmltestrunner, the offscreen preview runner.

**Spec:** `docs/superpowers/specs/2026-11-04-external-rgb-light-design.md` (Cortex agent items 5-8, Cortex UI items 9-12, Decisions, Restore behavior).

**Repo:** `cortex-yocto`, worktree `.worktrees/external-rgb`, branch `feat/external-rgb-light`. Register contract from Plan 1 (`2026-11-04-external-rgb-1-g0b1.md`); this plan builds and tests without it.

Paths: `A/` = `meta-ecofleet/recipes-ecofleet/gobi-agent/`, `U/` = `meta-ecofleet/recipes-ecofleet/gobi-ui/files/`.

## Global Constraints

- **Registers:** wire addresses (= firmware register − 1) are 75 red, 76 green, 77 blue and 78 status. Status bit 0 is present, bit 1 is last apply OK, bit 2 is pending. Writes use one `modbus_write_registers(ctx, 75, 3, vals)`.
- **Command key:** `"led_rgb": [r, g, b]`, three integers 0-255. Anything else is ignored with one warning.
- **`latest.json` keys** are local only: add them in `build_latest_json()`, not `telemetry_object()`, so none of them goes to MQTT. They are `led_present` (bool), `led_ok` (bool), and `led_r`, `led_g`, `led_b` (the applied values).
- **Saved file `led.json`:**
  - Path: `/data/ecofleet/led.json` when `/data` is the shared partition (same rule as `DisplayModel::defaultConfigPath()`), else `/var/lib/gobi-ui/led.json`. The agent tries the first, then the second.
  - Shape: `{"h":0-360,"s":0-1,"v":0-1,"r":0-255,"g":0-255,"b":0-255}`.
  - It is written only when the finger lifts or the page closes, with `QSaveFile`, mode 0644, so the agent's `ecofleet` user can read it.
- **Timing:** the agent checks for commands every `CMD_POLL_MS` (200 ms). The UI sends a live update at most every `SEND_THROTTLE_MS` (200 ms): the first one immediately, then the latest one when the 200 ms are up. Release always sends the final value immediately.
- **Color math:**
  - Hue is the angle from 12 o'clock, clockwise: red 0, yellow 60, green 120, cyan 180, blue 240, magenta 300.
  - Saturation is distance ÷ wheel radius, capped at 1. The exact center keeps the previous hue.
  - Brightness 0 keeps hue and saturation.
  - HSV converts to RGB rounded to 0-255.
- **UI:**
  - The Settings row "External LED Color" is visible only while `telemetry.ledPresent` is true.
  - Status strings, exactly, highest priority first: `G0B1 offline, will apply when it reconnects` (`telemetry.stale`), `Not set. Tap the wheel to choose a color` (`!led.hasColor`), `Light not responding` (present and not OK), `Applied` (applied RGB == requested RGB), otherwise `Sending…`.
- **Restore:** the agent's desired color starts from `led.json`. With no valid saved color it sends nothing.
- **Not in this plan:** no shadow or cloud changes, and no Qt5Compat.

## Review Focus

1. **The UI writes `command.json` while the agent is consuming it.** The new write must survive. Test `test_new_write_after_take_survives` (Task 1).
2. **Older G0B1 firmware without registers 76-79:** the agent never writes, logs once, and the row stays hidden. Tests `test_should_write_needs_present_read` (Task 2) and `test_row_hidden_without_light` (Task 6).
3. **Missing or corrupt `led.json`:** the agent sends nothing and the page shows "Not set". Tests `test_parse_saved_rejects_bad` (Task 2) and `test_defaults_without_file` (Task 5).
4. **The finger lifts inside the 200 ms throttle window:** the final color is still sent and saved. Test `test_release_sends_final_and_saves` (Task 5).
5. **Offline while dragging:** the page keeps the requested color and says offline. Test `test_status_priority` (Task 6).

Commands (from the worktree root):
- Agent tests: `sh meta-ecofleet/recipes-ecofleet/gobi-agent/tests/run.sh 2>&1 | tail -3`.
- Agent `main.c` check: `cd A/files && cc -std=gnu11 -Wall -Wextra -fsyntax-only -DMQTT_ENDPOINT='"x"' -DFIRMWARE_VERSION='"1.0"' -I. -I$(brew --prefix cjson)/include -I$(brew --prefix libmodbus)/include/modbus -I$(brew --prefix libmodbus)/include -I$(brew --prefix mosquitto)/include main.c && echo OK`.
- UI C++ tests: `cmake -S U/tests -B /tmp/gobi-ui-tests -DCMAKE_PREFIX_PATH=/opt/homebrew/opt/qt && cmake --build /tmp/gobi-ui-tests && ctest --test-dir /tmp/gobi-ui-tests --output-on-failure`.
- QML tests: `QT_QPA_PLATFORM=offscreen /opt/homebrew/opt/qt/bin/qmltestrunner -input U/tests/qml`.

---

### Task 1: Agent — atomic command-file take and 200 ms pickup

**Files:**
- Create: `A/files/cmdfile.h`, `A/files/cmdfile.c`, `A/tests/test_cmdfile.c`
- Modify: `A/tests/run.sh` (copy the heater_fields block, lines 48-55; no cJSON)
- Modify: `A/files/main.c:989-1003` (`apply_command_file` reads through `cmdfile_take`, buffer 1024)
- Modify: `A/files/main.c:1460-1475` (wait loop ticks every `CMD_POLL_MS`)
- Modify: `A/files/config.h` (`#define CMD_POLL_MS 200`)
- Modify: `A/files/CMakeLists.txt` `target_sources` and the `A/gobi-agent_1.0.bb` `SRC_URI` (`file://cmdfile.c file://cmdfile.h`)

**Interfaces:**
- Produces: `long cmdfile_take(const char *path, char *buf, size_t cap);`
  - Renames `path` to `<path>.taking`, reads at most `cap - 1` bytes, NUL-terminates, then unlinks the taken copy.
  - Returns the byte count, 0 when there is no file, or -1 on error.

- [ ] **Step 1: Write the failing tests** in `A/tests/test_cmdfile.c` (the `CHECK` macro style of `test_heater_fields.c`, files in a `mkdtemp` dir):
  - `test_missing_returns_zero`: take on a missing path → 0.
  - `test_take_reads_and_removes`: write `{"fan":50}`, take → returns 10, the buffer equals the content, and neither `path` nor `path.taking` exists.
  - `test_new_write_after_take_survives`: write A, take, write B → `path` exists and holds B; a second take returns B.
  - `test_truncates_to_cap`: 2000 bytes with `cap` 1024 → returns 1023, `buf[1023] == '\0'`.
- [ ] **Step 2: Run the agent tests, expect FAIL.**
- [ ] **Step 3: Implement `cmdfile.{h,c}`.** In `apply_command_file`, replace the fopen/fread/unlink block with `char buf[1024]; long n = cmdfile_take(COMMAND_JSON_PATH, buf, sizeof buf); if (n <= 0) return;`. Change the wait loop to `for (int ms = 0; ms < poll_s * 1000 && g_running; ms += CMD_POLL_MS) { nanosleep(200 ms); apply_command_file(); ...existing OTA publish block... }`.
- [ ] **Step 4: Run the agent tests and the `main.c` check, expect PASS / OK.**
- [ ] **Step 5: Commit** — `fix(agent): take command.json atomically and check it every 200 ms`

### Task 2: Agent — LED parse and reconcile helpers

**Files:**
- Create: `A/files/led_ctl.h`, `A/files/led_ctl.c`, `A/tests/test_led_ctl.c`
- Modify: `A/tests/run.sh` (cJSON test block, with `-I"$cjson/include" ... -L"$cjson/lib" -lcjson`), `A/files/CMakeLists.txt`, `A/gobi-agent_1.0.bb` `SRC_URI`

**Interfaces:**
- Produces:
  ```c
  #define LED_ST_PRESENT  0x0001u
  #define LED_ST_APPLY_OK 0x0002u
  typedef struct { bool have; uint8_t r, g, b; } led_color_t;
  typedef struct { bool read_ok; uint16_t r, g, b, status; } led_hw_t;  /* fw regs 76-79 as last read */
  bool led_parse_cmd(const cJSON *item, led_color_t *out);    /* array of 3 integral numbers 0..255 */
  bool led_parse_saved(const char *json, led_color_t *out);   /* led.json text: "r","g","b" 0..255 */
  bool led_present(const led_hw_t *hw);                       /* read_ok && (status & LED_ST_PRESENT) */
  bool led_should_write(const led_color_t *desired, const led_hw_t *hw);
  ```
  `led_should_write` is true only when `desired->have`, `led_present(hw)`, and the applied (r, g, b) differs from the desired value.

- [ ] **Step 1: Write the failing tests** in `A/tests/test_led_ctl.c`:
  - `test_parse_cmd_ok`: `[255,128,0]` → true, 255/128/0, `have`.
  - `test_parse_cmd_rejects`: `[256,0,0]`, `[-1,0,0]`, `[1,2]`, `[1,2,3,4]`, `"red"`, `[1.5,0,0]`, `null` → false.
  - `test_parse_saved_ok`: `{"h":30,"s":1,"v":1,"r":255,"g":128,"b":0}` → 255/128/0.
  - `test_parse_saved_rejects_bad`: `""`, `"{"`, `{"r":1,"g":2}`, `{"r":300,"g":0,"b":0}` → false.
  - `test_should_write_needs_present_read`: desired `{have,1,2,3}`. `read_ok=false` → false. `read_ok=true`, `status=0` → false. Present with applied 1,2,3 → false. Present with applied 0,0,0 → true. Desired `have=false` → false.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `led_ctl.{h,c}`.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(agent): LED command, saved-color and reconcile helpers`

### Task 3: Agent — Modbus read, write, reconcile and `latest.json`

**Files:**
- Modify: `A/files/config.h`
  - `REG_LED_RED 75`, `REG_LED_GREEN 76`, `REG_LED_BLUE 77`, `REG_LED_STATUS 78`, each with a `/* fw 76 led_red RW */`-style comment in the heater block's format.
  - `LED_SAVED_PATH "/data/ecofleet/led.json"` and `LED_SAVED_FALLBACK "/var/lib/gobi-ui/led.json"`.
- Modify: `A/files/main.c`
  - `telemetry_t` (lines 88-143) gains `led_hw_t led;`.
  - Globals `static led_color_t g_led_desired;` and `static bool g_led_absent_logged;`.
  - `modbus_read_besteffort()` (702-743): one best-effort `modbus_read_registers(g_modbus, REG_LED_RED, 4, v)`. Success fills `t->led`; failure sets `read_ok=false` and never triggers a reconnect.
  - `apply_command_file()`: handle `led_rgb`.
  - The poll cycle (around 1236-1293): reconcile before `g_last_t = t`.
  - `build_latest_json()` (889-913): add the five keys.
  - Startup: load the saved color.

**Interfaces:**
- Consumes: Task 2 (`led_*`), Task 1 (`cmdfile_take`), `write_latest_snapshot()`, `build_latest_json()`.
- Produces: `static int mb_write_led(const led_color_t *c, led_hw_t *readback);`
  - One `modbus_write_registers(g_modbus, REG_LED_RED, 3, {r,g,b})`, with `MB_WRITE_ATTEMPTS` and `modbus_flush` between attempts like `mb_write_reg` (main.c:967).
  - Logs `control: led_rgb -> r,g,b`.
  - On success it re-reads 75-78 into `*readback`. Returns 0 or -1.

- [ ] **Step 1: Startup.** After the config load, set `g_led_desired` from the first of `LED_SAVED_PATH` / `LED_SAVED_FALLBACK` that `led_parse_saved` accepts. If neither is valid, `have` stays false.
- [ ] **Step 2: Command.**
  - In `apply_command_file()`, after the heater block: if `led_parse_cmd(cJSON_GetObjectItemCaseSensitive(root,"led_rgb"), &c)`, set `g_led_desired = c`.
  - Then, if `led_present(&g_last_t.led)`, call `mb_write_led(&c, &g_last_t.led)` and refresh `latest.json` with `write_latest_snapshot(build_latest_json(&g_last_t))`.
  - Otherwise log `led: no external light reported; color kept for later`, only once until it is present again.
  - A key that is present but invalid logs `control: bad led_rgb, ignoring`.
- [ ] **Step 3: Reconcile.** In the poll cycle, after `modbus_read_besteffort(&t)`: `if (led_should_write(&g_led_desired, &t.led)) mb_write_led(&g_led_desired, &t.led);`. That is at most one write per cycle.
- [ ] **Step 4: Keys.** In `build_latest_json()`: `led_present` = `led_present(&t->led)`, `led_ok` = `(t->led.status & LED_ST_APPLY_OK) != 0`, and `led_r`/`led_g`/`led_b`.
- [ ] **Step 5: Verify** — agent tests PASS, the `main.c` check OK, and the host link check from `docs/superpowers/plans/2026-10-07-panel-software-update.md:518-524` builds `gobi-agent`.
- [ ] **Step 6: Commit** — `feat(agent): external LED color over Modbus regs 76-79 with restore`

### Task 4: UI — color math

**Files:**
- Create: `U/LedColor.h`, `U/LedColor.cpp` (plain C++, no Qt), `U/tests/tst_ledcolor.cpp`
- Modify: `U/tests/CMakeLists.txt` (copy the `tst_displaymodel` block)

**Interfaces:**
- Produces:
  ```cpp
  namespace ledcolor {
  struct Rgb { int r, g, b; };
  Rgb    hsvToRgb(double hueDeg, double sat, double val);          // 0..255, rounded
  double hueFromPoint(double dx, double dy, double prevHue);       // dx right+, dy down+; 12 o'clock = 0, clockwise; (0,0) -> prevHue
  double satFromPoint(double dx, double dy, double radius);        // hypot/radius, capped at 1
  }
  ```

- [ ] **Step 1: Write the failing tests** in `U/tests/tst_ledcolor.cpp` (QtTest, data-driven where natural):
  - `hsvToRgb` cases:
    - `(0,1,1)` = `{255,0,0}`
    - `(60,1,1)` = `{255,255,0}`
    - `(120,1,1)` = `{0,255,0}`
    - `(180,1,1)` = `{0,255,255}`
    - `(240,1,1)` = `{0,0,255}`
    - `(300,1,1)` = `{255,0,255}`
    - `(30,1,1)` = `{255,128,0}`
    - `(200,0,1)` = `{255,255,255}`
    - `(200,1,0)` = `{0,0,0}`
    - `(360,1,1)` = `{255,0,0}`
  - `hueFromPoint` cases:
    - `(0,-10)` → 0
    - `(10,0)` → 90
    - `(0,10)` → 180
    - `(-10,0)` → 270
    - `(0,0,123)` → 123
  - `satFromPoint` cases: `(5,0,10)` → 0.5; `(20,0,10)` → 1; `(0,0,10)` → 0.
- [ ] **Step 2: Run the UI C++ tests, expect FAIL.**
- [ ] **Step 3: Implement `LedColor.{h,cpp}`.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(ui): LED color math (HSV wheel mapping)`

### Task 5: UI — LedModel, shared command writer, telemetry fields

**Files:**
- Create: `U/CommandFile.h`, `U/CommandFile.cpp`. Move `writeCommand` out of `TelemetryModel.cpp:15-34` unchanged, with the path as a parameter. TelemetryModel calls it with `COMMAND_PATH`.
- Create: `U/LedModel.h`, `U/LedModel.cpp`, `U/tests/tst_ledmodel.cpp`
- Modify: `U/TelemetryModel.h/.cpp`: properties `ledPresent` (bool), `ledOk` (bool), `ledR`, `ledG`, `ledB` (int), parsed in `poll()` like `heater_present` (line 86). Their NOTIFY is `dataChanged`.
- Modify: `U/main.cpp`: `LedModel led(LedModel::defaultConfigPath(), QStringLiteral("/var/lib/ecofleet/command.json"));` and `setContextProperty("led", &led)`, next to `display` (lines 42 and 52).
- Modify: `U/CMakeLists.txt` sources (add the 6 new files) and `U/tests/CMakeLists.txt` (`tst_ledmodel` linking `LedModel`, `LedColor` and `CommandFile`).

**Interfaces:**
- Consumes: Task 4 (`ledcolor::*`).
- Produces:
  ```cpp
  void mergeCommandKey(const QString &path, const QString &key, const QJsonValue &value); // CommandFile.h
  class LedModel : public QObject {            // LedModel.h
      Q_OBJECT
      Q_PROPERTY(double hue READ hue NOTIFY changed)                                   // 0..360
      Q_PROPERTY(double saturation READ saturation NOTIFY changed)                     // 0..1
      Q_PROPERTY(double brightness READ brightness WRITE setBrightness NOTIFY changed) // 0..1
      Q_PROPERTY(int r READ r NOTIFY changed)
      Q_PROPERTY(int g READ g NOTIFY changed)
      Q_PROPERTY(int b READ b NOTIFY changed)
      Q_PROPERTY(bool hasColor READ hasColor NOTIFY changed)   // a color was saved or touched
  public:
      LedModel(const QString &configPath, const QString &commandPath, QObject *parent = nullptr);
      static QString defaultConfigPath();                      // DisplayModel rule, file led.json
      Q_INVOKABLE void pickAt(double dx, double dy, double radius); // wheel: set H,S; throttled send
      Q_INVOKABLE void release();                              // finger lifted: send final now, save
      Q_INVOKABLE void flush();                                // page closing: save if a change is unsaved
      void setBrightness(double v);                            // throttled send
  signals:
      void changed();
  };
  ```
  - Defaults without a file are hue 0, saturation 1, brightness 1, `hasColor` false.
  - Sends `mergeCommandKey(commandPath, "led_rgb", QJsonArray{r,g,b})`.
  - Throttle: `SEND_THROTTLE_MS` 200 with a single-shot `QTimer` for the trailing send.

- [ ] **Step 1: Write the failing tests** in `U/tests/tst_ledmodel.cpp` (`QTemporaryDir` for both paths):
  - `test_defaults_without_file`: `hasColor` false, and no command file exists after construction.
  - `test_pick_sets_hue_sat_rgb`: `pickAt(10,0,10)` → hue 90, sat 1, rgb `(128,255,0)`, `hasColor` true.
  - `test_center_keeps_hue`: `pickAt(10,0,10)`, then `pickAt(0,0,10)` → hue 90, sat 0, rgb `(255,255,255)`.
  - `test_brightness_zero_keeps_hue_sat`: after a pick, `setBrightness(0)` → rgb `(0,0,0)` with hue and sat unchanged; `setBrightness(1)` → the previous rgb.
  - `test_throttle_leading_and_trailing`:
    - `pickAt` A → the command file holds A's `led_rgb` immediately.
    - `pickAt` B within 50 ms → the file still holds A.
    - `QTest::qWait(300)` → the file holds B.
  - `test_release_sends_final_and_saves`: `pickAt` A → the config file does not exist yet. `release()` → the command file holds A, and the config file has A's r/g/b and h/s/v.
  - `test_merges_with_existing_command`: pre-seed `{"mode":"auto"}`, `pickAt` → both keys are present.
  - `test_load_restores`: write a `led.json` → a new `LedModel` has its h/s/v, rgb, and `hasColor` true.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `CommandFile`, `LedModel`, the TelemetryModel fields and the `main.cpp` wiring. The existing `tst_*` tests must still pass.
- [ ] **Step 4: Run all UI C++ tests, expect PASS.**
- [ ] **Step 5: Commit** — `feat(ui): LedModel (HSV state, throttled led_rgb, led.json) and telemetry LED fields`

### Task 6: UI — color page, Settings row, packaging, previews

**Files:**
- Create: `U/qml/screens/LedColorScreen.qml`, `U/tests/qml/tst_ledcolorscreen.qml`
- Modify: `U/qml/screens/SettingsScreen.qml` (a row after the Display `InfoCard`)
- Modify: the recipe `gobi-ui_1.0.bb`: `SRC_URI` lines for `LedModel.h/.cpp`, `LedColor.h/.cpp`, `CommandFile.h/.cpp` and `qml/screens/LedColorScreen.qml` (screens install via the existing glob); `PR` r15 → r16.
- Modify: `U/qml/preview/Mocks.qml` (a `led` mock, plus `ledPresent: true`, `ledOk: true`, `ledR/G/B` on the telemetry mock), `U/qml/preview/runner/main.cpp` (`led` context property in both places), and `U/qml/preview/Shots.qml` (`Component { id: ledC; LedColorScreen {} }` and step `["12-led-color", function() { root.sub(ledC) }]`).

**Interfaces:**
- Consumes: context properties `led` (Task 5) and `telemetry` (`stale`, `ledPresent`, `ledOk`, `ledR/G/B`); atoms `ScreenHeader`, `Icon`, `InfoCard`; Theme tokens.
- Produces: `LedColorScreen` with `function statusText()`, which returns the exact strings in Global Constraints in their priority order.

- [ ] **Step 1: Write the failing QML tests** in `U/tests/qml/tst_ledcolorscreen.qml` (stub `QtObject`s named `telemetry` and `led`, as in the existing QML tests):
  - `test_status_priority`, all five cases:
    - stale → "G0B1 offline, will apply when it reconnects", even when the colors match
    - not stale and `!hasColor` → "Not set. Tap the wheel to choose a color"
    - present and `!ledOk` → "Light not responding"
    - applied == requested → "Applied"
    - otherwise "Sending…"
  - `test_row_hidden_without_light`: SettingsScreen with `telemetry.ledPresent=false` → the row with objectName `ledRow` has `visible == false`; with true → `visible`.
- [ ] **Step 2: Run the QML tests, expect FAIL.**
- [ ] **Step 3: Implement the screen.**
  - The `ScreenHeader` titled "External LED Color" pops on Back. The page calls `led.flush()` on `StackView.onRemoved`.
  - **Left:** the wheel, about 340 px square.
    - A `Canvas` painted when its size changes (the `WeatherIcon.qml` setup): 360 wedges of 1°, each filled `hsl(h,100%,50%)` and drawn from angle `(h − 90)°` so red sits at 12 o'clock and hue runs clockwise. Then a `createRadialGradient` from white at the center to transparent at the edge.
    - Over that, a black circle with `opacity: 1 - led.brightness`.
    - The marker sits at `cx + sin(h)·s·R, cy − cos(h)·s·R`: a 28 px ring, white 3 px with a 1 px dark outline.
    - A `MouseArea` handles input:
      - Press inside the circle → `led.pickAt(dx, dy, R)`.
      - Drag → `pickAt`; saturation is capped, so dragging outside the circle stays on the edge.
      - Release → `led.release()`.
  - **Right column:**
    - A preview swatch (`Qt.rgba(led.r/255, led.g/255, led.b/255)`, Theme radius).
    - "Brightness" and a `Slider` styled like the Display brightness slider in `SettingsScreen.qml:19-30`, range 0-100. `onMoved` sets `led.brightness = value/100`, and releasing it calls `led.release()`.
    - The `statusText()` line.
- [ ] **Step 4: Add the Settings row.**
  - Use the 60 px row pattern (`MaintenanceScreen.qml:54-65`) with `objectName: "ledRow"`, `visible: telemetry.ledPresent`.
  - Contents: an existing `Icon` name from `atoms/Icon.qml`, the title "External LED Color", a 24 px circle in the saved color (`led.hasColor`, else `Theme.textMute`), and `chevron-right`.
  - It pushes via `Component { id: ledC; LedColorScreen {} }` and `function open(c) { if (page.StackView.view) page.StackView.view.push(c) }`.
- [ ] **Step 5: Run the QML tests (PASS), then the preview runner** (`U/qml/preview/runner/README.md`), and look at `/tmp/shots/12-led-color.png` and the Settings shot:
  - the wheel has red at the top and runs clockwise
  - the marker is visible
  - nothing is clipped at 800 × 480
- [ ] **Step 6: Commit** — `feat(ui): External LED Color page and Settings row`

## Bench acceptance (after both plans, needs the G0B1 R0, the breakout and the lamp on 12 V)

From the spec's Verification:
1. Taps and drags give the expected red, green, blue, mixed colors and white on the lamp, and brightness 0 is off.
2. Settings and the page survive reopening and a Cortex reboot.
3. A G0B1 reset, a power cycle and an RS-485 unplug each bring back the saved color.
4. With the lamp unplugged, the page says "Light not responding" or the row hides.
5. Rapid dragging while the heater coprocessor is polled produces no new heater transport errors and no Modbus errors in `journalctl -u gobi-agent`.
