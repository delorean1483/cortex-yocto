# APU GUI Redesign — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cluttered 3-tab gobi-ui with the rail-based IA (Home / Mode / Battery / Menu) on a fixed 800×480 canvas that scales to any panel, re-homing today's Diagnostics/Device content into Menu — using only data that already exists.

**Architecture:** All QML is authored inside a fixed 800×480 `ScaleRoot` that letterbox-scales to the physical panel (native on the Riverdi 5″, ~1.6× on the 1280×800 dev kit). An `AppShell` hosts a persistent left `Rail` + a content `StackView`. Three reusable templates (`BigNumberScreen`, `ChoiceList`, `TileGrid`) back every screen. Colors are centralized in a `Theme` singleton. A desktop `qml` preview harness with mocked `telemetry`/`devinfo`/`weather` gives a fast visual loop; final verification is a Yocto image build flashed to the dev kit.

**Tech Stack:** Qt 6 / QML (QtQuick, QtQuick.Controls, QtQuick.Layouts); Yocto (`gobi-ui_1.0.bb`); desktop Qt 6 `qml` runtime for preview.

**Spec:** `docs/superpowers/specs/2026-08-31-apu-gui-redesign-design.md` (read it first; it maps every screen to telemetry and explains the phasing).

## Global Constraints

