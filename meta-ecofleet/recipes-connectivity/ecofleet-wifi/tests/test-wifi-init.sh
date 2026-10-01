#!/bin/sh
# Host test for ecofleet-wifi-init: creates an empty config once, never overwrites.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
init="$here/../files/ecofleet-wifi-init"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
conf="$tmp/wifi/wpa_supplicant-wlan0.conf"
fail() { echo "FAIL: $*"; exit 1; }

sh "$init" "$conf"
[ -f "$conf" ] || fail "config not created"
grep -qx 'ctrl_interface=/run/wpa_supplicant' "$conf" || fail "ctrl_interface missing"
grep -qx 'update_config=1' "$conf" || fail "update_config missing"
grep -qx 'country=US' "$conf" || fail "country missing"
[ "$(stat -f %Lp "$tmp/wifi" 2>/dev/null || stat -c %a "$tmp/wifi")" = 700 ] || fail "dir not 0700"
[ "$(stat -f %Lp "$conf" 2>/dev/null || stat -c %a "$conf")" = 600 ] || fail "file not 0600"

echo 'network={ ssid="keep" }' >> "$conf"
sh "$init" "$conf"
grep -q 'ssid="keep"' "$conf" || fail "existing config was overwritten"
echo "test-wifi-init: ALL PASS"
