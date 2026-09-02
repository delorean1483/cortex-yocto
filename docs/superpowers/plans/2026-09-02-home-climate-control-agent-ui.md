# Home Climate Control — Agent + UI Plan (Plan B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the gobi-ui **Home** screen into a thermostat-style climate control (big current temp, Auto/Off + setpoint, `AUTO/LOW/MED/HIGH` fan presets, glowing `control_status` bar, de-buttoned stats), plumb the new firmware `fan_auto` register through the agent + TelemetryModel, prettify status strings app-wide, and simplify the rail to Home / Mode / Menu.

**Architecture:** gobi-agent reads/writes the `fan_auto` register (fw9 / wire 8) alongside the existing mode/setpoint/fan command path; `TelemetryModel` gains `fanAuto`/`setFanAuto`; a new `StatusLabels` QML singleton maps raw firmware enums to friendly labels; `HomeScreen.qml` is rewritten; the rail loses the (redundant, read-only) Battery item — Battery remains a Mode option and its unique datum (target V) moves to Diagnostics.

**Tech Stack:** C (gobi-agent, libmodbus/cJSON), C++ (`TelemetryModel`, Qt6), QML (Qt6 Quick), Yocto recipe (`gobi-ui_1.0.bb`).

**Spec:** `docs/superpowers/specs/2026-09-02-home-climate-control-design.md`.

**Repo/branch:** `cortex-yocto` (this repo), branch `feat/home-climate-control` (stacked on `feat/apu-component-test`). Paths below are relative to repo root. gobi-ui files live under `meta-ecofleet/recipes-ecofleet/gobi-ui/files/`; agent under `meta-ecofleet/recipes-ecofleet/gobi-agent/files/`.

## Global Constraints

- **Consumes Plan A** (`fan_auto` = fw reg 9). Degrade gracefully if absent: reading reg 9 on old firmware returns an exception — the agent must treat a failed `fan_auto` read as absent (do **not** trigger a reconnect storm; mirror the component-test `modbus_read_diag` best-effort pattern), publishing no/`false` `fan_auto`; the UI then hides the AUTO segment (LOW/MED/HIGH still work via reg 12).
- `TelemetryModel` emits only the aggregate `dataChanged` signal (no per-property NOTIFY) — QML `Connections` must use `onDataChanged`.
- Optimistic-echo pattern for commands (as in the current `HomeScreen`/`ModeScreen`): apply locally, defer to telemetry when it echoes back.
- **Never display raw enum strings** (`warming_up`, `low_oil`, …) — always via `StatusLabels`.
- Fan presets are fixed UI constants: **LOW 40 / MED 70 / HIGH 100** (all ≥ firmware min-spin). Manual presets write the existing `fan` command key (reg 12); AUTO writes `fan_auto`.

## Verification reality

- **gobi-agent (C):** no local build (needs Yocto/libmodbus/cJSON). Verified by careful reading vs. the existing `main.c`/`config.h` patterns and the eventual Yocto build. (Tasks touching only the agent get a read-based review.)
- **QML:** offscreen harness runs locally —
  `QT_QUICK_CONTROLS_STYLE=Basic QT_QPA_PLATFORM=offscreen /opt/homebrew/opt/qt/bin/qml -I meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml <harness>.qml`
  (clean = empty stderr modulo the font notice). Each QML task ships a tiny harness that injects a mock `telemetry` object exposing the properties/invokables it uses. `qmllint -I <qmldir>` for syntax.
- **TelemetryModel (C++):** no host harness; QML contract pinned by a mock; C++ verified by reading + eventual build.

---

### Task 1: Agent — `fan_auto` read + command

**Files:**
- Modify: `meta-ecofleet/recipes-ecofleet/gobi-agent/files/config.h` (add `REG_FAN_AUTO`)
- Modify: `meta-ecofleet/recipes-ecofleet/gobi-agent/files/main.c` (read into telemetry; apply command key)

**Interfaces:**
- Produces: `latest.json` key `fan_auto` (bool); `command.json` key `fan_auto` (0/1) → reg 9.

- [ ] **Step 1: Add the register define** — `config.h`, next to the other climate regs:

```c
#define REG_FAN_AUTO       8    /* fw 9  auto-fan flag 0/1 (wire = fw-1)   R/W */
```

- [ ] **Step 2: Read it into telemetry (best-effort, no reconnect storm).** In `main.c` where the telemetry struct is populated, read reg 9 with the same guarded/best-effort approach the component-test used for the diag regs (a local read that does **not** go through the reconnect-triggering `RD` macro), defaulting to `false` on failure. Add a struct field `bool fan_auto;` and:

