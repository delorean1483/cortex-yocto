# External RGB light: user color control (design)

Date: 2026-11-04. Status: draft for approval.
Repos: `g0b1-firmware` (driver, service, Modbus registers) and `cortex-yocto`
(gobi-agent, gobi-ui). Sources: Robb's G0B1 R0 + L011 breakout handoff
(sections 9-13, hardware and register settings), the user's two UI prompts
(the second, full HSV, replaces the first), and the decisions below.

## Intent

The truck has an external 12 V RGB lamp wired to the L011 breakout. The user
picks its color on the Cortex touchscreen, the way they would set a home light.
It is lighting, not a status signal: nothing assigns colors from APU state.

## Goals

- A color page reached from Settings: HSV wheel (hue and saturation) plus a
  brightness slider, with live response while dragging.
- The G0B1 drives the IS31FL3293 directly over its I2C2 bus. The L011 heater
  coprocessor plays no part.
- The chosen color is saved on the Cortex and comes back by itself after any
  restart (decided, see "Restore behavior").
- The page always shows whether the light really has the chosen color.

## Non-goals (this round)

- Status colors, blinking, fades or the chip's pattern engine.
- BLE. No Cortex-to-G0B1 BLE link exists in either repo today; RS-485 Modbus is
  the only link. The G0B1 side is built so a future BLE handler calls the same
  function (see G0B1, item 2).
- Cloud or shadow control of the light, and gamma or white-balance correction
  (Robb: linear first; correction can be layered above the driver later).
- The L011 heater bring-up. That is a separate bench job on the existing
  firmware (`g0b1-firmware/docs/heater-coprocessor.md`, M1-M8).

## Anti-goals (a failure even if it "works")

- Dragging floods RS-485 or delays heater, mode, fan or other APU commands.
- An RGB write stalls or corrupts the heater coprocessor's I2C traffic.
- The lamp shows a color the user did not choose (for example garbage after a
  G0B1 reset).
- A persistent-storage write for every drag step.

## Decisions (made with the user)

1. Full HSV now. Wheel angle = hue, red at the top, increasing clockwise
   (yellow 60°, green 120°, cyan 180°, blue 240°, magenta 300°). Wheel radius =
   saturation, 0% (white) at the center to 100% at the edge. A separate
   brightness slider, 0% = off, 100% = full.
2. Hue is kept when saturation is 0, and hue and saturation are kept when
   brightness is 0, so raising either brings the previous color back.
3. The saved color is restored automatically after truck power-up, a Cortex
   reboot, a G0B1 reset and an RS-485 link loss.
4. Transport is RS-485 Modbus only for now.
5. The Settings row is hidden until the G0B1 reports the LED driver present
   (register 79 bit 0), like the HeaterCard. Today that means every truck:
   G0B1 v1.1.6 has no registers past 75, and no truck has the lamp yet. While
   the driver is absent the agent sends no color writes; when it appears, the
   saved color is applied. If the driver is present but the last apply
   failed, the page shows "Light not responding".
6. Testing is on the G0B1 R0 with the breakout on header ST1 (PC3 = VCC_EN
   powers the 3P3_VCC rail). The R1 build must keep compiling. On R1, PC3 is
   LEDS_OFF, which only switches the LEDs on the G0B1 board itself and has
   nothing to do with the external lamp, so the RGB code never touches it.
   G0B1 R2 will carry the breakout's heater and LED circuitry on board. Keep
   everything board-specific (which I2C peripheral, rail enable, settle time)
   behind the driver's I2C backend and board init, so R2 needs only a new
   backend or board config, not changes to the driver, service or registers.

## Hardware facts (Robb's handoff; datasheet-checked by Robb, not yet bench-tested)

- IS31FL3293 at 7-bit address 0x6C on the G0B1's I2C2 (PB14 SDA, PA11 SCL,
  100 kHz), the same bus as the L011 coprocessor at 0x64. The breakout has
  2.2 kΩ pull-ups. Power comes from the 3P3_VCC rail, switched by PC3 (VCC_EN)
  on R0, which `app_main.c` already enables before I2C users start.
- Channel map: OUT1 = green, OUT2 = red, OUT3 = blue. The driver sinks current
  into a two-MOSFET stage, so sinking means lamp on and a higher PWM means
  brighter. Do not invert unless the bench contradicts the schematic.
- Use fixed full current settings and vary brightness by PWM only (the driver
  sinks gate pull-up current, not lamp current).
- Init: `0x3F`=0xC5 (reset); `0x02`=0x00 (PWM + current-level mode);
  `0x03`=0x3F; `0x10..0x12`=0xFF; `0x27`=0xC5 (latch currents); PWM
  `0x19..0x1E` all 0 then `0x28`=0xC5 (latch PWM); `0x01`=0x75 (normal
  operation, all channels, 400 Hz PWM). Shutdown: `0x01`=0x70.
