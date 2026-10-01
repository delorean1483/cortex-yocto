# On-screen WiFi Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let anyone at the cab screen scan for, join (open/WPA2), and forget WiFi networks, with the unit remembering several and showing which one is in use, its signal, IP and internet state.

**Architecture:** gobi-ui (runs as root) gets a `WifiModel` that drives `wpa_supplicant` over its Unix-datagram control socket through a small non-blocking `WpaCtrl` client; all parsing/hashing/classification lives in a pure `WpaParse` module so it is host-testable. QML adds a WiFi screen, a join/password screen with a custom keyboard, a saved-networks screen, a Menu tile and a header indicator. The `ecofleet-wifi` recipe makes `wpa_supplicant` always run, creating an empty config on `/data/wifi` when none exists.

**Tech Stack:** Qt 6 (Core, Network for `QPasswordDigestor`, Quick), C++17, POSIX `AF_UNIX`/`SOCK_DGRAM`, QtTest, Yocto/BitBake, systemd.

**Spec:** `docs/superpowers/specs/2026-10-01-wifi-setup-design.md`

## Global Constraints

- No passcode anywhere in the WiFi feature (open access); screen lock still covers the whole UI.
- Supported security: open and WPA2-PSK (incl. WPA2/WPA3 transition). WPA3-only (SAE), WEP and enterprise (EAP) networks are listed but marked "Not supported" and cannot be joined.
- Credentials only in `/data/wifi/wpa_supplicant-wlan0.conf` (dir 0700, file 0600); WPA2 key stored as the 64-hex PSK (PBKDF2-HMAC-SHA1, 4096 iterations, 32 bytes, salt = SSID bytes) — never the plaintext password, never logged.
- SSID sent to `wpa_supplicant` hex-encoded (`SET_NETWORK <id> ssid <hex>`), never quoted.
- Validation: SSID 1–32 bytes (UTF-8); WPA2 password 8–63 printable ASCII (0x20–0x7E), spaces allowed, never trimmed.
- Nothing may block the UI thread: every control-socket request has a 2000 ms timeout; join waits at most 30000 ms; internet check `--max-time 8`.
- Internet check URL: `http://connectivitycheck.gstatic.com/generate_204`, forced out of `wlan0`; recheck every 120000 ms while connected.
- Signal bars: RSSI ≥ -55 → 4, ≥ -65 → 3, ≥ -75 → 2, ≥ -85 → 1, else 0.
- User-facing copy (exact): "Wrong password." / "Couldn't connect to <ssid>." / "<ssid> is out of range." / "WiFi unavailable" / "This network needs a web sign-in, which isn't supported. Try another network or a phone hotspot." / "Connected, but this network isn't reaching the internet."
- Never unload the WiFi driver; Bluetooth stays masked; wlan0 route metric stays 2048 (Ethernet primary).
- Repo paths below are relative to `meta-ecofleet/recipes-ecofleet/` unless they start with `docs/`.

## Spec adjustments made while planning

- Entry point is a **WiFi tile on Menu page 2** (next to Cloud Connection), not a Settings row: Settings already fills the 440 px content area and a row would force scrolling.
- QML methods are `join()` / `joinSaved()` (not `connect()`, which collides with `QObject::connect`).
- "Scanning" is a separate `scanning` bool, not a `state` value, so a rescan while connected keeps showing "connected".

## Review Focus

1. SSIDs with quotes, backslashes, spaces or UTF-8 (e.g. `Café "Yard"`) — must display correctly and join (hex SSID). Pinned in Task 2 (`decodeSsid`, `ssidHex`) and Task 4 (`joinSendsHexSsidAndPsk`).
2. One SSID broadcast by several APs / bands — must show as one row with the strongest signal. Pinned in Task 2 (`buildListCollapsesDuplicates`).
3. Re-joining a saved network after its password changed — the old entry must be replaced, not duplicated. Pinned in Task 4 (`rejoinReplacesOldEntry`).
4. `wpa_supplicant` disappearing mid-join — join must fail cleanly, state becomes `unavailable`, and the model recovers when it returns. Pinned in Task 4 (`serverLossFailsJoinAndRecovers`).
5. Double-tapping Connect / a second join while one is pending — must be ignored (no extra `ADD_NETWORK`). Pinned in Task 4 (`secondJoinIgnoredWhilePending`).

---

## File Structure

| File | Responsibility |
|---|---|
| `ecofleet-wifi/files/ecofleet-wifi-init` (new) | Create empty `/data/wifi` config if missing |
| `ecofleet-wifi/files/wpa_supplicant-wlan0.conf` (modify) | systemd drop-in: always run, `ExecStartPre` init |
| `ecofleet-wifi/ecofleet-wifi_1.0.bb` (modify) | install init script |
| `ecofleet-wifi/tests/test-wifi-init.sh` (new) | host test for the init script |
| `gobi-ui/files/WpaParse.h/.cpp` (new) | pure parsing, PSK, validation, list building, check classification |
| `gobi-ui/files/WpaCtrl.h/.cpp` (new) | non-blocking control-socket client (requests + events) |
| `gobi-ui/files/WifiModel.h/.cpp` (new) | state machine exposed to QML |
| `gobi-ui/files/tests/FakeWpa.h` (new) | fake `wpa_supplicant` server for tests |
| `gobi-ui/files/tests/tst_wpaparse.cpp`, `tst_wpactrl.cpp`, `tst_wifimodel.cpp` (new) | host tests |
| `gobi-ui/files/main.cpp`, `CMakeLists.txt`, `tests/CMakeLists.txt`, `gobi-ui_1.0.bb` (modify) | wiring/build/install |
| `gobi-ui/files/qml/atoms/Icon.qml` (modify) | `wifi` glyph |
| `gobi-ui/files/qml/atoms/WifiBars.qml`, `TextKeyboard.qml` (new) | signal bars, keyboard |
| `gobi-ui/files/qml/screens/WifiScreen.qml`, `WifiJoinScreen.qml`, `WifiSavedScreen.qml` (new) | screens |
| `gobi-ui/files/qml/Header.qml`, `AppShell.qml`, `screens/MenuScreen.qml` (modify) | header indicator + entry points |
| `gobi-ui/files/qml/preview/Mocks.qml`, `Shots.qml` (modify) | previews |

---

### Task 1: wpa_supplicant always runs, empty config created on /data

**Files:**
- Create: `ecofleet-wifi/files/ecofleet-wifi-init`
- Create: `ecofleet-wifi/tests/test-wifi-init.sh`
- Modify: `ecofleet-wifi/files/wpa_supplicant-wlan0.conf`
- Modify: `ecofleet-wifi/ecofleet-wifi_1.0.bb`

**Interfaces:**
- Produces: `/usr/sbin/ecofleet-wifi-init [conf-path]` — exits 0; creates the file only if missing.

- [ ] **Step 1: Write the failing test**

`ecofleet-wifi/tests/test-wifi-init.sh`:
```sh
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `sh meta-ecofleet/recipes-ecofleet/ecofleet-wifi/tests/test-wifi-init.sh`
Expected: FAIL (`ecofleet-wifi-init` does not exist → `sh: ...: No such file`).

- [ ] **Step 3: Write the init script**

`ecofleet-wifi/files/ecofleet-wifi-init`:
```sh
#!/bin/sh
# Ensure wpa_supplicant has a config on /data (survives A/B updates). With no
# networks it idles; the screen adds networks and wpa_supplicant SAVE_CONFIGs
# them here. Never overwrites an existing file.
set -eu
CONF=${1:-/data/wifi/wpa_supplicant-wlan0.conf}
DIR=$(dirname "$CONF")
[ -f "$CONF" ] && exit 0
mkdir -p "$DIR"
chmod 700 "$DIR"
umask 077
printf 'ctrl_interface=/run/wpa_supplicant\nupdate_config=1\ncountry=US\n' > "$CONF.tmp"
mv "$CONF.tmp" "$CONF"
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `sh meta-ecofleet/recipes-ecofleet/ecofleet-wifi/tests/test-wifi-init.sh`
Expected: `test-wifi-init: ALL PASS`

- [ ] **Step 5: Make wpa_supplicant always run**

Replace `ecofleet-wifi/files/wpa_supplicant-wlan0.conf` with:
```ini
# EcoFleet: WiFi credentials live on /data so they survive A/B updates.
# wpa_supplicant always runs; with no saved networks it idles. Networks are
# added from the cab screen (gobi-ui WifiModel) and saved here by
# wpa_supplicant itself (update_config=1).
[Unit]
RequiresMountsFor=/data

[Service]
ExecStartPre=/usr/sbin/ecofleet-wifi-init
ExecStart=
ExecStart=/usr/sbin/wpa_supplicant -c/data/wifi/wpa_supplicant-wlan0.conf -i%I
```

- [ ] **Step 6: Install the script from the recipe**

In `ecofleet-wifi/ecofleet-wifi_1.0.bb`:
- add `    file://ecofleet-wifi-init \` to `SRC_URI`
- in `do_install()` add, before the `unitdir=` line:
```sh
    install -D -m 0755 ${WORKDIR}/ecofleet-wifi-init ${D}${sbindir}/ecofleet-wifi-init
```
- add `    ${sbindir}/ecofleet-wifi-init \` to `FILES:${PN}`
- update `DESCRIPTION`'s last sentence to: "The driver is never unloaded, and wpa_supplicant always runs with its config on /data/wifi."

- [ ] **Step 7: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/ecofleet-wifi
git commit -m "feat(wifi): wpa_supplicant always runs; create empty /data/wifi config"
```

---

### Task 2: WpaParse — pure parsing, PSK, validation, list building

**Files:**
- Create: `gobi-ui/files/WpaParse.h`, `gobi-ui/files/WpaParse.cpp`
- Create: `gobi-ui/files/tests/tst_wpaparse.cpp`
- Modify: `gobi-ui/files/tests/CMakeLists.txt`

**Interfaces:**
- Produces (namespace `wpa`):
  - `struct ScanEntry { QString bssid; int freq; int signal; QString flags; QString ssid; };`
  - `struct SavedNet { int id; QString ssid; bool current; };`
  - `struct Event { enum Type { Other, Connected, Disconnected, WrongKey, ScanResults }; Type type = Other; int id = -1; };`
  - `enum class Internet { Unknown, Online, NoInternet, Portal };`
  - `QString decodeSsid(const QByteArray &escaped);`
  - `QList<ScanEntry> parseScanResults(const QByteArray &reply);`
  - `QList<SavedNet> parseListNetworks(const QByteArray &reply);`
  - `QMap<QString, QString> parseKeyValues(const QByteArray &reply);` (values for `ssid` are already `decodeSsid`-decoded)
  - `Event parseEvent(const QByteArray &line);` (line without the `<N>` prefix)
  - `int signalBars(int rssiDbm);`
  - `bool isSecured(const QString &flags);` `bool isSupported(const QString &flags);`
  - `QByteArray ssidHex(const QString &ssid);`
  - `QByteArray pskHex(const QString &password, const QString &ssid);`
  - `QString validateSsid(const QString &ssid);` `QString validatePassword(const QString &password);` (empty string = valid)
  - `QVariantList buildNetworkList(const QList<ScanEntry> &scan, const QList<SavedNet> &saved, const QString &inUseSsid);` → maps `{ssid, bars, secured, supported, saved, savedId, inUse}`
  - `Internet classifyCheck(int exitCode, const QByteArray &httpCode);`
  - `QString internetName(Internet);` → `"unknown" | "online" | "no_internet" | "portal"`

- [ ] **Step 1: Write the failing test**

