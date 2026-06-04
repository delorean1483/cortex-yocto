# EcoFleet Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add EcoFleet logo branding to gobi-ui via a 2.5 s boot splash screen and a persistent top bar visible on all tabs.

**Architecture:** A transparent logo PNG is added to the recipe's file assets and installed to `/usr/share/gobi-ui/`. `main.qml` gains a persistent top bar (logo + status badges) anchored to the top and a splash overlay `Rectangle` with a timed fade-out. `DashboardPage.qml` loses its header row since the logo and badges move to the global top bar.

**Tech Stack:** QML (Qt 6), Yocto BitBake recipe

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `meta-ecofleet/recipes-ecofleet/gobi-ui/files/ecofleet_logo.png` | Create | Logo asset (transparent PNG) |
| `meta-ecofleet/recipes-ecofleet/gobi-ui/gobi-ui_1.0.bb` | Modify | Add logo to `SRC_URI` + `do_install` + `FILES` |
| `meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/main.qml` | Modify | Add top bar + splash overlay |
| `meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/DashboardPage.qml` | Modify | Remove header `RowLayout` (logo + badges move to top bar) |

---

## Task 1: Add logo asset to recipe

**Files:**
- Create: `meta-ecofleet/recipes-ecofleet/gobi-ui/files/ecofleet_logo.png`
- Modify: `meta-ecofleet/recipes-ecofleet/gobi-ui/gobi-ui_1.0.bb`

- [ ] **Step 1: Copy transparent logo PNG into the recipe files directory**

```bash
cp /Users/sungkang/Downloads/ecofleet_transparent.png \
   meta-ecofleet/recipes-ecofleet/gobi-ui/files/ecofleet_logo.png
```

Verify it copied:
```bash
ls -lh meta-ecofleet/recipes-ecofleet/gobi-ui/files/ecofleet_logo.png
```
Expected: file present, non-zero size.

- [ ] **Step 2: Add logo to `SRC_URI`, `do_install`, and `FILES` in `gobi-ui_1.0.bb`**

In `meta-ecofleet/recipes-ecofleet/gobi-ui/gobi-ui_1.0.bb`, make these three changes:

**SRC_URI** — add one line after `file://gobi-ui.service \`:
```bitbake
    file://ecofleet_logo.png \
```

**`do_install:append()`** — add one line after the last `install -m 0644 ${WORKDIR}/qml/DevicePage.qml` line:
```bitbake
    install -m 0644 ${WORKDIR}/ecofleet_logo.png  ${D}${datadir}/gobi-ui/
```

**`FILES:${PN}`** already covers `${datadir}/gobi-ui/` so no change needed there.

- [ ] **Step 3: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-ui/files/ecofleet_logo.png \
        meta-ecofleet/recipes-ecofleet/gobi-ui/gobi-ui_1.0.bb
git commit -m "gobi-ui: add EcoFleet transparent logo asset"
```

---

## Task 2: Add persistent top bar to `main.qml`

**Files:**
- Modify: `meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/main.qml`

The top bar sits between the window top and the SwipeView. The SwipeView's `anchors.top` moves from `parent.top` to `topBar.bottom`. The tab bar stays at the bottom unchanged.

- [ ] **Step 1: Update `main.qml` — add top bar and adjust SwipeView anchor**

Replace the entire contents of `meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/main.qml` with:

```qml
import QtQuick
import QtQuick.Controls

ApplicationWindow {
    id: root
    visible: true
    visibility: Window.FullScreen
    width: 1280
    height: 800
    title: "EcoFleet"

    background: Rectangle { color: "#0D1117" }

    // ── Top bar ───────────────────────────────────────────────────────────────
    Rectangle {
        id: topBar
        anchors.top: parent.top
        anchors.left: parent.left
        anchors.right: parent.right
        height: 40
        color: "#161B22"

        Rectangle {
            anchors.bottom: parent.bottom
            width: parent.width; height: 1
            color: "#21262D"
        }

        Image {
            anchors.left: parent.left
            anchors.leftMargin: 14
            anchors.verticalCenter: parent.verticalCenter
            source: "/usr/share/gobi-ui/ecofleet_logo.png"
            height: 24
            fillMode: Image.PreserveAspectFit
        }

        Row {
            anchors.right: parent.right
            anchors.rightMargin: 14
            anchors.verticalCenter: parent.verticalCenter
            spacing: 8

            // No-data badge
            Rectangle {
                visible: telemetry.stale
                width: noDataRow.width + 20; height: 24; radius: 12
                color: "#2D1B1B"; border.color: "#F85149"; border.width: 1
                Row {
                    id: noDataRow
                    anchors.centerIn: parent
                    spacing: 6
                    Rectangle { width: 6; height: 6; radius: 3; color: "#F85149"; anchors.verticalCenter: parent.verticalCenter }
                    Text { text: "NO DATA"; color: "#F85149"; font.pixelSize: 11; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                }
            }

            // Fault badge
            Rectangle {
                visible: telemetry.hasFault
                width: faultTxt.width + 20; height: 24; radius: 12
                color: "#2D1014"; border.color: "#F85149"; border.width: 1
                Text {
                    id: faultTxt
                    anchors.centerIn: parent
                    text: "FAULT " + telemetry.fault
                    color: "#F85149"; font.pixelSize: 11; font.weight: Font.Bold
                }
            }
        }
    }

    SwipeView {
        id: view
        anchors.top: topBar.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: tabBar.top
        clip: true

        DashboardPage  {}
        DiagnosticsPage {}
        DevicePage {}
    }

    // ── Tab bar ───────────────────────────────────────────────────────────────
    Rectangle {
        id: tabBar
        height: 52
        anchors.bottom: parent.bottom
        width: parent.width
        color: "#161B22"

        Row {
            anchors.fill: parent

            Repeater {
                model: ["Dashboard", "Diagnostics", "Device"]

                Item {
                    width: root.width / 3
                    height: tabBar.height

                    Rectangle {
                        anchors.top: parent.top
                        width: parent.width; height: 2
                        color: view.currentIndex === index ? "#00C49A" : "transparent"
                        Behavior on color { ColorAnimation { duration: 150 } }
                    }

                    Text {
                        anchors.centerIn: parent
                        text: modelData
                        color: view.currentIndex === index ? "#00C49A" : "#8B949E"
                        font.pixelSize: 16
                        font.weight: Font.Medium
                        Behavior on color { ColorAnimation { duration: 150 } }
                    }

                    MouseArea {
                        anchors.fill: parent
                        onClicked: view.currentIndex = index
                    }
                }
            }
        }
    }

    // ── Splash overlay ────────────────────────────────────────────────────────
    Rectangle {
        id: splash
        anchors.fill: parent
        color: "#0D1117"
        z: 10

        Column {
            anchors.centerIn: parent
            spacing: 16

            Image {
                anchors.horizontalCenter: parent.horizontalCenter
                source: "/usr/share/gobi-ui/ecofleet_logo.png"
                height: 72
                fillMode: Image.PreserveAspectFit
            }

            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                text: "FLEET APU MONITOR"
                color: "#6E7681"
                font.pixelSize: 12
                font.letterSpacing: 3
            }

            Rectangle {
                anchors.horizontalCenter: parent.horizontalCenter
                width: 120; height: 3; radius: 2; color: "#21262D"
                Rectangle {
                    width: parent.width * 0.7; height: parent.height; radius: parent.radius
                    color: "#00C49A"
                }
            }
        }

        SequentialAnimation on opacity {
            running: true
            PauseAnimation   { duration: 2500 }
            NumberAnimation  { to: 0; duration: 300; easing.type: Easing.InQuad }
            ScriptAction     { script: splash.visible = false }
        }
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/main.qml
git commit -m "gobi-ui: add persistent top bar with logo and boot splash"
```

