# R1 board test over USB-C

Tests every carrier part except the LCD from the Mac, over R1's USB-C login
console (`docs/bench/r1-usb-console.md`). Results go in the internal R1 hardware
findings doc, not in this repo.

Tools in `docs/bench/tools/`:

| Tool | What it does |
|---|---|
| `r1sh.py PORT 'cmd' ...` | Logs in as root on the USB-C console and runs commands. `@put LOCAL REMOTE` copies a file (base64, 400-character lines; longer lines hang the console). `@MACNOW@` becomes the Mac's clock. `R1SH_TIMEOUT` = seconds per command (default 60). |
| `r1-test.sh` | The automatic test, about a minute. Prints PASS / FAIL / INFO per part and a summary. Every write is put back. `NOBUZZ=1` skips the buzzer. |
| `r1-key.sh N` | Watches both power-key inputs for N seconds with logind's power-key handling blocked. |
| `r1-buzz-sweep.sh` | Six buzzer tones, 1 to 5 kHz, then puts the pad and PWM back. |

## Automatic test

```sh
cd docs/bench/tools
P=$(ls /dev/cu.usbmodem* | head -1)      # the EF-MX8MM console
R1SH_TIMEOUT=240 python3 -I r1sh.py "$P" \
    "@put r1-test.sh /tmp/r1-test.sh" "sh /tmp/r1-test.sh @MACNOW@ 2>&1" | tee r1-test.log
```

Notes:

- A new board's RTC has never been set (oscillator stopped), so the RTC checks
  fail until it is: `date -u -s @<Mac epoch>; hwclock -w -u -f /dev/rtc0`.
- RS-485 passes only with a partner on JK1 (the APU), M.2 only with an SSD fitted.
- The CAN check drives the TCAN3414's TXD/RXD pins as GPIOs (there is no CAN
  controller) and expects RXD to follow TXD in normal mode, not in standby.

## Buttons (one at a time, with the console watched)

1. PB2 short press: `R1SH_TIMEOUT=100 python3 -I r1sh.py "$P" "@put r1-key.sh /tmp/r1-key.sh" "sh /tmp/r1-key.sh 60"`,
   then press. Expect `KEY_POWER` press + release on `snvs-powerkey`. Our image
   ignores a short press (logind `HandlePowerKey=ignore`).
2. PB2 hold 6 s: the board switches off; a short press switches it back on.
3. PB1: a power-on reset (SRC_SRSR = 0x1); the RTC keeps time on the coin cell.
4. PB3 held while switching on: with a blank carrier eMMC the Mac sees NXP's
   USB loader (`SE Blank M845S`, 1fc9:0134). Switch off and on again without PB3.

## Turning Ethernet on (reworked boards only)

Ethernet is off on R1 because the KSZ9031's I/O runs at 3.3 V while the SoC's
Ethernet pads are fed 1.8 V. A board reworked so both match opts in through the
U-Boot environment; every other board stays off.

1. Meter the powered board: SOK1-31 (`NVCC_ENET`) and U16 pin 16 (DVDDH) must
   read the same voltage. Stop here if they don't: the PHY would drive 3.3 V into
   1.8 V SoC pads.
2. The board needs the boot script with the opt-in. It lives on the boot
   partition (p1), which `.swu` updates never write, so reflash the board with an
   image from this branch (`r1-flash.uuu`, see `r1-usb-console.md`).
3. `fw_setenv ecofleet_eth 1`, then reboot. The U-Boot log shows
   `==> EcoFleet: Ethernet on (ecofleet_eth=1)`.
4. Plug JK4 into a switch and run `r1-test.sh`: its Ethernet section shows the
   link and speed.

To switch it off again: `fw_setenv ecofleet_eth` and reboot.