`gobi-ui/files/tests/tst_wpaparse.cpp`:
```cpp
// Host tests for WpaParse: wpa_supplicant control-interface text, PSK hashing,
// validation, the merged network list, and internet-check classification.
#include <QtTest>
#include "../WpaParse.h"

using namespace wpa;

class TestWpaParse : public QObject
{
    Q_OBJECT
private slots:
    void decodeSsidHandlesEscapes()
    {
        QCOMPARE(decodeSsid("EcoFleet-Staff"), QStringLiteral("EcoFleet-Staff"));
        QCOMPARE(decodeSsid("Caf\\xc3\\xa9 \\\"Yard\\\""), QStringLiteral("Café \"Yard\""));
        QCOMPARE(decodeSsid("back\\\\slash"), QStringLiteral("back\\slash"));
        QCOMPARE(decodeSsid("tab\\there"), QStringLiteral("tab\there"));
    }

    void scanResults()
    {
        const QByteArray r =
            "bssid / frequency / signal level / flags / ssid\n"
            "0c:ea:14:23:2d:43\t5240\t-47\t[WPA2-PSK-CCMP][ESS]\tEcoFleet-Staff\n"
            "11:22:33:44:55:66\t2412\t-80\t[ESS]\tFree WiFi\n"
            "22:22:33:44:55:66\t2437\t-70\t[WPA2-PSK-CCMP][ESS]\t\n";
        const auto s = parseScanResults(r);
        QCOMPARE(s.size(), 3);
        QCOMPARE(s[0].bssid, QStringLiteral("0c:ea:14:23:2d:43"));
        QCOMPARE(s[0].freq, 5240);
        QCOMPARE(s[0].signal, -47);
        QCOMPARE(s[0].ssid, QStringLiteral("EcoFleet-Staff"));
        QCOMPARE(s[1].ssid, QStringLiteral("Free WiFi"));
        QCOMPARE(s[2].ssid, QString());   // hidden network
    }

    void listNetworks()
    {
        const QByteArray r =
            "network id / ssid / bssid / flags\n"
            "0\tEcoFleet-Staff\tany\t[CURRENT]\n"
            "1\tShop-Guest\tany\t\n"
            "2\tOld\tany\t[DISABLED]\n";
        const auto n = parseListNetworks(r);
        QCOMPARE(n.size(), 3);
        QCOMPARE(n[0].id, 0);
        QVERIFY(n[0].current);
        QCOMPARE(n[1].ssid, QStringLiteral("Shop-Guest"));
        QVERIFY(!n[1].current);
    }

    void keyValues()
    {
        const auto kv = parseKeyValues("wpa_state=COMPLETED\nssid=Caf\\xc3\\xa9\nip_address=192.168.0.206\nid=0\n");
        QCOMPARE(kv.value("wpa_state"), QStringLiteral("COMPLETED"));
        QCOMPARE(kv.value("ssid"), QStringLiteral("Café"));
        QCOMPARE(kv.value("ip_address"), QStringLiteral("192.168.0.206"));
    }

    void events()
    {
        Event e = parseEvent("CTRL-EVENT-CONNECTED - Connection to 0c:ea:14:23:2d:43 completed [id=3 id_str=]");
        QCOMPARE(e.type, Event::Connected);
        QCOMPARE(e.id, 3);
        e = parseEvent("CTRL-EVENT-SSID-TEMP-DISABLED id=4 ssid=\"x\" auth_failures=1 duration=10 reason=WRONG_KEY");
        QCOMPARE(e.type, Event::WrongKey);
        QCOMPARE(e.id, 4);
        e = parseEvent("CTRL-EVENT-SSID-TEMP-DISABLED id=4 ssid=\"x\" auth_failures=1 duration=10 reason=CONN_FAILED");
        QCOMPARE(e.type, Event::Other);
        QCOMPARE(parseEvent("CTRL-EVENT-DISCONNECTED bssid=0c:ea:14:23:2d:43 reason=3").type, Event::Disconnected);
        QCOMPARE(parseEvent("CTRL-EVENT-SCAN-RESULTS ").type, Event::ScanResults);
        QCOMPARE(parseEvent("CTRL-EVENT-BSS-ADDED 5 aa:bb").type, Event::Other);
    }

    void bars()
    {
        QCOMPARE(signalBars(-47), 4);
        QCOMPARE(signalBars(-55), 4);
        QCOMPARE(signalBars(-60), 3);
        QCOMPARE(signalBars(-70), 2);
        QCOMPARE(signalBars(-80), 1);
        QCOMPARE(signalBars(-90), 0);
    }

    void security()
    {
        QVERIFY(!isSecured("[ESS]"));
        QVERIFY(isSupported("[ESS]"));
        QVERIFY(isSecured("[WPA2-PSK-CCMP][ESS]"));
        QVERIFY(isSupported("[WPA2-PSK-CCMP][ESS]"));
        QVERIFY(isSupported("[WPA2-PSK+SAE-CCMP][ESS]"));       // WPA2/WPA3 transition
        QVERIFY(isSecured("[WPA2-SAE-CCMP][ESS]"));
        QVERIFY(!isSupported("[WPA2-SAE-CCMP][ESS]"));          // WPA3-only
        QVERIFY(!isSupported("[WPA2-EAP-CCMP][ESS]"));          // enterprise
        QVERIFY(!isSupported("[WEP][ESS]"));
    }

    void ssidHexEncodesUtf8()
    {
        QCOMPARE(ssidHex(QStringLiteral("Café \"Yard\"")), QByteArray("436166c3a920225961726422"));
    }

    void pskMatchesWpaPassphrase()
    {
        QCOMPARE(pskHex("password", "IEEE"),
                 QByteArray("f42c6fc52df0ebef9ebb4b90b38a5f902e83fe1b135a70e23aed762e9710a12e"));
        QCOMPARE(pskHex("ThisIsAPassword", "ThisIsASSID"),
                 QByteArray("0dc0d6eb90555ed6419756b9a15ec3e3209b63df707dd508d14581f8982721af"));
        QCOMPARE(pskHex(QStringLiteral("pa\"ss word!"), QStringLiteral("Café \"Yard\"")),
                 QByteArray("5d8edb3da0ecfd482604d636a477b8cbe8db0142ad99c3639ec186e1a553d19a"));
    }

    void validation()
    {
        QVERIFY(validateSsid("").size() > 0);
        QVERIFY(validateSsid(QString(33, 'a')).size() > 0);
        QVERIFY(validateSsid(QString(11, QChar(0x00e9))).size() > 0);   // 22 bytes OK...
        QVERIFY(validateSsid(QString(16, QChar(0x00e9))).isEmpty());     // ...32 bytes OK
        QVERIFY(validateSsid(QString(17, QChar(0x00e9))).size() > 0);    // 34 bytes too long
        QVERIFY(validatePassword("1234567").size() > 0);
        QVERIFY(validatePassword("12345678").isEmpty());
        QVERIFY(validatePassword(" spaces ok ").isEmpty());
        QVERIFY(validatePassword(QString(63, 'x')).isEmpty());
        QVERIFY(validatePassword(QString(64, 'x')).size() > 0);
        QVERIFY(validatePassword(QStringLiteral("pässword")).size() > 0);
    }

    void buildListOrdersAndFlags()
    {
        const QList<ScanEntry> scan = {
            {"a", 2412, -80, "[ESS]", "Free"},
            {"b", 5240, -47, "[WPA2-PSK-CCMP][ESS]", "Yard"},
            {"c", 2437, -60, "[WPA2-PSK-CCMP][ESS]", "Shop"},
            {"d", 2437, -50, "[WPA2-PSK-CCMP][ESS]", "Strong"},
            {"e", 2437, -40, "[WPA2-PSK-CCMP][ESS]", ""},
        };
        const QList<SavedNet> saved = { {0, "Yard", true}, {1, "Shop", false}, {2, "Away", false} };
        const auto l = buildNetworkList(scan, saved, "Yard");
        QCOMPARE(l.size(), 4);   // hidden SSID dropped; saved-but-absent "Away" not listed
        const auto m0 = l[0].toMap(), m1 = l[1].toMap(), m2 = l[2].toMap(), m3 = l[3].toMap();
        QCOMPARE(m0["ssid"].toString(), QStringLiteral("Yard"));
        QVERIFY(m0["inUse"].toBool());
        QCOMPARE(m0["savedId"].toInt(), 0);
        QCOMPARE(m1["ssid"].toString(), QStringLiteral("Shop"));     // saved before unsaved
        QVERIFY(m1["saved"].toBool());
        QCOMPARE(m2["ssid"].toString(), QStringLiteral("Strong"));   // then by signal
        QCOMPARE(m3["ssid"].toString(), QStringLiteral("Free"));
        QVERIFY(!m3["secured"].toBool());
        QCOMPARE(m3["savedId"].toInt(), -1);
        QCOMPARE(m0["bars"].toInt(), 4);
    }

    void buildListCollapsesDuplicates()
    {
        const QList<ScanEntry> scan = {
            {"a", 2412, -78, "[WPA2-PSK-CCMP][ESS]", "Yard"},
            {"b", 5240, -52, "[WPA2-PSK-CCMP][ESS]", "Yard"},
        };
        const auto l = buildNetworkList(scan, {}, QString());
        QCOMPARE(l.size(), 1);
        QCOMPARE(l[0].toMap()["bars"].toInt(), 4);
    }

    void classify()
    {
        QCOMPARE(classifyCheck(0, "204"), Internet::Online);
        QCOMPARE(classifyCheck(0, "200"), Internet::Portal);
        QCOMPARE(classifyCheck(0, "302"), Internet::Portal);
        QCOMPARE(classifyCheck(6, "000"), Internet::NoInternet);    // DNS failure
        QCOMPARE(classifyCheck(28, "000"), Internet::NoInternet);   // timeout
        QCOMPARE(internetName(Internet::Portal), QStringLiteral("portal"));
        QCOMPARE(internetName(Internet::NoInternet), QStringLiteral("no_internet"));
    }
};

QTEST_GUILESS_MAIN(TestWpaParse)
#include "tst_wpaparse.moc"
```

Append to `gobi-ui/files/tests/CMakeLists.txt` (and change the `find_package` line to `find_package(Qt6 6.2 REQUIRED COMPONENTS Core Gui Network Test)`):
```cmake

add_executable(tst_wpaparse tst_wpaparse.cpp ../WpaParse.h ../WpaParse.cpp)
target_link_libraries(tst_wpaparse PRIVATE Qt6::Core Qt6::Network Qt6::Test)
target_compile_options(tst_wpaparse PRIVATE -Wall -Wextra)
add_test(NAME tst_wpaparse COMMAND tst_wpaparse)
```

- [ ] **Step 2: Run to verify it fails**

Run (from `gobi-ui/files/tests`): `cmake -S . -B /tmp/gobi-ui-tests -DCMAKE_PREFIX_PATH=/opt/homebrew/opt/qt && cmake --build /tmp/gobi-ui-tests`
Expected: CMake error "Cannot find source file: ../WpaParse.h".

- [ ] **Step 3: Implement**

`gobi-ui/files/WpaParse.h`:
```cpp
#pragma once

#include <QByteArray>
#include <QList>
#include <QMap>
#include <QString>
#include <QVariantList>

/* Pure helpers for talking to wpa_supplicant's control interface: parsing its
 * text replies and events, hashing WPA2 keys exactly like wpa_passphrase,
 * validating input, and merging scan + saved networks into the list the WiFi
 * screen shows. No I/O here, so all of it is host-testable. */
namespace wpa {

struct ScanEntry { QString bssid; int freq = 0; int signal = 0; QString flags; QString ssid; };
struct SavedNet  { int id = -1; QString ssid; bool current = false; };
struct Event     { enum Type { Other, Connected, Disconnected, WrongKey, ScanResults }; Type type = Other; int id = -1; };
enum class Internet { Unknown, Online, NoInternet, Portal };

QString decodeSsid(const QByteArray &escaped);
QList<ScanEntry> parseScanResults(const QByteArray &reply);
QList<SavedNet> parseListNetworks(const QByteArray &reply);
QMap<QString, QString> parseKeyValues(const QByteArray &reply);
Event parseEvent(const QByteArray &line);

int signalBars(int rssiDbm);
bool isSecured(const QString &flags);
bool isSupported(const QString &flags);

QByteArray ssidHex(const QString &ssid);
QByteArray pskHex(const QString &password, const QString &ssid);
QString validateSsid(const QString &ssid);
QString validatePassword(const QString &password);

QVariantList buildNetworkList(const QList<ScanEntry> &scan, const QList<SavedNet> &saved,
                              const QString &inUseSsid);

Internet classifyCheck(int exitCode, const QByteArray &httpCode);
QString internetName(Internet i);

} // namespace wpa
```

`gobi-ui/files/WpaParse.cpp`:
```cpp
#include "WpaParse.h"

#include <QCryptographicHash>
#include <QPasswordDigestor>
#include <QRegularExpression>
#include <QVariantMap>
#include <algorithm>

namespace wpa {

static int hexVal(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

/* Inverse of wpa_supplicant's printf_encode(): \\ \" \e \n \r \t and \xhh. */
QString decodeSsid(const QByteArray &in)
{
    QByteArray out;
    for (int i = 0; i < in.size(); ++i) {
        const char c = in[i];
        if (c != '\\' || i + 1 >= in.size()) { out += c; continue; }
        const char n = in[++i];
        switch (n) {
        case '\\': out += '\\'; break;
        case '"':  out += '"';  break;
        case 'n':  out += '\n'; break;
        case 'r':  out += '\r'; break;
        case 't':  out += '\t'; break;
        case 'e':  out += '\033'; break;
        case 'x':
            if (i + 2 < in.size() && hexVal(in[i + 1]) >= 0 && hexVal(in[i + 2]) >= 0) {
                out += char(hexVal(in[i + 1]) * 16 + hexVal(in[i + 2]));
                i += 2;
            } else {
                out += "\\x";
            }
            break;
        default: out += '\\'; out += n; break;
        }
    }
    return QString::fromUtf8(out);
}

/* Data lines of a tab-separated table reply (header line skipped). */
static QList<QByteArrayList> tableRows(const QByteArray &reply)
{
    QList<QByteArrayList> rows;
    const QByteArrayList lines = reply.split('\n');
    for (int i = 1; i < lines.size(); ++i) {
        if (lines[i].isEmpty()) continue;
        rows << lines[i].split('\t');
    }
    return rows;
}

QList<ScanEntry> parseScanResults(const QByteArray &reply)
{
    QList<ScanEntry> out;
    for (const QByteArrayList &f : tableRows(reply)) {
        if (f.size() < 4) continue;
        ScanEntry e;
        e.bssid  = QString::fromLatin1(f[0]);
        e.freq   = f[1].toInt();
        e.signal = f[2].toInt();
        e.flags  = QString::fromLatin1(f[3]);
        e.ssid   = f.size() > 4 ? decodeSsid(f[4]) : QString();
        out << e;
    }
    return out;
}

QList<SavedNet> parseListNetworks(const QByteArray &reply)
{
    QList<SavedNet> out;
    for (const QByteArrayList &f : tableRows(reply)) {
        if (f.size() < 2) continue;
        SavedNet n;
        n.id = f[0].toInt();
        n.ssid = decodeSsid(f[1]);
        n.current = f.size() > 3 && f[3].contains("[CURRENT]");
        out << n;
    }
    return out;
}

QMap<QString, QString> parseKeyValues(const QByteArray &reply)
{
    QMap<QString, QString> kv;
    for (const QByteArray &line : reply.split('\n')) {
        const int eq = line.indexOf('=');
        if (eq <= 0) continue;
        const QString key = QString::fromLatin1(line.left(eq));
        const QByteArray val = line.mid(eq + 1);
        kv.insert(key, key == QLatin1String("ssid") ? decodeSsid(val) : QString::fromUtf8(val));
    }
    return kv;
}

static int intField(const QByteArray &line, const char *pattern)
{
    const QRegularExpression re(QString::fromLatin1(pattern));
    const auto m = re.match(QString::fromLatin1(line));
    return m.hasMatch() ? m.captured(1).toInt() : -1;
}

Event parseEvent(const QByteArray &line)
{
    Event e;
    if (line.startsWith("CTRL-EVENT-CONNECTED")) {
        e.type = Event::Connected;
        e.id = intField(line, "\\[id=(\\d+)");
    } else if (line.startsWith("CTRL-EVENT-DISCONNECTED")) {
        e.type = Event::Disconnected;
    } else if (line.startsWith("CTRL-EVENT-SSID-TEMP-DISABLED") && line.contains("reason=WRONG_KEY")) {
        e.type = Event::WrongKey;
        e.id = intField(line, "\\bid=(\\d+)");
    } else if (line.startsWith("CTRL-EVENT-SCAN-RESULTS")) {
        e.type = Event::ScanResults;
    }
    return e;
}

int signalBars(int dbm)
{
    if (dbm >= -55) return 4;
    if (dbm >= -65) return 3;
    if (dbm >= -75) return 2;
    if (dbm >= -85) return 1;
    return 0;
}

bool isSecured(const QString &flags)
{
    return flags.contains(QLatin1String("WPA")) || flags.contains(QLatin1String("RSN"))
        || flags.contains(QLatin1String("WEP")) || flags.contains(QLatin1String("SAE"));
}

bool isSupported(const QString &flags)
{
    if (!isSecured(flags)) return true;                       // open
    return flags.contains(QLatin1String("-PSK"));             // WPA/WPA2-PSK, incl. PSK+SAE
}

QByteArray ssidHex(const QString &ssid) { return ssid.toUtf8().toHex(); }

QByteArray pskHex(const QString &password, const QString &ssid)
{
    return QPasswordDigestor::deriveKeyPbkdf2(QCryptographicHash::Sha1, password.toLatin1(),
                                              ssid.toUtf8(), 4096, 32).toHex();
}

QString validateSsid(const QString &ssid)
{
    const int n = ssid.toUtf8().size();
    if (n == 0) return QStringLiteral("Enter the network name.");
    if (n > 32) return QStringLiteral("Network name is too long.");
    return QString();
}

QString validatePassword(const QString &pw)
{
    if (pw.size() < 8) return QStringLiteral("Password must be at least 8 characters.");
    if (pw.size() > 63) return QStringLiteral("Password must be 63 characters or fewer.");
    for (const QChar c : pw)
        if (c.unicode() < 0x20 || c.unicode() > 0x7e)
            return QStringLiteral("Password can only use standard keyboard characters.");
    return QString();
}

QVariantList buildNetworkList(const QList<ScanEntry> &scan, const QList<SavedNet> &saved,
                              const QString &inUseSsid)
{
    // Strongest entry per SSID; hidden (empty) SSIDs dropped.
    QMap<QString, ScanEntry> best;
    for (const ScanEntry &e : scan) {
        if (e.ssid.isEmpty()) continue;
        auto it = best.find(e.ssid);
        if (it == best.end() || e.signal > it->signal) best.insert(e.ssid, e);
    }
    QList<QVariantMap> rows;
    for (const ScanEntry &e : best) {
        int savedId = -1;
        for (const SavedNet &s : saved)
            if (s.ssid == e.ssid) { savedId = s.id; break; }
        QVariantMap m;
        m["ssid"] = e.ssid;
        m["bars"] = signalBars(e.signal);
        m["signal"] = e.signal;
        m["secured"] = isSecured(e.flags);
        m["supported"] = isSupported(e.flags);
        m["saved"] = savedId >= 0;
        m["savedId"] = savedId;
        m["inUse"] = !inUseSsid.isEmpty() && e.ssid == inUseSsid;
        rows << m;
    }
    std::sort(rows.begin(), rows.end(), [](const QVariantMap &a, const QVariantMap &b) {
        if (a["inUse"].toBool() != b["inUse"].toBool()) return a["inUse"].toBool();
        if (a["saved"].toBool() != b["saved"].toBool()) return a["saved"].toBool();
        return a["signal"].toInt() > b["signal"].toInt();
    });
    QVariantList out;
    for (const QVariantMap &m : rows) out << m;
    return out;
}

Internet classifyCheck(int exitCode, const QByteArray &httpCode)
{
    if (exitCode != 0) return Internet::NoInternet;
    return httpCode.trimmed() == "204" ? Internet::Online : Internet::Portal;
}

QString internetName(Internet i)
{
    switch (i) {
    case Internet::Online:     return QStringLiteral("online");
    case Internet::NoInternet: return QStringLiteral("no_internet");
    case Internet::Portal:     return QStringLiteral("portal");
    default:                   return QStringLiteral("unknown");
    }
}

} // namespace wpa
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cmake --build /tmp/gobi-ui-tests && ctest --test-dir /tmp/gobi-ui-tests -R tst_wpaparse --output-on-failure`
Expected: `100% tests passed`.