- **Canvas:** every screen is authored for **800×480**; never hardcode a different window size inside components. Sizing uses these fixed px (they are logical px on the 800×480 canvas), not relative-to-window.
- **Palette (from existing gobi-ui, use via `Theme` singleton after Task 2):** bg `#0D1117`; surface `#161B22`; surface-2 `#1C2230`; border `#30363D`; text `#E6EDF3`; text-dim `#C9D1D9`; text-mute `#6E7681`; text-label `#8B949E`; accent `#00C49A`; accent-blue `#58A6FF`; ok `#3FB950`; warn `#E3B341`; fault `#F85149`.
- **Data surface (read-only unless noted):** `telemetry.{cabinTempF, extTempF, battV, clmtSetpointF, battSetpointV, rpm, fanSpeed, engineHrs, machineHrs, oilHrs, oilOk, ignition, mode, engineStatus, controlStatus, error, hasError, oilChange, stale}`; writes `telemetry.setMode("off"|"climate"|"battery")`, `telemetry.setSetpoint(int degF)`, `telemetry.setFan(int 0-100)`, `telemetry.resetOil()`. `devinfo.{serial, hostname, fwVersion, ethLinked, ipAddress, macAddress}`. `weather` (existing `WeatherModel`, used by `WeatherStrip`).
- **Modes today = Off / Climate / Battery** (not the spec's Auto/Manual/Battery-Saver — those are deferred firmware work; do not invent them).
- **Battery = voltage only** (`battV`); there is no SoC %/amps. Show volts + a plain-language status; do not fabricate a percentage.
- **No new external dependencies.** QtQuick.Controls Basic style only (matches the device).
- **File location:** all new QML lives in `meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/`. Preview harness lives in `meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/preview/`.
- **Commit granularity:** one commit per task, on branch `feat/gobi-ui-800x480-layout`.
- **Import convention:** the `Theme` singleton (with its `qmldir`) lives at the `qml/` root. Files in `qml/` use `import "."` for it; files in `qml/atoms/`, `qml/templates/`, `qml/screens/` use `import ".."`. Sibling directories are reached with `import "../atoms"` / `import "../templates"`. QML components in the *same* directory need no import (auto-resolved by filename).

---

## File Structure

```
meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/
  main.qml                     (MODIFY task 16 — swap SwipeView/TabBar for ScaleRoot+AppShell)
  Theme.qml                    (CREATE task 2 — color/token singleton)
  qmldir                       (CREATE task 2 — registers `singleton Theme`)
  ScaleRoot.qml                (CREATE task 3)
  AppShell.qml                 (CREATE task 6)
  Rail.qml                     (CREATE task 5)
  Header.qml                   (CREATE task 4)
  atoms/StatusPill.qml         (CREATE task 4)
  atoms/FaultBanner.qml        (CREATE task 4)
  atoms/StatCard.qml           (CREATE task 4)
  templates/BigNumberScreen.qml(CREATE task 7)
  templates/ChoiceList.qml     (CREATE task 8)
  templates/TileGrid.qml       (CREATE task 9)
  screens/HomeScreen.qml       (CREATE task 10)
  screens/ModeScreen.qml       (CREATE task 11)
  screens/BatteryScreen.qml    (CREATE task 12)
  screens/MenuScreen.qml       (CREATE task 13)
  screens/DiagnosticsScreen.qml(CREATE task 14 — adapts DiagnosticsPage content)
  screens/UserMaintScreen.qml  (CREATE task 15 — oil reset + hours/serial)
  screens/UnitInfoScreen.qml   (CREATE task 15 — identity + network)
  preview/Preview.qml          (CREATE task 1 — harness + mock context)
  preview/Mocks.qml            (CREATE task 1 — mock telemetry/devinfo/weather)
gobi-ui: CMakeLists / .qrc / recipe SRC_URI  (MODIFY task 16 — ship new files)
```

Old `DashboardPage.qml`, `DiagnosticsPage.qml`, `DevicePage.qml`, `SegButton.qml`, `StepButton.qml` are removed from the app in Task 16 (kept in git history). `WeatherStrip.qml`/`WeatherIcon.qml` are retained (reused by Home footer later; still referenced by preview).

---

### Task 1: Preview harness + mocked context

**Files:**
- Create: `.../qml/preview/Mocks.qml`
- Create: `.../qml/preview/Preview.qml`

**Interfaces:**
- Produces: a runnable `qml preview/Preview.qml` window sized 1280×800 that exposes `property QtObject telemetry`, `property QtObject devinfo` on its root so child components resolve `telemetry.*`/`devinfo.*` the same way they will against the real C++ context properties. `Preview.qml` has `property Component content` — set it to the component under test.

- [ ] **Step 1: Install a desktop Qt 6 runtime (one-time)**

Run: `brew install qt` (provides `qml`). Verify: `qml --version` prints Qt 6.x. If `qml` is not on PATH, use `$(brew --prefix qt)/bin/qml`.

- [ ] **Step 2: Write the mock context**

`preview/Mocks.qml`:
```qml
import QtQuick
QtObject {
    // telemetry mock — mirrors TelemetryModel's read API + no-op writes
    property QtObject telemetry: QtObject {
        property real   cabinTempF: 74;   property real extTempF: 88
        property real   battV: 12.9;      property real clmtSetpointF: 70
        property real   battSetpointV: 12.0
        property int    rpm: 2200;        property int  fanSpeed: 55
        property int    engineHrs: 1342;  property int  machineHrs: 5210
        property int    oilHrs: 96
        property bool   oilOk: true;      property bool ignition: true
        property string mode: "climate";  property string engineStatus: "Running"
        property string controlStatus: "Cooling"
        property string error: "";        property bool   hasError: false
        property string oilChange: "good"; property bool  stale: false
        function setMode(m) { mode = m }
        function setSetpoint(f) { clmtSetpointF = f }
        function setFan(p) { fanSpeed = p }
        function resetOil() { oilHrs = 0 }
    }
    property QtObject devinfo: QtObject {
        property string serial: "APU-DEMO-0001"; property string hostname: "gobi-apu"
        property string fwVersion: "v1.2.32";    property bool   ethLinked: true
        property string ipAddress: "192.168.0.85"; property string macAddress: "00:11:22:33:44:55"
    }
}
```

- [ ] **Step 3: Write the preview harness**

`preview/Preview.qml`:
```qml
import QtQuick
import QtQuick.Controls
ApplicationWindow {
    id: win
    visible: true; width: 1280; height: 800; title: "gobi-ui preview"
    property alias content: loader.sourceComponent
    Mocks { id: mocks }
    // expose mock models on the window root scope so `telemetry.*` resolves
    property QtObject telemetry: mocks.telemetry
    property QtObject devinfo:  mocks.devinfo
    Rectangle { anchors.fill: parent; color: "#000" }
    Loader { id: loader; anchors.fill: parent }
    // default content: a placeholder until a task sets it
    Component.onCompleted: if (!loader.sourceComponent) placeholder.active = true
    Loader { id: placeholder; active: false; anchors.centerIn: parent
        sourceComponent: Text { text: "set Preview.content"; color: "#888" } }
}
```

- [ ] **Step 4: Run the harness to verify it loads**

Run: `qml -I meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/preview/Preview.qml`
Expected: a 1280×800 window opens showing "set Preview.content" with no QML errors on the console. Close it.

- [ ] **Step 5: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/preview/
git commit -m "test(gobi-ui): desktop qml preview harness + mocked telemetry/devinfo"
```

---

### Task 2: Theme singleton (centralize the palette)

**Files:**
- Create: `.../qml/Theme.qml`
- Create: `.../qml/qmldir`

**Interfaces:**
- Produces: `Theme` singleton with color tokens: `bg, surface, surface2, border, text, textDim, textMute, textLabel, accent, accentBlue, ok, warn, fault` (all `color`). Imported via `import "."` and referenced as `Theme.accent`.

- [ ] **Step 1: Write the token singleton**

`Theme.qml`:
```qml
pragma Singleton
import QtQuick
QtObject {
    readonly property color bg:        "#0D1117"
    readonly property color surface:   "#161B22"
    readonly property color surface2:  "#1C2230"
    readonly property color border:    "#30363D"
    readonly property color text:      "#E6EDF3"
    readonly property color textDim:   "#C9D1D9"
    readonly property color textMute:  "#6E7681"
    readonly property color textLabel: "#8B949E"
    readonly property color accent:    "#00C49A"
    readonly property color accentBlue:"#58A6FF"
    readonly property color ok:        "#3FB950"
    readonly property color warn:      "#E3B341"
    readonly property color fault:     "#F85149"
}
```

- [ ] **Step 2: Register the singleton**

`qmldir`:
```
singleton Theme 1.0 Theme.qml
```

- [ ] **Step 3: Verify it resolves in the harness**

Temporarily set `content` in `Preview.qml` `Component.onCompleted` is not needed; instead run a one-off check:
Run: `qml -I meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml -e 'import QtQuick; import "."; Rectangle{width:200;height:100;color:Theme.accent}'` (if `-e` unsupported, add a throwaway `Rectangle{ color: Theme.accent }` as `Preview.content` and eyeball it).
Expected: a teal (`#00C49A`) rectangle, no "Theme is not defined" error.

- [ ] **Step 4: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/Theme.qml meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/qmldir
git commit -m "feat(gobi-ui): Theme singleton centralizing the palette"
```

---

### Task 3: ScaleRoot — fixed 800×480 canvas + letterbox scale

**Files:**
- Create: `.../qml/ScaleRoot.qml`

**Interfaces:**
- Consumes: nothing.
- Produces: `ScaleRoot` — fills its parent, centers an 800×480 `Item` scaled by `Math.min(parent.width/800, parent.height/480)`. Has `default property alias content: canvas.data` so children are placed on the 800×480 canvas. Background fills the whole parent with `Theme.bg` (so letterbox bars are bg-colored, not black).

- [ ] **Step 1: Write ScaleRoot**

`ScaleRoot.qml`:
```qml
import QtQuick
import "."
Item {
    id: root
    default property alias content: canvas.data
    Rectangle { anchors.fill: parent; color: Theme.bg }   // fills letterbox area
    Item {
        id: canvas
        width: 800; height: 480
        anchors.centerIn: parent
        scale: Math.min(root.width / 800, root.height / 480)
        transformOrigin: Item.Center
        clip: true
    }
}
```

- [ ] **Step 2: Verify scaling in the harness**

Set `Preview.content` to:
```qml
Component { ScaleRoot {
    Rectangle { anchors.fill: parent; color: "#123"; border.color: "#0f0"; border.width: 2
        Text { anchors.centerIn: parent; color: "#fff"; text: "800x480 canvas" } }
} }
```
Run the harness. Expected: an 800×480 (green-bordered) canvas scaled up (~1.6×) and centered in the 1280×800 window, with `Theme.bg` bars top/bottom. Resize the window — the canvas re-fits and preserves 5:3.

- [ ] **Step 3: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/ScaleRoot.qml
git commit -m "feat(gobi-ui): ScaleRoot fixed 800x480 canvas with letterbox scaling"
```

---

### Task 4: Shared atoms — Header, StatusPill, FaultBanner, StatCard

**Files:**
- Create: `.../qml/Header.qml`, `.../qml/atoms/StatusPill.qml`, `.../qml/atoms/FaultBanner.qml`, `.../qml/atoms/StatCard.qml`

**Interfaces:**
- Produces:
  - `Header` — 40px-tall bar: left = small connectivity dot (`telemetry.stale` → fault, else ok) + `devinfo.ipAddress`; right = live clock (`Qt.formatDateTime(now,"ddd MMM d  h:mm AP")`). `implicitHeight: 40`.
  - `StatusPill { property string label; property color hue: Theme.accent }` — rounded pill, `hue`-tinted bg + border, centered label.
  - `FaultBanner { property string text; property color hue: Theme.fault; signal clicked() }` — slim full-width banner, visible only when `text !== ""`.
  - `StatCard { property string label; property string value; property color valueColor: Theme.text }` — surface rectangle, small mute label over a large value.

- [ ] **Step 1: Write the atoms**

`atoms/StatusPill.qml`:
```qml
import QtQuick
import ".."
Rectangle {
    property string label: ""
    property color hue: Theme.accent
    implicitWidth: t.width + 28; implicitHeight: 30; radius: height/2
    color: Qt.rgba(hue.r, hue.g, hue.b, 0.15); border.color: hue; border.width: 1
    Text { id: t; anchors.centerIn: parent; text: label; color: hue
           font.pixelSize: 15; font.weight: Font.Bold }
}
```
`atoms/FaultBanner.qml`:
```qml
import QtQuick
import ".."
Rectangle {
    property string text: ""
    property color hue: Theme.fault
    signal clicked()
    visible: text !== ""
    implicitHeight: visible ? 30 : 0; radius: 8
    color: Qt.rgba(hue.r, hue.g, hue.b, 0.15); border.color: hue; border.width: 1
    Row { anchors.left: parent.left; anchors.leftMargin: 12; anchors.verticalCenter: parent.verticalCenter; spacing: 8
        Rectangle { width: 8; height: 8; radius: 4; color: hue; anchors.verticalCenter: parent.verticalCenter }
        Text { text: parent.parent.text; color: hue; font.pixelSize: 13; font.weight: Font.DemiBold
               anchors.verticalCenter: parent.verticalCenter } }
    MouseArea { anchors.fill: parent; onClicked: parent.clicked() }
}
```
`atoms/StatCard.qml`:
```qml
import QtQuick
import ".."
Rectangle {
    property string label: ""; property string value: ""
    property color valueColor: Theme.text
    radius: 10; color: Theme.surface
    Column {
        anchors.left: parent.left; anchors.leftMargin: 12
        anchors.verticalCenter: parent.verticalCenter; spacing: 2
        Text { text: label; color: Theme.textMute; font.pixelSize: 12 }
        Text { text: value; color: valueColor; font.pixelSize: 22; font.weight: Font.DemiBold }
    }
}
```
`Header.qml`:
```qml
import QtQuick
import "."
Rectangle {
    implicitHeight: 40; color: Theme.surface
    Rectangle { anchors.bottom: parent.bottom; width: parent.width; height: 1; color: Theme.border }
    Row {
        anchors.left: parent.left; anchors.leftMargin: 12
        anchors.verticalCenter: parent.verticalCenter; spacing: 8
        Rectangle { width: 8; height: 8; radius: 4; anchors.verticalCenter: parent.verticalCenter
            color: telemetry.stale ? Theme.fault : Theme.ok }
        Text { text: devinfo.ipAddress; color: Theme.textMute; font.pixelSize: 12
               anchors.verticalCenter: parent.verticalCenter }
    }
    Text {
        anchors.right: parent.right; anchors.rightMargin: 12; anchors.verticalCenter: parent.verticalCenter
        property var now: new Date()
        text: Qt.formatDateTime(now, "ddd MMM d  h:mm AP"); color: Theme.textMute; font.pixelSize: 13
        Timer { interval: 1000; running: true; repeat: true; onTriggered: parent.now = new Date() }
    }
}
```

- [ ] **Step 2: Verify each atom in the harness**

Set `Preview.content` to a `ScaleRoot` containing a `Column` with `Header{width:800}`, `StatusPill{label:"RUNNING"}`, `FaultBanner{text:"Low battery"}`, `StatCard{width:180;height:70;label:"BATTERY";value:"12.9 V"}`. Run the harness. Expected: header shows IP + live clock + green dot; a teal RUNNING pill; a red fault banner; a battery stat card. No errors.

- [ ] **Step 3: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/Header.qml meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/atoms/
git commit -m "feat(gobi-ui): shared atoms — Header, StatusPill, FaultBanner, StatCard"
```

---

### Task 5: Rail — persistent left navigation

**Files:**
- Create: `.../qml/Rail.qml`

**Interfaces:**
- Produces: `Rail { property var model; property int currentIndex; signal picked(int index) }`. `model` = array of `{ key, label }`. Fixed `implicitWidth: 160`. Renders a vertical stack of items; active item = accent text + a 3px accent left-edge marker; tapping emits `picked(index)`.

- [ ] **Step 1: Write Rail**

`Rail.qml`:
```qml
import QtQuick
import "."
Rectangle {
    property var model: []
    property int currentIndex: 0
    signal picked(int index)
    implicitWidth: 160; color: Theme.surface
    Rectangle { anchors.right: parent.right; width: 1; height: parent.height; color: Theme.border }
    Column {
        anchors.fill: parent; anchors.topMargin: 8
        Repeater {
            model: parent.parent.model
            Item {
                width: 160; height: 84
                property bool active: index === parent.parent.parent.currentIndex
                Rectangle { anchors.left: parent.left; width: 3; height: parent.height
                    color: parent.active ? Theme.accent : "transparent" }
                Column { anchors.centerIn: parent; spacing: 4
                    // icon placeholder: a rounded square; replace with line-icon set during styling
                    Rectangle { width: 30; height: 30; radius: 8; anchors.horizontalCenter: parent.horizontalCenter
                        color: "transparent"; border.width: 2
                        border.color: parent.parent.active ? Theme.accent : Theme.textMute }
                    Text { text: modelData.label; anchors.horizontalCenter: parent.horizontalCenter
                        color: parent.parent.active ? Theme.accent : Theme.textMute
                        font.pixelSize: 14; font.weight: parent.parent.active ? Font.Bold : Font.Medium }
                }
                MouseArea { anchors.fill: parent; onClicked: parent.parent.parent.picked(index) }
            }
        }
    }
}
```

- [ ] **Step 2: Verify Rail in the harness**

`Preview.content`: a `ScaleRoot` with a `Rail { height:440; model:[{key:"home",label:"Home"},{key:"mode",label:"Mode"},{key:"batt",label:"Battery"},{key:"menu",label:"Menu"}]; currentIndex:0; onPicked: currentIndex=index }`. Run. Expected: 4 items, "Home" accented with the left marker; tapping another item moves the accent/marker. No errors.

- [ ] **Step 3: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/Rail.qml
git commit -m "feat(gobi-ui): Rail persistent left navigation"
```

---

### Task 6: AppShell — header + rail + content StackView

**Files:**
- Create: `.../qml/AppShell.qml`

**Interfaces:**
- Consumes: `Header`, `Rail`.
- Produces: `AppShell` sized 800×480. Properties: `property var railModel`, `property int railIndex`, `property var railScreens` (array of `Component`, index-aligned with `railModel`). Exposes `function pushScreen(comp)` and `function popScreen()` that push/pop a `StackView` in the content pane (used by Menu sub-navigation). Selecting a rail item resets the StackView to that rail screen. Layout: `Header` (top, 40), then a row of `Rail` (left, 160) + `StackView` (fills rest).

- [ ] **Step 1: Write AppShell**

`AppShell.qml`:
```qml
import QtQuick
import QtQuick.Controls
import "."
Item {
    id: shell
    width: 800; height: 480
    property var railModel: []
    property var railScreens: []     // Component[] aligned with railModel
    property int railIndex: 0
    function pushScreen(comp) { stack.push(comp) }
    function popScreen() { if (stack.depth > 1) stack.pop() }
    function selectRail(i) {
        shell.railIndex = i
        stack.clear()
        stack.push(railScreens[i])
    }
    Header { id: hdr; anchors.top: parent.top; anchors.left: parent.left; anchors.right: parent.right }
    Rail {
        id: rail
        anchors.top: hdr.bottom; anchors.bottom: parent.bottom; anchors.left: parent.left
        model: shell.railModel; currentIndex: shell.railIndex
        onPicked: shell.selectRail(index)
    }
    StackView {
        id: stack
        anchors.top: hdr.bottom; anchors.bottom: parent.bottom
        anchors.left: rail.right; anchors.right: parent.right
        clip: true
        Component.onCompleted: if (shell.railScreens.length) push(shell.railScreens[0])
    }
}
```

- [ ] **Step 2: Verify AppShell in the harness**

`Preview.content`: `ScaleRoot { AppShell {
  railModel: [{key:"a",label:"Home"},{key:"b",label:"Mode"}]
  railScreens: [ Component{ Rectangle{color:Theme.bg; Text{anchors.centerIn:parent;text:"HOME";color:Theme.text}} },
                 Component{ Rectangle{color:Theme.bg; Text{anchors.centerIn:parent;text:"MODE";color:Theme.text}} } ] } }`
Run. Expected: header + rail + "HOME" content; tapping "Mode" swaps content to "MODE". No errors.

- [ ] **Step 3: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/AppShell.qml
git commit -m "feat(gobi-ui): AppShell — header + rail + content StackView"
```

---

### Task 7: BigNumberScreen template

**Files:**
- Create: `.../qml/templates/BigNumberScreen.qml`

**Interfaces:**
- Produces: `BigNumberScreen` with properties `property string value`, `property bool showSteppers: false`, `property string statusText`, `property string pillText`, `property color pillHue: Theme.accent`, `property string faultText: ""`, `property var footerStats: []` (array of `{label,value}`), and signals `incremented()`, `decremented()`, `faultTapped()`. Layout: optional `FaultBanner` at top; centered oversized `value` with optional up/down chevrons to its right and `statusText` beside; a `StatusPill` below; a footer row of `StatCard`s.

- [ ] **Step 1: Write the template**

`templates/BigNumberScreen.qml`:
```qml
import QtQuick
import QtQuick.Layouts
import ".."
import "../atoms"
Item {
    id: scr
    property string value: ""
    property bool showSteppers: false
    property string statusText: ""
    property string pillText: ""
    property color pillHue: Theme.accent
    property string faultText: ""
    property var footerStats: []
    signal incremented(); signal decremented(); signal faultTapped()

    ColumnLayout {
        anchors.fill: parent; anchors.margins: 16; spacing: 10
        FaultBanner { Layout.fillWidth: true; text: scr.faultText; onClicked: scr.faultTapped() }
        Item { Layout.fillWidth: true; Layout.fillHeight: true
            RowLayout {
                anchors.centerIn: parent; spacing: 16
                Text { text: scr.value; color: Theme.text; font.pixelSize: 140; font.weight: Font.Light }
                ColumnLayout {
                    visible: scr.showSteppers; spacing: 8
                    Repeater { model: [{t:"▲",inc:true},{t:"▼",inc:false}]
                        Rectangle { Layout.preferredWidth: 56; Layout.preferredHeight: 44; radius: 10
                            color: ma.pressed ? Theme.surface2 : Theme.surface; border.color: Theme.border; border.width: 1
                            Text { anchors.centerIn: parent; text: modelData.t; color: Theme.accentBlue; font.pixelSize: 20 }
                            MouseArea { id: ma; anchors.fill: parent
                                onClicked: modelData.inc ? scr.incremented() : scr.decremented() } } }
                }
                Text { text: scr.statusText; color: Theme.textDim; font.pixelSize: 20; Layout.alignment: Qt.AlignVCenter }
            }
        }
        StatusPill { Layout.alignment: Qt.AlignHCenter; label: scr.pillText; hue: scr.pillHue; visible: scr.pillText !== "" }
        RowLayout {
            Layout.fillWidth: true; Layout.preferredHeight: 64; spacing: 10; visible: scr.footerStats.length > 0
            Repeater { model: scr.footerStats
                StatCard { Layout.fillWidth: true; Layout.fillHeight: true
                    label: modelData.label; value: modelData.value } }
        }
    }
}
```

- [ ] **Step 2: Verify the template in the harness**

`Preview.content`: `ScaleRoot { BigNumberScreen { anchors.fill: parent; value:"70°"; showSteppers:true; statusText:"Cooling to 70"; pillText:"RUNNING"; footerStats:[{label:"BATTERY",value:"12.9 V"},{label:"ENGINE HRS",value:"1342"}]; faultText:"" } }`
Run. Expected: big "70°" with ▲/▼ chevrons + "Cooling to 70", a RUNNING pill, two footer stat cards; tapping chevrons logs nothing but doesn't error. Set `faultText:"Low battery"` and confirm the banner appears above without moving the number off-screen.

- [ ] **Step 3: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/templates/BigNumberScreen.qml
git commit -m "feat(gobi-ui): BigNumberScreen template"
```

---

### Task 8: ChoiceList template

**Files:**
- Create: `.../qml/templates/ChoiceList.qml`

**Interfaces:**
- Produces: `ChoiceList { property var model; property string current; signal picked(string value) }`. `model` = array of `{ value, title, help }`. Renders rows (title bold + helper text below); the row whose `value === current` gets an accent outline box; tapping a row emits `picked(value)` immediately (no confirm).

- [ ] **Step 1: Write the template**

`templates/ChoiceList.qml`:
```qml
import QtQuick
import QtQuick.Layouts
import ".."
ColumnLayout {
    id: list
    property var model: []
    property string current: ""
    signal picked(string value)
    anchors.margins: 16; spacing: 10
    Repeater {
        model: list.model
        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 88; radius: 12
            property bool sel: modelData.value === list.current
            color: sel ? Theme.surface2 : Theme.surface
            border.color: sel ? Theme.accent : Theme.border; border.width: sel ? 2 : 1
            Column { anchors.left: parent.left; anchors.leftMargin: 18; anchors.right: parent.right
                     anchors.rightMargin: 18; anchors.verticalCenter: parent.verticalCenter; spacing: 4
                Text { text: modelData.title; color: sel ? Theme.accent : Theme.text
                       font.pixelSize: 20; font.weight: Font.Bold }
                Text { text: modelData.help; color: Theme.textMute; font.pixelSize: 14
                       width: parent.width; wrapMode: Text.WordWrap } }
            MouseArea { anchors.fill: parent; onClicked: list.picked(modelData.value) }
        }
    }
    Item { Layout.fillHeight: true }
}
```

- [ ] **Step 2: Verify the template in the harness**

`Preview.content`: `ScaleRoot { ChoiceList { anchors.fill:parent; current:"climate"
  model:[{value:"climate",title:"Climate",help:"Runs to heat or cool the cab."},
         {value:"battery",title:"Battery",help:"Runs to keep the battery charged."},
         {value:"off",title:"Off",help:"APU stays off."}]
  onPicked: current = value } }`
Run. Expected: three rows, "Climate" outlined in accent; tapping "Battery" moves the outline. No errors.

- [ ] **Step 3: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/templates/ChoiceList.qml
git commit -m "feat(gobi-ui): ChoiceList template (selectable rows with helper text)"
```

---

### Task 9: TileGrid template

**Files:**
- Create: `.../qml/templates/TileGrid.qml`

**Interfaces:**
- Produces: `TileGrid { property var pages; signal opened(string target) }`. `pages` = array of pages; each page = array of `{ title, target, locked }` (≤6). Renders one page as a 3×2 grid of tiles (icon placeholder + title + optional lock glyph), with page-dot pagination + swipe between pages; tapping a tile emits `opened(target)`.

- [ ] **Step 1: Write the template**

`templates/TileGrid.qml`:
```qml
import QtQuick
import QtQuick.Layouts
import ".."
Item {
    id: grid
    property var pages: []
    signal opened(string target)
    ColumnLayout {
        anchors.fill: parent; anchors.margins: 16; spacing: 8
        SwipeView {
            id: sv; Layout.fillWidth: true; Layout.fillHeight: true; clip: true
            Repeater {
                model: grid.pages
                GridLayout {
                    columns: 3; rows: 2; columnSpacing: 12; rowSpacing: 12
                    Repeater {
                        model: modelData
                        Rectangle {
                            Layout.fillWidth: true; Layout.fillHeight: true; radius: 12
                            color: ma.pressed ? Theme.surface2 : Theme.surface
                            border.color: Theme.border; border.width: 1
                            Column { anchors.centerIn: parent; spacing: 8
                                Rectangle { width: 40; height: 40; radius: 10; anchors.horizontalCenter: parent.horizontalCenter
                                    color: "transparent"; border.color: Theme.textMute; border.width: 2 }
                                Text { text: modelData.title; anchors.horizontalCenter: parent.horizontalCenter
                                    color: Theme.text; font.pixelSize: 15 } }
                            Text { visible: modelData.locked === true; text: "🔒"
                                anchors.top: parent.top; anchors.right: parent.right; anchors.margins: 8; font.pixelSize: 14 }
                            MouseArea { id: ma; anchors.fill: parent; onClicked: grid.opened(modelData.target) }
                        }
                    }
                }
            }
        }
        Row {
            Layout.alignment: Qt.AlignHCenter; spacing: 8; visible: grid.pages.length > 1
            Repeater { model: grid.pages.length
                Rectangle { width: 8; height: 8; radius: 4
                    color: index === sv.currentIndex ? Theme.accent : Theme.border } }
        }
    }
}
```

- [ ] **Step 2: Verify the template in the harness**

`Preview.content`: `ScaleRoot { TileGrid { anchors.fill:parent
  pages:[[{title:"Diagnostics",target:"diag"},{title:"Maintenance",target:"maint",locked:true},{title:"Cloud",target:"cloud"},{title:"Error Log",target:"log"},{title:"Screen Lock",target:"lock"},{title:"Settings",target:"set"}],
         [{title:"Unit Info",target:"unit"},{title:"Support",target:"sup"}]]
  onOpened: console.log("open", target) } }`
Run. Expected: a 3×2 grid, a lock glyph on "Maintenance", two page dots; swiping shows page 2; tapping logs the target. No errors.

- [ ] **Step 3: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/templates/TileGrid.qml
git commit -m "feat(gobi-ui): TileGrid template (paged 3x2 launcher)"
```

---

### Task 10: HomeScreen

**Files:**
- Create: `.../qml/screens/HomeScreen.qml`

**Interfaces:**
- Consumes: `BigNumberScreen`, `telemetry`. Produces: `HomeScreen` (fills the content pane). Big number = cab setpoint `Math.round(telemetry.clmtSetpointF)+"°"`; steppers call `telemetry.setSetpoint(clamp(±1, 55..85))` debounced 350ms; status = `telemetry.controlStatus`; pill = run state derived from `telemetry.mode`/`telemetry.engineStatus`; fault banner = `telemetry.hasError ? "Fault: "+telemetry.error : ""`; footer = battery volts + engine hours.

- [ ] **Step 1: Write HomeScreen**

`screens/HomeScreen.qml`:
```qml
import QtQuick
import "../templates"
import ".."
Item {
    id: home
    property int target: Math.round(telemetry.clmtSetpointF)
    Component.onCompleted: target = Math.round(telemetry.clmtSetpointF)
    Timer { id: send; interval: 350; onTriggered: telemetry.setSetpoint(home.target) }
    function bump(d) { target = Math.max(55, Math.min(85, target + d)); send.restart() }
    BigNumberScreen {
        anchors.fill: parent
        value: home.target + "°"
        showSteppers: true
        statusText: telemetry.controlStatus
        pillText: telemetry.mode === "off" ? "OFF"
                  : (telemetry.engineStatus.length ? telemetry.engineStatus.toUpperCase() : "STANDBY")
        pillHue: telemetry.mode === "off" ? Theme.textMute : Theme.accent
        faultText: telemetry.hasError ? "Fault: " + telemetry.error : ""
        footerStats: [ { label: "BATTERY", value: telemetry.battV.toFixed(1) + " V" },
                       { label: "ENGINE HRS", value: telemetry.engineHrs + "" } ]
        onIncremented: home.bump(1)
        onDecremented: home.bump(-1)
    }
}
```

- [ ] **Step 2: Verify HomeScreen in the harness**

`Preview.content`: `ScaleRoot { HomeScreen { anchors.fill: parent } }`. Run. Expected: "70°" with working ▲/▼ (number changes, mock `setSetpoint` updates it), "Cooling" status, an accent "RUNNING" pill, battery + engine-hrs footer. In `Mocks.qml` temporarily set `hasError:true; error:"LOW_OIL"` → the fault banner shows.

- [ ] **Step 3: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/screens/HomeScreen.qml
git commit -m "feat(gobi-ui): HomeScreen (setpoint big-number + run state)"
```

---

### Task 11: ModeScreen

**Files:**
- Create: `.../qml/screens/ModeScreen.qml`

**Interfaces:**
- Consumes: `ChoiceList`, `telemetry`. Produces: `ModeScreen` — three real modes with helper text; `current: telemetry.mode`; `onPicked: telemetry.setMode(value)`.

- [ ] **Step 1: Write ModeScreen**

`screens/ModeScreen.qml`:
```qml
import QtQuick
import "../templates"
ChoiceList {
    current: telemetry.mode
    model: [
        { value: "climate", title: "Climate", help: "Runs the APU to heat or cool the cab to your setpoint." },
        { value: "battery", title: "Battery",  help: "Runs the APU only to keep the truck battery charged." },
        { value: "off",     title: "Off",      help: "APU stays off. Cab climate and battery support are unavailable." }
    ]
    onPicked: telemetry.setMode(value)
}
```

- [ ] **Step 2: Verify ModeScreen in the harness**

`Preview.content`: `ScaleRoot { ModeScreen { anchors.fill: parent } }`. Run. Expected: 3 rows, "Climate" outlined (mock mode); tapping "Battery" moves the outline (mock `setMode` updates `telemetry.mode`, binding follows). No errors.

- [ ] **Step 3: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/screens/ModeScreen.qml
git commit -m "feat(gobi-ui): ModeScreen (Off/Climate/Battery choice list)"
```

---

### Task 12: BatteryScreen

**Files:**
- Create: `.../qml/screens/BatteryScreen.qml`

**Interfaces:**
- Consumes: `BigNumberScreen`, `telemetry`. Produces: read-only `BatteryScreen` — big number = `telemetry.battV.toFixed(1)+" V"`; no steppers; status = plain-language from voltage thresholds; footer = setpoint volts + charge/discharge hint. Thresholds: `<11.8` "Low — APU will start to recharge" (warn); `>=12.4` "Battery healthy" (ok); else "Battery OK".

- [ ] **Step 1: Write BatteryScreen**

`screens/BatteryScreen.qml`:
```qml
import QtQuick
import "../templates"
import ".."
Item {
    function statusText(v) {
        if (v < 11.8) return "Low — APU will start to recharge";
        if (v >= 12.4) return "Battery healthy";
        return "Battery OK";
    }
    BigNumberScreen {
        anchors.fill: parent
        value: telemetry.battV.toFixed(1) + " V"
        showSteppers: false
        statusText: parent.statusText(telemetry.battV)
        pillText: telemetry.battV < 11.8 ? "LOW" : "OK"
        pillHue: telemetry.battV < 11.8 ? Theme.warn : Theme.ok
        footerStats: [ { label: "TARGET", value: telemetry.battSetpointV.toFixed(1) + " V" },
                       { label: "IGNITION", value: telemetry.ignition ? "On" : "Off" } ]
    }
}
```

- [ ] **Step 2: Verify BatteryScreen in the harness**

`Preview.content`: `ScaleRoot { BatteryScreen { anchors.fill: parent } }`. Run. Expected: "12.9 V" big, "Battery healthy", green OK pill, target/ignition footer. In `Mocks.qml` set `battV:11.5` → "LOW" warn pill + "Low — APU will start to recharge".

- [ ] **Step 3: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/screens/BatteryScreen.qml
git commit -m "feat(gobi-ui): BatteryScreen (read-only voltage + plain-language status)"
```

---

### Task 13: MenuScreen + sub-navigation

**Files:**
- Create: `.../qml/screens/MenuScreen.qml`

**Interfaces:**
- Consumes: `TileGrid`. Produces: `MenuScreen { property var shell }` — a `TileGrid` whose `onOpened(target)` calls `shell.pushScreen(<component for target>)`. Phase-1 live targets: `diag`→DiagnosticsScreen, `usermaint`→UserMaintScreen, `unit`→UnitInfoScreen. Not-yet-built tiles (alerts, log, cloud, lock, settings, maint, support) push a shared "Coming soon" placeholder so the grid is complete but honest.

- [ ] **Step 1: Write MenuScreen**

`screens/MenuScreen.qml`:
```qml
import QtQuick
import "../templates"
import ".."
Item {
    id: menu
    property var shell
    Component { id: diag;      DiagnosticsScreen {} }
    Component { id: usermaint; UserMaintScreen {} }
    Component { id: unit;      UnitInfoScreen {} }
    Component { id: soon; Item { Rectangle { anchors.fill: parent; color: Theme.bg
        Text { anchors.centerIn: parent; text: "Coming soon"; color: Theme.textMute; font.pixelSize: 18 } } } }
    function open(target) {
        if (target === "diag") menu.shell.pushScreen(diag);
        else if (target === "usermaint") menu.shell.pushScreen(usermaint);
        else if (target === "unit") menu.shell.pushScreen(unit);
        else menu.shell.pushScreen(soon);
    }
    TileGrid {
        anchors.fill: parent
        pages: [
            [ {title:"Live Diagnostics",target:"diag"}, {title:"User Maintenance",target:"usermaint"},
              {title:"Unit Information",target:"unit"}, {title:"Alerts",target:"alerts"},
              {title:"Error Log",target:"log"}, {title:"Settings",target:"settings"} ],
            [ {title:"Cloud Connection",target:"cloud"}, {title:"Screen Lock",target:"lock"},
              {title:"Maintenance",target:"maint",locked:true}, {title:"Support",target:"support"} ]
        ]
        onOpened: menu.open(target)
    }
}
```

- [ ] **Step 2: Verify MenuScreen routing in the harness**

Temporarily create empty stubs `DiagnosticsScreen.qml`/`UserMaintScreen.qml`/`UnitInfoScreen.qml` (a `Rectangle{color:Theme.bg}` each) so the components resolve. `Preview.content`: a `ScaleRoot { AppShell { railModel:[{key:"menu",label:"Menu"}]; railScreens:[ Component{ MenuScreen{ shell: /* the AppShell */ } } ] } }` — wire `shell` via a `property` you pass down (or test MenuScreen with a fake `shell` object exposing `pushScreen`). Expected: the 2-page grid renders; tapping "Live Diagnostics" pushes (blank stub) and a back gesture/pop returns; "Alerts" pushes "Coming soon". No errors. (Stubs are replaced in Tasks 14–15.)

- [ ] **Step 3: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/screens/MenuScreen.qml
git commit -m "feat(gobi-ui): MenuScreen tile launcher + sub-navigation"
```

---

### Task 14: DiagnosticsScreen (re-home DiagnosticsPage)

**Files:**
- Create: `.../qml/screens/DiagnosticsScreen.qml` (adapt content from `qml/DiagnosticsPage.qml`)

**Interfaces:**
- Consumes: `telemetry`, `StatCard`. Produces: `DiagnosticsScreen` — the existing four labelled sections (STATUS / CLIMATE / POWER & ENGINE / SERVICE), 16 read-only values, laid out to fill the content pane (no scroll). A back header row (title + a back chevron that calls the enclosing StackView's `pop()` via `StackView.view.pop()`).

- [ ] **Step 1: Write DiagnosticsScreen**

Port the `sections` array + the section/tile rendering from `DiagnosticsPage.qml` verbatim (same 16 tiles, same fault-outline logic), swapping raw hex for `Theme.*`, and add a top row:
```qml
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
Item {
    id: page
    property var sections: [
        { name: "STATUS", tiles: [
            ["Mode", telemetry.mode, false], ["Control Status", telemetry.controlStatus, false],
            ["Engine Status", telemetry.engineStatus, false], ["Error", telemetry.error, telemetry.hasError] ] },
        { name: "CLIMATE", tiles: [
            ["Cabin Temp", telemetry.cabinTempF.toFixed(0)+" °F", false], ["Setpoint", telemetry.clmtSetpointF.toFixed(0)+" °F", false],
            ["External Temp", telemetry.extTempF.toFixed(0)+" °F", false], ["Fan Speed", telemetry.fanSpeed>0?telemetry.fanSpeed+"%":"Off", false] ] },
        { name: "POWER & ENGINE", tiles: [
            ["Battery", telemetry.battV.toFixed(2)+" V", false], ["Engine RPM", telemetry.rpm+"", false],
            ["Oil Pressure", telemetry.oilOk?"OK":"LOW", !telemetry.oilOk], ["Ignition", telemetry.ignition?"On":"Off", false] ] },
        { name: "SERVICE", tiles: [
            ["Engine Hours", telemetry.engineHrs+" h", false], ["Oil Hours", telemetry.oilHrs+" h", false],
            ["Machine Hours", telemetry.machineHrs+" h", false], ["Oil Change", telemetry.oilChange, telemetry.oilChange!=="good"] ] }
    ]
    ColumnLayout {
        anchors.fill: parent; anchors.margins: 12; spacing: 6
        RowLayout { Layout.fillWidth: true
            Text { text: "‹"; color: Theme.accentBlue; font.pixelSize: 26
                MouseArea { anchors.fill: parent; anchors.margins: -10; onClicked: if (page.StackView.view) page.StackView.view.pop() } }
            Text { text: "Live Diagnostics"; color: Theme.textDim; font.pixelSize: 18; font.weight: Font.DemiBold } }
        Repeater { model: page.sections
            ColumnLayout { Layout.fillWidth: true; Layout.fillHeight: true; spacing: 3
                Text { text: modelData.name; color: Theme.textMute; font.pixelSize: 11; font.letterSpacing: 2; font.weight: Font.DemiBold }
                RowLayout { Layout.fillWidth: true; Layout.fillHeight: true; spacing: 8
                    Repeater { model: modelData.tiles
                        Rectangle { Layout.fillWidth: true; Layout.fillHeight: true; radius: 10; color: Theme.surface
                            border.color: modelData[2] ? Theme.fault : "transparent"; border.width: modelData[2] ? 1 : 0
                            Column { anchors.left: parent.left; anchors.leftMargin: 14; anchors.right: parent.right; anchors.rightMargin: 10
                                     anchors.verticalCenter: parent.verticalCenter; spacing: 2
                                Text { text: modelData[0]; color: Theme.textMute; font.pixelSize: 12; elide: Text.ElideRight; width: parent.width }
                                Text { text: modelData[1]; color: modelData[2] ? Theme.fault : Theme.text; font.pixelSize: 22
                                       font.weight: Font.DemiBold; elide: Text.ElideRight; width: parent.width } } } } } } }
    }
}
```

- [ ] **Step 2: Verify DiagnosticsScreen in the harness**

`Preview.content`: `ScaleRoot { DiagnosticsScreen { anchors.fill: parent } }`. Expected: four labelled sections filling the pane with the 16 mock values; the back chevron renders (no StackView in this preview, so it no-ops safely). No errors.

- [ ] **Step 3: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/screens/DiagnosticsScreen.qml
git commit -m "feat(gobi-ui): DiagnosticsScreen (re-homed live diagnostics)"
```

---

### Task 15: UserMaintScreen + UnitInfoScreen (re-home DevicePage)

**Files:**
- Create: `.../qml/screens/UserMaintScreen.qml`, `.../qml/screens/UnitInfoScreen.qml`

**Interfaces:**
- Consumes: `telemetry`, `devinfo`. Produces:
  - `UserMaintScreen` — hours (`engineHrs`/`machineHrs`/`oilHrs`), serial (`devinfo.serial`), and a **hold-to-reset oil timer** (port the existing 1500ms hold interaction from `DevicePage.qml`) that calls `telemetry.resetOil()`; add a `ConfirmDialog`-free hold-confirm (the 1.5s hold IS the confirm). Back chevron like Task 14.
  - `UnitInfoScreen` — Identity card (serial/hostname/fwVersion) + Network card (ethLinked dot + ipAddress/macAddress), ported from `DevicePage.qml`. Back chevron.

- [ ] **Step 1: Write UserMaintScreen**

Port the "Engine Oil" hold-to-reset card from `DevicePage.qml` (the `oilBtn`/`holdFill`/`oilHold`/`oilClear` logic, swapping hex → `Theme.*`), add hours + serial rows above it, and the back-chevron header from Task 14. Reuse the exact hold timing (1500ms) and `telemetry.resetOil()` call.

- [ ] **Step 2: Write UnitInfoScreen**

Port the Identity + Network cards from `DevicePage.qml` (serial/hostname/fwVersion; ethLinked dot + ip/mac), swapping hex → `Theme.*`, add the back-chevron header.

- [ ] **Step 3: Verify both in the harness**

`Preview.content` = `ScaleRoot{ UserMaintScreen{anchors.fill:parent} }` then `ScaleRoot{ UnitInfoScreen{anchors.fill:parent} }`. Expected: hours/serial + a hold-to-reset bar that fills over ~1.5s and shows "OIL TIMER RESET" (mock `resetOil` zeroes `oilHrs`); identity + network cards with the green link dot. No errors.

- [ ] **Step 4: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/screens/UserMaintScreen.qml meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/screens/UnitInfoScreen.qml
git commit -m "feat(gobi-ui): UserMaint + UnitInfo screens (re-homed device page)"
```

---

### Task 16: Integrate into main.qml + build wiring + on-device verification

**Files:**
- Modify: `.../qml/main.qml` (replace `SwipeView`+`TabBar` body with `ScaleRoot { AppShell {...} }`)
- Modify: gobi-ui resource/build listing (whichever the recipe uses — `.qrc`, `CMakeLists.txt` `qt_add_qml_module`/`RESOURCES`, and/or the recipe `SRC_URI` + install of `qml/`). Confirm the new `qml/` subfolders (`atoms/`, `templates/`, `screens/`, plus `Theme.qml`/`qmldir`) are shipped.
- Delete from app: remove `DashboardPage.qml`, `DiagnosticsPage.qml`, `DevicePage.qml`, `SegButton.qml`, `StepButton.qml` from the resource listing (leave files or `git rm`).

**Interfaces:**
- Consumes: everything above. Produces: the running app boots into the rail IA.

- [ ] **Step 1: Rewrite main.qml body**

Replace the `SwipeView`+`TabBar` (keep the top-level `ApplicationWindow`, splash, and the `topBar` **removed** — Header now lives inside AppShell) with:
```qml
// inside ApplicationWindow, replacing SwipeView + tabBar:
ScaleRoot {
    anchors.fill: parent
    AppShell {
        anchors.centerIn: parent   // AppShell is fixed 800x480; ScaleRoot scales it
        railModel: [ {key:"home",label:"Home"}, {key:"mode",label:"Mode"},
                     {key:"batt",label:"Battery"}, {key:"menu",label:"Menu"} ]
        railScreens: [ homeC, modeC, battC, menuC ]
    }
}
Component { id: homeC; HomeScreen {} }
Component { id: modeC; ModeScreen {} }
Component { id: battC; BatteryScreen {} }
Component { id: menuC; MenuScreen { shell: /* the AppShell id */ } }
```
Give the `AppShell` an `id: shell` and reference it as `MenuScreen { shell: shell }`. Keep the existing `splash` overlay unchanged (it sits above at `z:10`).

- [ ] **Step 2: Update the build/resource listing**

Find how QML is packaged (grep the recipe + `CMakeLists.txt` for `qml/` / `.qrc` / `qt_add_qml_module`). Add every new file (`Theme.qml`, `qmldir`, `ScaleRoot.qml`, `AppShell.qml`, `Rail.qml`, `Header.qml`, `atoms/*`, `templates/*`, `screens/*`) and remove the five deleted pages. Do **not** ship `preview/`.

- [ ] **Step 3: Sanity-load the full app in the harness**

Point the harness at the real app root by setting `Preview.content` to `Component { ScaleRoot { AppShell { railModel:[...]; railScreens:[...] } } }` mirroring `main.qml` (mocks provide `telemetry`/`devinfo`). Expected: boots to Home; rail switches Home/Mode/Battery/Menu; Menu opens Diagnostics/UserMaint/UnitInfo and back. No errors.

- [ ] **Step 4: Build the image + flash + on-device check**

Build via the CI (`gh workflow run build.yml --ref feat/gobi-ui-800x480-layout -R delorean1483/cortex-yocto`) or the team's local Yocto build; flash the resulting `.wic.zst` to the dev-kit SD (see `docs/superpowers/plans` flash workflow / `project-pending-verification` memory). Boot the dev kit.
Expected on the 1280×800 dev-kit panel: the 800×480 UI centered with small letterbox bars; Home big-number + rail; Mode/Battery/Menu navigate; Diagnostics/UserMaint/UnitInfo reachable via Menu; the setpoint chevrons and oil-reset write through to the APU. Confirm it reads correctly at true target proportions.

- [ ] **Step 5: Commit**

```bash
git add -A meta-ecofleet/recipes-ecofleet/gobi-ui/
git commit -m "feat(gobi-ui): switch app to rail IA (Home/Mode/Battery/Menu) on scaled 800x480 canvas"
```

---

## Notes for the executor
- **Preview first, device last.** Tasks 1–15 verify on the desktop `qml` harness (seconds); only Task 16 needs the slow image build. If `brew install qt` is unavailable, fall back to building the image per task — much slower; prefer the harness.
- **Styling latitude:** icons are placeholder rounded-squares; a real single-stroke line-icon set is a visual-design pass on top of this structure (out of scope for Phase 1 — the IA/structure is what fixes clutter). Keep all colors via `Theme`.
- **Do not** add Auto/Manual/Battery-Saver modes, battery %, Error Log history, or Maintenance component-test here — those are Phase 2/3 and need firmware/backend (spec §7, §9).
```
