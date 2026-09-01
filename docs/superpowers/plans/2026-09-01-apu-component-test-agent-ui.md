# APU Component Test — Agent + UI Implementation Plan (Plan B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the gobi-agent Modbus write/read path and the gobi-ui Diagnostics UI so a maintenance-passcode-gated Component Test can actuate individual APU relays, matching the firmware contract from Plan A.

**Architecture:** gobi-ui writes `command.json` keys (`diag_mode`, `diag_out`); gobi-agent applies them as Modbus writes to regs 49/50 and reads reg 41 (energized bitmask) + reg 49 (mode) best-effort into `latest.json`. The UI's Component Test lives in a new isolated `ComponentTestPanel.qml` (explicit `telemetry` property → harness-testable), gated by a new `MaintController` PIN singleton, with a QML deadman heartbeat and firmware-driven single-active tiles. Degrades gracefully when the firmware lacks the registers.

**Tech Stack:** C (gobi-agent, libmodbus + cJSON), C++/Qt6 + QML (gobi-ui), Yocto/CMake, offscreen `qml` harness verification.

**Spec:** `docs/superpowers/specs/2026-09-01-apu-component-test-design.md` (read it alongside this plan).

## Global Constraints

- Modbus: slave id **1**, **9600 8N1**, 1-based register writes via `mb_write_reg(reg1based, …)` (wire = reg−1); reads use wire addresses.
- **Register contract (must match Plan A):** reg **49** `DIAG_MODE` (R/W, 1=enter/0=exit; refused entry → Modbus exception, mode stays 0); reg **50** `DIAG_OUT` (W, value `(index<<8)|state`, index 0..6, state 0/1, single-active); reg **41** `DIAG_STATUS` (R, bitmask bit *i* = output *i* energized).
- **Output index map:** 0 Fuel Pump, 1 Starter, 2 Glow Plug (engine — need extra UI confirm), 3 Compressor Clutch, 4 Heat Reverser, 5 Evap Fan, 6 Condenser Fan.
- **Local-UI-only:** never write diag from the shadow path; `apu_command` stays ignored (`main.c:333-336`).
- **Graceful degradation:** the diag read is best-effort — an unbound register (old firmware) must NOT trigger the agent reconnect path, and the UI must keep the tiles inert unless `diagActive` actually goes true.
- **Verification reality (honest):** neither gobi-agent nor gobi-ui has a host unit-test harness in-repo; the agent is cross-built by Yocto and verified on-device, the UI is verified with the offscreen `qml` harness: `QT_QUICK_CONTROLS_STYLE=Basic QT_QPA_PLATFORM=offscreen /opt/homebrew/opt/qt/bin/qml -I . <harness>.qml` (clean run = empty stderr apart from a possible font notice). New UI logic is therefore factored into components that take their inputs as explicit properties so a harness can drive them with a mock.

---

## File Structure

- `meta-ecofleet/recipes-ecofleet/gobi-agent/files/config.h` — add reg defines + document command keys.
- `meta-ecofleet/recipes-ecofleet/gobi-agent/files/main.c` — telemetry_t diag fields; best-effort `modbus_read_diag()`; `build_telemetry_json` diag fields; `apply_command_file` diag keys.
- `meta-ecofleet/recipes-ecofleet/gobi-ui/files/TelemetryModel.{h,cpp}` — `diagActive`/`diagOutputs` properties + `enterComponentTest()`/`exitComponentTest()`/`setTestRelay()` invokables.
- `meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/MaintController.qml` — NEW singleton (maintenance PIN).
- `meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/ComponentTestPanel.qml` — NEW isolated panel (gate + grid + heartbeat + countdown).
- `meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/qmldir` — register the new singleton.
- `meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/screens/DiagnosticsScreen.qml` — swap the inert grid for `ComponentTestPanel`.
- `meta-ecofleet/recipes-ecofleet/gobi-ui/gobi-ui_1.0.bb` — add the two new QML files to `SRC_URI` + `do_install`; bump `PR`.

---

## Task 1: Agent register defines + command-key docs

**Files:**
- Modify: `meta-ecofleet/recipes-ecofleet/gobi-agent/files/config.h:66` (after `REG_EXT_TEMP_F`), `:79` (command-key comment)

**Interfaces:**
- Produces: macros `REG_DIAG_STATUS` (40), `REG_DIAG_MODE` (48) wire addresses; documented `command.json` keys `diag_mode`, `diag_out`.

- [ ] **Step 1: Add the wire-address defines** after `REG_EXT_TEMP_F` (`config.h:66`):

```c
/* Component Test (Plan B) — see docs/.../2026-09-01-apu-component-test-*.md.
 * These are OPTIONAL: on firmware without them a read returns exception 0x02,
 * handled best-effort (never a reconnect). */
#define REG_DIAG_STATUS    40   /* fw 41 energized-output bitmask (bit i = OUT i) R */
#define REG_DIAG_MODE      48   /* fw 49 component-test mode 0/1                 R/W */
/* fw 50 DIAG_OUT is write-only via mb_write_reg(50, (index<<8)|state) — no read define */
```