- [ ] **Step 5: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-ui/files/WpaParse.* meta-ecofleet/recipes-ecofleet/gobi-ui/files/tests/tst_wpaparse.cpp meta-ecofleet/recipes-ecofleet/gobi-ui/files/tests/CMakeLists.txt
git commit -m "feat(ui): WpaParse — wpa_supplicant parsing, PSK, validation, network list"
```

---

### Task 3: WpaCtrl — non-blocking control-socket client (+ fake server)

**Files:**
- Create: `gobi-ui/files/WpaCtrl.h`, `gobi-ui/files/WpaCtrl.cpp`
- Create: `gobi-ui/files/tests/FakeWpa.h`
- Create: `gobi-ui/files/tests/tst_wpactrl.cpp`
- Modify: `gobi-ui/files/tests/CMakeLists.txt`

**Interfaces:**
- Produces:
  - `class WpaCtrl : public QObject` — `explicit WpaCtrl(const QString &serverPath, QObject *parent = nullptr)`; `bool open()`; `void close()`; `bool isOpen() const`; `using Reply = std::function<void(bool ok, const QByteArray &reply)>`; `void request(const QByteArray &cmd, Reply cb)`; `void setTimeoutMs(int)`; signals `event(const QByteArray &line)` (prefix `<N>` stripped), `lost()`.
  - `class FakeWpa` (tests only) — `explicit FakeWpa(const QString &path)`; `std::function<QByteArray(const QByteArray &cmd)> handler`; `QList<QByteArray> commands`; `void sendEvent(const QByteArray &line)`; `void stop()`; `bool attached() const`; `bool mute` (when true, never replies).

- [ ] **Step 1: Write the fake server and failing test**

`gobi-ui/files/tests/FakeWpa.h`:
```cpp
#pragma once
// A stand-in wpa_supplicant control socket for host tests: binds a Unix
// datagram socket, records every command, replies via `handler` (default
// "OK\n"), and can push "<3>"-prefixed events to an ATTACHed client.
#include <QObject>
#include <QSocketNotifier>
#include <functional>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <fcntl.h>
#include <cstring>

class FakeWpa : public QObject
{
public:
    std::function<QByteArray(const QByteArray &)> handler = [](const QByteArray &) { return QByteArray("OK\n"); };
    QList<QByteArray> commands;
    bool mute = false;

    explicit FakeWpa(const QString &path) : m_path(path.toLocal8Bit())
    {
        m_fd = ::socket(AF_UNIX, SOCK_DGRAM, 0);
        ::fcntl(m_fd, F_SETFL, O_NONBLOCK);
        sockaddr_un a{}; a.sun_family = AF_UNIX;
        std::strncpy(a.sun_path, m_path.constData(), sizeof(a.sun_path) - 1);
        ::unlink(m_path.constData());
        ::bind(m_fd, reinterpret_cast<sockaddr *>(&a), sizeof(a));
        m_n = new QSocketNotifier(m_fd, QSocketNotifier::Read, this);
        connect(m_n, &QSocketNotifier::activated, this, [this] { onRead(); });
    }
    ~FakeWpa() override { stop(); }

    bool attached() const { return m_monLen > 0; }

    void sendEvent(const QByteArray &line)
    {
        const QByteArray msg = "<3>" + line;
        ::sendto(m_fd, msg.constData(), msg.size(), 0, reinterpret_cast<sockaddr *>(&m_mon), m_monLen);
    }

    void stop()
    {
        if (m_fd < 0) return;
        delete m_n; m_n = nullptr;
        ::close(m_fd); m_fd = -1;
        ::unlink(m_path.constData());
    }

private:
    void onRead()
    {
        char buf[4096];
        sockaddr_un from{}; socklen_t len = sizeof(from);
        const ssize_t n = ::recvfrom(m_fd, buf, sizeof(buf), 0, reinterpret_cast<sockaddr *>(&from), &len);
        if (n <= 0) return;
        const QByteArray cmd(buf, int(n));
        commands << cmd;
        QByteArray reply;
        if (cmd == "ATTACH") { m_mon = from; m_monLen = len; reply = "OK\n"; }
        else reply = handler(cmd);
        if (!mute)
            ::sendto(m_fd, reply.constData(), reply.size(), 0, reinterpret_cast<sockaddr *>(&from), len);
    }

    QByteArray m_path;
    int m_fd = -1;
    QSocketNotifier *m_n = nullptr;
    sockaddr_un m_mon{};
    socklen_t m_monLen = 0;
};
```

`gobi-ui/files/tests/tst_wpactrl.cpp`:
```cpp
// Host tests for WpaCtrl against FakeWpa: request/reply ordering, events,
// timeouts, and behaviour when the server is absent or goes away.
#include <QtTest>
#include <QSignalSpy>
#include <QTemporaryDir>
#include "FakeWpa.h"
#include "../WpaCtrl.h"

class TestWpaCtrl : public QObject
{
    Q_OBJECT
    QTemporaryDir m_dir;
    QString path() const { return m_dir.path() + "/wlan0"; }

private slots:
    void openFailsWithoutServer()
    {
        WpaCtrl c(m_dir.path() + "/nope");
        QVERIFY(!c.open());
        QVERIFY(!c.isOpen());
        bool called = false, okv = true;
        c.request("PING", [&](bool ok, const QByteArray &) { called = true; okv = ok; });
        QTRY_VERIFY(called);
        QVERIFY(!okv);
    }

    void repliesInOrder()
    {
        FakeWpa f(path());
        f.handler = [](const QByteArray &c) { return c == "PING" ? QByteArray("PONG\n") : QByteArray("OK\n"); };
        WpaCtrl c(path());
        QVERIFY(c.open());
        QStringList got;
        c.request("PING", [&](bool ok, const QByteArray &r) { QVERIFY(ok); got << QString::fromLatin1(r); });
        c.request("SCAN", [&](bool ok, const QByteArray &r) { QVERIFY(ok); got << QString::fromLatin1(r); });
        QTRY_COMPARE(got.size(), 2);
        QCOMPARE(got[0], QStringLiteral("PONG\n"));
        QCOMPARE(got[1], QStringLiteral("OK\n"));
        QCOMPARE(f.commands.last(), QByteArray("SCAN"));
    }

    void eventsArriveWithoutPrefix()
    {
        FakeWpa f(path());
        WpaCtrl c(path());
        QSignalSpy spy(&c, &WpaCtrl::event);
        QVERIFY(c.open());
        QTRY_VERIFY(f.attached());
        f.sendEvent("CTRL-EVENT-SCAN-RESULTS ");
        QTRY_COMPARE(spy.count(), 1);
        QCOMPARE(spy[0][0].toByteArray(), QByteArray("CTRL-EVENT-SCAN-RESULTS "));
    }

    void timeoutFailsRequestAndReportsLost()
    {
        FakeWpa f(path());
        WpaCtrl c(path());
        c.setTimeoutMs(200);
        QSignalSpy lost(&c, &WpaCtrl::lost);
        QVERIFY(c.open());
        QTRY_VERIFY(f.attached());
        f.mute = true;
        bool called = false, okv = true;
        c.request("STATUS", [&](bool ok, const QByteArray &) { called = true; okv = ok; });
        QTRY_VERIFY(called);
        QVERIFY(!okv);
        QCOMPARE(lost.count(), 1);
        QVERIFY(!c.isOpen());
    }

    void serverGoneReportsLost()
    {
        FakeWpa f(path());
        WpaCtrl c(path());
        QSignalSpy lost(&c, &WpaCtrl::lost);
        QVERIFY(c.open());
        f.stop();
        bool called = false;
        c.request("STATUS", [&](bool, const QByteArray &) { called = true; });
        QTRY_VERIFY(called);
        QTRY_COMPARE(lost.count(), 1);
    }
};

QTEST_GUILESS_MAIN(TestWpaCtrl)
#include "tst_wpactrl.moc"
```

Append to `gobi-ui/files/tests/CMakeLists.txt`:
```cmake

add_executable(tst_wpactrl tst_wpactrl.cpp FakeWpa.h ../WpaCtrl.h ../WpaCtrl.cpp)
target_link_libraries(tst_wpactrl PRIVATE Qt6::Core Qt6::Test)
target_compile_options(tst_wpactrl PRIVATE -Wall -Wextra)
add_test(NAME tst_wpactrl COMMAND tst_wpactrl)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cmake -S . -B /tmp/gobi-ui-tests -DCMAKE_PREFIX_PATH=/opt/homebrew/opt/qt` (from `gobi-ui/files/tests`)
Expected: "Cannot find source file: ../WpaCtrl.h".

- [ ] **Step 3: Implement**

`gobi-ui/files/WpaCtrl.h`:
```cpp
#pragma once

#include <QByteArray>
#include <QObject>
#include <QQueue>
#include <QTimer>
#include <functional>

class QSocketNotifier;

/* Minimal, non-blocking client for wpa_supplicant's control interface (the
 * protocol wpa_cli speaks): one Unix datagram socket for request/reply, one
 * ATTACHed for unsolicited events. Requests are queued and sent one at a time;
 * each has a timeout. A timeout or send failure means wpa_supplicant is gone:
 * the client closes, fails every pending request and emits lost() — the owner
 * reopens later. */
class WpaCtrl : public QObject
{
    Q_OBJECT
public:
    using Reply = std::function<void(bool ok, const QByteArray &reply)>;

    explicit WpaCtrl(const QString &serverPath, QObject *parent = nullptr);
    ~WpaCtrl() override;

    bool open();
    void close();
    bool isOpen() const { return m_cmdFd >= 0; }
    void request(const QByteArray &cmd, Reply cb);
    void setTimeoutMs(int ms) { m_timeoutMs = ms; }

signals:
    void event(const QByteArray &line);
    void lost();

private:
    struct Pending { QByteArray cmd; Reply cb; };
    int openSocket(const QByteArray &localPath);
    void sendHead();
    void onCmdReadable();
    void onMonReadable();
    void fail();

    QByteArray m_server;
    QByteArray m_cmdLocal, m_monLocal;
    int m_cmdFd = -1, m_monFd = -1;
    QSocketNotifier *m_cmdN = nullptr, *m_monN = nullptr;
    QQueue<Pending> m_queue;
    bool m_inFlight = false;
    QTimer m_timer;
    int m_timeoutMs = 2000;
};
```

`gobi-ui/files/WpaCtrl.cpp`:
```cpp
#include "WpaCtrl.h"

