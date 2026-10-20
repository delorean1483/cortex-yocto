#!/bin/sh
# R1 (EF-MX8MM) board test: every carrier part on the BOM except the LCD.
# Run on R1 as root: sh r1-test.sh [MAC_EPOCH]   (MAC_EPOCH = the Mac's date +%s)
# From the Mac over the USB-C console (docs/bench/r1-board-test.md):
#   R1SH_TIMEOUT=240 python3 -I r1sh.py /dev/cu.usbmodem1301 \
#       "@put r1-test.sh /tmp/r1-test.sh" "sh /tmp/r1-test.sh @MACNOW@ 2>&1"
# NOBUZZ=1 skips the buzzer tones.
#
# Nothing changes for good. The EEPROM and carrier-eMMC write tests put the
# original bytes back (the eMMC one only runs on a blank area), and the CAN
# pins, buzzer pad and PWM1 registers are put back as they were.
# Linux I2C buses on R1: 0 = I2C1 (PMIC 0x4b, SN65DSI84 0x2c), 1 = I2C2 (touch
# 0x41), 2 = I2C3 (MCP7940N 0x6f, BR24G04 0x50/0x51).

MAC_NOW=$1
UP0=$(cut -d. -f1 /proc/uptime)
RES=/tmp/r1-test.result; : > $RES

h()    { printf '\n== %s\n' "$1"; }
pass() { echo "PASS  $*"; echo "PASS  $*" >> $RES; }
fail() { echo "FAIL  $*"; echo "FAIL  $*" >> $RES; }
info() { echo "INFO  $*"; echo "INFO  $*" >> $RES; }
# devmem2 prints "Read at address 0x...: 0x..."; empty output = the read failed
rd()   { devmem2 $1 w 2>/dev/null | awk '/^Read at/ {print $NF}'; }
wr()   { devmem2 $1 w $(printf 0x%x $2) >/dev/null 2>&1; }
setb() { _v=$(rd $1); [ -n "$_v" ] && wr $1 $(( _v | $2 )); }
clrb() { _v=$(rd $1); [ -n "$_v" ] && wr $1 $(( _v & ~$2 )); }
putb() { _v=$(rd $1); [ -n "$_v" ] && wr $1 $(( (_v & ~$2) | ($3 & $2) )); }  # put MASK bits back to ORIG
bit()  { echo $(( ($(rd $1) >> $2) & 1 )); }
same() { [ "$(md5sum < $1)" = "$(md5sum < $2)" ]; }
line() { grep -m1 -E "\($1 *\|" /sys/kernel/debug/gpio || echo "$1: not in debugfs"; }
gchip() { gpiodetect 2>/dev/null | awk -v a="$1" 'index($0, a) {print $1; exit}'; }
fresh() { sync; echo 3 > /proc/sys/vm/drop_caches; }
DIN=iflag=direct; DOUT=oflag=direct
dd if=/dev/zero of=/dev/null bs=512 count=1 iflag=direct 2>/dev/null || { DIN=; DOUT=; }

h "Board and SoM"
tr -d '\0' < /proc/device-tree/model; echo
echo "firmware $(cat /etc/ecofleet/firmware-version 2>/dev/null), kernel $(uname -r), up ${UP0} s"
echo "SoC $(cat /sys/devices/soc0/soc_id 2>/dev/null) rev $(cat /sys/devices/soc0/revision 2>/dev/null) serial $(cat /sys/devices/soc0/serial_number 2>/dev/null)"
n=$(grep -c ^processor /proc/cpuinfo); m=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$n" = 4 ] && [ "$m" -gt 3500 ]; then pass "SoM: 4 cores, $m MiB RAM"; else fail "SoM: $n cores, $m MiB RAM (BOM: quad core, 4 GB)"; fi
for z in /sys/class/thermal/thermal_zone*/; do echo "$(cat ${z}type): $(( $(cat ${z}temp) / 1000 )) C"; done
info "reset cause register SRC_SRSR = $(rd 0x3039005c)"

h "Power rails"
for r in /sys/class/regulator/regulator.*; do
    [ -e $r/name ] || continue
    uv=$(cat $r/microvolts 2>/dev/null)
    printf '%-24s %-9s %s\n' "$(cat $r/name)" "$(cat $r/state 2>/dev/null)" "${uv:+$(( uv / 1000 )) mV}"
done

