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

R2 has the PHY's I/O, its pull-ups and `NVCC_ENET` all on 1.8 V, so step 1
holds by design; it still needs `ecofleet_eth 1` until the image can tell R2
from an unreworked R1.

## Ethernet checks (R2, or a reworked R1)

- PHY found and bound to the device-tree node: `dmesg | grep -iE 'scan phy|KSZ9031'`
  shows `scan phy ethernet-phy at address N` up to the strap address (R2: 7,
  R1: 3) and `Micrel KSZ9031 Gigabit PHY`.
- Interrupt in use, not polling: `grep -i 30be0000 /proc/interrupts` lists the
  PHY's IRQ on gpio5 2, and its count grows when the cable is pulled and replugged.
- Skews: `rxc-skew-ps`/`txc-skew-ps` and friends in the device tree are the
  driver's `rgmii-id` preset. If gigabit drops frames, read
  `ethtool -S eth0 | grep -iE 'crc|align|frame'` before and after a transfer.
- Link LED colour (R2): orange at 10/100, green at 1000, dark with no link.
  `cat /sys/class/leds/eth-speed/{trigger,device_name,link_10,link_100}` shows
  `[netdev]`, `eth0`, `1`, `1`. Force 100 Mb/s on the switch port to see orange.

## NVMe (R2)

APST (autonomous power-state transitions) is on by default for any drive that
supports it: `cat /sys/module/nvme_core/parameters/default_ps_max_latency_us`
reads 100000, and `dmesg | grep -i nvme` shows the drive. With nvme-cli,
`nvme get-feature /dev/nvme0 -f 0x0c -H` reports `Autonomous Power State
Transition Enable (APSTE): Enabled`.
