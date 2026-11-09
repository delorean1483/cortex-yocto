#!/bin/sh
# Login console on R1's USB-C port (Robb, 2026-10-14): R1's UART1 is shared with
# the Ezurio module, so a console there needs wires tacked onto the board and
# input on it fights the module's TX. Once Linux is up, a CDC ACM USB serial
# device on usbotg1 (the USB-C port used for programming) carries a login
# instead. This runs the real gadget script against a fake configfs/sysfs tree
# and checks the unit, recipe and image wiring.
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
D=$ROOT/meta-ecofleet/recipes-bsp/ecofleet-usb-console
SCRIPT=$D/files/ecofleet-usb-console
UNIT=$D/files/ecofleet-usb-console.service
DTS=$ROOT/meta-ecofleet/recipes-kernel/linux/files/imx8mm-ecofleet-ef-mx8mm.dts
IMAGE=$ROOT/meta-ecofleet/recipes-core/images/ecofleet-image.bb
fail=0
ok()  { echo "ok   - $1"; }
bad() { echo "FAIL - $1"; fail=1; }
t=$(mktemp -d); trap 'chmod -R u+w "$t"; rm -rf "$t"' EXIT

# Fake tree. Probe order puts usbotg2 (32e50000) first as ci_hdrc.0, so a script
# that takes the first UDC binds the wrong port.
fake() {
    r=$1; shift
    mkdir -p "$r/config/usb_gadget" "$r/udc"
    for pair in "$@"; do
        name=${pair%%=*} addr=${pair#*=}
        dev="$r/devices/platform/soc@0/32c00000.bus/$addr.usb/$name/udc/$name"
        mkdir -p "$dev"
        ln -s "$dev" "$r/udc/$name"
    done
    echo 27163209DABC09FF > "$r/serial_number"
}
run() {
    CONFIGFS=$1/config UDC_DIR=$1/udc SOC_SERIAL=$1/serial_number sh "$SCRIPT" >"$1/out" 2>&1
}
val() { cat "$G/$1" 2>/dev/null; }

[ -f "$SCRIPT" ] && ok "gadget script present" || bad "missing $SCRIPT"

# 1. Gadget set up on the USB-C port's UDC.
fake "$t/a" ci_hdrc.0=32e50000 ci_hdrc.1=32e40000
G=$t/a/config/usb_gadget/ecofleet
run "$t/a" && ok "script exits 0" || bad "script failed: $(cat "$t/a/out")"
[ "$(val UDC)" = ci_hdrc.1 ] && ok "bound to usbotg1 (32e40000.usb)" || bad "UDC is '$(val UDC)', want ci_hdrc.1"
[ "$(val idVendor)" = 0x1d6b ] && [ "$(val idProduct)" = 0x0104 ] && ok "VID:PID 1d6b:0104" || bad "VID:PID '$(val idVendor):$(val idProduct)'"
[ "$(val bDeviceClass)" = 0xEF ] && [ "$(val bDeviceSubClass)" = 0x02 ] && [ "$(val bDeviceProtocol)" = 0x01 ] \
    && ok "IAD device class (Windows inbox CDC ACM driver)" || bad "device class not 0xEF/0x02/0x01"
[ "$(val strings/0x409/serialnumber)" = 27163209DABC09FF ] && ok "serial number = SoC serial" || bad "serial '$(val strings/0x409/serialnumber)'"
[ "$(val strings/0x409/manufacturer)" = EcoFleet ] && ok "manufacturer string" || bad "manufacturer '$(val strings/0x409/manufacturer)'"
[ -d "$G/functions/acm.usb0" ] && ok "ACM function (ttyGS0)" || bad "no functions/acm.usb0"
[ -L "$G/configs/c.1/acm.usb0" ] && [ "$(cd -P "$G/configs/c.1/acm.usb0" && pwd -P)" = "$(cd -P "$G/functions/acm.usb0" && pwd -P)" ] \
    && ok "config c.1 links the ACM function" || bad "configs/c.1/acm.usb0 does not link functions/acm.usb0"
[ "$(val configs/c.1/bmAttributes)" = 0xC0 ] && ok "self-powered (R1 never draws from VBUS)" || bad "bmAttributes '$(val configs/c.1/bmAttributes)'"

# 2. Second run (service restart) while bound: configfs refuses writes then, so
#    the script must leave everything alone. Read-only files stand in for EBUSY.
chmod -R a-w "$G"
run "$t/a" && ok "re-run while bound exits 0" || bad "re-run while bound failed: $(cat "$t/a/out")"
chmod -R u+w "$G"

# 3. No UDC for the USB-C port: fail loudly, bind nothing.
fake "$t/b" ci_hdrc.0=32e50000
G=$t/b/config/usb_gadget/ecofleet
run "$t/b" && bad "exits 0 with no usbotg1 UDC" || ok "fails with no usbotg1 UDC"
[ -z "$(val UDC)" ] && ok "nothing bound without usbotg1" || bad "bound '$(val UDC)' without usbotg1"

# 4. Unit: R1 only, starts the getty itself.
compat=$(sed -n 's/^[[:space:]]*compatible = "\([^"]*\)".*/\1/p' "$DTS" | head -1)
grep -qx "ConditionFirmware=device-tree-compatible($compat)" "$UNIT" 2>/dev/null \
    && ok "unit gated on the R1 compatible ($compat)" || bad "unit not gated on ConditionFirmware=device-tree-compatible($compat)"
grep -qx 'ExecStart=/usr/sbin/ecofleet-usb-console' "$UNIT" 2>/dev/null && ok "ExecStart" || bad "ExecStart=/usr/sbin/ecofleet-usb-console"
grep -q '^ExecStartPost=.*systemctl --no-block start serial-getty@ttyGS0.service' "$UNIT" 2>/dev/null \
    && ok "starts serial-getty@ttyGS0" || bad "unit does not start serial-getty@ttyGS0"
# A unit skipped by its condition still pulls in its Wants=/Requires=: the
# getty would then wait for a ttyGS0 that never appears on the dev kit.
grep -Eq '^(Wants|Requires)=.*serial-getty@ttyGS0' "$UNIT" 2>/dev/null \
    && bad "getty pulled in by Wants/Requires (starts on the dev kit too)" || ok "getty not pulled in by Wants/Requires"
grep -qx 'WantedBy=multi-user.target' "$UNIT" 2>/dev/null && ok "WantedBy=multi-user.target" || bad "WantedBy=multi-user.target"

# 5. Recipe and image.
BB=$(ls "$D"/ecofleet-usb-console*.bb 2>/dev/null | head -1)
[ -n "$BB" ] && ok "recipe present" || bad "no recipe in $D"
grep -q 'SYSTEMD_SERVICE:${PN} = "ecofleet-usb-console.service"' "$BB" 2>/dev/null && ok "recipe enables the unit" || bad "recipe does not set SYSTEMD_SERVICE"
grep -q '${sbindir}/ecofleet-usb-console' "$BB" 2>/dev/null && ok "recipe installs the script to sbindir" || bad "recipe does not install the script to sbindir"
sed -n '/^IMAGE_INSTALL:append/,/"/p' "$IMAGE" | grep -qw 'ecofleet-usb-console' \
    && ok "image installs ecofleet-usb-console" || bad "ecofleet-image.bb does not install ecofleet-usb-console"

[ $fail = 0 ] && echo PASS || { echo FAILED; exit 1; }