---

## Task 3: Remove header row from `DashboardPage.qml`

**Files:**
- Modify: `meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/DashboardPage.qml`

The header `RowLayout` (lines 31–71 in the current file) contains the "EcoFleet Gobi APU" text and the NO DATA / FAULT badges. Both are now in the global top bar. Remove the entire block.

- [ ] **Step 1: Remove the header `RowLayout` from `DashboardPage.qml`**

Delete the following block from `DashboardPage.qml` (the `// ── Header ──` comment through the closing `}`of the RowLayout, inclusive):

```qml
        // ── Header ────────────────────────────────────────────────────────────
        RowLayout {
            Layout.fillWidth: true
            height: 40
            spacing: 12

            Text {
                text: "EcoFleet Gobi APU"
                color: "#C9D1D9"
                font.pixelSize: 18
                font.weight: Font.SemiBold
            }

            Item { Layout.fillWidth: true }

            // No-data badge
            Rectangle {
                visible: telemetry.stale
                width: noDataRow.width + 20; height: 28; radius: 14
                color: "#2D1B1B"; border.color: "#F85149"; border.width: 1
                Row {
                    id: noDataRow
                    anchors.centerIn: parent
                    spacing: 6
                    Rectangle { width: 6; height: 6; radius: 3; color: "#F85149"; anchors.verticalCenter: parent.verticalCenter }
                    Text { text: "NO DATA"; color: "#F85149"; font.pixelSize: 11; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                }
            }

            // Fault badge
            Rectangle {
                visible: telemetry.hasFault
                width: faultTxt.width + 20; height: 28; radius: 14
                color: "#2D1014"; border.color: "#F85149"; border.width: 1
                Text {
                    id: faultTxt
                    anchors.centerIn: parent
                    text: "FAULT " + telemetry.fault
                    color: "#F85149"; font.pixelSize: 11; font.weight: Font.Bold
                }
            }
        }
```

After removal, the `ColumnLayout` inside the `Page` should begin directly with the `// ── APU State card ──` block.

- [ ] **Step 2: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/DashboardPage.qml
git commit -m "gobi-ui: remove dashboard header row (logo and badges moved to top bar)"
```

---

## Task 4: Tag and build

- [ ] **Step 1: Tag and push**

```bash
git tag v1.2.0
git push origin main v1.2.0
```

- [ ] **Step 2: Trigger build**

```bash
gh workflow run build.yml --ref v1.2.0 -R delorean1483/cortex-yocto
gh run list --workflow="build.yml" -R delorean1483/cortex-yocto
```

- [ ] **Step 3: Watch build**

```bash
gh run watch <run-id> -R delorean1483/cortex-yocto
```

Expected: build succeeds and `v1.2.0` appears in GitHub Releases with all assets.

- [ ] **Step 4: Flash and verify on device**

Download and flash:
```bash
gh release download v1.2.0 -R delorean1483/cortex-yocto \
    --pattern "*.wic.zst" --pattern "*.wic.bmap" --clobber
diskutil unmountDisk /dev/disk6
zstd -d ecofleet-image-imx8mm-var-dart.rootfs.wic.zst --stdout | sudo dd of=/dev/rdisk6 bs=4M status=progress
diskutil eject /dev/disk6
```

On device, verify:
1. EcoFleet splash screen appears on boot (~2.5 s) then fades
2. Top bar shows logo on Dashboard, Diagnostics, and Device tabs
3. NO DATA badge appears in top bar (not in dashboard body) when gobi-agent is not running
4. FAULT badge appears in top bar when `telemetry.hasFault` is true
5. Dashboard content area has no duplicate header text