h "I2C"
for b in 0 1 2; do echo "-- i2c-$b"; i2cdetect -y $b | tail -n +2; done
chk() {
    if [ -e /sys/bus/i2c/devices/$1/driver ]; then pass "$2 at $1, driver $(basename $(readlink /sys/bus/i2c/devices/$1/driver))"
    else fail "$2 at $1: no driver bound"; fi
}
chk 0-004b "PMIC BD71847"; chk 0-002c "LVDS bridge SN65DSI84"; chk 2-006f "RTC MCP7940N"; chk 2-0050 "EEPROM BR24G04"

h "RTC MCP7940N, crystal Y1, coin cell B1"
r6f() { i2cget -f -y 2 0x6f $1 2>/dev/null; }
stamp() { printf '%02x-%02x %02x:%02x' $(( $(r6f $4) & 0x1f )) $(( $(r6f $3) & 0x3f )) $(( $(r6f $2) & 0x3f )) $(( $(r6f $1) & 0x7f )); }
wk=$(r6f 0x03)
if [ -z "$wk" ]; then fail "RTC: register read failed"; else
    echo "RTCWKDAY $wk: OSCRUN=$(( (wk >> 5) & 1 )) PWRFAIL=$(( (wk >> 4) & 1 )) VBATEN=$(( (wk >> 3) & 1 ))"
    if [ $(( (wk >> 5) & 1 )) = 1 ]; then pass "RTC oscillator running"; else fail "RTC oscillator stopped (Y1 or ST bit)"; fi
    if [ $(( (wk >> 3) & 1 )) = 1 ]; then pass "RTC coin-cell backup enabled (VBATEN)"; else fail "RTC VBATEN off: the coin cell would not keep time"; fi
    if [ $(( (wk >> 4) & 1 )) = 1 ]; then
        info "RTC ran on the coin cell through a power loss: main power lost $(stamp 0x18 0x19 0x1a 0x1b), back $(stamp 0x1c 0x1d 0x1e 0x1f) (MM-DD hh:mm RTC time; the first loss since the flag was last cleared)"
    fi