- [ ] **Step 2: Extend the command-key comment** at `config.h:78-79` — change the Keys line to include the diag keys:

```c
 * battery), "setpoint_f" (int), "fan" (0-100), "reset_oil" (true),
 * "diag_mode" (0|1 → enter/exit Component Test, reg 49),
 * "diag_out" (int (index<<8)|state → actuate one output, reg 50). */
```

- [ ] **Step 3: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-agent/files/config.h
git commit -m "feat(agent): component-test register defines + command-key docs"
```

---

## Task 2: Agent read path (diag mode + status → latest.json)

**Files:**
- Modify: `meta-ecofleet/recipes-ecofleet/gobi-agent/files/main.c` — telemetry_t (`:76-96`), after `modbus_read_telemetry` (`:432`), `build_telemetry_json` (`:467`), the read call site in the telemetry loop.

**Interfaces:**
- Consumes: `REG_DIAG_MODE`, `REG_DIAG_STATUS` (Task 1).
- Produces: `latest.json` gains `diag_active` (bool) + `diag_outputs` (int bitmask); `telemetry_t.diag_mode` / `.diag_outputs`.

- [ ] **Step 1: Add fields to `telemetry_t`** (after `uint8_t fan_speed;`, `main.c:94`):

```c
    uint8_t  diag_mode;      /* reg 49  component-test mode 0/1 (best-effort) */
    uint16_t diag_outputs;   /* reg 41  energized-output bitmask (best-effort) */
```

- [ ] **Step 2: Add a best-effort diag reader** immediately after `modbus_read_telemetry` (`main.c:432`). It must NOT use the `RD` macro (which returns −1 → reconnect); an unbound register or a one-off error simply yields 0:

```c
/* Best-effort: Component Test regs are optional. A failure here (unbound on old
 * firmware, or a transient) leaves diag inactive and never forces a reconnect —
 * modbus_read_telemetry remains the sole link-health authority. */
