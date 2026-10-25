# Watch both power-key inputs (SoC snvs + PMIC bd718xx) for N seconds; logind's power-off is inhibited
N=${1:-60}
systemd-inhibit --what=handle-power-key --mode=block --who=r1-test --why="button test" sleep $(( N + 3 )) &
sleep 1
for e in /dev/input/event*; do timeout $N cat $e > /tmp/key.$(basename $e) & done
i0=$(grep -E "snvs-powerkey|bd718" /proc/interrupts | awk '{s=0; for (i=2;i<=5;i++) s+=$i; printf "%s=%d ", $NF, s}')
sleep $N
echo "interrupts before: $i0"
echo "interrupts after:  $(grep -E "snvs-powerkey|bd718" /proc/interrupts | awk '{s=0; for (i=2;i<=5;i++) s+=$i; printf "%s=%d ", $NF, s}')"
for f in /tmp/key.event*; do
    d=/sys/class/input/${f#/tmp/key.}/device/name
    ev=$(od -An -tx1 -v $f | tr -d '\n' | tr -s ' ' | grep -o "01 00 74 00 0[01] 00 00 00" | tr '\n' ',')
    echo "$(cat $d 2>/dev/null): $(wc -c < $f) bytes, KEY_POWER events: ${ev:-none}"
done
