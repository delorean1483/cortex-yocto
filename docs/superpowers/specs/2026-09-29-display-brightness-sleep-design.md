# Display brightness + sleep (gobi-ui Settings)

**Date:** 2026-09-29 · **Status:** approved design

## Goal
Operators can set panel brightness and a screen-sleep timeout from Settings. The
screen dims, then goes dark after inactivity, and a tap wakes it without pressing
anything underneath.

## Hardware (probed read-only on .86, v1.2.64)
- `/sys/class/backlight/backlight` — pwm-backlight, `type=raw`, `max_brightness=100`,
  linear DT levels 0..100, DT default 80. `bl_power` present (0 = on, 4 = powerdown).
- Panel: `card1-LVDS-1`. Touch: `generic ft5x06` (+ ADS7846 node).
- Weston `idle-time=0` → the compositor never blanks, so gobi-ui owns sleep.
- gobi-ui runs as root → writes sysfs directly, no helper/udev rule.

## Behaviour
- **Brightness** 10–100 % (floor 10 so the panel can't be set black and look dead).
- **Sleep after** Never / 1 / 5 / 10 / 30 min. Default **10 min**.
- **Dim first:** 30 s before sleep the backlight drops to 20 % (or the user level
  if that is lower). Then `bl_power=4`. States: `on` → `dim` → `off`.
- **Any touch** while `on` restarts the idle timer. A touch while `dim`/`off`
  only wakes: the press and its release/moves are swallowed (app event filter).
- **Keep awake:** never dims/sleeps while an APU fault is active
  (`telemetry.hasError`) or Component Test is running (`telemetry.diagActive`).
  A new fault wakes the screen.
- **Persistence:** `/data/ecofleet/display.json` (shared A/B partition → survives
  updates); falls back to `/var/lib/gobi-ui/display.json` if `/data` isn't
  writable. Saved brightness applied at startup.

## Implementation
- New `DisplayModel` (C++, context property `display`): `brightness`,
  `sleepMinutes` (0 = never), read-only `state`, `keepAwake`; installs an event
  filter on the QGuiApplication. Backlight dir / config path overridable via
  `GOBI_BACKLIGHT_DIR` / `GOBI_DISPLAY_CONFIG` for tests.
- `main.qml`: `Binding { target: display; property: "keepAwake"; value: telemetry.hasError || telemetry.diagActive }`.
- `SettingsScreen.qml`: "Display" card — brightness slider (applies live, saves on
  release) + `SegmentedControl` for sleep.
- Mocks + preview runner get a `display` mock.
- QtTest `tests/tst_displaymodel` (host, temp-dir fake sysfs) covers load/save,
  clamping, dim→off timing, keep-awake, wake-swallows-touch.