```c
/* best-effort: absent on old fw -> false, no reconnect */
t->fan_auto = modbus_read_reg_besteffort(ctx, REG_FAN_AUTO, /*dflt=*/0) ? true : false;
```

(Reuse/rename the existing best-effort helper introduced for the diag read; if it is diag-specific, generalize it to `modbus_read_reg_besteffort(ctx, wire_addr, dflt)`.)

- [ ] **Step 3: Publish the key** — in the `build_telemetry_json`/`cJSON_Add…` block near `fan_speed`:

```c
cJSON_AddBoolToObject(root, "fan_auto", t->fan_auto);
```

- [ ] **Step 4: Apply the command key** — in `apply_command_file()`, next to the `fan` key handling:

```c
const cJSON *fan_auto = cJSON_GetObjectItemCaseSensitive(root, "fan_auto");
if (cJSON_IsNumber(fan_auto)) {
    int v = fan_auto->valueint;
    if (v == 0 || v == 1) mb_write_reg(9, v, "fan_auto");
}
```

- [ ] **Step 5: Commit** (`git add` the two files; message `feat(agent): fan_auto read + command key (reg 9)`).

---

### Task 2: TelemetryModel — `fanAuto` + `setFanAuto`

**Files:**
- Modify: `…/gobi-ui/files/TelemetryModel.h` (Q_PROPERTY + invokable + member)
- Modify: `…/gobi-ui/files/TelemetryModel.cpp` (poll read + setter)

**Interfaces:**
- Produces (QML): `bool telemetry.fanAuto` (read), `telemetry.setFanAuto(bool)`. Consumed by Task 4.

- [ ] **Step 1: Header** — add near the other Q_PROPERTYs / invokables / members:

```cpp
Q_PROPERTY(bool fanAuto READ fanAuto NOTIFY dataChanged)   // with the others
...
Q_INVOKABLE void setFanAuto(bool on);
...
bool fanAuto() const { return m_fanAuto; }                 // in the getters block
...
bool m_fanAuto = false;                                    // in the members block
```

- [ ] **Step 2: poll() read** — in `TelemetryModel::poll()`, next to `m_fanSpeed`:

```cpp
m_fanAuto = o[u"fan_auto"].toBool();
```

- [ ] **Step 3: Setter** — next to `setFan`:

```cpp
void TelemetryModel::setFanAuto(bool on) { writeCommand(QStringLiteral("fan_auto"), on ? 1 : 0); }
```

- [ ] **Step 4: Verify** — mock-harness shape check: a QML harness that reads `telemetry.fanAuto` and calls `telemetry.setFanAuto(true)` loads clean under the offscreen `qml` runner against a mock exposing those. Commit (`feat(ui): TelemetryModel fanAuto + setFanAuto`).

---

### Task 3: `StatusLabels` singleton (prettify enums)

**Files:**
- Create: `…/gobi-ui/files/qml/StatusLabels.qml`
- Modify: `…/gobi-ui/files/qml/qmldir` (register singleton)
- Modify: `…/gobi-ui/gobi-ui_1.0.bb` (package the new file)
- Test: `…/gobi-ui/files/qml/harness_statuslabels.qml` (temp harness, not shipped)

**Interfaces:**
- Produces: `StatusLabels.control(s, upper)`, `StatusLabels.error(s)`, `StatusLabels.engine(s, upper)` → friendly strings (Title Case; `upper=true` → UPPERCASE). Consumed by Tasks 4 & 5.

- [ ] **Step 1: Failing harness** — `harness_statuslabels.qml` asserting `StatusLabels.control("warming_up") === "Warming Up"`, `StatusLabels.control("chillin", true) === "AT TARGET"`, `StatusLabels.error("low_oil") === "Low Oil"`; run offscreen → FAIL (no singleton).

- [ ] **Step 2: Implement** `StatusLabels.qml`:

```qml
pragma Singleton
import QtQuick
QtObject {
    readonly property var _control: ({
        "off":"Off","warming_up":"Warming Up","starting":"Starting","running":"Running",
        "defrost":"Defrost","charging":"Charging","cooling":"Cooling","chillin":"At Target","unknown":"—" })
    readonly property var _error: ({
        "none":"None","low_oil":"Low Oil","high_engine_temp":"High Engine Temp","low_battery":"Low Battery",
        "ac_low_pressure":"AC Low Pressure","ac_high_pressure":"AC High Pressure","starting_failure":"Starting Failure",
        "standby":"Standby","engine_stalled":"Engine Stalled","no_rpm":"No RPM","high_ac_pressure":"High AC Pressure","unknown":"—" })
    function control(s, upper) { var v = _control[s] !== undefined ? _control[s] : (s || "—"); return upper ? v.toUpperCase() : v }
    function engine(s, upper)  { return control(s, upper) }   // same enum family (control_status_t)
    function error(s)          { return _error[s] !== undefined ? _error[s] : (s || "—") }
}
```