#include <QDir>
#include <QSocketNotifier>
#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

static int s_counter = 0;

WpaCtrl::WpaCtrl(const QString &serverPath, QObject *parent)
    : QObject(parent), m_server(serverPath.toLocal8Bit())
{
    m_timer.setSingleShot(true);
    connect(&m_timer, &QTimer::timeout, this, &WpaCtrl::fail);
}

WpaCtrl::~WpaCtrl() { close(); }

int WpaCtrl::openSocket(const QByteArray &local)
{
    const int fd = ::socket(AF_UNIX, SOCK_DGRAM, 0);
    if (fd < 0) return -1;
    ::fcntl(fd, F_SETFD, FD_CLOEXEC);
    ::fcntl(fd, F_SETFL, O_NONBLOCK);
    sockaddr_un la{}; la.sun_family = AF_UNIX;
    std::strncpy(la.sun_path, local.constData(), sizeof(la.sun_path) - 1);
    ::unlink(local.constData());
    sockaddr_un ra{}; ra.sun_family = AF_UNIX;
    std::strncpy(ra.sun_path, m_server.constData(), sizeof(ra.sun_path) - 1);
    if (::bind(fd, reinterpret_cast<sockaddr *>(&la), sizeof(la)) < 0
        || ::connect(fd, reinterpret_cast<sockaddr *>(&ra), sizeof(ra)) < 0) {
        ::close(fd);
        ::unlink(local.constData());
        return -1;
    }
    return fd;
}

bool WpaCtrl::open()
{
    close();
    const QByteArray base = QDir::tempPath().toLocal8Bit() + "/gobi-wpa-"
                          + QByteArray::number(::getpid()) + "-" + QByteArray::number(s_counter++);
    m_cmdLocal = base + "-c";
    m_monLocal = base + "-m";
    m_cmdFd = openSocket(m_cmdLocal);
    m_monFd = m_cmdFd >= 0 ? openSocket(m_monLocal) : -1;
    if (m_cmdFd < 0 || m_monFd < 0) { close(); return false; }

    m_cmdN = new QSocketNotifier(m_cmdFd, QSocketNotifier::Read, this);
    connect(m_cmdN, &QSocketNotifier::activated, this, &WpaCtrl::onCmdReadable);
    m_monN = new QSocketNotifier(m_monFd, QSocketNotifier::Read, this);
    connect(m_monN, &QSocketNotifier::activated, this, &WpaCtrl::onMonReadable);

    if (::send(m_monFd, "ATTACH", 6, 0) < 0) { close(); return false; }
    return true;
}

void WpaCtrl::close()
{
    m_timer.stop();
    m_inFlight = false;
    delete m_cmdN; m_cmdN = nullptr;
    delete m_monN; m_monN = nullptr;
    if (m_cmdFd >= 0) { ::close(m_cmdFd); m_cmdFd = -1; ::unlink(m_cmdLocal.constData()); }
    if (m_monFd >= 0) { ::close(m_monFd); m_monFd = -1; ::unlink(m_monLocal.constData()); }
    // Fail whatever was queued (callbacks may enqueue more; those fail too).
    QQueue<Pending> pending;
    pending.swap(m_queue);
    for (const Pending &p : pending) p.cb(false, QByteArray());
}

void WpaCtrl::request(const QByteArray &cmd, Reply cb)
{
    if (!isOpen()) {
        QTimer::singleShot(0, this, [cb] { cb(false, QByteArray()); });
        return;
    }
    m_queue.enqueue({cmd, std::move(cb)});
    if (!m_inFlight) sendHead();
}

void WpaCtrl::sendHead()
{
    if (m_queue.isEmpty() || !isOpen()) return;
    const QByteArray &cmd = m_queue.head().cmd;
    if (::send(m_cmdFd, cmd.constData(), size_t(cmd.size()), 0) < 0) {
        QTimer::singleShot(0, this, &WpaCtrl::fail);
        return;
    }
    m_inFlight = true;
    m_timer.start(m_timeoutMs);
}

void WpaCtrl::onCmdReadable()
{
    char buf[16384];
    const ssize_t n = ::recv(m_cmdFd, buf, sizeof(buf), 0);
    if (n < 0) { if (errno != EAGAIN && errno != EWOULDBLOCK) fail(); return; }
    if (!m_inFlight || m_queue.isEmpty()) return;
    m_timer.stop();
    m_inFlight = false;
    const Pending p = m_queue.dequeue();
    p.cb(true, QByteArray(buf, int(n)));
    if (!m_inFlight) sendHead();
}

void WpaCtrl::onMonReadable()
{
    char buf[4096];
    const ssize_t n = ::recv(m_monFd, buf, sizeof(buf), 0);
    if (n <= 0) return;
    QByteArray msg(buf, int(n));
    if (!msg.startsWith('<')) return;              // ATTACH's "OK"
    const int end = msg.indexOf('>');
    emit event(end > 0 ? msg.mid(end + 1) : msg);
}

void WpaCtrl::fail()
{
    const bool wasOpen = isOpen();
    close();
    if (wasOpen) emit lost();
}
```

Note for `serverGoneReportsLost`: after the fake server closes, `::send` on a connected Unix datagram socket fails with `ECONNREFUSED`/`ENOENT` → `fail()` → pending callback gets `false` and `lost()` fires.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cmake -S . -B /tmp/gobi-ui-tests -DCMAKE_PREFIX_PATH=/opt/homebrew/opt/qt && cmake --build /tmp/gobi-ui-tests && ctest --test-dir /tmp/gobi-ui-tests -R tst_wpactrl --output-on-failure`
Expected: `100% tests passed`.

- [ ] **Step 5: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-ui/files/WpaCtrl.* meta-ecofleet/recipes-ecofleet/gobi-ui/files/tests/FakeWpa.h meta-ecofleet/recipes-ecofleet/gobi-ui/files/tests/tst_wpactrl.cpp meta-ecofleet/recipes-ecofleet/gobi-ui/files/tests/CMakeLists.txt
git commit -m "feat(ui): WpaCtrl — non-blocking wpa_supplicant control client"
```

---

### Task 4: WifiModel — the state machine QML uses

**Files:**
- Create: `gobi-ui/files/WifiModel.h`, `gobi-ui/files/WifiModel.cpp`
- Create: `gobi-ui/files/tests/tst_wifimodel.cpp`
- Modify: `gobi-ui/files/tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `WpaCtrl` (Task 3), everything in `wpa::` (Task 2), `FakeWpa` (Task 3, tests).
- Produces `class WifiModel : public QObject`:
  - `explicit WifiModel(const QString &socketPath = QStringLiteral("/run/wpa_supplicant/wlan0"), QObject *parent = nullptr)`
  - `void start()`; `void setTimings(int retryMs, int pollMs, int joinTimeoutMs, int netCheckMs)`; `void setInternetCheck(const QString &program, const QStringList &args)`
  - Q_PROPERTYs (NOTIFY `changed`): `QString state` (`unavailable|idle|connecting|connected`), `bool scanning`, `QString ssid`, `int signalDbm`, `int signalBars`, `QString ip`, `QString internet` (`unknown|online|no_internet|portal`), `QVariantList networks`, `QVariantList saved` (`{id, ssid, inUse}`), `QString lastError`, `QString pendingSsid`
  - Q_INVOKABLE: `scan()`, `join(QString ssid, QString password)`, `joinSaved(int id)`, `forget(int id)`, `addHidden(QString ssid, bool secured, QString password)`, `clearError()`
  - signals: `changed()`, `joined(QString ssid)`, `joinFailed(QString ssid, QString error)`

- [ ] **Step 1: Write the failing test**

`gobi-ui/files/tests/tst_wifimodel.cpp`:
```cpp
// Host tests for WifiModel against FakeWpa: status/scan refresh, join success
// and failure paths, forgetting, and losing wpa_supplicant.
#include <QtTest>
#include <QSignalSpy>
#include <QTemporaryDir>
#include "FakeWpa.h"
#include "../WifiModel.h"

static const QByteArray kScan =
    "bssid / frequency / signal level / flags / ssid\n"
    "0c:ea:14:23:2d:43\t5240\t-47\t[WPA2-PSK-CCMP][ESS]\tYard\n"
    "11:22:33:44:55:66\t2412\t-70\t[WPA2-PSK-CCMP][ESS]\tShop\n"
    "22:22:33:44:55:66\t2412\t-60\t[ESS]\tFree\n";

/* A small scriptable wpa_supplicant: tracks networks so ADD/REMOVE/LIST agree. */
struct Script {
    QString state = "DISCONNECTED";
    QString ssid;
    QMap<int, QString> nets;     // id -> ssid
    int nextId = 0;
    int current = -1;
    QByteArray operator()(const QByteArray &c)
    {
        if (c == "STATUS") {
            QByteArray r = "wpa_state=" + state.toLatin1() + "\n";
            if (state == "COMPLETED") r += "ssid=" + ssid.toUtf8() + "\nid=" + QByteArray::number(current) + "\nip_address=192.168.0.206\n";
            return r;
        }
        if (c == "LIST_NETWORKS") {
            QByteArray r = "network id / ssid / bssid / flags\n";
            for (auto it = nets.begin(); it != nets.end(); ++it)
                r += QByteArray::number(it.key()) + "\t" + it.value().toUtf8() + "\tany\t"
                   + (it.key() == current ? "[CURRENT]" : "") + "\n";
            return r;
        }
        if (c == "SCAN_RESULTS") return kScan;
        if (c == "SIGNAL_POLL") return "RSSI=-47\nLINKSPEED=600\n";
        if (c == "ADD_NETWORK") { nets.insert(nextId, QString()); return QByteArray::number(nextId++) + "\n"; }
        if (c.startsWith("SET_NETWORK ")) {
            const QList<QByteArray> p = c.split(' ');
            if (p.size() >= 4 && p[2] == "ssid") nets[p[1].toInt()] = QString::fromUtf8(QByteArray::fromHex(p[3]));
            return "OK\n";
        }
        if (c.startsWith("REMOVE_NETWORK ")) { nets.remove(c.mid(15).toInt()); return "OK\n"; }
        return "OK\n";
    }
};

class TestWifiModel : public QObject
{
    Q_OBJECT
    QTemporaryDir m_dir;
    QString path() const { return m_dir.path() + "/wlan0"; }

    static void fast(WifiModel &m) { m.setTimings(100, 60000, 500, 60000); m.setInternetCheck("sh", {"-c", "printf 204"}); }
    static int count(const FakeWpa &f, const QByteArray &prefix)
    { int n = 0; for (const auto &c : f.commands) if (c.startsWith(prefix)) ++n; return n; }

private slots:
    void unavailableWithoutServer()
    {
        WifiModel m(m_dir.path() + "/missing");
        fast(m);
        m.start();
        QCOMPARE(m.state(), QStringLiteral("unavailable"));
    }

    void refreshShowsConnectedNetwork()
    {
        FakeWpa f(path()); Script s; s.nets = {{0, "Yard"}}; s.nextId = 1; s.current = 0;
        s.state = "COMPLETED"; s.ssid = "Yard";
        f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QTRY_COMPARE(m.state(), QStringLiteral("connected"));
        QTRY_COMPARE(m.ssid(), QStringLiteral("Yard"));
        QTRY_COMPARE(m.ip(), QStringLiteral("192.168.0.206"));
        QTRY_COMPARE(m.signalBars(), 4);
        QTRY_COMPARE(m.networks().size(), 3);
        QCOMPARE(m.networks()[0].toMap()["ssid"].toString(), QStringLiteral("Yard"));
        QVERIFY(m.networks()[0].toMap()["inUse"].toBool());
        QTRY_COMPARE(m.internet(), QStringLiteral("online"));
        QCOMPARE(m.saved().size(), 1);
    }

    void joinSendsHexSsidAndPsk()
    {
        FakeWpa f(path()); Script s; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QTRY_COMPARE(m.networks().size(), 3);
        m.join("Shop", "password1");
        QTRY_VERIFY(f.commands.contains("SELECT_NETWORK 0"));
        QVERIFY(f.commands.contains("SET_NETWORK 0 ssid " + QByteArray("Shop").toHex()));
        QVERIFY(f.commands.contains("SET_NETWORK 0 psk " + wpa::pskHex("password1", "Shop")));
        QVERIFY(f.commands.contains("SET_NETWORK 0 key_mgmt WPA-PSK"));
        for (const auto &c : f.commands) QVERIFY(!c.contains("password1"));   // never sent in plaintext
        QCOMPARE(m.state(), QStringLiteral("connecting"));
        QCOMPARE(m.pendingSsid(), QStringLiteral("Shop"));
    }

    void joinSuccessSaves()
    {
        FakeWpa f(path()); Script s; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QSignalSpy ok(&m, &WifiModel::joined);
        QTRY_COMPARE(m.networks().size(), 3);
        m.join("Shop", "password1");
        QTRY_VERIFY(f.commands.contains("SELECT_NETWORK 0"));
        s.state = "COMPLETED"; s.ssid = "Shop"; s.current = 0;
        f.sendEvent("CTRL-EVENT-CONNECTED - Connection to 11:22:33:44:55:66 completed [id=0 id_str=]");
        QTRY_COMPARE(ok.count(), 1);
        QTRY_VERIFY(f.commands.contains("SAVE_CONFIG"));
        QVERIFY(f.commands.contains("ENABLE_NETWORK all"));
        QTRY_COMPARE(m.state(), QStringLiteral("connected"));
        QCOMPARE(m.lastError(), QString());
    }

    void wrongPasswordRemovesAndDoesNotSave()
    {
        FakeWpa f(path()); Script s; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QSignalSpy bad(&m, &WifiModel::joinFailed);
        QTRY_COMPARE(m.networks().size(), 3);
        m.join("Shop", "wrongpass");
        QTRY_VERIFY(f.commands.contains("SELECT_NETWORK 0"));
        f.sendEvent("CTRL-EVENT-SSID-TEMP-DISABLED id=0 ssid=\"Shop\" auth_failures=1 duration=10 reason=WRONG_KEY");
        QTRY_COMPARE(bad.count(), 1);
        QCOMPARE(bad[0][1].toString(), QStringLiteral("Wrong password."));
        QTRY_VERIFY(f.commands.contains("REMOVE_NETWORK 0"));
        QVERIFY(f.commands.contains("ENABLE_NETWORK all"));
        QVERIFY(!f.commands.contains("SAVE_CONFIG"));
        QCOMPARE(m.lastError(), QStringLiteral("Wrong password."));
    }

    void timeoutFails()
    {
        FakeWpa f(path()); Script s; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QSignalSpy bad(&m, &WifiModel::joinFailed);
        QTRY_COMPARE(m.networks().size(), 3);
        m.join("Free", "");
        QTRY_COMPARE(bad.count(), 1);   // joinTimeoutMs = 500 in fast()
        QCOMPARE(bad[0][1].toString(), QStringLiteral("Couldn't connect to Free."));
        QVERIFY(f.commands.contains("SET_NETWORK 0 key_mgmt NONE"));
        QTRY_VERIFY(f.commands.contains("REMOVE_NETWORK 0"));
    }

    void outOfRangeAndValidation()
    {
        FakeWpa f(path()); Script s; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QTRY_COMPARE(m.networks().size(), 3);
        m.join("Gone", "password1");
        QCOMPARE(m.lastError(), QStringLiteral("Gone is out of range."));
        m.join("Shop", "short");
        QCOMPARE(m.lastError(), QStringLiteral("Password must be at least 8 characters."));
        QCOMPARE(count(f, "ADD_NETWORK"), 0);
    }

    void secondJoinIgnoredWhilePending()
    {
        FakeWpa f(path()); Script s; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QTRY_COMPARE(m.networks().size(), 3);
        m.join("Shop", "password1");
        m.join("Shop", "password1");
        QTRY_VERIFY(f.commands.contains("SELECT_NETWORK 0"));
        QCOMPARE(count(f, "ADD_NETWORK"), 1);
    }

    void rejoinReplacesOldEntry()
    {
        FakeWpa f(path()); Script s; s.nets = {{0, "Shop"}}; s.nextId = 1; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QTRY_COMPARE(m.saved().size(), 1);
        m.join("Shop", "newpassword");   // password changed: add as new
        QTRY_VERIFY(f.commands.contains("SELECT_NETWORK 1"));
        s.state = "COMPLETED"; s.ssid = "Shop"; s.current = 1;
        f.sendEvent("CTRL-EVENT-CONNECTED - Connection to 11:22:33:44:55:66 completed [id=1 id_str=]");
        QTRY_VERIFY(f.commands.contains("REMOVE_NETWORK 0"));
        QTRY_VERIFY(f.commands.contains("SAVE_CONFIG"));
        QTRY_COMPARE(m.saved().size(), 1);
    }

    void joinSavedSelectsWithoutAdding()
    {
        FakeWpa f(path()); Script s; s.nets = {{0, "Shop"}}; s.nextId = 1; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QTRY_COMPARE(m.saved().size(), 1);
        m.joinSaved(0);
        QTRY_VERIFY(f.commands.contains("SELECT_NETWORK 0"));
        QCOMPARE(count(f, "ADD_NETWORK"), 0);
    }

    void forgetRemovesAndSaves()
    {
        FakeWpa f(path()); Script s; s.nets = {{0, "Shop"}}; s.nextId = 1; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QTRY_COMPARE(m.saved().size(), 1);
        m.forget(0);
        QTRY_VERIFY(f.commands.contains("SAVE_CONFIG"));
        QVERIFY(f.commands.contains("REMOVE_NETWORK 0"));
        QTRY_COMPARE(m.saved().size(), 0);
    }

    void addHiddenSetsScanSsid()
    {
        FakeWpa f(path()); Script s; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QTRY_COMPARE(m.networks().size(), 3);
        m.addHidden("Secret", true, "password1");   // not in scan: allowed for hidden
        QTRY_VERIFY(f.commands.contains("SELECT_NETWORK 0"));
        QVERIFY(f.commands.contains("SET_NETWORK 0 scan_ssid 1"));
    }

    void portalAndNoInternet()
    {
        FakeWpa f(path()); Script s; s.nets = {{0, "Yard"}}; s.nextId = 1; s.current = 0;
        s.state = "COMPLETED"; s.ssid = "Yard"; f.handler = std::ref(s);
        WifiModel m(path()); m.setTimings(100, 60000, 500, 60000);
        m.setInternetCheck("sh", {"-c", "printf 302"});
        m.start();
        QTRY_COMPARE(m.internet(), QStringLiteral("portal"));

        WifiModel n(path()); n.setTimings(100, 60000, 500, 60000);
        n.setInternetCheck("sh", {"-c", "printf 000; exit 6"});
        n.start();
        QTRY_COMPARE(n.internet(), QStringLiteral("no_internet"));
    }

    void serverLossFailsJoinAndRecovers()
    {
        auto *f = new FakeWpa(path()); Script s; f->handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QSignalSpy bad(&m, &WifiModel::joinFailed);
        QTRY_COMPARE(m.networks().size(), 3);
        m.join("Shop", "password1");
        QTRY_VERIFY(f->commands.contains("SELECT_NETWORK 0"));
        delete f;                                   // wpa_supplicant goes away
        m.scan();                                   // next request notices
        QTRY_COMPARE(m.state(), QStringLiteral("unavailable"));
        QTRY_COMPARE(bad.count(), 1);
        FakeWpa back(path()); Script s2; back.handler = std::ref(s2);
        QTRY_COMPARE(m.state(), QStringLiteral("idle"));   // retry every 100 ms
    }
};

QTEST_GUILESS_MAIN(TestWifiModel)
#include "tst_wifimodel.moc"
```

