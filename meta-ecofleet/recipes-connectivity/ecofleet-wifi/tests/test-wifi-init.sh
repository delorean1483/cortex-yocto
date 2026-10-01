#!/bin/sh
# Host test for ecofleet-wifi-init: creates the config once, never overwrites a
# good one, replaces an empty or broken one (keeping the bad copy), and always
# tightens permissions.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
init="$here/../files/ecofleet-wifi-init"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $*"; exit 1; }
# Octal permission bits; GNU stat first (BSD's -f means something else on GNU).
mode() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }
is_fresh() {
    grep -qx 'ctrl_interface=/run/wpa_supplicant' "$1" || fail "$2: ctrl_interface missing"
    grep -qx 'update_config=1' "$1" || fail "$2: update_config missing"
    grep -qx 'country=US' "$1" || fail "$2: country missing"
}

# 1. Fresh: created with tight permissions.
conf="$tmp/a/wifi/wpa_supplicant-wlan0.conf"
sh "$init" "$conf"
[ -f "$conf" ] || fail "config not created"
is_fresh "$conf" "fresh"
[ "$(mode "$tmp/a/wifi")" = 700 ] || fail "dir not 0700"
[ "$(mode "$conf")" = 600 ] || fail "file not 0600"

# 2. A good existing file is left untouched.
echo 'network={ ssid="keep" }' >> "$conf"
cp "$conf" "$tmp/a/expected"
sh "$init" "$conf"
cmp -s "$conf" "$tmp/a/expected" || fail "good config was changed"
[ ! -e "$conf.bad" ] || fail "good config was moved aside"

# 3. A zero-length file (power cut during first boot) is replaced.
conf="$tmp/b/wifi/wpa_supplicant-wlan0.conf"
mkdir -p "$tmp/b/wifi"; : > "$conf"
sh "$init" "$conf"
is_fresh "$conf" "zero-length"

# 4. A file without ctrl_interface is replaced; the bad copy is kept.
conf="$tmp/c/wifi/wpa_supplicant-wlan0.conf"
mkdir -p "$tmp/c/wifi"; printf 'network={ ssid="half"\n' > "$conf"
sh "$init" "$conf"
is_fresh "$conf" "no ctrl_interface"
grep -q 'ssid="half"' "$conf.bad" || fail "bad copy not kept"

# 5. Loose permissions on an existing good dir/file are tightened.
conf="$tmp/d/wifi/wpa_supplicant-wlan0.conf"
mkdir -p "$tmp/d/wifi"
printf 'ctrl_interface=/run/wpa_supplicant\nupdate_config=1\nnetwork={ ssid="x" }\n' > "$conf"
chmod 755 "$tmp/d/wifi"; chmod 644 "$conf"
sh "$init" "$conf"
[ "$(mode "$tmp/d/wifi")" = 700 ] || fail "existing dir not tightened to 0700"
[ "$(mode "$conf")" = 600 ] || fail "existing file not tightened to 0600"
grep -q 'ssid="x"' "$conf" || fail "good config lost while tightening"

echo "test-wifi-init: ALL PASS"