- PWM: 12-bit per channel, low byte then high nibble (`0x19/1A` OUT1,
  `0x1B/1C` OUT2, `0x1D/1E` OUT3). Write all six bytes, then one `0x28` latch.
- No G0B1-controlled hardware shutdown line (EXT_RGB_OFF is not on HDR2). If
  the G0B1 hangs or I2C fails, the lamp keeps its last color. Normal off is
  PWM 0.

## Design

### G0B1 (`g0b1-firmware`)

1. **IS31FL3293 register driver.** Portable, behind an I2C backend seam like
   the heater client's `drv_heater_i2c2` so it is host-testable with a fake
   bus. Operations: probe, init (sequence above, ending with PWM 0 and normal
   operation), set three 12-bit PWM values with one latch, and shutdown. Every
   transfer has a bounded timeout (no indefinite waits).
2. **RGB service.** One transport-independent entry point,
   `rgb_set_logical(r, g, b)` with 0-255 each: Modbus calls it now, and a BLE
   handler calls it later. It clamps, converts to 12-bit with
   `(v * 4095 + 127) / 255`, maps logical to physical channels and marks the
   color dirty. The superloop's `rgb_process()` applies a dirty color in one
   PWM write plus latch. So a three-register Modbus write lands on the lamp as
   one change, never channel by channel. Init runs after the 3P3_VCC rail is
   up. If the chip is absent or a write fails, the service reports it, retries
   init with a backoff, and never blocks the superloop. After a successful
   re-init it re-applies the last requested color (my call), so a chip glitch
   doesn't leave the lamp dark until the agent's next reconcile. After G0B1
   boot the applied color is 0,0,0 (off) until commanded.
3. **Modbus registers** (`mbp_rgb.c`, the existing `mb_reg_bind` pattern;
   firmware register numbers as in `modbus_defs.h`):

   | Reg | Name | Access | Meaning |
   |---|---|---|---|
   | 76 | led_red | RW | write: requested red 0-255; read: red currently applied |
   | 77 | led_green | RW | same for green |
   | 78 | led_blue | RW | same for blue |
   | 79 | led_status | RO | bit 0: driver found and initialized; bit 1: last apply succeeded; other bits are the planner's call |

   Values above 255 return an illegal-value exception. The engine applies a
   function-code-16 write register by register, so a bad third value would
   leave the first two stored. The agent always sends values it has already
   checked, so this only matters for a faulty master (my call: accepted, not
   worked around). `MB_REG_MAX` goes
   75 → 79 and `MB_REG_LIMIT` 76 → 80; check tests keyed off `MB_REG_MAX`.
   The agent writes 76-78 together with function code 16, which the G0B1
   already supports and applies register by register. Item 2 makes that
   atomic at the lamp.
4. **Sharing I2C2 with the heater client.** Both run in the same superloop, so
   their transactions never overlap. An RGB update is about 8 bytes plus the
   latch (roughly 1 ms at 100 kHz) and happens when the color changes, plus a
   quiet refresh every 10 s (configuration and PWM rewritten without the reset,
   so no flicker; about 2 ms of bus time). The refresh exists because a chip
   that loses power and comes back while idle would otherwise stay dark while
   every status said "applied" (added after the Plan 1 final review). A failed
   refresh takes the apply-failure path, so the page shows "Light not
   responding".

### Cortex agent (`gobi-agent`)

5. **Command.** A new `command.json` key, `"led_rgb": [r, g, b]` with logical
   0-255 values, applied as one function-code-16 write to registers 76-78.
   Right after the write the agent reads 76-79 back and rewrites
   `latest.json`, so "Applied" appears within a second instead of after the
   next 5-60 s poll (my call).
6. **Faster pickup.** The agent checks `command.json` once a second today.
   Check it every 200 ms instead, so live drags reach the lamp about five
   times a second. This affects every touchscreen command and only makes them
   faster. Every Modbus write stays on the agent's one Modbus thread, queued
   with all other traffic. Today the agent reads `command.json` and then
   unlinks it, so a write the UI makes in between is lost. That gets likelier
   at five writes a second and could drop the release value or a merged mode
   command. The agent renames the file aside atomically first and reads the
   renamed copy (my call).
7. **Restore (reconcile).** The agent keeps a desired color. At start it reads
   the saved color from the UI's settings file (item 10), using the same path
   rule as the UI. gobi-ui runs as root and gobi-agent as `ecofleet`, so the
   file must be readable by `ecofleet`. After that it uses
   the most recent `led_rgb` command. Each poll cycle it reads registers 76-79.
   When the G0B1 answers, the LED driver is present, and the applied color is
   not the desired one, it writes the desired color, at most once per poll
   cycle. While the registers are missing (older G0B1 firmware) or bit 0 is
   clear, it sends no color writes and logs that only once, not every cycle. That covers a G0B1 reset (applied drops to 0), a dropped link and a
   Cortex reboot. With no saved color (first use) it sends nothing, and the
   lamp stays off.