Append to `gobi-ui/files/tests/CMakeLists.txt`:
```cmake

add_executable(tst_wifimodel tst_wifimodel.cpp FakeWpa.h
    ../WifiModel.h ../WifiModel.cpp ../WpaCtrl.h ../WpaCtrl.cpp ../WpaParse.h ../WpaParse.cpp)
target_link_libraries(tst_wifimodel PRIVATE Qt6::Core Qt6::Network Qt6::Test)
target_compile_options(tst_wifimodel PRIVATE -Wall -Wextra)
add_test(NAME tst_wifimodel COMMAND tst_wifimodel)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cmake -S . -B /tmp/gobi-ui-tests -DCMAKE_PREFIX_PATH=/opt/homebrew/opt/qt` (from `gobi-ui/files/tests`)
Expected: "Cannot find source file: ../WifiModel.h".

- [ ] **Step 3: Implement**

`gobi-ui/files/WifiModel.h`:
```cpp
#pragma once

#include <QObject>
#include <QProcess>
#include <QStringList>
#include <QTimer>
#include <QVariantList>
#include <functional>

#include "WpaCtrl.h"
#include "WpaParse.h"

/* The WiFi screen's model: talks to wpa_supplicant (WpaCtrl), keeps status,
 * signal, the merged network list and saved networks current, runs joins
 * (a network is saved only after it connects; a wrong password or timeout
 * removes it again), and checks whether the connection reaches the internet.
 * Everything is asynchronous; nothing here blocks the UI thread. */
class WifiModel : public QObject
{
    Q_OBJECT
    Q_PROPERTY(QString state READ state NOTIFY changed)
    Q_PROPERTY(bool scanning READ scanning NOTIFY changed)
    Q_PROPERTY(QString ssid READ ssid NOTIFY changed)
    Q_PROPERTY(int signalDbm READ signalDbm NOTIFY changed)
    Q_PROPERTY(int signalBars READ signalBars NOTIFY changed)
    Q_PROPERTY(QString ip READ ip NOTIFY changed)
    Q_PROPERTY(QString internet READ internet NOTIFY changed)
    Q_PROPERTY(QVariantList networks READ networks NOTIFY changed)
    Q_PROPERTY(QVariantList saved READ saved NOTIFY changed)
    Q_PROPERTY(QString lastError READ lastError NOTIFY changed)
    Q_PROPERTY(QString pendingSsid READ pendingSsid NOTIFY changed)

public:
    explicit WifiModel(const QString &socketPath = QStringLiteral("/run/wpa_supplicant/wlan0"),
                       QObject *parent = nullptr);

    void start();
    void setTimings(int retryMs, int pollMs, int joinTimeoutMs, int netCheckMs);
    void setInternetCheck(const QString &program, const QStringList &args);

    QString state() const;
    bool scanning() const { return m_scanning; }
    QString ssid() const { return m_connected ? m_ssid : QString(); }
    int signalDbm() const { return m_connected ? m_rssi : 0; }
    int signalBars() const { return m_connected ? wpa::signalBars(m_rssi) : 0; }
    QString ip() const { return m_connected ? m_ip : QString(); }
    QString internet() const { return wpa::internetName(m_internet); }
    QVariantList networks() const { return m_networks; }
    QVariantList saved() const;
    QString lastError() const { return m_lastError; }
    QString pendingSsid() const { return m_pending.active ? m_pending.ssid : QString(); }

    Q_INVOKABLE void scan();
    Q_INVOKABLE void join(const QString &ssid, const QString &password);
    Q_INVOKABLE void joinSaved(int id);
    Q_INVOKABLE void forget(int id);
    Q_INVOKABLE void addHidden(const QString &ssid, bool secured, const QString &password);
    Q_INVOKABLE void clearError();

signals:
    void changed();
    void joined(const QString &ssid);
    void joinFailed(const QString &ssid, const QString &error);

private:
    struct Pending { bool active = false; int id = -1; QString ssid; bool isNew = false; };

    void tryOpen();
    void onLost();
    void onEvent(const QByteArray &line);
    void refresh();
    void rebuild();
    void runSequence(const QList<QByteArray> &cmds, std::function<void(bool)> done);
    void beginJoin(const QString &ssid, const QString &password, bool hidden);
    void finishJoin(bool ok, const QString &error);
    void runInternetCheck();
    bool inScan(const QString &ssid) const;
    void setError(const QString &e);

    WpaCtrl m_ctrl;
    QTimer m_retry, m_poll, m_joinTimer, m_netCheck;
    QProcess m_check;
    QString m_checkProgram = QStringLiteral("curl");
    QStringList m_checkArgs = {
        QStringLiteral("-s"), QStringLiteral("-o"), QStringLiteral("/dev/null"),
        QStringLiteral("-w"), QStringLiteral("%{http_code}"),
        QStringLiteral("--interface"), QStringLiteral("wlan0"),
        QStringLiteral("--max-time"), QStringLiteral("8"),
        QStringLiteral("http://connectivitycheck.gstatic.com/generate_204") };

    bool m_open = false;
    bool m_connected = false;
    QString m_wpaState;
    bool m_scanning = false;
    QString m_ssid, m_ip;
    int m_rssi = 0;
    wpa::Internet m_internet = wpa::Internet::Unknown;
    QList<wpa::ScanEntry> m_scan;
    QList<wpa::SavedNet> m_saved;
    QVariantList m_networks;
    QString m_lastError;
    Pending m_pending;
};
```