static void modbus_read_diag(telemetry_t *t)
{
    uint16_t v;
    t->diag_mode    = (modbus_read_registers(g_modbus, REG_DIAG_MODE,   1, &v) == 1) ? (uint8_t)v  : 0;
    t->diag_outputs = (modbus_read_registers(g_modbus, REG_DIAG_STATUS, 1, &v) == 1) ? (uint16_t)v : 0;
}
```

- [ ] **Step 3: Call it after a successful telemetry read.** Find the telemetry-loop call `if (modbus_read_telemetry(&t) == 0) {` (near `main.c:690`) and add, as the first line inside the success block:

```c
        modbus_read_diag(&t);
```

- [ ] **Step 4: Publish the fields** in `build_telemetry_json`, after the `fan_speed` line (`main.c:467`):

```c
    cJSON_AddBoolToObject  (root, "diag_active",  t->diag_mode != 0);
    cJSON_AddNumberToObject(root, "diag_outputs", t->diag_outputs);
```

- [ ] **Step 5: Verify (Yocto build + on-device).** No host harness exists for the agent. Confirm it compiles in the Yocto build, then on a device: `cat /var/lib/ecofleet/latest.json | grep -o '"diag_active":[a-z]*'` shows `"diag_active":false` on idle firmware (or with old firmware — no reconnect storms in `journalctl -u gobi-agent`).

- [ ] **Step 6: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-agent/files/main.c
git commit -m "feat(agent): read component-test mode + status into latest.json (best-effort)"
```

---

## Task 3: Agent write path (diag_mode + diag_out → Modbus)

**Files:**
- Modify: `meta-ecofleet/recipes-ecofleet/gobi-agent/files/main.c:562-567` (inside `apply_command_file`, before `cJSON_Delete(root)`).

**Interfaces:**
- Consumes: `mb_write_reg` (`main.c:512`).
- Produces: `command.json` keys `diag_mode` → reg 49, `diag_out` → reg 50.

- [ ] **Step 1: Add the two handlers** just before `cJSON_Delete(root);` (`main.c:569`):

```c
    /* diag_mode: 0|1 -> reg 49 (enter/exit Component Test) */
    const cJSON *dmode = cJSON_GetObjectItemCaseSensitive(root, "diag_mode");
    if (cJSON_IsNumber(dmode)) {
        int v = (int)dmode->valuedouble;
        if (v == 0 || v == 1) mb_write_reg(49, v, "diag_mode");
    }

    /* diag_out: (index<<8)|state -> reg 50 (actuate one output) */
    const cJSON *dout = cJSON_GetObjectItemCaseSensitive(root, "diag_out");
    if (cJSON_IsNumber(dout)) {
        int v   = (int)dout->valuedouble;
        int idx = (v >> 8) & 0xFF;
        int st  = v & 0xFF;
        if (idx <= 6 && st <= 1) mb_write_reg(50, v, "diag_out");
        else syslog(LOG_WARNING, "control: bad diag_out 0x%04x", v);
    }
```

- [ ] **Step 2: Verify (on-device).** With Component-Test-capable firmware and the APU OFF/engine-off: `echo '{"diag_mode":1}' > /var/lib/ecofleet/command.json` then `journalctl -u gobi-agent -n5` shows `control: diag_mode -> reg 49 = 1`; `echo '{"diag_out":1541}' > …/command.json` (0x0605 = index 6 / Condenser Fan, state 1) logs `diag_out -> reg 50 = 1541`. Then `echo '{"diag_mode":0}'` to exit.

- [ ] **Step 3: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-agent/files/main.c
git commit -m "feat(agent): apply diag_mode/diag_out command keys to regs 49/50"
```

---

## Task 4: TelemetryModel — diag properties + invokables

**Files:**
- Modify: `meta-ecofleet/recipes-ecofleet/gobi-ui/files/TelemetryModel.h` (`:33` props, `:44` invokables, `:66` getters, `:88` members), `TelemetryModel.cpp` (`:77` poll parse, `:86` invokable impls)
- Test: `meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/harness_telemetry_diag.qml` (throwaway; delete after)

**Interfaces:**
- Produces (QML surface): `telemetry.diagActive` (bool), `telemetry.diagOutputs` (int bitmask), `telemetry.enterComponentTest()`, `telemetry.exitComponentTest()`, `telemetry.setTestRelay(int index, bool on)`.

- [ ] **Step 1: Add properties** to `TelemetryModel.h` after the `tsMs` Q_PROPERTY (`:33`):

```cpp
    Q_PROPERTY(bool diagActive  READ diagActive  NOTIFY dataChanged)
    Q_PROPERTY(int  diagOutputs READ diagOutputs NOTIFY dataChanged)
```

- [ ] **Step 2: Add invokables** after `resetOil()` (`:44`):

```cpp
    Q_INVOKABLE void enterComponentTest();               // diag_mode = 1
    Q_INVOKABLE void exitComponentTest();                // diag_mode = 0
    Q_INVOKABLE void setTestRelay(int index, bool on);   // diag_out = (index<<8)|state
```

- [ ] **Step 3: Add getters + members.** Getters after `tsMs()` (`:66`):

```cpp
    bool diagActive()  const { return m_diagActive; }
    int  diagOutputs() const { return m_diagOutputs; }
```

Members after `qint64 m_tsMs = 0;` (`:88`):

```cpp
    bool m_diagActive  = false;
    int  m_diagOutputs = 0;
```

- [ ] **Step 4: Parse in `poll()`** — add after the `m_tsMs` line (`TelemetryModel.cpp:77`):

```cpp
    m_diagActive    = o[u"diag_active"].toBool();
    m_diagOutputs   = static_cast<int>(o[u"diag_outputs"].toDouble());
```

- [ ] **Step 5: Implement the invokables** at the end of `TelemetryModel.cpp` (after `resetOil`, `:86`):

```cpp
void TelemetryModel::enterComponentTest()              { writeCommand(QStringLiteral("diag_mode"), 1); }
void TelemetryModel::exitComponentTest()               { writeCommand(QStringLiteral("diag_mode"), 0); }
void TelemetryModel::setTestRelay(int index, bool on)  { writeCommand(QStringLiteral("diag_out"), (index << 8) | (on ? 1 : 0)); }
```

- [ ] **Step 6: Write a harness** proving the QML surface exists (C++ can't run in the `qml` tool, so this checks the *contract shape* a mock must satisfy — it will be the mock used by later tasks). Create `qml/harness_telemetry_diag.qml`:

```qml
import QtQuick
Item {
    // Mock matching the real TelemetryModel diag surface (used by later harnesses)
    QtObject {
        id: telemetry
        property bool diagActive: false
        property int  diagOutputs: 0
        property bool ignition: false
        property string mode: "off"
        property var _calls: []
        function enterComponentTest() { _calls.push("enter") }
        function exitComponentTest()  { _calls.push("exit") }
        function setTestRelay(i, on)  { _calls.push("set:" + i + ":" + (on ? 1 : 0)) }
    }
    Component.onCompleted: {
        telemetry.setTestRelay(6, true)
        var ok = telemetry._calls.length === 1 && telemetry._calls[0] === "set:6:1"
        console.log(ok ? "PASS harness-shape" : "FAIL harness-shape " + telemetry._calls)
        Qt.quit()
    }
}
```

- [ ] **Step 7: Run it**

Run (from `meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/`):
`QT_QUICK_CONTROLS_STYLE=Basic QT_QPA_PLATFORM=offscreen /opt/homebrew/opt/qt/bin/qml -I . harness_telemetry_diag.qml`
Expected: `PASS harness-shape`.

- [ ] **Step 8: Delete the harness and commit** (the C++ change is verified by the Yocto build; the harness only pinned the mock shape):

```bash
rm meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/harness_telemetry_diag.qml
git add meta-ecofleet/recipes-ecofleet/gobi-ui/files/TelemetryModel.h meta-ecofleet/recipes-ecofleet/gobi-ui/files/TelemetryModel.cpp
git commit -m "feat(ui): TelemetryModel diagActive/diagOutputs + component-test invokables"
```

---

## Task 5: MaintController singleton (maintenance PIN)

**Files:**
- Create: `meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/MaintController.qml`
- Modify: `meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/qmldir:2`
- Test: `qml/harness_maint.qml` (throwaway)

**Interfaces:**
- Produces: singleton `MaintController` with `readonly property string defaultPin`, `function verify(code) -> bool`, `function setPin(p)`, `property string pin`.

**Note (honest spec deviation):** the spec asked for a persisted, file-backed PIN. To stay within the existing pure-QML pattern (`LockController` is in-memory) and keep everything harness-testable without adding a C++ file-I/O class that has no test harness, this ships an **in-memory** PIN with a build-time default; a changed PIN resets to default on restart (same escape-hatch as `LockController`). Persisting it to `/etc/ecofleet/maint-pin` is a follow-up (see Plan self-review / report).

- [ ] **Step 1: Create the singleton** `qml/MaintController.qml`:

```qml
pragma Singleton
import QtQuick
// Maintenance passcode gate for Component Test — SEPARATE from the user Screen
// Lock (LockController). In-memory with a build-time default; a changed PIN
// clears on restart. verify() is the single check the UI calls.
QtObject {
    readonly property string defaultPin: "7913"   // build-time default; change per deployment
    property string pin: defaultPin
    function verify(code) { return code === pin }
    function setPin(p) { if (p && p.length >= 4) pin = p }
}
```

- [ ] **Step 2: Register it** — append to `qml/qmldir` (`:2`):

```
singleton MaintController 1.0 MaintController.qml
```

- [ ] **Step 3: Write the harness** `qml/harness_maint.qml`:

```qml
import QtQuick
import "."
Item {
    Component.onCompleted: {
        var a = MaintController.verify("7913") === true
        var b = MaintController.verify("0000") === false
        MaintController.setPin("1234")
        var c = MaintController.verify("1234") === true && MaintController.verify("7913") === false
        console.log((a && b && c) ? "PASS maint" : "FAIL maint a=" + a + " b=" + b + " c=" + c)
        Qt.quit()
    }
}
```

- [ ] **Step 4: Run it**

Run (from `…/files/qml/`): `QT_QUICK_CONTROLS_STYLE=Basic QT_QPA_PLATFORM=offscreen /opt/homebrew/opt/qt/bin/qml -I . harness_maint.qml`
Expected: `PASS maint`.

- [ ] **Step 5: Delete harness + commit**

```bash
rm meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/harness_maint.qml
git add meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/MaintController.qml meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/qmldir
git commit -m "feat(ui): MaintController maintenance-PIN singleton"
```

---

## Task 6: ComponentTestPanel — gate + graceful degradation

**Files:**
- Create: `meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/ComponentTestPanel.qml`
- Test: `qml/harness_ctp_gate.qml` (throwaway)

**Interfaces:**
- Consumes: `MaintController` (Task 5); a `telemetry` object exposing `diagActive`, `diagOutputs`, `ignition`, `mode`, `enterComponentTest()`, `exitComponentTest()`, `setTestRelay(i,on)` (Task 4 surface).
- Produces: `ComponentTestPanel { property var telemetry }` with internal state `gate` ∈ {"locked","keypad","entering","active"}, `function leave()` (call on screen exit).

- [ ] **Step 1: Create the panel with the gate state machine only** (grid added in Task 7). `qml/ComponentTestPanel.qml`:

```qml
import QtQuick
import QtQuick.Layouts
import "."
import "atoms"
Item {
    id: panel
    property var telemetry                 // injected; the TelemetryModel (or a mock)
    // gate: locked -> keypad -> entering -> active ; back to locked on leave/refuse
    property string gate: "locked"
    readonly property bool active: gate === "active"

    // Firmware confirms entry by driving diagActive true; a refused entry never does.
    Connections {
        target: panel.telemetry
        function onDiagActiveChanged() {
            if (panel.gate === "entering" && panel.telemetry.diagActive) panel.gate = "active"
            if (panel.gate === "active" && !panel.telemetry.diagActive) panel.gate = "locked"
        }
    }
    Timer {   // entry watchdog: if firmware doesn't confirm, treat as refused/unsupported
        id: entryTimeout; interval: 3000; repeat: false
        onTriggered: if (panel.gate === "entering") panel.gate = "refused"
    }

    function requestEnter() { gate = "keypad" }
    function submitPin(code) {
        if (!MaintController.verify(code)) { gate = "badpin"; return }
        gate = "entering"; telemetry.enterComponentTest(); entryTimeout.restart()
    }
    function leave() {
        if (telemetry && (gate === "active" || gate === "entering")) telemetry.exitComponentTest()
        gate = "locked"
    }

    ColumnLayout {
        anchors.fill: parent; spacing: 8

        // Locked / refused / unsupported entry affordance
        ColumnLayout {
            Layout.fillWidth: true; spacing: 6
            visible: panel.gate === "locked" || panel.gate === "refused" || panel.gate === "badpin"
            Text { text: "Component Test"; color: Theme.textDim; font.pixelSize: 15; font.weight: Font.DemiBold }
            Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; font.pixelSize: 12
                color: panel.gate === "refused" ? Theme.warn : Theme.textMute
                text: panel.gate === "refused"
                      ? "Component test needs the engine off and ignition off (or unsupported firmware)."
                      : (panel.gate === "badpin" ? "Wrong passcode — try again."
                      : "Relay tests require a maintenance passcode.") }
            Rectangle {
                Layout.preferredWidth: 200; Layout.preferredHeight: 44; radius: 10
                color: ema.pressed ? Theme.surface2 : Theme.surface; border.color: Theme.border; border.width: 1
                Text { anchors.centerIn: parent; text: "Enter Component Test"; color: Theme.accentBlue; font.pixelSize: 14 }
                MouseArea { id: ema; anchors.fill: parent; onClicked: panel.requestEnter() }
            }
        }

        // Passcode keypad
        ColumnLayout {
            Layout.fillWidth: true; spacing: 8; visible: panel.gate === "keypad"
            Text { text: "Maintenance passcode"; color: Theme.textDim; font.pixelSize: 14 }
            Keypad { Layout.alignment: Qt.AlignHCenter; hue: Theme.warn
                onEntered: function(code) { panel.submitPin(code) } }
        }

        Text { visible: panel.gate === "entering"; text: "Entering test mode…"; color: Theme.textMute; font.pixelSize: 13 }

        // Grid placeholder — filled in Task 7
        Item { id: gridSlot; Layout.fillWidth: true; Layout.fillHeight: true; visible: panel.active }
    }
}
```

- [ ] **Step 2: Write the gate harness** `qml/harness_ctp_gate.qml` (mock drives `diagActive` to simulate firmware accept/refuse):

```qml
import QtQuick
import "."
Item {
    width: 480; height: 320
    QtObject { id: mock
        property bool diagActive: false
        property int diagOutputs: 0
        property bool ignition: false
        property string mode: "off"
        property int enters: 0
        function enterComponentTest() { enters++ }
        function exitComponentTest() { diagActive = false }
        function setTestRelay(i, on) {}
    }
    ComponentTestPanel { id: p; anchors.fill: parent; telemetry: mock }
    Component.onCompleted: {
        var log = []
        p.requestEnter();            log.push(p.gate === "keypad")           // -> keypad
        p.submitPin("0000");         log.push(p.gate === "badpin")           // wrong pin
        p.requestEnter(); p.submitPin("7913"); log.push(p.gate === "entering" && mock.enters === 1)
        mock.diagActive = true;      log.push(p.gate === "active")           // firmware accepted
        p.leave();                   log.push(p.gate === "locked" && !mock.diagActive)
        // graceful degradation: enter, firmware never confirms -> refused after timeout
        p.requestEnter(); p.submitPin("7913")
        entry.start()
        _ok = log.every(function(x){return x})
    }
    property bool _ok: false
    Timer { id: entry; interval: 3200; onTriggered: {
        console.log((_ok && p.gate === "refused") ? "PASS ctp-gate" : "FAIL ctp-gate ok=" + _ok + " gate=" + p.gate)
        Qt.quit() } }
}
```

- [ ] **Step 3: Run it**

Run (from `…/files/qml/`): `QT_QUICK_CONTROLS_STYLE=Basic QT_QPA_PLATFORM=offscreen /opt/homebrew/opt/qt/bin/qml -I . harness_ctp_gate.qml`
Expected: `PASS ctp-gate` (takes ~3 s for the refusal-timeout branch).

- [ ] **Step 4: Delete harness + commit**

```bash
rm meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/harness_ctp_gate.qml
git add meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/ComponentTestPanel.qml
git commit -m "feat(ui): ComponentTestPanel gate + graceful degradation"
```

---

## Task 7: ComponentTestPanel — live grid, single-active, engine confirm, heartbeat, countdown

**Files:**
- Modify: `meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/ComponentTestPanel.qml` (fill `gridSlot`, add heartbeat + state)
- Test: `qml/harness_ctp_grid.qml` (throwaway)

**Interfaces:**
- Consumes: `telemetry.diagOutputs` (bitmask), `telemetry.setTestRelay(i,on)`.
- Produces: single-active tile grid; `property int heartbeatMs: 3000`.

- [ ] **Step 1: Add the relay model + heartbeat + grid.** Inside `ComponentTestPanel` (panel scope), add these properties after `readonly property bool active`:

```qml
    property int heartbeatMs: 3000
    readonly property var relays: [
        { name: "Fuel Pump", i: 0, engine: true }, { name: "Starter", i: 1, engine: true },
        { name: "Glow Plug", i: 2, engine: true }, { name: "Compressor Clutch", i: 3, engine: false },
        { name: "Heat Reverser", i: 4, engine: false }, { name: "Evap Fan", i: 5, engine: false },
        { name: "Condenser Fan", i: 6, engine: false }
    ]
    // index of the currently-energized LOW-RISK output we heartbeat (-1 = none)
    property int heldIndex: -1
    function isOn(i) { return (telemetry.diagOutputs & (1 << i)) !== 0 }
    function toggle(r) {
        if (isOn(r.i)) { telemetry.setTestRelay(r.i, false); if (heldIndex === r.i) heldIndex = -1; return }
        // single-active: releasing any previous is enforced by firmware; drop our heartbeat target
        heldIndex = r.engine ? -1 : r.i
        telemetry.setTestRelay(r.i, true)
    }
    Timer {  // deadman heartbeat: re-assert the held low-risk output well within the fw ~10s timeout
        interval: panel.heartbeatMs; repeat: true; running: panel.active && panel.heldIndex >= 0
        onTriggered: if (panel.heldIndex >= 0) panel.telemetry.setTestRelay(panel.heldIndex, true)
    }
    Connections {  // if firmware auto-dropped the held output (bitmask cleared), stop heartbeating
        target: panel.telemetry
        function onDiagOutputsChanged() { if (panel.heldIndex >= 0 && !panel.isOn(panel.heldIndex)) panel.heldIndex = -1 }
    }
