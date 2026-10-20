# R1: console and flashing over the USB-C port

R1's UART1, the only console the boot ROM's SPL and U-Boot have, is wired to the
Ezurio module, so a console there needs wires tacked onto the board. The USB-C
port used for programming now carries a console too:

| Stage | UART1 (wires) | USB-C |
|---|---|---|
| SPL, U-Boot banner | yes | no (USB is not up yet) |
| U-Boot from `board_late_init`: autoboot prompt, shell, boot script | yes | yes (CDC ACM, R1 only) |
| Kernel log | yes | no (`dmesg` / `journalctl -b` over the USB login) |
| Linux login | yes | yes (`ecofleet-usb-console`, R1 only) |

On the PC the port is a plain USB serial port, no driver: `/dev/cu.usbmodem*` on a
Mac, a COM port on Windows, `/dev/ttyACM0` on Linux. Baud rate does not matter.
U-Boot's port and Linux's port are different USB devices: U-Boot's disappears
when the kernel starts, Linux's appears once systemd is up (~10 s later).

On the Mac, the Anker hub's billboard also shows up as
`/dev/cu.usbmodemSN234567892`. Ignore it.

## Stop U-Boot over USB-C

With a PC on the port, autoboot waits 3 s (1 s with nothing plugged in). The stop
string is `ecofleet`.

The helper waits for the new port and sends the stop string itself:

```bash
python3 docs/bench/tools/uboot-console.py --port '/dev/cu.usbmodem*' -- 'version'
# then power-cycle R1 (add --boot to boot on after the commands)
```

By hand: `ls /dev/cu.usbmodem*` with R1 off, power on, open the port that was not
listed before (`screen /dev/cu.usbmodemXXXX 115200`) and type `ecofleet`.

At the U-Boot prompt, `fastboot` and `ums` need the port: first
`setenv stdin serial; setenv stdout serial; setenv stderr serial` (this ends the
USB console; carry on over UART1).

## Linux login over USB-C

Once Linux is up, open the new `/dev/cu.usbmodem*` port and log in as `root`.
No network yet (fresh `/data`)? Join WiFi from there:

```sh
wpa_cli -i wlan0 add_network            # prints the id, e.g. 0
wpa_cli -i wlan0 set_network 0 ssid '"<ssid>"'
wpa_cli -i wlan0 set_network 0 psk '"<password>"'
wpa_cli -i wlan0 enable_network 0
wpa_cli -i wlan0 save_config            # kept on /data/wifi
ip -4 addr show wlan0
```

## Flash R1's SoM over USB-C (uuu)

Needs uuu 1.5.243. Mac: `~/Downloads/uuu-1.5.243/uuu_mac_arm`, which needs
`brew install libusb openssl@3 zstd tinyxml2`. Use the decompressed image
(`zstd -d ecofleet-image-imx8mm-var-dart.rootfs.wic.zst`).

1. Put R1 in USB serial download, USB-C to the PC. R1 has no download switch:
   hold the boot button while powering on. That selects the carrier eMMC, and with
   nothing bootable there the boot ROM falls back to USB serial download. (Not yet
   tried on R1; if the carrier eMMC holds an image, this boots it instead.)
2. `uuu -b docs/bench/tools/r1-flash.uuu ecofleet-image-imx8mm-var-dart.rootfs.wic`.
   It writes the whole image, U-Boot included, to the SoM eMMC (mmc 2) and keeps
   the eMMC boot partitions disabled, as on .86.
3. Power off for at least 15 s, power on without the button. On UART1 or USB-C:
   `==> EcoFleet: board r1`, then Linux on slot a with the R1 device tree.

Anything wrong, U-Boot included: flash again. The boot ROM's USB download does not
depend on what is on the eMMC.

## Dev-kit check of the U-Boot USB console

U-Boot's USB console only turns itself on for R1. On the dev kit, booted from an
SD card with the new image (boot switch on SD, console cable on the FTDI port, a
USB-C cable from the Mac to the dev kit's USB-C port):

1. Stop U-Boot on the FTDI console, then
   `setenv ecofleet_usbcon 1; saveenv; reset`. This writes the SD card's env only.
2. No PC on USB-C (unplug it): the board must boot normally, 1 s autoboot.
3. PC on USB-C: `uboot-console.py --port '/dev/cu.usbmodem*' --boot -- version`,
   power-cycle. Expect the 3 s prompt, `version` output over USB and a normal
   boot; the USB port vanishes at `Starting kernel`.
4. Pull the USB-C cable while U-Boot prints (`help`): the FTDI console must stay
   alive.
5. Clean up: `setenv ecofleet_usbcon; saveenv`.
