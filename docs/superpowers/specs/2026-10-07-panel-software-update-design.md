# On-Panel Software Update — Design

**Date:** 2026-10-07
**Status:** Draft for review
**Supersedes:** the 2026-09-30 decision "no on-screen update trigger" (see `project-ui-update-notice`): the panel now may start an install, PIN-gated.

## 1. Purpose

Today a cortex software update can only be started from the dashboard
(`desired.firmware_target`) or by hand over SSH. Technicians at a truck need
to update a unit from the panel, e.g. during a service visit, without
dashboard access.

Goal: a PIN-gated **Software Update** screen that checks for the newest
released version and installs it through the existing, signed OTA path.

### Decisions (brainstorm)

| # | Decision |
|---|---|
| P1 | The offered version comes from a public `releases/latest.json` written by CI on tag releases. |
| P2 | Only technicians: the screen lives under **Menu → Maintenance** (maintenance PIN). |
| P3 | Upgrades only — never offer or install a version ≤ the running one. |
| P4 | Refuse while an OTA or an APU-controller flash is already in progress. |
| P5 | Check on demand only (on opening the screen / tapping Check). No periodic check, no Home badge. |

## 2. Existing pieces reused

- **Install path:** the agent's `ota_trigger(version)` → `write_ota_request("install <v>")` → root `gobi-ota-apply` (version validated digits+dots, URL from fixed base, `curl` → `swupdate` with signature check → `gobi-cold-reboot`). Status lines in `/var/lib/ecofleet/ota/status` → `ota_status` in `latest.json`.
- **Progress UI:** `UpdateOverlay` / `UpdateNotice` already show "Updating… don't power off" and failure banners from `ota_status`.
- **Version:** `running_version()` reads `/etc/ecofleet/firmware-version`.
- **APU flash:** `stm32_flash_status()` / `apu_flash_state`.
- **libcurl** is already linked into gobi-agent.

## 3. CI (`.github/workflows/build.yml`)

In the "Publish signed bundle to OTA bucket" step (tag builds only), after
the `.swu` upload succeeds and **only for non-prerelease tags** (no `-` in the
tag name — same rule as the GitHub "Latest" flag), upload
`s3://ecofleet-ota/releases/latest.json`:

```json
{"version":"1.2.74","published":"2026-10-07T18:00:00Z"}
```

`--content-type application/json --cache-control max-age=60`. The object is
covered by the existing public-read policy on `releases/*`. Ordering matters:
`latest.json` is written **after** the bundle, so it never points at a missing
`.swu`.

## 4. gobi-agent

### 4.1 Pure module `ota_offer.c/.h` (host-tested)

- `bool ota_parse_latest(const char *json, char *ver, size_t len)` — extract `version`; valid only if it matches `^\d+\.\d+\.\d+$` (cJSON).
- `int ota_ver_cmp(const char *a, const char *b)` — numeric N.N.N compare; unparseable sorts lowest.
- `ota_offer_t ota_decide(const char *running, const char *latest, bool ota_busy, bool apu_flash_busy)` → `OTA_OFFER_NONE` (latest ≤ running or invalid), `OTA_OFFER_AVAILABLE`, `OTA_OFFER_BLOCKED_BUSY`.
- `bool ota_status_busy(const char *ota_status)` — true for `downloading …` / `installing …`.

### 4.2 Check (`command.json` `{"ota_check":1}`)

Handled in `apply_command_file()` (telemetry thread). The fetch of
`https://ecofleet-ota.s3.amazonaws.com/releases/latest.json` uses libcurl
with an 8 s total timeout, a 4 KB body cap and TLS verification on. Each
check updates state that `build_latest_json()` publishes:

| Key | Type | Meaning |
|---|---|---|
| `ota_running` | string | running cortex version |
| `ota_latest` | string | last fetched `latest.json` version (`""` until a successful check) |
| `ota_available` | string | `ota_latest` if `ota_decide` says AVAILABLE, else `""` |
| `ota_check_state` | string | `idle` / `ok` / `failed: network` (no connection / timeout / TLS) / `failed: bad manifest` (HTTP status ≠ 200, unparseable, or non-N.N.N version) |
| `ota_check_ts` | number | epoch ms of the last completed check (0 = never) |

A check never installs anything. A slow network delays the next telemetry
cycle by at most 8 s (accepted; same thread as other panel commands).

### 4.3 Install (`command.json` `{"ota_install":"1.2.74"}`)

Accepted only when all hold: the string equals the current `ota_available`
(so it was offered by a successful check), `ota_decide()` is still AVAILABLE
(re-evaluated with current busy state), and it parses as N.N.N. Then
`ota_trigger(version)` — identical to a dashboard update from here on.
Rejections are logged and set `ota_check_state` to `failed: not offered` /
`failed: busy`.

## 5. gobi-ui

### 5.1 TelemetryModel

Read: `otaRunning`, `otaLatest`, `otaAvailable`, `otaCheckState`, `otaCheckTs`.
Write: `checkForUpdate()` → `{"ota_check":1}`, `installUpdate(version)` → `{"ota_install": version}`.

### 5.2 `SoftwareUpdateScreen.qml` (new) + Maintenance row

- Maintenance gets a row: icon `cpu`, **Software Update**, "Check for and install new unit software". (The Maintenance hub itself is already PIN-locked from the Menu.)
- Screen content:
  - "Installed: 1.2.73".
  - Status line: Checking… (UI-side, between tap and the next snapshot) / Up to date (checked 2 min ago) / Update available: **1.2.74** / Couldn't check — no internet (`failed: network`) / Update service error (`failed: bad manifest`).
  - **Check for updates** button (also fires once when the screen opens).
  - When available: **Install 1.2.74** as a two-tap `ConfirmButton` ("Tap again to install"), with the note "The unit restarts after installing (about 3 minutes). The APU and heater keep running."
  - Install disabled with a reason while `ota_status` shows an update in progress or `apu_flash_state` is flashing.
- After Install the existing `UpdateOverlay` takes over (downloading → installing → reboot).

## 6. Testing

- gobi-agent: `tests/test_ota_offer.c` — manifest parse (valid, missing key, non-semver, garbage, oversize), version compare (1.2.9 < 1.2.10, equal, unparseable), decide truth table incl. busy states, `ota_status_busy` strings. `main.c` `-fsyntax-only`.
- gobi-ui: native Qt6 build; preview shots: up to date, available, check failed, checking.
- CI: `actionlint`-style review of the YAML + the next real tag release proves it (verify `curl https://ecofleet-ota.s3.amazonaws.com/releases/latest.json`).

## 7. Out of scope

- Downgrades / choosing an older version; prerelease (`-rc`/`-diag`) installs from the panel.
- Periodic background checks, Home-screen badges, notifications.
- APU (STM32) firmware updates from this screen.
- Any change to the dashboard OTA flow.

## 8. Open items

1. First release after this lands must be a normal tag so `latest.json` exists; until then the panel reports `failed: bad manifest` (404). Optionally seed it by hand with the current release.
2. Bench: confirm the 8 s worst-case delay in the telemetry loop is acceptable on a weak LTE/WiFi link.