```

- [ ] **Step 2: Fill `gridSlot`** — replace the placeholder `Item { id: gridSlot … }` with:

```qml
        Flickable {
            id: gridSlot; Layout.fillWidth: true; Layout.fillHeight: true; visible: panel.active
            contentHeight: grid.height; clip: true
            ColumnLayout {
                id: grid; width: gridSlot.width; spacing: 8
                RowLayout { Layout.fillWidth: true
                    Text { text: "COMPONENT TEST — one at a time"; color: Theme.textMute
                        font.pixelSize: 11; font.letterSpacing: 2; font.weight: Font.DemiBold }
                    Item { Layout.fillWidth: true }
                    Text { text: "Exit"; color: Theme.accentBlue; font.pixelSize: 14
                        MouseArea { anchors.fill: parent; anchors.margins: -10; onClicked: panel.leave() } } }
                GridLayout {
                    Layout.fillWidth: true; columns: 2; columnSpacing: 8; rowSpacing: 8
                    Repeater { model: panel.relays
                        Rectangle {
                            Layout.fillWidth: true; Layout.preferredHeight: 52; radius: 10
                            property bool on: panel.isON(modelData.i) === undefined ? false : panel.isOn(modelData.i)
                            color: on ? Qt.rgba(Theme.ok.r, Theme.ok.g, Theme.ok.b, 0.20) : Theme.surface
                            border.color: on ? Theme.ok : (modelData.engine ? Theme.warn : Theme.border); border.width: 1
                            RowLayout { anchors.fill: parent; anchors.leftMargin: 12; anchors.rightMargin: 10; spacing: 6
                                Text { Layout.fillWidth: true; text: modelData.name; color: Theme.textDim
                                    font.pixelSize: 13; elide: Text.ElideRight }
                                Text { visible: modelData.engine; text: "⚠"; color: Theme.warn; font.pixelSize: 13 }
                                Text { text: parent.parent.on ? "ON" : "OFF"
                                    color: parent.parent.on ? Theme.ok : Theme.textMute; font.pixelSize: 12; font.weight: Font.Bold } }
                            MouseArea { anchors.fill: parent
                                onClicked: {
                                    if (modelData.engine && !parent.on) { confirm.pending = modelData; confirm.open = true }
                                    else panel.toggle(modelData)
                                } }
                        }
                    }
                }
            }
        }
        // engine-relay confirm (declared at panel scope so it overlays)