`gobi-ui/files/WifiModel.cpp`:
```cpp
#include "WifiModel.h"

#include <QVariantMap>

WifiModel::WifiModel(const QString &socketPath, QObject *parent)
    : QObject(parent), m_ctrl(socketPath)
{
    m_retry.setInterval(5000);
    m_poll.setInterval(5000);
    m_joinTimer.setSingleShot(true);
    m_joinTimer.setInterval(30000);
    m_netCheck.setInterval(120000);

    connect(&m_retry, &QTimer::timeout, this, &WifiModel::tryOpen);
    connect(&m_poll, &QTimer::timeout, this, &WifiModel::refresh);
    connect(&m_netCheck, &QTimer::timeout, this, &WifiModel::runInternetCheck);
    connect(&m_joinTimer, &QTimer::timeout, this, [this] {
        finishJoin(false, QStringLiteral("Couldn't connect to %1.").arg(m_pending.ssid));
    });
    connect(&m_ctrl, &WpaCtrl::event, this, &WifiModel::onEvent);
    connect(&m_ctrl, &WpaCtrl::lost, this, &WifiModel::onLost);
    connect(&m_check, &QProcess::finished, this, [this](int exitCode, QProcess::ExitStatus st) {
        const QByteArray code = m_check.readAllStandardOutput();
        m_internet = m_connected
            ? wpa::classifyCheck(st == QProcess::NormalExit ? exitCode : -1, code)
            : wpa::Internet::Unknown;
        emit changed();
    });
}

void WifiModel::setTimings(int retryMs, int pollMs, int joinTimeoutMs, int netCheckMs)
{
    m_retry.setInterval(retryMs);
    m_poll.setInterval(pollMs);
    m_joinTimer.setInterval(joinTimeoutMs);
    m_netCheck.setInterval(netCheckMs);
}

void WifiModel::setInternetCheck(const QString &program, const QStringList &args)
{
    m_checkProgram = program;
    m_checkArgs = args;
}

void WifiModel::start() { tryOpen(); }

QString WifiModel::state() const
{
    if (!m_open) return QStringLiteral("unavailable");
    if (m_pending.active) return QStringLiteral("connecting");
    if (m_connected) return QStringLiteral("connected");
    static const QStringList busy = { "ASSOCIATING", "ASSOCIATED", "AUTHENTICATING",
                                      "4WAY_HANDSHAKE", "GROUP_HANDSHAKE" };
    if (busy.contains(m_wpaState)) return QStringLiteral("connecting");
    return QStringLiteral("idle");
}

QVariantList WifiModel::saved() const
{
    QVariantList out;
    for (const wpa::SavedNet &s : m_saved) {
        QVariantMap m;
        m["id"] = s.id;
        m["ssid"] = s.ssid;
        m["inUse"] = m_connected && s.ssid == m_ssid;
        out << m;
    }
    return out;
}

void WifiModel::tryOpen()
{
    if (m_ctrl.open()) {
        m_open = true;
        m_retry.stop();
        m_poll.start();
        m_netCheck.start();
        emit changed();
        refresh();
        scan();
    } else {
        m_open = false;
        if (!m_retry.isActive()) m_retry.start();
        emit changed();
    }
}

void WifiModel::onLost()
{
    const bool hadJoin = m_pending.active;
    const QString joinSsid = m_pending.ssid;
    m_pending = Pending();
    m_joinTimer.stop();
    m_open = false;
    m_connected = false;
    m_scanning = false;
    m_internet = wpa::Internet::Unknown;
    m_poll.stop();
    m_netCheck.stop();
    m_retry.start();
    if (hadJoin) {
        setError(QStringLiteral("WiFi unavailable"));
        emit joinFailed(joinSsid, m_lastError);
    }
    emit changed();
}

void WifiModel::refresh()
{
    m_ctrl.request("STATUS", [this](bool ok, const QByteArray &r) {
        if (!ok) return;
        const auto kv = wpa::parseKeyValues(r);
        const bool wasConnected = m_connected;
        m_wpaState = kv.value("wpa_state");
        m_connected = m_wpaState == QLatin1String("COMPLETED");
        m_ssid = kv.value("ssid");
        m_ip = kv.value("ip_address");
        if (!m_connected) m_internet = wpa::Internet::Unknown;
        if (m_connected && !wasConnected) runInternetCheck();
        rebuild();
    });
    m_ctrl.request("LIST_NETWORKS", [this](bool ok, const QByteArray &r) {
        if (!ok) return;
        m_saved = wpa::parseListNetworks(r);
        rebuild();
    });
    m_ctrl.request("SIGNAL_POLL", [this](bool ok, const QByteArray &r) {
        if (!ok) return;
        const auto kv = wpa::parseKeyValues(r);
        if (kv.contains("RSSI")) m_rssi = kv.value("RSSI").toInt();
        rebuild();
    });
}

void WifiModel::rebuild()
{
    m_networks = wpa::buildNetworkList(m_scan, m_saved, m_connected ? m_ssid : QString());
    emit changed();
}

void WifiModel::scan()
{
    m_scanning = true;
    emit changed();
    m_ctrl.request("SCAN", [this](bool ok, const QByteArray &) {
        if (!ok) { m_scanning = false; emit changed(); return; }
        // Results arrive with CTRL-EVENT-SCAN-RESULTS; also read what's cached now.
        m_ctrl.request("SCAN_RESULTS", [this](bool ok2, const QByteArray &r) {
            if (ok2) m_scan = wpa::parseScanResults(r);
            rebuild();
        });
    });
}

void WifiModel::onEvent(const QByteArray &line)
{
    const wpa::Event e = wpa::parseEvent(line);
    switch (e.type) {
    case wpa::Event::ScanResults:
        m_ctrl.request("SCAN_RESULTS", [this](bool ok, const QByteArray &r) {
            if (ok) m_scan = wpa::parseScanResults(r);
            m_scanning = false;
            rebuild();
        });
        break;
    case wpa::Event::Connected:
        if (m_pending.active && (e.id < 0 || e.id == m_pending.id)) finishJoin(true, QString());
        else refresh();
        break;
    case wpa::Event::WrongKey:
        if (m_pending.active && e.id == m_pending.id) finishJoin(false, QStringLiteral("Wrong password."));
        break;
    case wpa::Event::Disconnected:
        refresh();
        break;
    default:
        break;
    }
}

void WifiModel::runSequence(const QList<QByteArray> &cmds, std::function<void(bool)> done)
{
    if (cmds.isEmpty()) { done(true); return; }
    const QByteArray head = cmds.first();
    const QList<QByteArray> rest = cmds.mid(1);
    m_ctrl.request(head, [this, rest, done](bool ok, const QByteArray &r) {
        if (!ok || r.startsWith("FAIL")) { done(false); return; }
        runSequence(rest, done);
    });
}

bool WifiModel::inScan(const QString &ssid) const
{
    for (const wpa::ScanEntry &e : m_scan)
        if (e.ssid == ssid) return true;
    return false;
}

void WifiModel::setError(const QString &e)
{
    m_lastError = e;
    emit changed();
}

void WifiModel::clearError() { setError(QString()); }

void WifiModel::join(const QString &ssid, const QString &password)
{
    if (m_pending.active) return;
    QString err = wpa::validateSsid(ssid);
    if (err.isEmpty() && !password.isEmpty()) err = wpa::validatePassword(password);
    if (err.isEmpty() && !inScan(ssid)) err = QStringLiteral("%1 is out of range.").arg(ssid);
    if (!err.isEmpty()) { setError(err); return; }
    beginJoin(ssid, password, false);
}

void WifiModel::addHidden(const QString &ssid, bool secured, const QString &password)
{
    if (m_pending.active) return;
    QString err = wpa::validateSsid(ssid);
    if (err.isEmpty() && secured) err = wpa::validatePassword(password);
    if (!err.isEmpty()) { setError(err); return; }
    beginJoin(ssid, secured ? password : QString(), true);
}

void WifiModel::beginJoin(const QString &ssid, const QString &password, bool hidden)
{
    m_lastError.clear();
    m_pending = { true, -1, ssid, true };
    emit changed();
    m_ctrl.request("ADD_NETWORK", [this, ssid, password, hidden](bool ok, const QByteArray &r) {
        bool isNum = false;
        const int id = r.trimmed().toInt(&isNum);
        if (!ok || !isNum) { finishJoin(false, QStringLiteral("Couldn't connect to %1.").arg(ssid)); return; }
        m_pending.id = id;
        const QByteArray sid = QByteArray::number(id);
        QList<QByteArray> cmds = { "SET_NETWORK " + sid + " ssid " + wpa::ssidHex(ssid) };
        if (password.isEmpty()) {
            cmds << "SET_NETWORK " + sid + " key_mgmt NONE";
        } else {
            cmds << "SET_NETWORK " + sid + " psk " + wpa::pskHex(password, ssid)
                 << "SET_NETWORK " + sid + " key_mgmt WPA-PSK";
        }
        if (hidden) cmds << "SET_NETWORK " + sid + " scan_ssid 1";
        cmds << "SELECT_NETWORK " + sid;
        runSequence(cmds, [this, ssid](bool okSeq) {
            if (!okSeq) { finishJoin(false, QStringLiteral("Couldn't connect to %1.").arg(ssid)); return; }
            m_joinTimer.start();
        });
    });
}

void WifiModel::joinSaved(int id)
{
    if (m_pending.active) return;
    QString ssid;
    for (const wpa::SavedNet &s : m_saved)
        if (s.id == id) ssid = s.ssid;
    if (ssid.isEmpty()) return;
    if (!inScan(ssid)) { setError(QStringLiteral("%1 is out of range.").arg(ssid)); return; }
    m_lastError.clear();
    m_pending = { true, id, ssid, false };
    emit changed();
    runSequence({ "SELECT_NETWORK " + QByteArray::number(id) }, [this, ssid](bool ok) {
        if (!ok) { finishJoin(false, QStringLiteral("Couldn't connect to %1.").arg(ssid)); return; }
        m_joinTimer.start();
    });
}

void WifiModel::finishJoin(bool ok, const QString &error)
{
    if (!m_pending.active) return;
    m_joinTimer.stop();
    const Pending p = m_pending;
    m_pending = Pending();

    QList<QByteArray> cmds;
    if (ok) {
        cmds << "ENABLE_NETWORK all";
        if (p.isNew) {
            for (const wpa::SavedNet &s : m_saved)          // replace an older entry for this SSID
                if (s.ssid == p.ssid && s.id != p.id) cmds << "REMOVE_NETWORK " + QByteArray::number(s.id);
            cmds << "SAVE_CONFIG";
        }
    } else {
        if (p.isNew && p.id >= 0) cmds << "REMOVE_NETWORK " + QByteArray::number(p.id);
        cmds << "ENABLE_NETWORK all";
    }
    runSequence(cmds, [this](bool) { refresh(); });

    if (ok) {
        m_lastError.clear();
        emit joined(p.ssid);
    } else {
        m_lastError = error;
        emit joinFailed(p.ssid, error);
    }
    emit changed();
}

void WifiModel::forget(int id)
{
    runSequence({ "REMOVE_NETWORK " + QByteArray::number(id), "SAVE_CONFIG" },
                [this](bool) { refresh(); });
}

void WifiModel::runInternetCheck()
{
    if (!m_connected || m_check.state() != QProcess::NotRunning) return;
    m_check.start(m_checkProgram, m_checkArgs);
}
```

Note: `finishJoin` ignores `runSequence` failures on cleanup (the next `refresh()` shows the true state).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cmake -S . -B /tmp/gobi-ui-tests -DCMAKE_PREFIX_PATH=/opt/homebrew/opt/qt && cmake --build /tmp/gobi-ui-tests && ctest --test-dir /tmp/gobi-ui-tests -R "tst_wifimodel|tst_wpa" --output-on-failure`
Expected: all three suites pass. If `serverLossFailsJoinAndRecovers` is flaky, check that `WpaCtrl::fail()` fires from the failed `send()` (it is deferred with `QTimer::singleShot(0, …)`).

- [ ] **Step 5: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-ui/files/WifiModel.* meta-ecofleet/recipes-ecofleet/gobi-ui/files/tests/tst_wifimodel.cpp meta-ecofleet/recipes-ecofleet/gobi-ui/files/tests/CMakeLists.txt
git commit -m "feat(ui): WifiModel — scan, join, forget, internet check over wpa_supplicant"
```

---

### Task 5: Wire WifiModel into the app, build and recipe

**Files:**
- Modify: `gobi-ui/files/main.cpp`
- Modify: `gobi-ui/files/CMakeLists.txt`
- Modify: `gobi-ui/gobi-ui_1.0.bb`
- Modify: `gobi-ui/files/qml/preview/Mocks.qml`
- Modify: `gobi-ui/files/qml/preview/runner/main.cpp`

**Interfaces:**
- Consumes: `WifiModel` (Task 4).
- Produces: QML context property `wifi` (real on device, mock in previews) with the Task 4 property/method names.

- [ ] **Step 1: App wiring**

`gobi-ui/files/main.cpp`: add `#include "WifiModel.h"` after `#include "DisplayModel.h"`; after the `DisplayModel display(...)` line add:
```cpp
    WifiModel       wifi;
    wifi.start();
```
and after the `display` context property line:
```cpp
    engine.rootContext()->setContextProperty(QStringLiteral("wifi"),      &wifi);
```

`gobi-ui/files/CMakeLists.txt`: add to `qt_add_executable` sources after `UpdateNotice.cpp`:
```
    WpaParse.h
    WpaParse.cpp
    WpaCtrl.h
    WpaCtrl.cpp
    WifiModel.h
    WifiModel.cpp
```

`gobi-ui/gobi-ui_1.0.bb`: bump `PR` by one; add after `file://UpdateNotice.cpp \`:
```
    file://WpaParse.h \
    file://WpaParse.cpp \
    file://WpaCtrl.h \
    file://WpaCtrl.cpp \
    file://WifiModel.h \
    file://WifiModel.cpp \
```
Also add `RDEPENDS:${PN} += "curl"` if no `RDEPENDS` line exists (curl is already in the image; this documents the runtime need).

- [ ] **Step 2: Preview mock**

In `gobi-ui/files/qml/preview/Mocks.qml` add a property before `devinfo`:
```qml
    // wifi mock — mirrors WifiModel (state unavailable|idle|connecting|connected)
    property QtObject wifi: QtObject {
        signal joined(string ssid)
        signal joinFailed(string ssid, string error)
        property string state: "connected";   property bool scanning: false
        property string ssid: "EcoFleet-Staff"; property int signalDbm: -47; property int signalBars: 4
        property string ip: "192.168.0.206";  property string internet: "online"
        property string lastError: "";        property string pendingSsid: ""
        property var networks: [
            { ssid: "EcoFleet-Staff", bars: 4, secured: true,  supported: true,  saved: true,  savedId: 0, inUse: true },
            { ssid: "Shop-Guest",     bars: 3, secured: true,  supported: true,  saved: true,  savedId: 1, inUse: false },
            { ssid: "Pilot-Travel-Center", bars: 2, secured: true, supported: true, saved: false, savedId: -1, inUse: false },
            { ssid: "FreeTruckStopWiFi",   bars: 1, secured: false, supported: true, saved: false, savedId: -1, inUse: false },
            { ssid: "Corp-Secure",    bars: 2, secured: true,  supported: false, saved: false, savedId: -1, inUse: false } ]
        property var saved: [ { id: 0, ssid: "EcoFleet-Staff", inUse: true }, { id: 1, ssid: "Shop-Guest", inUse: false } ]
        function scan() {}
        function join(s, p) {}
        function joinSaved(id) {}
        function forget(id) {}
        function addHidden(s, sec, p) {}
        function clearError() { lastError = "" }
    }
```
In `gobi-ui/files/qml/preview/runner/main.cpp`, everywhere the other mocks are set as context properties (both the window path and the harness path), add the same for `wifi`:
```cpp
        engine.rootContext()->setContextProperty("wifi", mocks->property("wifi").value<QObject*>());
```
(match the exact variable names used next to the existing `devinfo` line in each branch).

- [ ] **Step 3: Build the app on the host**

Run (from `gobi-ui/files`): `cmake -S . -B /tmp/gobi-ui-app -DCMAKE_PREFIX_PATH=/opt/homebrew/opt/qt && cmake --build /tmp/gobi-ui-app 2>&1 | grep -iE "error|warning:|Built target gobi-ui"`
Expected: `Built target gobi-ui`, no errors or warnings.

- [ ] **Step 4: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-ui
git commit -m "feat(ui): expose WifiModel to QML; preview mock"
```

---

### Task 6: Keyboard, signal bars, wifi glyph, header indicator

**Files:**
- Create: `gobi-ui/files/qml/atoms/TextKeyboard.qml`, `gobi-ui/files/qml/atoms/WifiBars.qml`
- Modify: `gobi-ui/files/qml/atoms/Icon.qml`, `gobi-ui/files/qml/Header.qml`, `gobi-ui/files/qml/AppShell.qml`
- Modify: `gobi-ui/gobi-ui_1.0.bb` (SRC_URI + install for the two atoms)

**Interfaces:**
- Consumes: `wifi.state`, `wifi.signalBars` (Task 5).
- Produces: `TextKeyboard { target: <TextField>; signal done() }`; `WifiBars { bars: int; active: bool; unit: real }`; `Header` signal `wifiTapped()` (AppShell connects it in Task 7, once `WifiScreen` exists).

