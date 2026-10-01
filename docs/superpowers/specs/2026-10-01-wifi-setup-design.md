# On-screen WiFi setup — design

**Status:** approved in conversation 2026-10-01, pending written-spec review
**Builds on:** v1.2.70 `ecofleet-wifi` (Bluetooth masked, no driver unload, credentials on `/data/wifi`, wlan0 route metric 2048)

## Goal

Let whoever is at the unit join a WiFi network from the touchscreen — typically
a driver whose cellular signal is poor and who wants to use a yard, shop or
phone-hotspot network — and have the unit remember it.

**Success criteria**

- Anyone can scan, join (open or WPA2), and forget networks from the screen; no
  passcode. Fleets that want to restrict it use the existing screen-lock PIN.
- The unit remembers several networks and rejoins any saved one in range on its own.
- It is always obvious which network is in use, how strong it is, its IP, and
  whether it actually reaches the internet.
- A network that needs a web sign-in (captive portal) is detected and explained,
  not silently broken.
- Credentials live only in `/data/wifi` (survive A/B updates), stored as the
  hashed PSK, never in plaintext and never logged.
- Nothing about WiFi can freeze the board or the UI: the driver is never
  unloaded, and every WiFi call is non-blocking with a timeout.

## Decisions (from the conversation)

| Topic | Decision |
|---|---|
| Who can use it | Anyone (no technician PIN) |
| Saved networks | Several; auto-rejoin whichever is in range |
| Captive portals | **Detect + explain only** in v1. A real in-unit browser (WPE WebKit) is a possible later project that slots in where the message is |
| Architecture | gobi-ui (already runs as root) talks to `wpa_supplicant` directly over its control socket |
| Keyboard | Custom QML keyboard in the app's style; no Qt Virtual Keyboard package |
| Security types | Open + WPA2-PSK (incl. WPA2/WPA3 transition networks). WPA3-only (SAE) is out of v1 — it needs a plaintext password at rest |

Rejected alternatives: a separate root helper service with request files (only
needed for unprivileged callers; adds latency and moving parts), and moving to
NetworkManager/connman (replaces the networkd + wpa_supplicant stack just
validated by a 1500-cycle soak).

## UI

### Entry points

- **Menu → WiFi tile** (page 2, next to Cloud Connection). *Changed during
  planning from a Settings row: Settings already fills the screen and a row
  would force scrolling.*
- **Header WiFi indicator** (every screen, beside "APU live"): WiFi glyph with
  signal bars, greyed when not connected. Tap opens the WiFi screen.

### WiFi screen (688×440 content area)

```
┌─ ‹ WiFi ─────────────────────────────── [Rescan] ┐
│ ┌──────────────────────────────────────────────┐ │
│ │ ✓ In use   Yard-WiFi      ▂▄▆  -54 dBm Online│ │  status card
│ │            192.168.0.206           [Forget]  │ │
│ └──────────────────────────────────────────────┘ │
│ NETWORKS                                         │
│ ┃▂▄▆█ 🔒 Yard-WiFi                  ✓ In use   ┃ │  accent border + tint
│  ▂▄▆   🔒  Shop-Guest                 Saved      │
│  ▂▄    🔒  Pilot-Travel-Center                   │
│  ▂         FreeTruckStopWiFi                     │
│ [Saved networks]          [Add hidden network]   │
└──────────────────────────────────────────────────┘
```

- **Status card:** connected network with an "In use" check, signal bars plus
  dBm, IP address, internet state (Online / No internet / Sign-in required with
  its explanation), and Forget.