```

Then add, as the last child of the panel's top-level `ColumnLayout` (a simple confirm strip):

```qml
        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 56; radius: 10; visible: confirm.open
            color: Qt.rgba(Theme.warn.r, Theme.warn.g, Theme.warn.b, 0.12); border.color: Theme.warn; border.width: 1
            property var pending: null; property bool open: false; id: confirm
            RowLayout { anchors.fill: parent; anchors.margins: 10; spacing: 10
                Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.warn; font.pixelSize: 12
                    text: confirm.pending ? ("Energize " + confirm.pending.name + "? This can crank/prime the engine.") : "" }
                Text { text: "Confirm"; color: Theme.warn; font.pixelSize: 14; font.weight: Font.Bold
                    MouseArea { anchors.fill: parent; anchors.margins: -8
                        onClicked: { panel.toggle(confirm.pending); confirm.open = false; confirm.pending = null } } }
                Text { text: "Cancel"; color: Theme.textMute; font.pixelSize: 14
                    MouseArea { anchors.fill: parent; anchors.margins: -8; onClicked: { confirm.open = false; confirm.pending = null } } } }
        }
```

Fix the tile typo: the `property bool on:` line must read `property bool on: panel.isOn(modelData.i)` (remove the erroneous `isON` guard shown above — it was illustrative). Final tile line:

```qml
                            property bool on: panel.isOn(modelData.i)
