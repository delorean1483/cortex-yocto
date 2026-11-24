# Buzzer frequency sweep: PWM1 (24 MHz clock) briefly routed to the SPKDRV pad
# (SPDIF_EXT_CLK), then pad, period, duty and brightness put back.
rd() { devmem2 $1 w 2>/dev/null | awk '/^Read at/ {print $NF}'; }
wr() { devmem2 $1 w $(printf 0x%x $2) >/dev/null 2>&1; }
M=0x303301f0; PCR=0x30660000; PSAR=0x3066000c; PPR=0x30660010
BL=/sys/class/backlight/backlight; b=$(cat $BL/brightness)
m=$(rd $M)
[ -n "$m" ] && [ -n "$b" ] || { echo "read failed, nothing changed"; exit 1; }
echo 50 > $BL/brightness; usleep 200000
pr=$(rd $PPR); sar=$(rd $PSAR); cr=$(rd $PCR)
[ -n "$pr" ] && [ -n "$sar" ] && [ $(( cr & 1 )) = 1 ] || { echo $b > $BL/brightness; echo "PWM1 off or read failed"; exit 1; }
n=0
for f in 1000 2000 2700 3500 4000 5000; do
    n=$(( n + 1 )); p=$(( 24000000 / f - 2 ))
    wr $PPR $p; wr $PSAR $(( (p + 2) / 2 ))
    echo "tone $n: $f Hz"
    wr $M 1; usleep 1000000; wr $M $m
    usleep 700000
done
wr $PPR $pr; wr $PSAR $sar; echo $b > $BL/brightness
echo "restored: pad $(rd $M) (was $m), PR $(rd $PPR) (was $pr)"