8. **Telemetry keys.** `latest.json` gains the applied color and the status
   bits (for example `led_r`, `led_g`, `led_b`, `led_present`, `led_ok`).
   Whether they also go to the cloud is the planner's call; the cloud
   ingest does not need them this round.

### Cortex UI (`gobi-ui`)

9. **Settings entry.** An "External LED Color" row in `SettingsScreen.qml`,
   with a small swatch of the saved color, pushes the new color page. It is
   visible only while `latest.json` reports the LED driver present
   (decision 5).
10. **Saved settings.** A model in the style of `DisplayModel`, with
    hue/saturation/brightness plus the derived RGB, saved as
    `/data/ecofleet/led.json` (the same `/data` fallback rule as
    `display.json`). It is written when the finger lifts (and on page exit if
    a save is pending), never per drag step.
11. **Color math**, kept apart from the UI and unit-tested: touch point to hue
    (red at the top, clockwise) and saturation (radius / wheel radius, capped at
    1); the center keeps the previous hue; HSV to 8-bit RGB.
12. **Color page**, 800 × 480, using the existing `ScreenHeader` and Back:
    - The wheel is drawn smooth: a conical hue gradient with a white-to-clear
      radial overlay for saturation, and a black overlay whose opacity follows
      brightness. Canvas (already used for the weather icons) or a
      ShaderEffect (`qtshadertools` is in the image) are both fine. Qt5Compat
      `ConicalGradient` is not in the image.
    - A selection marker that stays visible on light and dark (for example a
      white ring with a dark outline), a preview swatch, and a brightness
      slider styled like the Display brightness slider.
    - Tap or drag on the wheel changes hue and saturation, and the slider
      changes brightness only. While dragging, commands are throttled to at
      most one every 200 ms, the first immediately and the latest one
      always sent. On release the final value is sent and saved.
    - Reopening the page restores the marker, slider and preview from the
      saved values.
    - A status line distinguishes "Applied", "Sending…", "Light not
      responding" (driver present, last apply failed), "Light offline, will
      apply when it reconnects" (driver gone), "Not set. Tap the wheel to
      choose a color", and "G0B1 offline, will apply when it reconnects". The
      UI compares its requested RGB with the applied RGB in `latest.json`,
      reads the status bits, and uses `telemetry.stale` for G0B1 offline. If
      the driver disappears while the page is open, the page stays usable and
      shows "Light offline" rather than closing.

## Restore behavior (decided)

| Event | Lamp |
|---|---|
| First use, nothing saved | Off; nothing is sent |
| Truck power-up | Off while the G0B1 boots, then the saved color once the agent is polling |
| Cortex reboot | Keeps its color (the G0B1 stays powered); the agent confirms it on its first poll |
| G0B1 reset with the Cortex up | Off at G0B1 init, back to the saved color within a poll cycle |
| RS-485 link down | Keeps its last color; the page shows offline; reconciled when the link returns |
| G0B1 hangs | Keeps its last color (no hardware shutdown line, see above) |
| Lamp driver loses power and comes back, G0B1 running | Back to the applied color at the next 10 s refresh |

## Verification

- **G0B1 host tests** (existing Unity/CMake suite): init byte sequence,
  PWM packing and channel mapping, one latch per update, clamping, dirty/apply
  (a three-register write produces one I2C update), register exceptions,
  missing-chip behavior without blocking.
- **Agent host tests** (`tests/run.sh`): `led_rgb` parsing and validation, and
  the reconcile decision (when to write, when not to).
- **UI**: unit tests for the color math (0°/60°/120°/180°/240°/300°, center,
  edge, V = 0, S = 0) and the throttle; offscreen QML preview shots of the
  page in a few states.
- **Bench** (Robb; needs the G0B1 R0, the breakout and the lamp on 12 V):
  - his diagnostic sequence (off, red, green, blue, yellow, cyan, magenta,
    white, per-channel ramps, off), which proves mapping and polarity and that
    0 is off
  - monotonic brightness and low-level behavior; gate waveforms and MOSFET
    temperature
  - G0B1 reset, power cycle and RS-485 unplug all restore the saved color
  - rapid dragging while the heater coprocessor is polled, with no new heater
    transport errors and no Modbus errors
  - persistence across reopening the page and rebooting the Cortex

  The diagnostic sequence runs from a small bench script that writes
  registers 76-78 over RS-485 (like the earlier `mb_write.py`); no extra
  firmware command is needed. Stop gobi-agent while it runs, or the agent's
  reconcile puts the saved color back over the test colors.

## Left to the planner

File and function names, test placement, exact status bits beyond bits 0-1,
backoff constants, Canvas or shader for the wheel, slider and marker visuals
within the existing Theme, `latest.json` key names, whether the keys go to
MQTT, and the G0B1 firmware version bump and Cortex release steps.