- [ ] **Step 1: wifi glyph**

In `gobi-ui/files/qml/atoms/Icon.qml` `_paths`, add after `"cloud"`:
```qml
        "wifi":    "M5 12.55a11 11 0 0 1 14.08 0 M1.42 9a16 16 0 0 1 21.16 0 M8.53 16.11a6 6 0 0 1 6.95 0 M12 20h.01",
```

- [ ] **Step 2: Signal bars atom**

`gobi-ui/files/qml/atoms/WifiBars.qml`:
```qml
import QtQuick
import ".."
// Four rising bars; `bars` (0-4) are filled. Grey and unfilled when !active.
Row {
    id: wb
    property int bars: 0
    property bool active: true
    property color hue: Theme.accent
    property real unit: 4
    spacing: unit * 0.5
    Repeater { model: 4
        Rectangle {
            anchors.bottom: parent.bottom
            width: wb.unit; height: wb.unit * (index + 1.5); radius: 1
            color: wb.active && index < wb.bars ? wb.hue : Theme.border } }
}
```

- [ ] **Step 3: Keyboard atom**

`gobi-ui/files/qml/atoms/TextKeyboard.qml`:
```qml
import QtQuick
import QtQuick.Layouts
import ".."
// On-screen text keyboard for passwords and network names. Types into
// `target` (any item with text/cursorPosition, e.g. TextField). Letters page
// with Shift (one-shot; double-tap locks), numbers/symbols page, space,
// backspace, Done. Keys ~60x52 for gloved fingers.
Rectangle {
    id: kb
    property Item target: null
    property bool shift: false
    property bool caps: false
    property bool symbols: false
    signal done()
    color: Theme.bg
    implicitHeight: 4 * 52 + 3 * 6 + 12

    readonly property var letters: [ "qwertyuiop", "asdfghjkl", "zxcvbnm" ]
    readonly property var syms:    [ "1234567890", "-/:;()$&@\"", ".,?!'#%*+=" , "_\\|~<>[]{}^`" ]

    function insert(s) {
        if (!target) return
        const t = target.text, p = target.cursorPosition
        target.text = t.slice(0, p) + s + t.slice(p)
        target.cursorPosition = p + s.length
        if (shift && !caps) shift = false
    }
    function backspace() {
        if (!target || target.cursorPosition === 0) return
        const t = target.text, p = target.cursorPosition
        target.text = t.slice(0, p - 1) + t.slice(p)
        target.cursorPosition = p - 1
    }

    component Key: Rectangle {
        property string label: ""
        property string glyph: ""
        property real units: 1
        property bool accent: false
        signal tapped()
        Layout.preferredWidth: 58 * units + 6 * (units - 1); Layout.preferredHeight: 52
        radius: Theme.radiusSm
        color: ka.pressed ? Theme.surface2 : (accent ? Theme.accent : Theme.surface)
        border.color: Theme.border; border.width: accent ? 0 : 1
        Text { visible: parent.glyph === ""; anchors.centerIn: parent; text: parent.label
            color: parent.accent ? Theme.textOnAccent : Theme.text
            font.pixelSize: parent.label.length > 1 ? Theme.fsLabel + 1 : 22; font.weight: Font.Medium }
        Icon { visible: parent.glyph !== ""; anchors.centerIn: parent; name: parent.glyph; size: 24; color: Theme.textDim }
        MouseArea { id: ka; anchors.fill: parent; onClicked: parent.tapped() }
    }

    ColumnLayout {
        anchors.centerIn: parent; spacing: 6
        Repeater {
            model: kb.symbols ? kb.syms.slice(0, 3) : kb.letters
            RowLayout { Layout.alignment: Qt.AlignHCenter; spacing: 6
                Key { visible: !kb.symbols && index === 2; glyph: ""; label: kb.caps ? "⇪" : "⇧"; units: 1.5
                      accent: kb.shift
                      onTapped: { if (kb.shift && !kb.caps) kb.caps = true; else { kb.caps = false; kb.shift = !kb.shift } } }
                Repeater { model: modelData.split("")
                    Key { label: (kb.shift && !kb.symbols) ? modelData.toUpperCase() : modelData
                          onTapped: kb.insert(label) } }
                Key { visible: index === 2; glyph: "backspace"; units: 1.5; onTapped: kb.backspace() }
            }
        }
        RowLayout { visible: kb.symbols; Layout.alignment: Qt.AlignHCenter; spacing: 6
            Repeater { model: kb.syms[3].split("")
                Key { label: modelData; onTapped: kb.insert(modelData) } } }
        RowLayout { Layout.alignment: Qt.AlignHCenter; spacing: 6
            Key { label: kb.symbols ? "ABC" : "123"; units: 1.5; onTapped: kb.symbols = !kb.symbols }
            Key { label: "space"; units: 5; onTapped: kb.insert(" ") }
            Key { label: "Done"; units: 2; accent: true; onTapped: kb.done() }
        }
    }
}
```
On the symbols page the keyboard shows four symbol rows plus the bottom row (one row taller than the letters page); `implicitHeight` uses the letters-page height and the extra row is absorbed by the screen's `Layout.fillHeight` spacer above it.

- [ ] **Step 4: Header indicator + AppShell hook**

In `gobi-ui/files/qml/Header.qml`:
- add `signal wifiTapped()` after `implicitHeight: 40; color: Theme.surface`
- inside the right-hand `Row`, as its first child (before the APU-state `Row`), add:
```qml
        Item {
            anchors.verticalCenter: parent.verticalCenter
            width: wbar.width + 12; height: 32
            WifiBars { id: wbar; anchors.centerIn: parent; unit: 3.5
                bars: wifi.signalBars; active: wifi.state === "connected" }
            MouseArea { anchors.fill: parent; anchors.margins: -6; onClicked: hdr.wifiTapped() }
        }
```
- give the root `Rectangle` `id: hdr` and add `import "atoms"` at the top.

`gobi-ui/gobi-ui_1.0.bb`: add `file://qml/atoms/WifiBars.qml \` and `file://qml/atoms/TextKeyboard.qml \` to `SRC_URI`, and matching `install -m 0644 ${WORKDIR}/qml/atoms/<name>.qml ${D}${datadir}/gobi-ui/qml/atoms/` lines next to the existing atoms installs.

- [ ] **Step 5: Commit (preview verification happens in Task 7)**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-ui
git commit -m "feat(ui): text keyboard, WiFi bars, header WiFi indicator"
```

---

### Task 7: WiFi screens, Menu tile, previews

**Files:**
- Create: `gobi-ui/files/qml/screens/WifiScreen.qml`, `WifiJoinScreen.qml`, `WifiSavedScreen.qml`
- Modify: `gobi-ui/files/qml/screens/MenuScreen.qml`
- Modify: `gobi-ui/files/qml/preview/Shots.qml`
- Modify: `gobi-ui/gobi-ui_1.0.bb`

**Interfaces:**
- Consumes: `wifi` (Task 5), `WifiBars`, `TextKeyboard`, `Icon "wifi"`, `AppShell.openWifi()` (Task 6).
- Produces: `WifiScreen`, `WifiJoinScreen { ssid: string; hidden: bool }`, `WifiSavedScreen`.

- [ ] **Step 1: WifiScreen**

`gobi-ui/files/qml/screens/WifiScreen.qml`:
```qml
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
// WiFi: status card (network in use, signal, IP, internet) + nearby networks.
// Open to anyone. Tap: saved/open → join now; secured → password screen.
Item {
    id: page
    Component { id: joinC;  WifiJoinScreen {} }
    Component { id: savedC; WifiSavedScreen {} }
    function push(c, props) { if (page.StackView.view) page.StackView.view.push(c, props || {}) }
    Component.onCompleted: wifi.scan()

    readonly property string netText: wifi.internet === "online" ? "Online"
        : wifi.internet === "portal" ? "Sign-in required"
        : wifi.internet === "no_internet" ? "No internet" : "Checking…"
    readonly property color netHue: wifi.internet === "online" ? Theme.ok
        : wifi.internet === "unknown" ? Theme.textMute : Theme.warn

    function tap(n) {
        if (n.inUse || !n.supported || wifi.state === "connecting") return
        wifi.clearError()
        if (n.saved) wifi.joinSaved(n.savedId)
        else if (!n.secured) wifi.join(n.ssid, "")
        else page.push(joinC, { ssid: n.ssid })
    }

    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: 10
        RowLayout { Layout.fillWidth: true
            ScreenHeader { title: "WiFi"; onBack: if (page.StackView.view) page.StackView.view.pop() }
            Rectangle { Layout.preferredWidth: 104; Layout.preferredHeight: 40; radius: Theme.radiusSm
                visible: wifi.state !== "unavailable"
                color: rsa.pressed ? Theme.surface2 : Theme.surface; border.color: Theme.border
                Text { anchors.centerIn: parent; text: wifi.scanning ? "Scanning…" : "Rescan"
                    color: Theme.accent; font.pixelSize: Theme.fsLabel + 1; font.weight: Font.DemiBold }
                MouseArea { id: rsa; anchors.fill: parent; onClicked: wifi.scan() } } }

        // ── status card ──
        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 84; radius: Theme.radius
            readonly property bool on: wifi.state === "connected"
            color: on ? Theme.tint(Theme.accent, 0.10) : Theme.surface
            border.color: on ? Theme.accent : "transparent"; border.width: 1
            RowLayout {
                anchors.fill: parent; anchors.leftMargin: Theme.pad; anchors.rightMargin: Theme.pad; spacing: 14
                Icon { name: wifi.state === "connected" ? "check-circle" : "wifi"; size: 30
                    color: wifi.state === "connected" ? Theme.accent : Theme.textMute }
                ColumnLayout { Layout.fillWidth: true; spacing: 2
                    Text { Layout.fillWidth: true; elide: Text.ElideRight
                        text: wifi.state === "connected" ? wifi.ssid
                            : wifi.state === "connecting" ? "Connecting to " + wifi.pendingSsid + "…"
                            : wifi.state === "unavailable" ? "WiFi unavailable" : "Not connected"
                        color: Theme.text; font.pixelSize: Theme.fsTitle; font.weight: Font.DemiBold }
                    Text { Layout.fillWidth: true; elide: Text.ElideRight
                        visible: wifi.lastError !== "" || wifi.state === "connected"
                        text: wifi.lastError !== "" ? wifi.lastError
                            : (wifi.internet === "portal" ? "This network needs a web sign-in, which isn't supported. Try another network or a phone hotspot."
                            : wifi.internet === "no_internet" ? "Connected, but this network isn't reaching the internet."
                            : "In use · " + wifi.ip)
                        color: wifi.lastError !== "" ? Theme.fault : Theme.textMute; font.pixelSize: Theme.fsLabel }
                }
                ColumnLayout { visible: wifi.state === "connected"; spacing: 4
                    RowLayout { Layout.alignment: Qt.AlignRight; spacing: 8
                        WifiBars { bars: wifi.signalBars; unit: 5 }
                        Text { text: wifi.signalDbm + " dBm"; color: Theme.textMute; font.pixelSize: Theme.fsLabel } }
                    Text { Layout.alignment: Qt.AlignRight; text: page.netText; color: page.netHue
                        font.pixelSize: Theme.fsLabel + 1; font.weight: Font.DemiBold } }
            }
        }

        Text { text: "NETWORKS"; color: Theme.textMute; font.pixelSize: Theme.fsCaption
            font.letterSpacing: Theme.lsCaps; font.weight: Font.DemiBold }

        ListView {
            Layout.fillWidth: true; Layout.fillHeight: true; clip: true; spacing: 6
            model: wifi.networks
            boundsBehavior: Flickable.StopAtBounds
            delegate: Rectangle {
                width: ListView.view.width; height: 48; radius: Theme.radiusSm
                color: modelData.inUse ? Theme.tint(Theme.accent, 0.12) : (nma.pressed ? Theme.surface2 : Theme.surface)
                border.color: modelData.inUse ? Theme.accent : "transparent"; border.width: 1
                opacity: modelData.supported ? 1 : 0.55
                RowLayout {
                    anchors.fill: parent; anchors.leftMargin: 14; anchors.rightMargin: 14; spacing: 12
                    WifiBars { bars: modelData.bars; unit: 4 }
                    Icon { name: "lock"; size: 16; color: Theme.textMute; opacity: modelData.secured ? 1 : 0 }
                    Text { Layout.fillWidth: true; elide: Text.ElideRight; text: modelData.ssid
                        color: Theme.text; font.pixelSize: Theme.fsBody; font.weight: modelData.inUse ? Font.DemiBold : Font.Normal }
                    Text { text: !modelData.supported ? "Not supported"
                               : wifi.pendingSsid === modelData.ssid ? "Connecting…"
                               : modelData.inUse ? "✓ In use" : modelData.saved ? "Saved" : ""
                        color: modelData.inUse ? Theme.accent : Theme.textMute
                        font.pixelSize: Theme.fsLabel; font.weight: modelData.inUse ? Font.DemiBold : Font.Normal }
                }
                MouseArea { id: nma; anchors.fill: parent; onClicked: page.tap(modelData) }
            }
            Text { anchors.centerIn: parent; visible: parent.count === 0
                text: wifi.state === "unavailable" ? "WiFi unavailable" : wifi.scanning ? "Scanning…" : "No networks found"
                color: Theme.textMute; font.pixelSize: Theme.fsBody }
        }

        RowLayout { Layout.fillWidth: true; spacing: 10; visible: wifi.state !== "unavailable"
            Repeater {
                model: [ { t: "Saved networks", c: savedC }, { t: "Add hidden network", c: joinC, hidden: true } ]
                Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 44; radius: Theme.radiusSm
                    color: bma.pressed ? Theme.surface2 : Theme.surface; border.color: Theme.border
                    Text { anchors.centerIn: parent; text: modelData.t; color: Theme.accent
                        font.pixelSize: Theme.fsLabel + 1; font.weight: Font.DemiBold }
                    MouseArea { id: bma; anchors.fill: parent
                        onClicked: page.push(modelData.c, modelData.hidden ? { hidden: true } : {}) } } } }
    }
}
```

- [ ] **Step 2: WifiJoinScreen**

`gobi-ui/files/qml/screens/WifiJoinScreen.qml`:
```qml
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
// Password entry for a secured network, or name + security + password for a
// hidden one. The network is saved only after it connects; on success this
// screen closes, on failure the error shows and the entry is kept.
Item {
    id: page
    property string ssid: ""
    property bool hidden: false
    property bool secured: true
    property string error: ""
    readonly property bool busy: wifi.state === "connecting" && wifi.pendingSsid === (hidden ? nameField.text : ssid)
    readonly property bool valid: (hidden ? nameField.text.length > 0 : true)
                                  && (!secured || pwField.text.length >= 8)

    function submit() {
        if (!valid || busy) return
        page.error = ""
        wifi.clearError()
        if (hidden) wifi.addHidden(nameField.text, secured, pwField.text)
        else wifi.join(ssid, pwField.text)
        if (wifi.lastError !== "") page.error = wifi.lastError   // immediate validation error
    }

    Connections { target: wifi
        function onJoined(s) { if (s === (page.hidden ? nameField.text : page.ssid) && page.StackView.view) page.StackView.view.pop() }
        function onJoinFailed(s, e) { if (s === (page.hidden ? nameField.text : page.ssid)) page.error = e } }

    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: 8
        ScreenHeader { title: page.hidden ? "Add hidden network" : page.ssid
            subtitle: page.hidden ? "" : "Enter the WiFi password"
            onBack: if (page.StackView.view) page.StackView.view.pop() }

        RowLayout { Layout.fillWidth: true; spacing: 10; visible: page.hidden
            TextField { id: nameField; Layout.fillWidth: true; Layout.preferredHeight: 44
                placeholderText: "Network name"; font.pixelSize: Theme.fsBody; color: Theme.text
                background: Rectangle { radius: Theme.radiusSm; color: Theme.surface
                    border.color: nameField.activeFocus ? Theme.accent : Theme.border }
                onActiveFocusChanged: if (activeFocus) kb.target = nameField }
            SegmentedControl { Layout.preferredWidth: 220
                options: [ {label: "WPA2", value: 1}, {label: "None", value: 0} ]
                current: page.secured ? 1 : 0
                onPicked: (value) => page.secured = value === 1 }
            // Open hidden network: no password row, so Connect lives here.
            Rectangle { visible: !page.secured; Layout.preferredWidth: 120; Layout.preferredHeight: 44; radius: Theme.radiusSm
                color: page.valid && !page.busy ? Theme.accent : Theme.surface2
                Text { anchors.centerIn: parent; text: page.busy ? "Connecting…" : "Connect"
                    color: page.valid && !page.busy ? Theme.textOnAccent : Theme.textMute
                    font.pixelSize: Theme.fsBody; font.weight: Font.DemiBold }
                MouseArea { anchors.fill: parent; onClicked: page.submit() } } }

        RowLayout { Layout.fillWidth: true; spacing: 10; visible: page.secured
            TextField { id: pwField; Layout.fillWidth: true; Layout.preferredHeight: 44
                placeholderText: "Password"; font.pixelSize: Theme.fsBody; color: Theme.text
                echoMode: show.checked ? TextInput.Normal : TextInput.Password
                background: Rectangle { radius: Theme.radiusSm; color: Theme.surface
                    border.color: page.error !== "" ? Theme.fault : (pwField.activeFocus ? Theme.accent : Theme.border) }
                onActiveFocusChanged: if (activeFocus) kb.target = pwField
                Component.onCompleted: if (!page.hidden) forceActiveFocus() }
            Rectangle { id: show; property bool checked: false
                Layout.preferredWidth: 72; Layout.preferredHeight: 44; radius: Theme.radiusSm
                color: Theme.surface; border.color: Theme.border
                Text { anchors.centerIn: parent; text: show.checked ? "Hide" : "Show"; color: Theme.accent
                    font.pixelSize: Theme.fsLabel + 1; font.weight: Font.DemiBold }
                MouseArea { anchors.fill: parent; onClicked: show.checked = !show.checked } }
            Rectangle { Layout.preferredWidth: 120; Layout.preferredHeight: 44; radius: Theme.radiusSm
                color: page.valid && !page.busy ? Theme.accent : Theme.surface2
                Text { anchors.centerIn: parent; text: page.busy ? "Connecting…" : "Connect"
                    color: page.valid && !page.busy ? Theme.textOnAccent : Theme.textMute
                    font.pixelSize: Theme.fsBody; font.weight: Font.DemiBold }
                MouseArea { anchors.fill: parent; onClicked: page.submit() } } }

        Text { Layout.fillWidth: true; visible: page.error !== "" || (page.secured && pwField.text.length > 0 && pwField.text.length < 8)
            text: page.error !== "" ? page.error : "Password must be at least 8 characters."
            color: page.error !== "" ? Theme.fault : Theme.textMute; font.pixelSize: Theme.fsLabel }

        Item { Layout.fillHeight: true }
        TextKeyboard { id: kb; Layout.fillWidth: true; target: page.hidden ? nameField : pwField
            onDone: page.submit() }
    }
}
```
- [ ] **Step 3: WifiSavedScreen**

`gobi-ui/files/qml/screens/WifiSavedScreen.qml`:
```qml
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
// Networks this unit remembers; Forget removes one (the in-use one disconnects).
Item {
    id: page
    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: 10
        ScreenHeader { title: "Saved networks"; onBack: if (page.StackView.view) page.StackView.view.pop() }
        ListView {
            Layout.fillWidth: true; Layout.fillHeight: true; clip: true; spacing: 6
            model: wifi.saved
            delegate: Rectangle {
                width: ListView.view.width; height: 52; radius: Theme.radiusSm
                color: modelData.inUse ? Theme.tint(Theme.accent, 0.12) : Theme.surface
                border.color: modelData.inUse ? Theme.accent : "transparent"; border.width: 1
                RowLayout { anchors.fill: parent; anchors.leftMargin: 14; anchors.rightMargin: 8; spacing: 12
                    Icon { name: "wifi"; size: 22; color: modelData.inUse ? Theme.accent : Theme.textMute }
                    Text { Layout.fillWidth: true; elide: Text.ElideRight; text: modelData.ssid
                        color: Theme.text; font.pixelSize: Theme.fsBody }
                    Text { visible: modelData.inUse; text: "✓ In use"; color: Theme.accent
                        font.pixelSize: Theme.fsLabel; font.weight: Font.DemiBold }
                    Rectangle { Layout.preferredWidth: 96; Layout.preferredHeight: 38; radius: Theme.radiusSm
                        color: fma.pressed ? Theme.surface2 : "transparent"; border.color: Theme.fault
                        Text { anchors.centerIn: parent; text: "Forget"; color: Theme.fault
                            font.pixelSize: Theme.fsLabel + 1; font.weight: Font.DemiBold }
                        MouseArea { id: fma; anchors.fill: parent; onClicked: wifi.forget(modelData.id) } } }
            }
            Text { anchors.centerIn: parent; visible: parent.count === 0; text: "No saved networks"
                color: Theme.textMute; font.pixelSize: Theme.fsBody }
        }
    }
}
```

- [ ] **Step 4: Menu tile + header tap**

In `gobi-ui/files/qml/AppShell.qml`: add `import "screens"`; change the Header line to
```qml
    Header { id: hdr; anchors.top: parent.top; anchors.left: parent.left; anchors.right: parent.right
             onWifiTapped: shell.openWifi() }