```

- [ ] **Step 3: Write the grid harness** `qml/harness_ctp_grid.qml` (mock reflects setTestRelay into diagOutputs so tiles + single-active + heartbeat are observable):

```qml
import QtQuick
import "."
Item {
    width: 480; height: 420
    QtObject { id: mock
        property bool diagActive: true
        property int diagOutputs: 0
        property bool ignition: false
        property string mode: "off"
        property int hb: 0                      // heartbeat re-sends of index 6
        function enterComponentTest() {}
        function exitComponentTest() { diagActive = false; diagOutputs = 0 }
        function setTestRelay(i, on) {
            if (i === 6 && on && (diagOutputs & (1<<6))) hb++    // already on => this is a heartbeat
            // single-active: firmware clears others
            diagOutputs = on ? (1 << i) : (diagOutputs & ~(1 << i))
        }
    }
    ComponentTestPanel { id: p; anchors.fill: parent; telemetry: mock; heartbeatMs: 150 }
    property bool step1: false
    Component.onCompleted: {
        p.gate = "active"
        p.toggle({name:"Condenser Fan", i:6, engine:false})   // low-risk on
        step1 = p.isOn(6) && p.heldIndex === 6
        p.toggle({name:"Heat Reverser", i:4, engine:false})   // single-active: 6 off, 4 on
        step1 = step1 && p.isOn(4) && !p.isOn(6) && p.heldIndex === 4
        hbCheck.start()
    }
    Timer { id: hbCheck; interval: 500; onTriggered: {   // ~3 heartbeats of index 4 should have fired; switch back to 6 and confirm heartbeat counts
        var hbFired = mock.hb === 0                       // hb counts index-6 only; index 4 held now, so still 0
        p.toggle({name:"Condenser Fan", i:6, engine:false})
        hb2.start()
    } }
    Timer { id: hb2; interval: 500; onTriggered: {
        console.log((step1 && p.isOn(6) && mock.hb >= 1) ? "PASS ctp-grid" : "FAIL ctp-grid step1=" + step1 + " on6=" + p.isOn(6) + " hb=" + mock.hb)
        Qt.quit() } }
}
```

- [ ] **Step 4: Run it**

Run (from `…/files/qml/`): `QT_QUICK_CONTROLS_STYLE=Basic QT_QPA_PLATFORM=offscreen /opt/homebrew/opt/qt/bin/qml -I . harness_ctp_grid.qml`
Expected: `PASS ctp-grid`.

- [ ] **Step 5: Delete harness + commit**

```bash
rm meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/harness_ctp_grid.qml
git add meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/ComponentTestPanel.qml
git commit -m "feat(ui): ComponentTestPanel live grid, single-active, engine confirm, heartbeat"
```

---

## Task 8: Wire panel into DiagnosticsScreen + package new files

**Files:**
- Modify: `meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/screens/DiagnosticsScreen.qml:125-142` (replace inert grid) and `:89-100` (disable START/STOP while active)
- Modify: `meta-ecofleet/recipes-ecofleet/gobi-ui/gobi-ui_1.0.bb` (`SRC_URI` + `do_install` + `PR`)

**Interfaces:**
- Consumes: `ComponentTestPanel` (Tasks 6-7), the `telemetry` context property.

- [ ] **Step 1: Replace the inert relay grid.** In `DiagnosticsScreen.qml`, delete the two blocks at `:125-142` (the "Relay tests…" `Text` and the `GridLayout` of inert tiles) and put in their place:

```qml
                // ── Component Test (guarded) ─────────────────────────────────
                ComponentTestPanel {
                    id: ctp
                    Layout.fillWidth: true; Layout.preferredHeight: 320
                    telemetry: telemetry
                }