- **Network list:** the in-use network first (accent border, tint, check, "In
  use"), then other saved networks, then the rest by signal. Rows show signal
  bars, a lock for secured networks, and "Saved". Duplicate BSSIDs of one SSID
  collapse to one row (strongest signal).
- **Tap behaviour:** in-use → nothing; saved or open → connect immediately;
  secured and unsaved → password screen.
- **Password screen:** network name, password field with Show/Hide, keyboard
  across the bottom half, Connect (disabled until valid). The network is saved
  only after it connects.
- **Saved networks screen:** list of saved networks, each with Forget. Forgetting
  the in-use network disconnects it.
- **Add hidden network:** name, security (None / WPA2), password.
- **Row/card feedback:** Connecting… → In use; or an error (below).

### Keyboard (`atoms/TextKeyboard.qml`)

Letters page with Shift, numbers/symbols page, space, backspace, Done. Keys
about 60×52 px. Emits characters into a bound text field; no system input
method involved.

## WifiModel (C++, gobi-ui)

### Transport

A minimal client for the `wpa_supplicant` control interface: Unix datagram
sockets to `/run/wpa_supplicant/wlan0`, one for request/reply commands and one
`ATTACH`ed for unsolicited events. Uses `QSocketNotifier`, so it never blocks
the UI thread; every command has a timeout (about 2 s). No libwpa_client
dependency. If the socket is missing or stops answering, the model reports
`unavailable` and keeps retrying in the background.

### Exposed to QML

- Properties: `state` (`unavailable` | `idle` | `connecting` | `connected`),
  `scanning`, `ssid`, `signalDbm`, `signalBars` (0–4), `ip`, `internet`
  (`unknown` | `online` | `no_internet` | `portal`), `networks` (list of
  `{ssid, signalBars, secured, saved, inUse}`), `saved` (list of `{id, ssid}`),
  `lastError` (user-facing text).
- Methods: `scan()`, `join(ssid, password)`, `joinSaved(id)`,
  `forget(id)`, `addHidden(ssid, secured, password)` (*`join` rather than
  `connect`, which collides with `QObject::connect`*).
- `scanning` is a separate bool rather than a `state` value, so a rescan while
  connected still shows connected.

### Connect flow (new network)

1. `ADD_NETWORK`; `SET_NETWORK ssid` (hex-encoded, so any bytes are safe); for
   WPA2: `psk` = hashed key, `key_mgmt WPA-PSK`; open: `key_mgmt NONE`.
   Hidden: `scan_ssid 1`.
2. `SELECT_NETWORK <id>` (connects to it alone).
3. Wait for an event, at most 30 s:
   - `CTRL-EVENT-CONNECTED` → `ENABLE_NETWORK all`, `SAVE_CONFIG`, start the
     internet check.
   - `CTRL-EVENT-SSID-TEMP-DISABLED … reason=WRONG_KEY` → `REMOVE_NETWORK`,
     `ENABLE_NETWORK all`, error "Wrong password."
   - Timeout → same cleanup, error "Couldn't connect to <ssid>."
4. Nothing is saved unless step 3 succeeded.

`connectSaved` is `SELECT_NETWORK` + the same wait, then `ENABLE_NETWORK all`
(no save needed). `forget` is `REMOVE_NETWORK` + `SAVE_CONFIG`.

### Credentials

- WPA2 key stored as the 64-hex PSK = PBKDF2-HMAC-SHA1(password, ssid, 4096
  iterations, 32 bytes) via `QPasswordDigestor` — identical to `wpa_passphrase`.
  The plaintext password is never written anywhere or logged.
- Validation before connect: SSID 1–32 bytes; WPA2 password 8–63 printable ASCII.
- `wpa_supplicant` writes `/data/wifi/wpa_supplicant-wlan0.conf` itself on
  `SAVE_CONFIG` (`update_config=1`, file is root-only).

### Signal and IP

`SIGNAL_POLL` every ~5 s while the WiFi screen or header needs it (RSSI →
bars: ≥-55 four, ≥-65 three, ≥-75 two, ≥-85 one, else zero). IP from
`QNetworkInterface` for `wlan0`.

## Internet check / captive portal

After every successful connect, and every 2 min while connected: an HTTP GET to
`http://connectivitycheck.gstatic.com/generate_204` forced out of wlan0
(`curl --interface wlan0 --max-time 8`, run via `QProcess`, never blocking).

| Result | `internet` | Card text |
|---|---|---|
| HTTP 204 | `online` | Online |
| any other HTTP status or a redirect | `portal` | Sign-in required — "This network needs a web sign-in, which isn't supported. Try another network or a phone hotspot." |
| DNS failure / timeout / connect error | `no_internet` | No internet — "Connected, but this network isn't reaching the internet." |

A portal network stays connected and saved; if it gets signed in some other
way, the next check turns it `online`.

## Boot behaviour (`ecofleet-wifi` recipe change)

- `wpa_supplicant@wlan0` **always runs**: drop the `ConditionPathExists` gate;
  `ExecStartPre` creates `/data/wifi/wpa_supplicant-wlan0.conf` (mode 0600, dir
  0700) with only `ctrl_interface=/run/wpa_supplicant`, `update_config=1`,
  `country=US` if the file is missing. With no networks it idles and does not
  scan.
- Unchanged: Bluetooth masked, `variscite-wifi` has no `ExecStop`, wlan0 DHCP at
  metric 2048 (Ethernet stays primary). WiFi-vs-cellular priority is decided when
  the cellular link lands.

## Errors (user-facing)

| Situation | Message |
|---|---|
| Wrong password | "Wrong password." (back to password screen, entry kept) |
| No connection within 30 s | "Couldn't connect to <ssid>." |
| Network no longer in scan | "<ssid> is out of range." |
| `wpa_supplicant` / driver missing or unresponsive | Screen shows "WiFi unavailable", actions disabled; rest of app unaffected |
| Invalid input | Inline under the field; Connect disabled |

## Testing

**Host (QtTest, `gobi-ui/files/tests`):**
- Parsing: `SCAN_RESULTS` (spaces, quotes, UTF-8, hidden/empty SSID, duplicate
  BSSIDs), `STATUS`, `LIST_NETWORKS`, `SIGNAL_POLL`, event lines.
- PSK hashing matches `wpa_passphrase` fixtures.
- Validation and SSID hex encoding.
- Connect flow against a fake `wpa_supplicant` on a local datagram socket:
  success (saves, re-enables others), wrong key (removes, nothing saved),
  timeout, forget, socket absent → `unavailable`.
- Internet-check classification (204 / 200 / 302 / failure).

**Previews (`preview/Shots.qml` + `Mocks.qml`):** WiFi screen connected+online,
connecting, wrong password, sign-in required, unavailable; password screen with
keyboard; saved networks; header indicator states. Reviewed before device testing.

**Bench (.86):**
1. Forget EcoFleet-Staff, rejoin from the screen; join a phone hotspot; both
   saved, only hashed keys in `/data/wifi`.
2. Wrong password → error, not saved.
3. Turn the hotspot off → falls back to EcoFleet-Staff by itself.
4. Sign-in-required message (simulated on host; a real portal network if available).
5. Regression: existing 150-cycle soak with the new image (wpa_supplicant now always runs).
6. Empty `/data/wifi` → clean boot, screen scans, nothing auto-connects.

## Out of scope (v1)

- Captive-portal sign-in (in-unit browser) — later, WPE WebKit.
- WPA3-only (SAE) and enterprise (802.1X) networks.
- Setting WiFi from the dashboard / remotely via the agent (can share the same
  control socket later via `ctrl_interface_group`).
- WiFi-vs-cellular route policy (with the cellular link work).