```
and add:
```qml
    Component { id: wifiC; WifiScreen {} }
    function openWifi() { selectRail(2); stack.push(wifiC) }
```

In `gobi-ui/files/qml/screens/MenuScreen.qml`:
- add `Component { id: wifiS; WifiScreen {} }` next to the other Components
- add `"wifi": wifiS,` to `_routes`
- in page 2 of `pages`, insert after the Cloud Connection entry: `{title:"WiFi",target:"wifi",icon:"wifi"},`

- [ ] **Step 5: Recipe install**

`gobi-ui/gobi-ui_1.0.bb`: add `file://qml/screens/WifiScreen.qml \`, `file://qml/screens/WifiJoinScreen.qml \`, `file://qml/screens/WifiSavedScreen.qml \` to `SRC_URI`, and matching `install -m 0644 ${WORKDIR}/qml/screens/<name>.qml ${D}${datadir}/gobi-ui/qml/screens/` lines.

- [ ] **Step 6: Preview steps**

In `gobi-ui/files/qml/preview/Shots.qml`: add Components
```qml
    Component { id: wifiC;      WifiScreen {} }
    Component { id: wifiJoinC;  WifiJoinScreen { ssid: "Pilot-Travel-Center" } }
    Component { id: wifiHidC;   WifiJoinScreen { hidden: true } }
    Component { id: wifiSavedC; WifiSavedScreen {} }
```
and append to `steps` (after the last existing step):
```qml
        ["21-wifi",            function() { root.sub(wifiC) }],
        ["21b-wifi-portal",    function() { wifi.internet = "portal"; root.sub(wifiC) }],
        ["21c-wifi-connecting",function() { wifi.internet = "online"; wifi.state = "connecting"; wifi.pendingSsid = "Shop-Guest"; root.sub(wifiC) }],
        ["21d-wifi-wrongpw",   function() { wifi.state = "idle"; wifi.pendingSsid = ""; wifi.lastError = "Wrong password."; root.sub(wifiC) }],
        ["21e-wifi-unavail",   function() { wifi.lastError = ""; wifi.state = "unavailable"; wifi.networks = []; root.sub(wifiC) }],
        ["21f-wifi-join",      function() { wifi.state = "connected"; root.sub(wifiJoinC) }],
        ["21g-wifi-hidden",    function() { root.sub(wifiHidC) }],
        ["21h-wifi-saved",     function() { root.sub(wifiSavedC) }],
        ["21i-menu-p2",        function() { shell.selectRail(2) }]
```
(`21e` empties the mock list; the steps after it don't need the list. If `18-lockoverlay` leaves the screen locked, add `LockController.tryUnlock("1234");` at the start of `21-wifi`.)

- [ ] **Step 7: Render and review**

Run (from `gobi-ui/files`):
```sh
cmake -S qml/preview/runner -B /tmp/shots-build -DCMAKE_PREFIX_PATH=/opt/homebrew/opt/qt && cmake --build /tmp/shots-build
rm -rf /tmp/shots && mkdir -p /tmp/shots
QT_QPA_PLATFORM=offscreen QT_QUICK_CONTROLS_STYLE=Basic QT_QUICK_BACKEND=software /tmp/shots-build/shots $PWD/qml $PWD/fonts /tmp/shots preview/Shots.qml
```
Expected: stderr shows only `app font "Inter"`; `/tmp/shots/21*.png` exist. Open each and check: the in-use row is highlighted with "✓ In use" and sits first; status card shows bars, dBm, IP, "Online"; portal text fits (wrap/elide acceptable); keyboard fully visible under the password row on 21f/21g; header WiFi bars visible on every screen; Menu page 2 shows the WiFi tile. Fix layout issues before committing. Send the images to the user for review.

- [ ] **Step 8: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-ui
git commit -m "feat(ui): WiFi screens — status, networks, join with keyboard, saved, menu tile"
```

---

### Task 8: Branch build and bench verification on .86

**Files:** none (verification); final spec note.

- [ ] **Step 1: Full host test run**

Run: `cmake --build /tmp/gobi-ui-tests && ctest --test-dir /tmp/gobi-ui-tests --output-on-failure` and `sh meta-ecofleet/recipes-ecofleet/ecofleet-wifi/tests/test-wifi-init.sh`
Expected: all suites pass except the known-flaky `tst_displaymodel::dimsThenSleeps` (pre-existing, ~3/20 on main); rerun once if it is the only failure.

- [ ] **Step 2: Push and branch-build**

```bash
git push -u origin feat/wifi-setup-screen
gh workflow run build.yml --ref feat/wifi-setup-screen -R delorean1483/cortex-yocto
```
Wait for success; download the `ecofleet-bench-image` artifact (`gh run download <id> -R delorean1483/cortex-yocto -D <scratch>`).

- [ ] **Step 3: Install on .86**

```sh
scp <scratch>/ecofleet-bench-image/ecofleet-feat-wifi-setup-screen.swu root@192.168.0.86:/tmp/w.swu
ssh root@192.168.0.86 'swupdate -i /tmp/w.swu -f /etc/swupdate/ecofleet.cfg && fw_printenv slot_active && sync && (sleep 1; /usr/sbin/gobi-cold-reboot) &'
```
Expected: `SWUpdate was successful`, slot flips; board returns; WiFi still connected to EcoFleet-Staff from `/data/wifi`.

- [ ] **Step 4: Bench checklist (with the user at the panel)**

1. WiFi tile and header bars visible; WiFi screen shows EcoFleet-Staff "✓ In use", bars, dBm, IP, Online.
2. Forget EcoFleet-Staff → disconnects; rejoin from the list with its password → In use, Online. `ssh root@192.168.0.86 'cat /data/wifi/wpa_supplicant-wlan0.conf'` shows `psk=<64 hex>` only (no plaintext).
3. Wrong password on a phone hotspot → "Wrong password.", nothing new in the config; correct password → joins and is saved.
4. Turn the hotspot off → unit falls back to EcoFleet-Staff by itself within ~1 min.
5. `ssh root@192.168.0.86 'mv /data/wifi /data/wifi.bak && sync && /usr/sbin/gobi-cold-reboot'` → boots clean, empty config recreated, screen scans, nothing auto-joins; restore with `mv /data/wifi.bak /data/wifi` + cold reboot.
6. Regression soak: `ssh root@192.168.0.86 'systemd-run --unit=wifi-soak sh /data/wifi-debug/soak.sh 150'` → `done ok=150 fail=0`.

- [ ] **Step 5: Open the PR**

```bash
gh pr create -R delorean1483/cortex-yocto --base main --head feat/wifi-setup-screen \
  --title "feat(wifi): join and manage WiFi networks from the screen" \
  --body-file <scratch>/pr-wifi-setup.md
```
PR body: summary (spec link), decisions, test evidence (host suites, previews, bench checklist results), and the attribution footer.