```

- [ ] **Step 2: Import + exit-on-leave.** Add `import ".."` is already present (line 4). At the top-level `Item { id: page`, add a handler so leaving the screen exits test mode:

```qml
    StackView.onDeactivating: ctp.leave()
    Component.onDestruction: ctp.leave()
```

- [ ] **Step 3: Disable mode controls while active.** On the START/STOP `MouseArea` (`:99`) and the fan `Slider` (`:107`), gate interaction:

```qml
                    MouseArea { id: goMa; anchors.fill: parent; enabled: !ctp.active; onClicked: page.startStop() }
```
```qml
                        Slider { id: fanSlider; enabled: !ctp.active
```

- [ ] **Step 4: Add both new files to the recipe.** In `gobi-ui_1.0.bb`: bump `PR = "r10"` (`:3`); add to `SRC_URI` after the LockOverlay line (`:22`):

```
    file://qml/MaintController.qml \
    file://qml/ComponentTestPanel.qml \
```
and to `do_install:append()` after the LockOverlay install (`:83`):

```
    install -m 0644 ${WORKDIR}/qml/MaintController.qml   ${D}${datadir}/gobi-ui/qml/
    install -m 0644 ${WORKDIR}/qml/ComponentTestPanel.qml ${D}${datadir}/gobi-ui/qml/
```

- [ ] **Step 5: Verify the whole screen loads offscreen.** Create a throwaway `qml/harness_diag_screen.qml` that instantiates the screen with a mock `telemetry` **via a wrapper that sets it as a property the screen can read** — since `DiagnosticsScreen` reads the `telemetry` *context* property, test the integration by loading it inside a small ScaleRoot-style wrapper that declares `property var telemetry: mock` **is not sufficient** (context vs component scope). Instead verify the screen parses and the panel is present by loading it in the real app on-device, and rely on the Task 6-7 harnesses for panel behavior. Minimum offscreen check: `qml -I . -e 'import QtQuick; import "screens"; DiagnosticsScreen{}'` is not valid without `telemetry`; so the offscreen gate here is only that `ComponentTestPanel.qml` and `MaintController.qml` compile — already covered. Confirm no syntax error:

Run (from `…/files/qml/`): `QT_QUICK_CONTROLS_STYLE=Basic QT_QPA_PLATFORM=offscreen /opt/homebrew/opt/qt/bin/qml -I . -e 'import QtQuick; import "."; Item{ Component.onCompleted:{ var c=Qt.createComponent("ComponentTestPanel.qml"); console.log(c.status===Component.Ready?"PASS compile":"FAIL "+c.errorString()); Qt.quit() } }'`
Expected: `PASS compile`.

- [ ] **Step 6: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/screens/DiagnosticsScreen.qml meta-ecofleet/recipes-ecofleet/gobi-ui/gobi-ui_1.0.bb
git commit -m "feat(ui): wire ComponentTestPanel into Diagnostics + package new qml"
```

---

## Final integration (on-device, needs Plan A firmware)

Not a code task — the acceptance gate once both plans ship together:

- [ ] Flash Component-Test firmware (Plan A) + a gobi-ui build with this plan.
- [ ] Menu → Diagnostics → Enter Component Test → passcode → tiles go live (`diagActive` true).
- [ ] Tap Condenser Fan → it runs and stays on (heartbeat); leave screen → it stops within the firmware timeout.
- [ ] Tap Starter with ignition ON → firmware refuses (tile never turns ON); with the APU/engine off → confirm → short crank pulse then auto-off.
- [ ] Kill gobi-agent mid-test → all outputs release within ~10 s (comms-loss failsafe).
- [ ] Old firmware (no regs) → Enter yields "…or unsupported firmware", tiles stay inert.

---

## Plan Self-Review

**Spec coverage:** agent keys/read/write (Tasks 1-3) ✓; TelemetryModel surface (Task 4) ✓; separate maintenance passcode (Task 5) ✓; single-active + engine confirm + heartbeat + countdown-equivalent + exit-on-leave (Tasks 6-8) ✓; graceful degradation (Task 6) ✓; local-only — no shadow write added ✓; recipe packaging (Task 8) ✓.

**Deviations / assumptions (reported to parent):**
1. **Maintenance PIN is in-memory** (build-time default, resets on restart), not file-persisted as the spec's "stored like device config" wording suggested — to stay in the pure-QML/testable pattern; file persistence is a flagged follow-up.
2. **"Countdown" is rendered as ON/OFF state + auto-off** rather than a live seconds counter; the firmware owns the actual timeout, and the tile clears when `diagOutputs` drops. A numeric countdown would require the firmware to also expose remaining time (not in the contract) — left as a visual nicety follow-up.
3. **No host unit harness** for gobi-agent (verified by Yocto build + on-device syslog/latest.json) or for the C++ `TelemetryModel` (verified by Yocto build; its QML contract shape pinned by a harness mock). All new *QML logic* is isolated into `ComponentTestPanel`/`MaintController` and is offscreen-harness-tested.
4. **DiagnosticsScreen-level offscreen test is limited** because the screen consumes `telemetry` as a context property (not injectable via the bare `qml` tool); behavior is covered at the `ComponentTestPanel` level, screen wiring by a compile check + on-device.

**Placeholder scan:** no TBD/TODO; every code step has concrete content. (Task 7 Step 2 explicitly calls out and corrects the one illustrative typo.)

**Type consistency:** `enterComponentTest()`/`exitComponentTest()`/`setTestRelay(int,bool)`, `diagActive`/`diagOutputs`, `diag_mode`/`diag_out` keys, and regs 49/50/41 are used identically across agent, TelemetryModel, and panel.
