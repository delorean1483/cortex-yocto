# EcoFleet Branding — Design Spec

**Date:** 2026-06-04  
**Status:** Approved

---

## Summary

Add EcoFleet branding to the gobi-ui touchscreen dashboard via two surfaces: a boot splash screen and a persistent top bar visible on all tabs.

---

## Design

### 1. Boot Splash Screen

A full-screen overlay rendered on top of the main UI at startup.

- **Background:** `#0D1117` (matches app background — no flash)
- **Content:** EcoFleet logo centered, "FLEET APU MONITOR" subtitle below in `#6E7681`, a teal progress bar beneath that
- **Duration:** 2.5 seconds, then fade out over 300 ms
- **Implementation:** A `Rectangle` overlay in `main.qml` with `z: 10`, hidden by a `SequentialAnimation` — `PauseAnimation { duration: 2500 }` followed by `NumberAnimation` on `opacity` to 0, then `visible: false`

### 2. Persistent Top Bar

A `Rectangle` anchored to the top of `ApplicationWindow`, visible on all three tabs.

- **Height:** 40 px
- **Background:** `#161B22` (matches tab bar)
- **Bottom border:** 1 px `#21262D` separator line
- **Left side:** EcoFleet logo `Image`, height 24 px, `fillMode: PreserveAspectFit`
- **Right side:** NO DATA and FAULT status badges — moved here from `DashboardPage` header so they are visible on every tab

### 3. Dashboard Header Removal

`DashboardPage.qml` currently has a `RowLayout` header containing "EcoFleet Gobi APU" text and the NO DATA / FAULT badges. This row is removed entirely since:
- The logo replaces the text branding
- The badges move to the global top bar

Net content height impact: zero — the 40 px top bar replaces the ~40 px dashboard header row.

---

## Files Changed

| File | Change |
|------|--------|
| `meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/main.qml` | Add top bar `Rectangle` + splash overlay |
| `meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/DashboardPage.qml` | Remove header `RowLayout` (logo + badges move to top bar) |
| `meta-ecofleet/recipes-ecofleet/gobi-ui/files/ecofleet_logo.png` | Add transparent logo PNG (source: `ecofleet_transparent.png`) |
| `meta-ecofleet/recipes-ecofleet/gobi-ui/gobi-ui_1.0.bb` | Add `ecofleet_logo.png` to `SRC_URI` and install to `/usr/share/gobi-ui/` |
| `meta-ecofleet/recipes-ecofleet/gobi-ui/files/CMakeLists.txt` | Add logo to `RESOURCES` or install step |

---

## Logo Asset

- Source: `ecofleet_transparent.png` (transparent background PNG)
- Stored at: `meta-ecofleet/recipes-ecofleet/gobi-ui/files/ecofleet_logo.png`
- Referenced in QML as: `Image { source: "/usr/share/gobi-ui/ecofleet_logo.png" }`

---

## Out of Scope

- Animated logo / motion graphics
- Custom fonts
- Per-tab header variations
- Dark/light theme toggle