- [ ] **Step 3: Register** in `qmldir`: `singleton StatusLabels 1.0 StatusLabels.qml`.

- [ ] **Step 4: Package** — add `install -m 0644 ${WORKDIR}/qml/StatusLabels.qml ${D}${datadir}/gobi-ui/qml/` to `do_install:append()` and `file://qml/StatusLabels.qml \` to `SRC_URI` in `gobi-ui_1.0.bb`.

- [ ] **Step 5: Run harness → PASS; delete harness; commit** (`feat(ui): StatusLabels singleton — prettify control/engine/error enums`).

---

### Task 4: HomeScreen redesign

**Files:**
- Rewrite: `…/gobi-ui/files/qml/screens/HomeScreen.qml`
- Test: `…/gobi-ui/files/qml/harness_home.qml` (mock telemetry with mode/cabinTempF/clmtSetpointF/fanSpeed/fanAuto/controlStatus/extTempF/battV/engineHrs/hasError/error + setMode/setSetpoint/setFan/setFanAuto)

**Interfaces:**
- Consumes: `telemetry` (Task 2 props), `StatusLabels` (Task 3), `Theme`, `Icon`.

**Layout** (per spec §1 / mockup `home-final` + `home-glow`): glow status bar (top) → weather/time → body row [rail is external | big current temp | control column: AUTO/OFF + status caption + setpoint ▲▼] → fan presets row `AUTO/LOW/MED/HIGH` → divider + passive stats.

- [ ] **Step 1: Write `harness_home.qml`** (mock telemetry) and run offscreen → FAIL (new HomeScreen not yet written / references undefined props).

- [ ] **Step 2: Implement `HomeScreen.qml`.** Full screen (no `BigNumberScreen`). Key logic + structure:

```qml
import QtQuick
import QtQuick.Layouts
import ".."
import "../atoms"
Item {
    id: home
    // optimistic mode (climate/off) + setpoint, mirroring the old HomeScreen
    property string uiMode: ""
    readonly property string effMode: uiMode !== "" ? uiMode : telemetry.mode
    readonly property bool on: effMode !== "off"
    property int target: Math.round(telemetry.clmtSetpointF)
    Component.onCompleted: target = Math.round(telemetry.clmtSetpointF)
    Timer { id: spSend; interval: 350; onTriggered: telemetry.setSetpoint(home.target) }
    function bump(d) { home.target = Math.max(55, Math.min(85, home.target + d)); spSend.restart() }
    // AUTO turns climate on AND puts fan in auto (spec §2); OFF stops.
    function setAuto(a) { home.uiMode = a ? "climate" : "off"; telemetry.setMode(home.uiMode); if (a) telemetry.setFanAuto(true) }
    // fan presets
    readonly property var presets: [{k:"LOW",v:40},{k:"MED",v:70},{k:"HIGH",v:100}]
    function pickAuto() { telemetry.setFanAuto(true) }
    function pickPreset(v) { telemetry.setFanAuto(false); telemetry.setFan(v) }
    function activeFan() { return telemetry.fanAuto ? "AUTO" : (function(){ for (var i=0;i<home.presets.length;i++) if (home.presets[i].v===telemetry.fanSpeed) return home.presets[i].k; return "" })() }
    // glow bar color + label from control_status
    function glowColor(s){ return s==="cooling"?"#2F81F7": (s==="warming_up"||s==="starting")?"#F0883E": s==="chillin"?"#39B0C4": s==="charging"?Theme.ok: "transparent" }
    readonly property bool glowOn: telemetry.controlStatus !== "off" && home.on
    // setpoint caption from control_status
    function caption(){ var s=telemetry.controlStatus; if(!home.on)return "OFF"; if(s==="cooling")return "COOLING TO"; if(s==="warming_up"||s==="starting")return "WARMING UP"; if(s==="chillin")return "AT TARGET"; if(s==="charging")return "CHARGING"; return StatusLabels.control(s,true) }
    Connections { target: telemetry; function onDataChanged(){ if (home.uiMode!=="" && telemetry.mode===home.uiMode) home.uiMode="" } }

    ColumnLayout {
        anchors.fill: parent; anchors.margins: 12; spacing: 8
        // 1. glow bar
        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 26; radius: 9; visible: home.glowOn
            color: Qt.rgba(0,0,0,0)
            border.color: home.glowColor(telemetry.controlStatus); border.width: 1
            // soft pulse
            SequentialAnimation on opacity { running: home.glowOn; loops: Animation.Infinite
                NumberAnimation { to: 0.55; duration: 1200 } NumberAnimation { to: 1.0; duration: 1200 } }
            Text { anchors.centerIn: parent; text: StatusLabels.control(telemetry.controlStatus, true)
                color: home.glowColor(telemetry.controlStatus); font.pixelSize: 12; font.letterSpacing: 2; font.weight: Font.Bold }
        }
        // 2. body: big temp + control column
        RowLayout {
            Layout.fillWidth: true; Layout.fillHeight: true; spacing: 10
            ColumnLayout { Layout.fillWidth: true
                Text { Layout.alignment: Qt.AlignHCenter; text: telemetry.cabinTempF.toFixed(0)+"°"
                    color: Theme.accentBlue; font.pixelSize: 110; font.weight: Font.Bold }
                Text { Layout.alignment: Qt.AlignHCenter; text: "CABIN NOW"; color: Theme.textMute
                    font.pixelSize: 11; font.letterSpacing: 2 } }
            ColumnLayout { Layout.preferredWidth: 150; spacing: 10
                // AUTO / OFF
                RowLayout { spacing: 0
                    Repeater { model: [{t:"AUTO",on:true},{t:"OFF",on:false}]
                        Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 40; radius: 9
                            property bool sel: modelData.on === home.on
                            color: sel ? (modelData.on?Qt.rgba(0.25,0.72,0.31,0.18):Theme.surface2) : "transparent"
                            border.color: sel ? (modelData.on?Theme.ok:Theme.border) : Theme.border; border.width: 1
                            Text { anchors.centerIn: parent; text: modelData.t; font.pixelSize: 14; font.weight: Font.Bold
                                color: sel ? (modelData.on?Theme.ok:Theme.text) : Theme.textMute }
                            MouseArea { anchors.fill: parent; onClicked: home.setAuto(modelData.on) } } } }
                Text { Layout.alignment: Qt.AlignHCenter; text: home.caption(); color: Theme.textMute; font.pixelSize: 10; font.letterSpacing: 1 }
                RowLayout { Layout.alignment: Qt.AlignHCenter; spacing: 10
                    Text { text: home.target; color: Theme.accentBlue; font.pixelSize: 40; font.weight: Font.Bold }
                    ColumnLayout { spacing: 4
                        Rectangle { Layout.preferredWidth: 48; Layout.preferredHeight: 34; radius: 8; color: Theme.surface; border.color: Theme.border; border.width: 1
                            Text { anchors.centerIn: parent; text:"▲"; color: Theme.accentBlue } MouseArea { anchors.fill: parent; onClicked: home.bump(1) } }
                        Rectangle { Layout.preferredWidth: 48; Layout.preferredHeight: 34; radius: 8; color: Theme.surface; border.color: Theme.border; border.width: 1
                            Text { anchors.centerIn: parent; text:"▼"; color: Theme.accentBlue } MouseArea { anchors.fill: parent; onClicked: home.bump(-1) } } } } }
        }
        // 3. fan presets: AUTO / LOW / MED / HIGH  (AUTO hidden if firmware lacks fan_auto — see note)
        RowLayout { Layout.fillWidth: true; Layout.preferredHeight: 52; spacing: 8
            Text { text: "FAN"; color: Theme.textMute; font.pixelSize: 12; Layout.preferredWidth: 34 }
            Rectangle { Layout.fillWidth: true; Layout.fillHeight: true; radius: 10
                property bool sel: home.activeFan()==="AUTO"
                color: sel?Qt.rgba(0.25,0.72,0.31,0.18):Theme.surface; border.color: sel?Theme.ok:Theme.border; border.width: 1
                Text { anchors.centerIn: parent; text:"AUTO"; color: sel?Theme.ok:Theme.textDim; font.weight: Font.Bold }
                MouseArea { anchors.fill: parent; onClicked: home.pickAuto() } }
            Repeater { model: home.presets
                Rectangle { Layout.fillWidth: true; Layout.fillHeight: true; radius: 10
                    property bool sel: home.activeFan()===modelData.k
                    color: sel?Qt.rgba(0.18,0.5,0.9,0.18):Theme.surface; border.color: sel?Theme.accentBlue:Theme.border; border.width: 1
                    Text { anchors.centerIn: parent; text: modelData.k; color: sel?Theme.accentBlue:Theme.textDim; font.weight: Font.Bold }
                    MouseArea { anchors.fill: parent; onClicked: home.pickPreset(modelData.v) } } }
        }
        // 4. divider + passive stats
        Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 1; color: Theme.border }
        RowLayout { Layout.fillWidth: true; spacing: 16
            Repeater { model: [ {l:"OUTSIDE", v: telemetry.extTempF.toFixed(0)+"°F"},
                                {l:"BATTERY", v: telemetry.battV.toFixed(1)+" V"},
                                {l:"ENGINE HRS", v: telemetry.engineHrs+""} ]
                RowLayout { spacing: 6
                    Text { text: modelData.v; color: Theme.textDim; font.pixelSize: 13; font.weight: Font.DemiBold }
                    Text { text: modelData.l; color: Theme.textMute; font.pixelSize: 11 } } }
        }
    }
}
```

- [ ] **Step 3: Run harness → PASS** (clean stderr). Iterate on any binding warnings.

- [ ] **Step 4: Graceful-degrade note** — the AUTO fan segment should hide when firmware lacks `fan_auto` (agent publishes it absent). v1: since the agent defaults `fan_auto=false`, AUTO stays visible but harmless; a stricter hide (publish a separate `fan_auto_supported`) is a documented fast-follow — leave AUTO visible for v1.

- [ ] **Step 5: Commit** (`feat(ui): thermostat Home — current temp, Auto/Off + setpoint, fan presets, glow status bar`).

---

### Task 5: Rail → Home/Mode/Menu; Diagnostics prettify + battery target

**Files:**
- Modify: `…/gobi-ui/files/qml/main.qml` (drop Battery from `railModel`/`railScreens`)
- Modify: `…/gobi-ui/files/qml/screens/DiagnosticsScreen.qml` (apply `StatusLabels`; add battery target to POWER section)
- (Leave `BatteryScreen.qml` in the tree but unreferenced by the rail; Mode's "battery" option already sets `mode=battery`.)
- Test: reuse `harness_home`-style offscreen loads for the touched screens.

**Interfaces:** consumes `StatusLabels` (Task 3).

- [ ] **Step 1: Rail** — in `main.qml`, change:

```qml
railModel: [ {key:"home",label:"Home",icon:"home"}, {key:"mode",label:"Mode",icon:"mode"},
             {key:"menu",label:"Menu",icon:"menu"} ]