fi
r1=$(cat /sys/class/rtc/rtc0/since_epoch 2>/dev/null); sleep 2; r2=$(cat /sys/class/rtc/rtc0/since_epoch 2>/dev/null)
if [ -n "$r1" ] && [ $(( r2 - r1 )) -ge 1 ] && [ $(( r2 - r1 )) -le 3 ]; then pass "RTC counts ($(( r2 - r1 )) s in 2 s)"; else fail "RTC not counting (rtc0 $r1 -> $r2)"; fi
echo "RTC now: $(date -u -d @$r2 2>/dev/null || echo $r2) UTC"
dmesg | grep "setting system clock" | tail -1
hc=$(dmesg | sed -n 's/.*setting system clock to .*(\([0-9]*\)).*/\1/p' | tail -1)
if [ -n "$MAC_NOW" ] && [ -n "$hc" ]; then
    err=$(( hc - (MAC_NOW - UP0) ))
    if [ ${err#-} -le 30 ]; then pass "RTC had the right time at boot (off by ${err} s)"
    else info "RTC was off by ${err} s at boot: never set, or the coin cell did not hold it (set it, power off, re-check)"; fi
fi

h "EEPROM BR24G04 (I2C3 0x50/0x51)"
E=/sys/bus/i2c/devices/2-0050/eeprom
if [ ! -e $E ]; then fail "EEPROM: no at24 eeprom file"; else
    sz=$(stat -c %s $E); echo "size $sz bytes"; hexdump -C $E | head -4
    dd if=$E of=/tmp/ee.orig bs=16 skip=31 count=1 2>/dev/null
    printf 'EcoFleet-R1-test' > /tmp/ee.pat
    dd if=/tmp/ee.pat of=$E bs=16 seek=31 count=1 conv=notrunc 2>/dev/null
    dd if=$E of=/tmp/ee.back bs=16 skip=31 count=1 2>/dev/null
    if same /tmp/ee.pat /tmp/ee.back; then ok_w=1; else ok_w=0; fi
    dd if=/tmp/ee.orig of=$E bs=16 seek=31 count=1 conv=notrunc 2>/dev/null
    dd if=$E of=/tmp/ee.back bs=16 skip=31 count=1 2>/dev/null
    if [ $ok_w = 1 ]; then pass "EEPROM write + read-back ($sz bytes, tested the last 16)"; else fail "EEPROM write did not stick (WP pin held high?)"; fi
    same /tmp/ee.orig /tmp/ee.back || fail "EEPROM: original bytes NOT put back"
fi

h "Carrier eMMC FEMC004G (usdhc2)"
cb=; sb=
for b in /sys/block/mmcblk[0-9]; do
    readlink -f $b | grep -q 30b50000.mmc && cb=$(basename $b)
    readlink -f $b | grep -q 30b60000.mmc && sb=$(basename $b)
done
if [ -z "$cb" ]; then fail "carrier eMMC: nothing on usdhc2"; dmesg | grep -i "mmc1" | tail -4; else
    d=/sys/block/$cb/device; sz=$(( $(cat /sys/block/$cb/size) / 2048 ))
    echo "$cb: $(cat $d/name) manfid $(cat $d/manfid) date $(cat $d/date) life $(cat $d/life_time 2>/dev/null) pre-EOL $(cat $d/pre_eol_info 2>/dev/null), $sz MiB"
    echo "partitions: $(ls /sys/block/$cb | grep -E "^${cb}p[0-9]" | tr '\n' ' ')"
    if [ $sz -gt 3000 ]; then pass "carrier eMMC $cb $(cat $d/name), $sz MiB"; else fail "carrier eMMC $cb is $sz MiB (BOM: 4 GB)"; fi
    echo "read 64 MiB: $(dd if=/dev/$cb of=/dev/null bs=1M count=64 $DIN 2>&1 | tail -1)"
    if grep -q "^/dev/$cb" /proc/mounts; then info "carrier eMMC write test skipped: $cb is mounted"; else
        off=$(( sz - 2 ))
        dd if=/dev/$cb of=/tmp/mmc.orig bs=1M skip=$off count=1 $DIN 2>/dev/null
        if [ $(tr -d '\000' < /tmp/mmc.orig | wc -c) -ne 0 ] && [ $(tr -d '\377' < /tmp/mmc.orig | wc -c) -ne 0 ]; then
            info "carrier eMMC write test skipped: the test area (MiB $off) holds data"
        else
            dd if=/dev/urandom of=/tmp/mmc.pat bs=1M count=1 2>/dev/null
            dd if=/tmp/mmc.pat of=/dev/$cb bs=1M seek=$off count=1 conv=fsync $DOUT 2>/dev/null
            fresh; dd if=/dev/$cb of=/tmp/mmc.back bs=1M skip=$off count=1 $DIN 2>/dev/null
            if same /tmp/mmc.pat /tmp/mmc.back; then pass "carrier eMMC write + read-back (1 MiB)"; else fail "carrier eMMC read-back differs"; fi
            dd if=/tmp/mmc.orig of=/dev/$cb bs=1M seek=$off count=1 conv=fsync $DOUT 2>/dev/null
            fresh; dd if=/dev/$cb of=/tmp/mmc.back bs=1M skip=$off count=1 $DIN 2>/dev/null
            same /tmp/mmc.orig /tmp/mmc.back || fail "carrier eMMC: original bytes NOT put back"
        fi
    fi
fi
if [ -n "$sb" ]; then
    d=/sys/block/$sb/device
    echo "SoM eMMC $sb: $(cat $d/name) $(( $(cat /sys/block/$sb/size) / 2048 )) MiB life $(cat $d/life_time 2>/dev/null) pre-EOL $(cat $d/pre_eol_info 2>/dev/null)"
fi

h "M.2 NVMe (PCIe, clock buffer U24)"
dmesg | grep -iE "imx6q-pcie|pcie.*link|nvme" | tail -6
for p in /sys/bus/pci/devices/*; do [ -e "$p" ] && echo "$(basename $p) $(cat $p/vendor):$(cat $p/device) class $(cat $p/class) $(cat $p/current_link_speed 2>/dev/null) x$(cat $p/current_link_width 2>/dev/null)"; done
if [ -e /sys/class/nvme/nvme0 ]; then
    pass "NVMe: $(cat /sys/class/nvme/nvme0/model | tr -s ' ') fw $(cat /sys/class/nvme/nvme0/firmware_rev)"
    nb=$(ls /sys/class/nvme/nvme0 | grep -m1 -E '^nvme0n[0-9]+$')
    [ -n "$nb" ] && echo "read 256 MiB: $(dd if=/dev/$nb of=/dev/null bs=1M count=256 $DIN 2>&1 | tail -1)"
    for t in /sys/class/nvme/nvme0/hwmon*/temp1_input; do [ -e $t ] && echo "SSD temperature $(( $(cat $t) / 1000 )) C"; done
else
    info "NVMe: none found (is an M.2 SSD fitted?)"
fi
line NVMe_ACT; line PCIE1_dRST

h "USB: hub USB2422, 2x USB-A, USB-C device port"
hub=
for u in /sys/bus/usb/devices/*; do
    [ -e $u/idVendor ] || continue
    echo "$(basename $u) $(cat $u/idVendor):$(cat $u/idProduct) class $(cat $u/bDeviceClass) $(cat $u/product 2>/dev/null)"
    [ "$(cat $u/bDeviceClass)" = 09 ] && [ "$(cat $u/idVendor)" != 1d6b ] && hub="$(basename $u) $(cat $u/idVendor):$(cat $u/idProduct)"
done
if [ -n "$hub" ]; then pass "USB hub enumerated: $hub"; else fail "USB hub U14 not enumerated"; fi
line USB_HUB_dRST
for u in /sys/class/udc/*; do [ -e $u ] && info "USB-C device port $(basename $u): $(cat $u/state)"; done

h "WiFi (SoM)"
if [ -e /sys/class/net/wlan0 ]; then
    ip -4 addr show wlan0 | grep -E "inet " || echo "wlan0: no IPv4 address"
    command -v iw >/dev/null && iw dev wlan0 link 2>/dev/null | head -3
    ns=0
    command -v iw >/dev/null && ns=$(iw dev wlan0 scan 2>/dev/null | grep -c 'SSID:')
    if [ "$ns" = 0 ] && command -v wpa_cli >/dev/null; then
        wpa_cli -i wlan0 scan >/dev/null 2>&1; sleep 5
        ns=$(( $(wpa_cli -i wlan0 scan_results 2>/dev/null | wc -l) - 1 ))
    fi
    if [ "$ns" -gt 0 ]; then pass "WiFi radio: $ns networks seen in a scan"; else fail "WiFi: a scan found nothing"; fi
else
    fail "WiFi: no wlan0"
fi

h "RS-485: ISO1450 + isolated supply U17, UART2 = ttymxc1, DE = GPIO3_IO21"
ls -l /dev/ecofleet-rs485 2>&1
line RS485_DE
c=$(grep -E "^1:" /proc/tty/driver/IMX-uart 2>/dev/null); echo "$c"
tx=$(echo "$c" | sed -n 's/.*tx:\([0-9]*\).*/\1/p'); rx=$(echo "$c" | sed -n 's/.*rx:\([0-9]*\).*/\1/p')
echo "gobi-agent: $(systemctl is-active gobi-agent)"
L=/var/lib/ecofleet/latest.json; [ -f $L ] && echo "latest.json updated $(( $(date +%s) - $(stat -c %Y $L) )) s ago"
if [ "${rx:-0}" -gt 0 ]; then pass "RS-485: $rx bytes received (a partner answered)"
elif [ "${tx:-0}" -gt 0 ]; then info "RS-485: sent $tx bytes, received none (nothing on the RJ45, or A/B swapped)"
else info "RS-485: no traffic yet"; fi

h "CAN: TCAN3414 loopback through its TXD/RXD pins (the i.MX8MM has no CAN controller)"
# UART3 pads as GPIOs: TXD = GPIO5_IO27, RXD = GPIO5_IO26. FD_CAN_EN = GPIO4_IO22
# (high = normal mode via Q6 on STB). With TXD pulsed low, a live transceiver
# drives the bus dominant and its receiver pulls RXD low; the GPIO edge latch
# (ISR + EDGE_SEL) catches that even if the dominant timeout ends it early.
MRX=0x30330244; MTX=0x30330248
G4DR=0x30230000; G4DIR=0x30230004
G5DR=0x30240000; G5DIR=0x30240004; G5PSR=0x30240008; G5ISR=0x30240018; G5ES=0x3024001c
EN=0x400000; TX=0x8000000; RX=0x4000000
mrx=$(rd $MRX); mtx=$(rd $MTX); g4dr=$(rd $G4DR); g4dir=$(rd $G4DIR)
g5dr=$(rd $G5DR); g5dir=$(rd $G5DIR); g5es=$(rd $G5ES)
if [ -z "$mrx" ] || [ -z "$mtx" ] || [ -z "$g4dr" ] || [ -z "$g4dir" ] || [ -z "$g5dr" ] || [ -z "$g5dir" ] || [ -z "$g5es" ]; then
    fail "CAN test: a register read failed, nothing changed"
else
    echo "UART3 pad mux before: RX $mrx TX $mtx"
    setb $G5DR $TX; setb $G5DIR $TX; clrb $G5DIR $RX
    wr $MTX 5; wr $MRX 5
    setb $G4DIR $EN; setb $G5ES $RX
    for mode in standby normal; do
        if [ $mode = normal ]; then setb $G4DR $EN; else clrb $G4DR $EN; fi
        usleep 5000
        wr $G5ISR $RX
        idle=$(bit $G5PSR 26)
        clrb $G5DR $TX; usleep 500; setb $G5DR $TX
        usleep 5000
        seen=$(bit $G5ISR 26)
        echo "$mode mode: RXD idle level $idle, edge on RXD when TXD pulsed low: $seen"
        eval "seen_$mode=$seen idle_$mode=$idle"
    done
    clrb $G4DR $EN; wr $G5ISR $RX
    wr $MRX $mrx; wr $MTX $mtx
    putb $G5ES $RX $g5es; putb $G5DIR $(( TX | RX )) $g5dir; putb $G5DR $TX $g5dr
    putb $G4DIR $EN $g4dir; putb $G4DR $EN $g4dr
    echo "restored: UART3 pad mux RX $(rd $MRX) TX $(rd $MTX)"
    if [ "$seen_normal" = 1 ] && [ "$seen_standby" = 0 ]; then pass "CAN transceiver: TXD -> bus -> RXD loopback works, FD_CAN_EN switches standby/normal"
    elif [ "$seen_normal" = 1 ]; then fail "CAN transceiver loops back in standby too: FD_CAN_EN (Q6 -> STB) has no effect"
    else fail "CAN transceiver: no loopback (RXD idle $idle_normal): unpowered, SHDN high, or TXD/RXD not reaching U15"; fi
fi

h "Cab temperature TMP05 (CAB_TEMP = GPIO4_IO27)"
c4=$(gchip 30230000)
if [ -z "$c4" ] || ! command -v gpiomon >/dev/null; then info "TMP05: gpiomon/gpiodetect missing, skipped"; else
    if gpiomon --version 2>/dev/null | grep -q 'v2'; then set -- -c $c4 -n 13 27; else set -- --num-events=13 $c4 27; fi
    timeout 3 gpiomon "$@" > /tmp/tmp05.ev 2>&1
    awk '{ l = tolower($0); e = (l ~ /rising/) ? "R" : (l ~ /falling/) ? "F" : ""
           if (e != "" && match($0, /[0-9]+\.[0-9]+/)) print e, substr($0, RSTART, RLENGTH) }' /tmp/tmp05.ev > /tmp/tmp05.e
    ne=$(wc -l < /tmp/tmp05.e)
    res=$(awk 'NR > 1 && $1 == "F" && p == "R" { th += $2 - t; nh++ }
               NR > 1 && $1 == "R" && p == "F" { tl += $2 - t; nl++ }
               { p = $1; t = $2 }
               END { if (nh && nl) { TH = th / nh * 1000; TL = tl / nl * 1000
                     printf "%.1f %.1f %.1f", TH, TL, 421 - 751 * TH / TL } }' /tmp/tmp05.e)
    if [ -n "$res" ]; then
        set -- $res
        tc=${3%.*}
        if [ "$tc" -gt -20 ] && [ "$tc" -lt 80 ]; then pass "TMP05: $3 C (high $1 ms, low $2 ms)"
        else fail "TMP05: $3 C is not plausible (high $1 ms, low $2 ms)"; fi
    else
        fail "TMP05: no PWM on CAB_TEMP ($ne edges in 3 s; level now $(bit 0x30230008 27))"
        head -3 /tmp/tmp05.ev
    fi
fi

h "Buzzer SPK1 (SPKDRV on the SPDIF_EXT_CLK pad; finding 2)"
# Briefly mux the pad to PWM1 (the backlight PWM) so the transducer gets a
# square wave, then put the pad back to GPIO5_IO5 (the SoM's BT_BUF_EN; BT is
# unused on our image). Tone 2 shortens the PWM period 4x, then restores it.
M=0x303301f0; PCR=0x30660000; PSAR=0x3066000c; PPR=0x30660010
BL=/sys/class/backlight/backlight; b=$(cat $BL/brightness 2>/dev/null)
m=$(rd $M); cr=$(rd $PCR)
if [ -n "$NOBUZZ" ]; then info "buzzer: skipped (NOBUZZ)"
elif [ -z "$m" ] || [ -z "$cr" ] || [ -z "$b" ]; then fail "buzzer test: a read failed, nothing changed"; else
    echo 50 > $BL/brightness; usleep 200000
    cr=$(rd $PCR); pr=$(rd $PPR); sar=$(rd $PSAR)
    echo "pad mux $m; PWM1 CR $cr PR $pr SAR $sar"
    if [ $(( cr & 1 )) = 0 ] || [ -z "$pr" ] || [ -z "$sar" ]; then info "buzzer: PWM1 is off, nothing to drive it with"; else
        echo ">>> tone 1: 1 kHz, 1.5 s"
        wr $M 1; usleep 1500000; wr $M $m
        usleep 700000
        echo ">>> tone 2: about 4 kHz, 1.5 s"
        wr $PPR $(( (pr + 2) / 4 - 2 )); wr $PSAR $(( sar / 4 ))
        wr $M 1; usleep 1500000; wr $M $m
        wr $PPR $pr; wr $PSAR $sar
        if [ "$(rd $M)" = "$m" ]; then info "buzzer: two tones played (1 kHz, then ~4 kHz); pad and PWM put back"
        else fail "buzzer: pad mux NOT put back (now $(rd $M), was $m)"; fi
    fi
    echo $b > $BL/brightness
fi

h "Ethernet KSZ9031 on JK4 (off unless ecofleet_eth=1 on a reworked board)"
line ETH_dReset
echo "u-boot ecofleet_eth=$(fw_printenv -n ecofleet_eth 2>/dev/null)"
dmesg | grep -iE "fec|ksz9031|micrel" | tail -4
N=/sys/class/net/eth0
if [ -e $N ]; then
    ip -4 addr show eth0 | grep -E "inet " || echo "eth0: no IPv4 address"
    if [ "$(cat $N/carrier 2>/dev/null)" = 1 ]; then pass "Ethernet link up, $(cat $N/speed) Mb/s $(cat $N/duplex) duplex"
    else info "eth0 present, no link (cable on JK4?)"; fi
else
    info "no eth0 (Ethernet off: expected unless ecofleet_eth=1)"
fi

h "Ezurio BL54L15 (held in reset until part C)"
line BT_nRST

h "Watchdog -> WDOG_B -> TPS3808 -> PMIC"
wm=$(rd 0x30330030)
if [ -n "$wm" ] && [ $(( wm & 7 )) = 1 ]; then pass "GPIO1_IO02 pad is WDOG_B"; else fail "GPIO1_IO02 pad mux $wm, not WDOG_B"; fi
for w in /sys/class/watchdog/watchdog*; do [ -e $w/identity ] && echo "$(basename $w): $(cat $w/identity), timeout $(cat $w/timeout 2>/dev/null) s, $(cat $w/state 2>/dev/null)"; done

h "On/off button (PB2 -> ONOFF -> snvs_pwrkey)"
grep -B1 -A5 -i "snvs" /proc/bus/input/devices | grep -E "Name|Handlers"

h "Touch ILI2132A raw replies (needs a panel on SOK5)"
if i2ctransfer -y 1 w1@0x41 0x42 >/dev/null 2>&1; then
    q() { i2ctransfer -y 1 w1@0x41 $1 >/dev/null 2>&1 || { echo "cmd $1: write NACK"; return; }; usleep $3; echo "cmd $1 (+$(( $3 / 1000 )) ms): $(i2ctransfer -y 1 r$2@0x41 2>&1)"; }
    for dly in 5000 50000; do q 0x42 3 $dly; q 0x61 32 $dly; q 0x40 8 $dly; q 0x21 8 $dly; q 0x20 21 $dly; q 0xc0 2 $dly; done
else
    info "touch: nothing at I2C2 0x41 (no panel or touch flex on SOK5)"
fi

h "Summary"
cat $RES