railScreens: [ homeC, modeC, menuC ]
```

(remove the `batt` entry and `battC` from the arrays; the `Component { id: battC; BatteryScreen {} }` may stay defined but unused, or be deleted.)

- [ ] **Step 2: Diagnostics prettify** — in `DiagnosticsScreen.qml`, wrap the STATUS section's status/error values with `StatusLabels` (add `import ".."` already present; `StatusLabels` is a singleton):

```qml
["Control Status", StatusLabels.control(telemetry.controlStatus), false],
["Engine Status",  StatusLabels.control(telemetry.engineStatus), false],
["Error",          StatusLabels.error(telemetry.error), telemetry.hasError]
```

- [ ] **Step 3: Battery target (no-loss)** — add to the POWER & ENGINE tiles in `DiagnosticsScreen.qml`:

```qml
["Batt Target", telemetry.battSetpointV.toFixed(1)+" V", false]
```

(place it in a POWER row; keep four-per-row layout tidy.)

- [ ] **Step 4: Verify** offscreen loads of `main.qml` (rail) and `DiagnosticsScreen.qml` are clean; the rail shows three items; Diagnostics shows friendly labels + batt target.

- [ ] **Step 5: Commit** (`feat(ui): rail -> Home/Mode/Menu; Diagnostics friendly labels + batt target`).

---

## Accepted v1 deviations / fast-follows
- AUTO fan segment stays visible even on firmware without `fan_auto` (harmless; a `fan_auto_supported` hide is a fast-follow).
- User-configurable fan presets, live-tune ramp reg, admin/cloud presets — all deferred (spec §Fast-follows).
- `BatteryScreen.qml` kept in-tree but unreferenced (Battery is a Mode option; its target moved to Diagnostics). Deleting the file is optional cleanup.
- Home `tempColor` tinting of the big number can reuse the old ramp if desired (v1 uses `Theme.accentBlue` flat; low-risk polish).

## Final whole-branch review
After all tasks: whole-branch review (mode/setpoint/fan/fan_auto command round-trips vs. agent regs; `StatusLabels` covers every enum value; no raw strings remain; graceful-degrade path; rail/Battery IA). Then bench-validate against Plan A firmware.
