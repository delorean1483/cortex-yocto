# Heater Coprocessor — Cortex Follow-up (regs 68–75) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the heater coprocessor's type, phase, setpoint control and fault clearing (G0B1 Modbus regs 68–75) through gobi-agent, the gobi-ui HeaterCard, and the cloud dashboard, without changing anything for units on older firmware.

**Architecture:** gobi-agent reads regs 68–75 best-effort and emits extra `heater_*` keys only when they exist (`heater_ext`); a pure, host-tested `heater_ext` module holds every decode. Two new control paths (setpoint °F, clear-fault) go through the existing `command.json` and shadow `desired.heater` machinery (sentinel fields, ack-on-success, seq compare-and-clear). The UI and dashboard key off `heater_phase` presence to switch between the legacy and the extended view.

**Tech Stack:** C11 + cJSON + libmodbus (gobi-agent, host tests via `tests/run.sh`), Qt6/QML (gobi-ui, offscreen preview runner), Node 20 Lambdas (plain `node x.test.js`), React + Vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-10-06-heater-coproc-cortex-design.md`

## Global Constraints

- Firmware reg N = Modbus wire N−1. Regs used: 68 type, 69 setpoint °C (RW 5–30), 70 caps (bit1 = setpoint), 71 phase (6 = fault), 72 vendor state, 75 command (write 3 = CLEAR_FAULT; read = CMD_RESULT).
- Older firmware (no regs 68–75): `latest.json`, shadow `reported.heater`, ingest points and every UI must be **unchanged**.
- `heater_present` = state register read OK **and** (reg 68 unreadable **or** type ≠ 0).
- Setpoint UI range 41–86 °F; firmware gets whole °C via `heater_f_to_c` (rounded, clamped 5–30).
- Clear Fault: on-screen two-tap `ConfirmButton`; dashboard behind `useCan('heater')` + confirm; it never starts the heater. Remote apply order: clear_fault → setpoint → level → on.
- No UI for reg 74.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017uxgfN1Y67gVKWmTWmpxxk
  ```

## Review Focus

1. **Heaterless unit on new firmware:** card hidden, no `heater` sub-object in reported → `heater_present_from` truth table (Task 1) + `test_shadow_heater` old-shape check (Task 2).
2. **A `clear_fault:false` or out-of-range setpoint alone must not create a pending remote command** (would ack nothing and null a real command) → `test_shadow_heater` (Task 2).
3. **A pending remote clear augmented by a later `on:1`** must keep both (clear first) → `test_shadow_heater` (Task 2).
4. **Old payload in the dashboard** keeps the "VEVOR diesel heater — Off" title and level control → HeaterTab test (Task 5).
5. **Fault with no vendor code (error 255)** must not show "Heater error code: 255" / "ERR 255" → HeaterTab test (Task 5) + HeaterCard `hasCode` (Task 3 preview shot 02c).

## How to apply each patch

Each patch block below is labelled with a path under `.superpowers/patches/`. Save the block's contents to that path and run `git apply <path>` from the repo root (`git apply --check` first). The blocks were generated against `main` @ the spec commit and verified to apply in task order.

---

### Task 1: `heater_ext` pure module (agent)

**Files:**
- Create: `meta-ecofleet/recipes-ecofleet/gobi-agent/files/heater_ext.h`, `heater_ext.c`, `tests/test_heater_ext.c`
- Modify: `gobi-agent/tests/run.sh`, `gobi-agent/files/CMakeLists.txt`, `gobi-agent/gobi-agent_1.0.bb`

**Interfaces — Produces:** `heater_type_name(unsigned)`, `heater_phase_name(unsigned)`, `heater_control_name(unsigned caps)`, `int heater_c_to_f(int)`, `int heater_f_to_c(int)`, `void heater_vendor_state_str(unsigned, char*, size_t)`, `bool heater_present_from(bool state_ok, bool type_ok, unsigned type)`; macros `HEATER_CAP_SETPOINT`, `HEATER_PHASE_FAULT 6`, `HEATER_CMD_CLEAR_FAULT 3`, `HEATER_SETPOINT_F_MIN 41`, `HEATER_SETPOINT_F_MAX 86`.

- [ ] **Step 1: Write the failing test** — apply the test patch (new `tests/test_heater_ext.c` + its `run.sh` block):

`.superpowers/patches/t1-test.patch`:

````diff
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-agent/tests/run.sh b/meta-ecofleet/recipes-ecofleet/gobi-agent/tests/run.sh
index f7f9f9c..0cf4844 100755
--- a/meta-ecofleet/recipes-ecofleet/gobi-agent/tests/run.sh
+++ b/meta-ecofleet/recipes-ecofleet/gobi-agent/tests/run.sh
@@ -121,3 +121,9 @@ cc -std=c11 -Wall -Wextra -Wpedantic -g -fsanitize=address,undefined \
 cc -std=c11 -Wall -Wextra -Wpedantic -g -fsanitize=address,undefined \
    -I"$files" -I"$cjson/include" "$here/test_event_log.c" "$files/event_log.c" \
    -L"$cjson/lib" -lcjson -o "$here/test_event_log" && "$here/test_event_log"
+
+# Heater coprocessor extended block (fw regs 68..75): pure helpers.
+cc -std=c11 -Wall -Wextra -Wpedantic -g -fsanitize=address,undefined \
+   -I"$files" "$here/test_heater_ext.c" "$files/heater_ext.c" \
+   -o "$here/test_heater_ext" && "$here/test_heater_ext"
+
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-agent/tests/test_heater_ext.c b/meta-ecofleet/recipes-ecofleet/gobi-agent/tests/test_heater_ext.c
new file mode 100644
index 0000000..7d2bc49
--- /dev/null
+++ b/meta-ecofleet/recipes-ecofleet/gobi-agent/tests/test_heater_ext.c
@@ -0,0 +1,46 @@
+#include "heater_ext.h"
+#include <string.h>
+#include <stdio.h>
+static int fails;
+#define CHECK(c) do{ if(!(c)){ printf("FAIL %s:%d %s\n",__FILE__,__LINE__,#c); fails++; } }while(0)
+int main(void){
+    CHECK(strcmp(heater_type_name(0),"none")==0);
+    CHECK(strcmp(heater_type_name(1),"vevor")==0);
+    CHECK(strcmp(heater_type_name(2),"autoterm")==0);
+    CHECK(strcmp(heater_type_name(7),"unknown")==0);
+
+    CHECK(strcmp(heater_phase_name(0),"off")==0);
+    CHECK(strcmp(heater_phase_name(1),"detecting")==0);
+    CHECK(strcmp(heater_phase_name(2),"starting")==0);
+    CHECK(strcmp(heater_phase_name(3),"running")==0);
+    CHECK(strcmp(heater_phase_name(4),"stopping")==0);
+    CHECK(strcmp(heater_phase_name(5),"cooldown")==0);
+    CHECK(strcmp(heater_phase_name(6),"fault")==0);
+    CHECK(strcmp(heater_phase_name(7),"unknown")==0);
+
+    CHECK(strcmp(heater_control_name(HEATER_CAP_LEVEL),"level")==0);
+    CHECK(strcmp(heater_control_name(HEATER_CAP_SETPOINT|0x24u),"setpoint")==0);
+    CHECK(strcmp(heater_control_name(0),"level")==0);
+
+    /* degC <-> degF: firmware range ends + a typical cabin setting */
+    CHECK(heater_c_to_f(5)==41);  CHECK(heater_c_to_f(30)==86);
+    CHECK(heater_c_to_f(22)==72); CHECK(heater_c_to_f(-10)==14);
+    CHECK(heater_f_to_c(41)==5);  CHECK(heater_f_to_c(86)==30);
+    CHECK(heater_f_to_c(72)==22); CHECK(heater_f_to_c(73)==23);
+    CHECK(heater_f_to_c(0)==5);   CHECK(heater_f_to_c(120)==30);   /* clamped */
+    for (int c = 5; c <= 30; c++) CHECK(heater_f_to_c(heater_c_to_f(c))==c);  /* round-trip */
+
+    char b[8];
+    heater_vendor_state_str(0x0400u,b,sizeof b); CHECK(strcmp(b,"4.0")==0);
+    heater_vendor_state_str(0x0204u,b,sizeof b); CHECK(strcmp(b,"2.4")==0);
+    heater_vendor_state_str(0xFFFFu,b,4);        CHECK(strlen(b)==3);     /* truncated, terminated */
+
+    /* present gate truth table */
+    CHECK(heater_present_from(false,false,0)==false);  /* no heater block at all */
+    CHECK(heater_present_from(true, false,0)==true);   /* old firmware: legacy rule */
+    CHECK(heater_present_from(true, true, 0)==false);  /* new fw, nothing detected */
+    CHECK(heater_present_from(true, true, 2)==true);   /* new fw, AUTOTERM */
+    CHECK(heater_present_from(false,true, 1)==false);  /* state read failed */
+    printf(fails?"test_heater_ext FAILED (%d)\n":"test_heater_ext ok\n", fails);
+    return fails?1:0;
+}
````

- [ ] **Step 2: Run it to verify it fails**

Run: `cd meta-ecofleet/recipes-ecofleet/gobi-agent && cc -std=c11 -Wall -Wextra -Wpedantic -fsanitize=address,undefined -Ifiles tests/test_heater_ext.c files/heater_ext.c -o /tmp/t_he`
Expected: FAIL — `heater_ext.h: No such file or directory`.

- [ ] **Step 3: Implement** — apply:

`.superpowers/patches/t1-impl.patch`:

````diff
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-agent/files/CMakeLists.txt b/meta-ecofleet/recipes-ecofleet/gobi-agent/files/CMakeLists.txt
index 37cfd8e..dbca958 100644
--- a/meta-ecofleet/recipes-ecofleet/gobi-agent/files/CMakeLists.txt
+++ b/meta-ecofleet/recipes-ecofleet/gobi-agent/files/CMakeLists.txt
@@ -48,6 +48,7 @@ target_sources(gobi-agent PRIVATE
     bl_transport_serial.c
     stm32_flash_task.c
     heater_fields.c
+    heater_ext.c
     apu_command.c
     ota_status.c
 )
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-agent/files/heater_ext.c b/meta-ecofleet/recipes-ecofleet/gobi-agent/files/heater_ext.c
new file mode 100644
index 0000000..ab3dbe7
--- /dev/null
+++ b/meta-ecofleet/recipes-ecofleet/gobi-agent/files/heater_ext.c
@@ -0,0 +1,55 @@
+#include "heater_ext.h"
+#include <stdio.h>
+
+const char *heater_type_name(unsigned type)
+{
+    switch (type) {
+    case 0: return "none";
+    case 1: return "vevor";
+    case 2: return "autoterm";
+    default: return "unknown";
+    }
+}
+
+const char *heater_phase_name(unsigned phase)
+{
+    static const char *const names[] = {
+        "off", "detecting", "starting", "running", "stopping", "cooldown", "fault"
+    };
+    return (phase < sizeof(names) / sizeof(names[0])) ? names[phase] : "unknown";
+}
+
+const char *heater_control_name(unsigned caps)
+{
+    return (caps & HEATER_CAP_SETPOINT) ? "setpoint" : "level";
+}
+
+/* n/d rounded half away from zero, for d > 0. */
+static int div_round(int n, int d)
+{
+    return (n >= 0) ? (n + d / 2) / d : -((-n + d / 2) / d);
+}
+
+int heater_c_to_f(int c)
+{
+    return div_round(c * 9, 5) + 32;
+}
+
+int heater_f_to_c(int f)
+{
+    int c = div_round((f - 32) * 5, 9);
+    if (c < HEATER_SETPOINT_C_MIN) c = HEATER_SETPOINT_C_MIN;
+    if (c > HEATER_SETPOINT_C_MAX) c = HEATER_SETPOINT_C_MAX;
+    return c;
+}
+
+void heater_vendor_state_str(unsigned v, char *buf, size_t len)
+{
+    if (!buf || len == 0) return;
+    snprintf(buf, len, "%u.%u", (v >> 8) & 0xFFu, v & 0xFFu);
+}
+
+bool heater_present_from(bool state_ok, bool type_ok, unsigned type)
+{
+    return state_ok && (!type_ok || type != 0);
+}
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-agent/files/heater_ext.h b/meta-ecofleet/recipes-ecofleet/gobi-agent/files/heater_ext.h
new file mode 100644
index 0000000..5f60a12
--- /dev/null
+++ b/meta-ecofleet/recipes-ecofleet/gobi-agent/files/heater_ext.h
@@ -0,0 +1,46 @@
+/* heater_ext.h — pure helpers for the heater coprocessor's extended Modbus
+ * block (EF-G0B1R firmware regs 68..75 / wire 67..74): heater type, generic
+ * phase, control mode from CAPS, setpoint degF<->degC, vendor state string,
+ * and the heater_present gate. No I/O; host-tested by
+ * ../tests/test_heater_ext.c.
+ */
+#pragma once
+#include <stdbool.h>
+#include <stddef.h>
+#include <stdint.h>
+
+#define HEATER_CAP_LEVEL     0x0001u   /* fw reg 70 bit0 */
+#define HEATER_CAP_SETPOINT  0x0002u   /* fw reg 70 bit1 */
+#define HEATER_PHASE_FAULT   6u        /* fw reg 71 value */
+#define HEATER_CMD_CLEAR_FAULT 3u      /* fw reg 75 command */
+
+#define HEATER_SETPOINT_F_MIN 41
+#define HEATER_SETPOINT_F_MAX 86
+#define HEATER_SETPOINT_C_MIN 5
+#define HEATER_SETPOINT_C_MAX 30
+
+/* fw reg 68: 0 none, 1 VEVOR, 2 AUTOTERM -> "none"|"vevor"|"autoterm"|"unknown". */
+const char *heater_type_name(unsigned type);
+
+/* fw reg 71: 0 off,1 detecting,2 starting,3 running,4 stop_requested,
+ * 5 cooldown,6 fault -> "off"|"detecting"|"starting"|"running"|"stopping"|
+ * "cooldown"|"fault", else "unknown". */
+const char *heater_phase_name(unsigned phase);
+
+/* "setpoint" if CAP_SETPOINT is set in caps, else "level". */
+const char *heater_control_name(unsigned caps);
+
+/* Whole degF from whole degC, rounded half away from zero. */
+int heater_c_to_f(int c);
+
+/* Whole degC from whole degF, rounded half away from zero, clamped 5..30. */
+int heater_f_to_c(int f);
+
+/* fw reg 72 (major<<8 | sub) -> "major.sub" into buf (always NUL-terminated). */
+void heater_vendor_state_str(unsigned v, char *buf, size_t len);
+
+/* heater_present: the legacy block answered (state_ok) AND either the
+ * extended block is absent (old firmware: type_ok false) or a heater type is
+ * actually detected (type != 0). Hides the card on heaterless units running
+ * coprocessor-era firmware, where reg 55 always answers. */
+bool heater_present_from(bool state_ok, bool type_ok, unsigned type);
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-agent/gobi-agent_1.0.bb b/meta-ecofleet/recipes-ecofleet/gobi-agent/gobi-agent_1.0.bb
index 82f652b..7e5bd30 100644
--- a/meta-ecofleet/recipes-ecofleet/gobi-agent/gobi-agent_1.0.bb
+++ b/meta-ecofleet/recipes-ecofleet/gobi-agent/gobi-agent_1.0.bb
@@ -10,7 +10,9 @@ SRC_URI = " \
     file://shadow.h \
     file://config.h \
     file://heater_fields.h \
+    file://heater_ext.h \
     file://heater_fields.c \
+    file://heater_ext.c \
     file://apu_command.h \
     file://apu_command.c \
     file://ota_status.h \
````

- [ ] **Step 4: Run the agent suite**

Run: `sh meta-ecofleet/recipes-ecofleet/gobi-agent/tests/run.sh 2>&1 | tail -3`
Expected: exit 0, last line `test_heater_ext ok`.

- [ ] **Step 5: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-agent
git commit -m "feat(gobi-agent): heater_ext helpers for coprocessor regs 68-75

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017uxgfN1Y67gVKWmTWmpxxk"
```

---

### Task 2: Agent wiring — reads, telemetry keys, local commands, shadow desired/reported

**Files:**
- Create: `gobi-agent/tests/test_shadow_heater.c`
- Modify: `gobi-agent/files/shadow.h`, `shadow.c`, `main.c`, `config.h`, `tests/run.sh`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces: `shadow_heater_cmd_t {int on, level, setpoint_f; bool clear_fault}`; `bool shadow_peek_heater_cmd(shadow_heater_cmd_t *cmd, unsigned *seq)` (replaces the `int*,int*,unsigned*` form — `main.c` is its only caller); `shadow_config_t.heater_setpoint_f/heater_clear_fault`; `shadow_reported_t.heater_ext/heater_type/heater_phase/heater_control/heater_setpoint_f/heater_fault`; `config.h` `REG_HEATER_TYPE 67 … REG_HEATER_COMMAND 74`; `latest.json` keys `heater_type, heater_phase, heater_control, heater_setpoint_f, heater_vendor_state, heater_fault, heater_cmd_result` (only when `heater_ext`); `command.json` keys `heater_setpoint_f`, `heater_clear_fault`.

- [ ] **Step 1: Write the failing test** — apply:

`.superpowers/patches/t2-test.patch`:

````diff
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-agent/tests/run.sh b/meta-ecofleet/recipes-ecofleet/gobi-agent/tests/run.sh
--- a/meta-ecofleet/recipes-ecofleet/gobi-agent/tests/run.sh
+++ b/meta-ecofleet/recipes-ecofleet/gobi-agent/tests/run.sh
@@ -127,3 +127,12 @@
    -I"$files" "$here/test_heater_ext.c" "$files/heater_ext.c" \
    -o "$here/test_heater_ext" && "$here/test_heater_ext"
 
+# desired.heater setpoint_f/clear_fault + reported.heater extended fields
+# through the REAL shadow.c.
+cc -std=c11 -Wall -Wextra -Wpedantic -g -fsanitize=address,undefined \
+   -DLOCATION_JSON_SHARED='"/tmp/test_shadow_heater_location.json"' \
+   -DLOCATION_JSON_LEGACY='"/tmp/test_shadow_heater_location.legacy.json"' \
+   -I"$here/mqstub" -I"$files" -I"$cjson/include" \
+   "$here/test_shadow_heater.c" "$files/location.c" "$files/state_path.c" \
+   -L"$cjson/lib" -lcjson -lpthread \
+   -o "$here/test_shadow_heater" && "$here/test_shadow_heater"
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-agent/tests/test_shadow_heater.c b/meta-ecofleet/recipes-ecofleet/gobi-agent/tests/test_shadow_heater.c
new file mode 100644
index 0000000..f26b00f
--- /dev/null
+++ b/meta-ecofleet/recipes-ecofleet/gobi-agent/tests/test_shadow_heater.c
@@ -0,0 +1,103 @@
+/* Host test for the heater remote-control surface in shadow.c: desired.heater
+ * setpoint_f / clear_fault (heater coprocessor, fw regs 69/75) alongside the
+ * existing on/level, and the reported.heater extended fields.
+ *
+ * shadow.c is compiled in (via #include) so we reach the static
+ * apply_desired(); tests/mqstub/ stands in for libmosquitto and the publish
+ * stub below captures the reported-state payload.
+ */
+#define _POSIX_C_SOURCE 200809L
+#include <stdio.h>
+#include <string.h>
+#include <stdbool.h>
+#include <cjson/cJSON.h>
+
+#include "shadow.h"
+#include "shadow.c"
+
+static char last_payload[4096];
+int mosquitto_publish(struct mosquitto *m, int *mid, const char *topic,
+                      int payloadlen, const void *payload, int qos, bool retain) {
+    (void)m; (void)mid; (void)topic; (void)qos; (void)retain;
+    if (payloadlen > 0 && (size_t)payloadlen < sizeof(last_payload)) {
+        memcpy(last_payload, payload, (size_t)payloadlen);
+        last_payload[payloadlen] = '\0';
+    }
+    return MOSQ_ERR_SUCCESS;
+}
+int mosquitto_subscribe(struct mosquitto *m, int *mid, const char *sub, int qos) {
+    (void)m; (void)mid; (void)sub; (void)qos; return MOSQ_ERR_SUCCESS;
+}
+
+static int fails;
+#define CHECK(c) do{ if(!(c)){ printf("FAIL %s:%d %s\n",__FILE__,__LINE__,#c); fails++; } }while(0)
+
+static void desired(const char *heater_json) {
+    char buf[256];
+    snprintf(buf, sizeof buf, "{\"heater\":%s}", heater_json);
+    cJSON *d = cJSON_Parse(buf);
+    apply_desired(d);
+    cJSON_Delete(d);
+}
+
+int main(void) {
+    shadow_heater_cmd_t c;
+    unsigned seq;
+    shadow_init("TEST-001", "1.2.73", NULL, NULL);
+
+    /* nothing pending */
+    CHECK(!shadow_peek_heater_cmd(&c, &seq));
+
+    /* bare setpoint */
+    desired("{\"setpoint_f\":72}");
+    CHECK(shadow_peek_heater_cmd(&c, &seq));
+    CHECK(c.setpoint_f == 72 && c.on == -1 && c.level == -1 && !c.clear_fault);
+    shadow_ack_heater_cmd(seq);
+    CHECK(!shadow_peek_heater_cmd(&c, &seq));
+
+    /* bare clear_fault */
+    desired("{\"clear_fault\":true}");
+    CHECK(shadow_peek_heater_cmd(&c, &seq));
+    CHECK(c.clear_fault && c.on == -1 && c.setpoint_f == -1);
+    shadow_ack_heater_cmd(seq);
+
+    /* clear_fault:false and out-of-range setpoint alone are not a command */
+    desired("{\"clear_fault\":false,\"setpoint_f\":90}");
+    CHECK(!shadow_peek_heater_cmd(&c, &seq));
+    desired("{\"setpoint_f\":40}");
+    CHECK(!shadow_peek_heater_cmd(&c, &seq));
+
+    /* a pending clear is augmented (not clobbered) by a later on:1 */
+    desired("{\"clear_fault\":true}");
+    desired("{\"on\":1}");
+    CHECK(shadow_peek_heater_cmd(&c, &seq));
+    CHECK(c.clear_fault && c.on == 1);
+    shadow_ack_heater_cmd(seq);
+
+    /* after an ack the next message starts fresh (no stale clear_fault) */
+    desired("{\"level\":4}");
+    CHECK(shadow_peek_heater_cmd(&c, &seq));
+    CHECK(c.level == 4 && !c.clear_fault && c.setpoint_f == -1);
+    shadow_ack_heater_cmd(seq);
+
+    /* reported: extended fields only when heater_ext */
+    shadow_reported_t r;
+    memset(&r, 0, sizeof r);
+    r.heater_present = true;
+    strcpy(r.heater_state, "off");
+    shadow_publish_reported((struct mosquitto *)0x1, &r);
+    CHECK(strstr(last_payload, "\"heater\"") != NULL);
+    CHECK(strstr(last_payload, "\"phase\"") == NULL);          /* old firmware shape */
+    r.heater_ext = true;
+    strcpy(r.heater_type, "autoterm"); strcpy(r.heater_phase, "fault");
+    strcpy(r.heater_control, "setpoint"); r.heater_setpoint_f = 72; r.heater_fault = true;
+    shadow_publish_reported((struct mosquitto *)0x1, &r);
+    CHECK(strstr(last_payload, "\"type\":\"autoterm\"") != NULL);
+    CHECK(strstr(last_payload, "\"phase\":\"fault\"") != NULL);
+    CHECK(strstr(last_payload, "\"control\":\"setpoint\"") != NULL);
+    CHECK(strstr(last_payload, "\"setpoint_f\":72") != NULL);
+    CHECK(strstr(last_payload, "\"fault\":true") != NULL);
+
+    printf(fails ? "test_shadow_heater FAILED (%d)\n" : "test_shadow_heater ok\n", fails);
+    return fails ? 1 : 0;
+}
````

- [ ] **Step 2: Run it to verify it fails**

Run: `sh meta-ecofleet/recipes-ecofleet/gobi-agent/tests/run.sh 2>&1 | tail -5`
Expected: FAIL compiling `test_shadow_heater.c` — unknown type `shadow_heater_cmd_t`.

- [ ] **Step 3: Implement** — apply:

`.superpowers/patches/t2-impl.patch`:

````diff
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-agent/files/config.h b/meta-ecofleet/recipes-ecofleet/gobi-agent/files/config.h
index 5dbe651..090066b 100644
--- a/meta-ecofleet/recipes-ecofleet/gobi-agent/files/config.h
+++ b/meta-ecofleet/recipes-ecofleet/gobi-agent/files/config.h
@@ -93,6 +93,15 @@
 #define REG_HEATER_VALID_FR    64   /* fw 65 */
 #define REG_HEATER_CSUM_FAIL   65   /* fw 66 */
 #define REG_HEATER_XPORT_ERR   66   /* fw 67 */
+/* Heater coprocessor extended block (g0b1-firmware PR #12): OPTIONAL, absent
+ * on older firmware (every read then fails with exception 0x02). */
+#define REG_HEATER_TYPE        67   /* fw 68 0 none,1 VEVOR,2 AUTOTERM       R  */
+#define REG_HEATER_SETPOINT_C  68   /* fw 69 5..30 degC                      RW */
+#define REG_HEATER_CAPS        69   /* fw 70 capability bits                 R  */
+#define REG_HEATER_PHASE       70   /* fw 71 generic phase 0..6              R  */
+#define REG_HEATER_VENDOR_ST   71   /* fw 72 major<<8|sub                    R  */
+#define REG_HEATER_DETECT      72   /* fw 73 detect_result<<8|line_sense     R  */
+#define REG_HEATER_COMMAND     74   /* fw 75 write 3 = clear fault; read = result RW */
 
 /* ── SQLite offline buffer ───────────────────────────────────────────────── */
 #define SQLITE_DB_PATH      "/var/lib/ecofleet/telemetry.db"
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-agent/files/main.c b/meta-ecofleet/recipes-ecofleet/gobi-agent/files/main.c
index 89ae40e..5ac9479 100644
--- a/meta-ecofleet/recipes-ecofleet/gobi-agent/files/main.c
+++ b/meta-ecofleet/recipes-ecofleet/gobi-agent/files/main.c
@@ -15,6 +15,7 @@
 #include "event_log.h"
 #include "stm32_flash_task.h"
 #include "heater_fields.h"
+#include "heater_ext.h"
 #include "apu_command.h"
 #include "ota_status.h"
 
@@ -126,6 +127,14 @@ typedef struct {
     uint16_t heater_valid_frames; /* reg 65                           */
     uint16_t heater_csum_fail;    /* reg 66                           */
     uint16_t heater_xport_err;    /* reg 67                           */
+    /* Heater coprocessor extended block (fw regs 68..75, best-effort). */
+    bool     heater_ext;          /* reg 68 read succeeded            */
+    uint16_t heater_type;         /* reg 68                           */
+    uint16_t heater_setpoint_c;   /* reg 69                           */
+    uint16_t heater_caps;         /* reg 70                           */
+    uint16_t heater_phase;        /* reg 71                           */
+    uint16_t heater_vendor_state; /* reg 72                           */
+    uint16_t heater_cmd_result;   /* reg 75                           */
 
     uint64_t ts_ms;
 } telemetry_t;
@@ -575,7 +584,21 @@ static void modbus_read_besteffort(telemetry_t *t)
      * heater feature (read fails with exception 0x02 on every register). */
     bool heater_ok = false;
     t->heater_state = modbus_read_reg_besteffort_ok(g_modbus, REG_HEATER_STATE, 0, &heater_ok);
-    t->heater_present      = heater_ok;
+    /* Extended block (coprocessor firmware). Its type register also gates
+     * heater_present: on that firmware reg 55 always answers, so presence
+     * means "a heater type is detected" (heater_present_from). */
+    bool ext_ok = false;
+    t->heater_type = heater_ok
+        ? modbus_read_reg_besteffort_ok(g_modbus, REG_HEATER_TYPE, 0, &ext_ok) : 0;
+    t->heater_ext          = ext_ok;
+    t->heater_present      = heater_present_from(heater_ok, ext_ok, t->heater_type);
+    if (ext_ok) {
+        t->heater_setpoint_c   = modbus_read_reg_besteffort(g_modbus, REG_HEATER_SETPOINT_C, 20);
+        t->heater_caps         = modbus_read_reg_besteffort(g_modbus, REG_HEATER_CAPS,       0);
+        t->heater_phase        = modbus_read_reg_besteffort(g_modbus, REG_HEATER_PHASE,      0);
+        t->heater_vendor_state = modbus_read_reg_besteffort(g_modbus, REG_HEATER_VENDOR_ST,  0);
+        t->heater_cmd_result   = modbus_read_reg_besteffort(g_modbus, REG_HEATER_COMMAND,    0);
+    }
     t->heater_request      = modbus_read_reg_besteffort(g_modbus, REG_HEATER_REQUEST,     0);
     t->heater_target_level = modbus_read_reg_besteffort(g_modbus, REG_HEATER_LEVEL,       0);
     t->heater_active_level = modbus_read_reg_besteffort(g_modbus, REG_HEATER_ACTIVE_LVL,  0);
@@ -675,6 +698,18 @@ static cJSON *telemetry_object(const telemetry_t *t)
     cJSON_AddNumberToObject(root, "heater_valid_frames",      t->heater_valid_frames);
     cJSON_AddNumberToObject(root, "heater_checksum_failures", t->heater_csum_fail);
     cJSON_AddNumberToObject(root, "heater_transport_errors",  t->heater_xport_err);
+    /* Extended keys only on coprocessor firmware: old payloads stay identical. */
+    if (t->heater_ext) {
+        char vs[8];
+        heater_vendor_state_str(t->heater_vendor_state, vs, sizeof(vs));
+        cJSON_AddStringToObject(root, "heater_type",         heater_type_name(t->heater_type));
+        cJSON_AddStringToObject(root, "heater_phase",        heater_phase_name(t->heater_phase));
+        cJSON_AddStringToObject(root, "heater_control",      heater_control_name(t->heater_caps));
+        cJSON_AddNumberToObject(root, "heater_setpoint_f",   heater_c_to_f(t->heater_setpoint_c));
+        cJSON_AddStringToObject(root, "heater_vendor_state", vs);
+        cJSON_AddBoolToObject  (root, "heater_fault",        t->heater_phase == HEATER_PHASE_FAULT);
+        cJSON_AddNumberToObject(root, "heater_cmd_result",   t->heater_cmd_result);
+    }
 
     return root;
 }
@@ -872,6 +907,19 @@ static void apply_command_file(void)
         if (v >= 1 && v <= 10) mb_write_reg(54, v, "heater_level");
     }
 
+    /* heater_setpoint_f -> reg 69 (degC 5..30; coprocessor firmware only) */
+    const cJSON *hsp = cJSON_GetObjectItemCaseSensitive(root, "heater_setpoint_f");
+    if (cJSON_IsNumber(hsp)) {
+        int v = (int)hsp->valuedouble;
+        if (v >= HEATER_SETPOINT_F_MIN && v <= HEATER_SETPOINT_F_MAX)
+            mb_write_reg(69, heater_f_to_c(v), "heater_setpoint_f");
+    }
+
+    /* heater_clear_fault: 1 -> reg 75 = CLEAR_FAULT (never starts the heater) */
+    const cJSON *hcf = cJSON_GetObjectItemCaseSensitive(root, "heater_clear_fault");
+    if (cJSON_IsNumber(hcf) && (int)hcf->valuedouble == 1)
+        mb_write_reg(75, HEATER_CMD_CLEAR_FAULT, "heater_clear_fault");
+
     cJSON_Delete(root);
 }
 
@@ -1136,6 +1184,17 @@ int main(void)
             srep.heater_fan_rpm = t.heater_fan_rpm;
             srep.heater_safe_off = heater_safe_off(t.heater_flags);
             srep.heater_comms_ok = heater_comms_ok(t.heater_flags);
+            srep.heater_ext      = t.heater_ext;
+            if (t.heater_ext) {
+                strncpy(srep.heater_type,    heater_type_name(t.heater_type),
+                        sizeof(srep.heater_type) - 1);
+                strncpy(srep.heater_phase,   heater_phase_name(t.heater_phase),
+                        sizeof(srep.heater_phase) - 1);
+                strncpy(srep.heater_control, heater_control_name(t.heater_caps),
+                        sizeof(srep.heater_control) - 1);
+                srep.heater_setpoint_f = heater_c_to_f(t.heater_setpoint_c);
+                srep.heater_fault      = (t.heater_phase == HEATER_PHASE_FAULT);
+            }
 
             /* OTA progress/failure from the root worker (so a failed OTA shows
              * as e.g. "failed: install 1.2.48" instead of a stuck "pending"). */
@@ -1165,12 +1224,19 @@ int main(void)
              * was actually applied here — if a newer one arrived meanwhile,
              * ack is a no-op and the newer command is retried next cycle
              * instead of being wiped. */
-            int hon, hlvl;
+            /* Order: clear_fault -> setpoint -> level -> on, so a single
+             * "clear then start" message lands in a usable order (the
+             * firmware still refuses the start if the clear was BUSY). */
+            shadow_heater_cmd_t hc;
             unsigned hseq;
-            if (shadow_peek_heater_cmd(&hon, &hlvl, &hseq)) {
+            if (shadow_peek_heater_cmd(&hc, &hseq)) {
                 int rc = 0;
-                if (hlvl >= 1) rc |= mb_write_reg(54, hlvl, "heater_level(shadow)");
-                if (hon  >= 0) rc |= mb_write_reg(53, hon,  "heater_on(shadow)");
+                if (hc.clear_fault)
+                    rc |= mb_write_reg(75, HEATER_CMD_CLEAR_FAULT, "heater_clear_fault(shadow)");
+                if (hc.setpoint_f >= 0)
+                    rc |= mb_write_reg(69, heater_f_to_c(hc.setpoint_f), "heater_setpoint_f(shadow)");
+                if (hc.level >= 1) rc |= mb_write_reg(54, hc.level, "heater_level(shadow)");
+                if (hc.on    >= 0) rc |= mb_write_reg(53, hc.on,    "heater_on(shadow)");
                 if (rc == 0) shadow_ack_heater_cmd(hseq);
             }
 
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-agent/files/shadow.c b/meta-ecofleet/recipes-ecofleet/gobi-agent/files/shadow.c
index 772df08..9561c59 100644
--- a/meta-ecofleet/recipes-ecofleet/gobi-agent/files/shadow.c
+++ b/meta-ecofleet/recipes-ecofleet/gobi-agent/files/shadow.c
@@ -116,6 +116,8 @@ static void set_default_config(shadow_config_t *cfg)
     cfg->heater_desired_valid = false;
     cfg->heater_on            = -1;  /* sentinel: not provided/invalid */
     cfg->heater_level         = -1;  /* sentinel: not provided/invalid */
+    cfg->heater_setpoint_f    = -1;  /* sentinel: not provided/invalid */
+    cfg->heater_clear_fault   = false;
 }
 
 /* ── Topic helpers ───────────────────────────────────────────────────────── */
@@ -246,7 +248,8 @@ static bool apply_desired(const cJSON *desired)
         s.apu_fw_target_seq++;
     }
 
-    /* Heater-scoped remote control: desired.heater = { "on": 0|1, "level": 1..10 },
+    /* Heater-scoped remote control: desired.heater = { "on": 0|1, "level": 1..10,
+     * "setpoint_f": 41..86, "clear_fault": true },
      * with "on" and "level" each INDEPENDENTLY optional so a bare stop
      * ({"on":0}) is never blocked on a level also being supplied — dropping a
      * remote stop would be a safety issue. Whichever field is absent/invalid
@@ -266,9 +269,13 @@ static bool apply_desired(const cJSON *desired)
     if (cJSON_IsObject(h)) {
         const cJSON *hon  = cJSON_GetObjectItemCaseSensitive(h, "on");
         const cJSON *hlvl = cJSON_GetObjectItemCaseSensitive(h, "level");
+        const cJSON *hsp  = cJSON_GetObjectItemCaseSensitive(h, "setpoint_f");
+        const cJSON *hclr = cJSON_GetObjectItemCaseSensitive(h, "clear_fault");
         int on_val    = s.config.heater_desired_valid ? s.config.heater_on    : -1;
         int level_val = s.config.heater_desired_valid ? s.config.heater_level : -1;
-        bool have_on = false, have_level = false;
+        int sp_val    = s.config.heater_desired_valid ? s.config.heater_setpoint_f : -1;
+        bool clr_val  = s.config.heater_desired_valid ? s.config.heater_clear_fault : false;
+        bool have_on = false, have_level = false, have_sp = false, have_clr = false;
 
         if (cJSON_IsNumber(hon)) {
             int v = (int)hon->valuedouble;
@@ -282,9 +289,18 @@ static bool apply_desired(const cJSON *desired)
             else
                 fprintf(stderr, "[shadow] heater.level %d out of range [1,10] — ignored\n", v);
         }
-        if (have_on || have_level) {
+        if (cJSON_IsNumber(hsp)) {
+            int v = (int)hsp->valuedouble;
+            if (v >= 41 && v <= 86) { sp_val = v; have_sp = true; }
+            else
+                fprintf(stderr, "[shadow] heater.setpoint_f %d out of range [41,86] — ignored\n", v);
+        }
+        if (cJSON_IsTrue(hclr)) { clr_val = true; have_clr = true; }
+        if (have_on || have_level || have_sp || have_clr) {
             s.config.heater_on            = on_val;
             s.config.heater_level         = level_val;
+            s.config.heater_setpoint_f    = sp_val;
+            s.config.heater_clear_fault   = clr_val;
             s.config.heater_desired_valid = true;
             s.heater_desired_seq++;
         }
@@ -511,6 +527,13 @@ int shadow_publish_reported(struct mosquitto *mosq,
         cJSON_AddNumberToObject(heater, "fan_rpm",  reported->heater_fan_rpm);
         cJSON_AddBoolToObject  (heater, "safe_off", reported->heater_safe_off);
         cJSON_AddBoolToObject  (heater, "comms_ok", reported->heater_comms_ok);
+        if (reported->heater_ext) {
+            cJSON_AddStringToObject(heater, "type",       reported->heater_type);
+            cJSON_AddStringToObject(heater, "phase",      reported->heater_phase);
+            cJSON_AddStringToObject(heater, "control",    reported->heater_control);
+            cJSON_AddNumberToObject(heater, "setpoint_f", reported->heater_setpoint_f);
+            cJSON_AddBoolToObject  (heater, "fault",      reported->heater_fault);
+        }
     }
 
     /* Echo the assigned location back so desired == reported (no standing
@@ -659,16 +682,18 @@ void shadow_ack_apu_firmware_target(unsigned seq)
     pthread_mutex_unlock(&s.config_mutex);
 }
 
-bool shadow_peek_heater_cmd(int *on, int *level, unsigned *seq)
+bool shadow_peek_heater_cmd(shadow_heater_cmd_t *cmd, unsigned *seq)
 {
-    if (!s.initialised || !on || !level || !seq) return false;
+    if (!s.initialised || !cmd || !seq) return false;
 
     pthread_mutex_lock(&s.config_mutex);
     bool pending = s.config.heater_desired_valid;
     if (pending) {
-        *on    = s.config.heater_on;
-        *level = s.config.heater_level;
-        *seq   = s.heater_desired_seq;
+        cmd->on          = s.config.heater_on;
+        cmd->level       = s.config.heater_level;
+        cmd->setpoint_f  = s.config.heater_setpoint_f;
+        cmd->clear_fault = s.config.heater_clear_fault;
+        *seq             = s.heater_desired_seq;
     }
     pthread_mutex_unlock(&s.config_mutex);
     return pending;
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-agent/files/shadow.h b/meta-ecofleet/recipes-ecofleet/gobi-agent/files/shadow.h
index 9475417..5dd113c 100644
--- a/meta-ecofleet/recipes-ecofleet/gobi-agent/files/shadow.h
+++ b/meta-ecofleet/recipes-ecofleet/gobi-agent/files/shadow.h
@@ -50,6 +50,9 @@ typedef struct {
                                   * applied to reg 53 only when >= 0             */
     int      heater_level;       /* pending: 1..10, or -1 = not provided/invalid —
                                   * applied to reg 54 only when >= 1             */
+    int      heater_setpoint_f;  /* pending: 41..86 degF, or -1 = not provided —
+                                  * applied to reg 69 (as degC) when >= 0        */
+    bool     heater_clear_fault; /* pending CLEAR_FAULT (reg 75 = 3)             */
 } shadow_config_t;
 
 /* ── Reported telemetry fields included in shadow update ────────────────── */
@@ -78,6 +81,16 @@ typedef struct {
     int      heater_fan_rpm;     /* raw fan RPM, reg 59                          */
     bool     heater_safe_off;    /* HEATER_FLAG_SAFE_OFF set                     */
     bool     heater_comms_ok;    /* fresh & no HEATER_FLAG_COMMS_FAULT           */
+
+    /* Heater coprocessor extended block (fw regs 68..75). Published inside
+     * reported.heater only when heater_ext (firmware has the block), so old
+     * firmware's reported shape is unchanged. */
+    bool     heater_ext;
+    char     heater_type[12];    /* "none"|"vevor"|"autoterm"|"unknown"          */
+    char     heater_phase[12];   /* "off"|"detecting"|...|"fault"|"unknown"       */
+    char     heater_control[10]; /* "level"|"setpoint"                           */
+    int      heater_setpoint_f;  /* reg 69 as degF                               */
+    bool     heater_fault;       /* phase == fault                               */
 } shadow_reported_t;
 
 /* ── Callbacks ────────────────────────────────────────────────────────────── */
@@ -195,14 +208,22 @@ void shadow_ack_apu_firmware_target(unsigned seq);
  * (never written) so a remote STOP can't be dropped just because no level
  * was supplied alongside it. */
 
-/* Copy any pending heater on/level command into *on / *level without
- * clearing it, as-is (including the -1 "not provided" sentinel on whichever
- * field wasn't part of the desired.heater payload). Also copies the current
- * heater-desired sequence number into *seq (guard NULL like the other
- * out-params) — pass it back unchanged to shadow_ack_heater_cmd() so the ack
- * only clears the command it actually saw. Returns true if a command is
- * pending (at least one of on/level valid). Thread-safe. */
-bool shadow_peek_heater_cmd(int *on, int *level, unsigned *seq);
+/* A pending heater command. Each field is independently optional: on/level/
+ * setpoint_f use -1 for "not provided"; clear_fault false = not requested. */
+typedef struct {
+    int  on;          /* 0|1 or -1                                  */
+    int  level;       /* 1..10 or -1                                */
+    int  setpoint_f;  /* 41..86 degF or -1                          */
+    bool clear_fault; /* CLEAR_FAULT requested                      */
+} shadow_heater_cmd_t;
+
+/* Copy any pending heater command into *cmd without clearing it, as-is
+ * (including the "not provided" sentinels). Also copies the current
+ * heater-desired sequence number into *seq — pass it back unchanged to
+ * shadow_ack_heater_cmd() so the ack only clears the command it actually
+ * saw. Returns true if a command is pending (at least one field valid).
+ * Thread-safe. */
+bool shadow_peek_heater_cmd(shadow_heater_cmd_t *cmd, unsigned *seq);
 
 /* Mark the pending heater command as applied IF it is still the same
  * command that was peeked: clears it and schedules a desired.heater=null
````

- [ ] **Step 4: Verify**

Run: `sh meta-ecofleet/recipes-ecofleet/gobi-agent/tests/run.sh 2>&1 | tail -2`
Expected: exit 0, ends with `test_heater_ext ok` / `test_shadow_heater ok`.
Run (main.c/shadow.c are not built by run.sh):
```bash
cd meta-ecofleet/recipes-ecofleet/gobi-agent/files && for f in main.c shadow.c; do cc -std=gnu11 -Wall -Wextra -fsyntax-only -DMQTT_ENDPOINT='"x"' -I. -I$(brew --prefix cjson)/include -I$(brew --prefix libmodbus)/include/modbus -I$(brew --prefix libmodbus)/include -I$(brew --prefix mosquitto)/include $f && echo OK $f; done
```
Expected: `OK main.c`, `OK shadow.c`, no warnings.

- [ ] **Step 5: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-agent
git commit -m "feat(gobi-agent): heater coprocessor regs 68-75 — type/phase/setpoint/clear-fault

Reads the extended block best-effort; new latest.json + reported.heater
keys only when present; command.json + desired.heater setpoint_f and
clear_fault (clear -> setpoint -> level -> on); heater_present hides
heaterless units on coprocessor firmware.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017uxgfN1Y67gVKWmTWmpxxk"
```

---

### Task 3: gobi-ui — TelemetryModel + HeaterCard (type, phase, setpoint, clear fault)

**Files:** Modify `gobi-ui/files/TelemetryModel.h`, `TelemetryModel.cpp`, `qml/HeaterCard.qml`, `qml/preview/Mocks.qml`, `qml/preview/Shots.qml`.

**Interfaces:**
- Consumes: Task 2 `latest.json` / `command.json` keys.
- Produces: Q_PROPERTYs `heaterExt, heaterType, heaterPhase, heaterControl, heaterSetpointF, heaterVendorState, heaterFault, heaterCmdResult`; `Q_INVOKABLE setHeaterSetpointF(int)`, `clearHeaterFault()`.

QML has no unit-test harness here; the gate is a native build + preview shots compared by eye (same as earlier gobi-ui work).

- [ ] **Step 1: Apply**

`.superpowers/patches/t3-ui.patch`:

````diff
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-ui/files/TelemetryModel.cpp b/meta-ecofleet/recipes-ecofleet/gobi-ui/files/TelemetryModel.cpp
index 1efca4c..be12383 100644
--- a/meta-ecofleet/recipes-ecofleet/gobi-ui/files/TelemetryModel.cpp
+++ b/meta-ecofleet/recipes-ecofleet/gobi-ui/files/TelemetryModel.cpp
@@ -96,6 +96,14 @@ void TelemetryModel::poll()
     m_heaterFlags        = static_cast<int>(o[u"heater_flags"].toDouble());
     m_heaterSafeOff      = o[u"heater_safe_off"].toBool();
     m_heaterCommsOk      = o[u"heater_comms_ok"].toBool();
+    m_heaterExt          = o.contains(u"heater_phase");
+    m_heaterType         = o[u"heater_type"].toString(QStringLiteral("none"));
+    m_heaterPhase        = o[u"heater_phase"].toString(QStringLiteral("off"));
+    m_heaterControl      = o[u"heater_control"].toString(QStringLiteral("level"));
+    m_heaterSetpointF    = static_cast<int>(o[u"heater_setpoint_f"].toDouble(68));
+    m_heaterVendorState  = o[u"heater_vendor_state"].toString();
+    m_heaterFault        = o[u"heater_fault"].toBool();
+    m_heaterCmdResult    = static_cast<int>(o[u"heater_cmd_result"].toDouble());
 
     m_update = describeUpdate(o[u"ota_status"].toString(),
                               o[u"apu_flash_state"].toString(),
@@ -128,3 +136,5 @@ void TelemetryModel::setTestRelay(int index, bool on)  { writeCommand(QStringLit
 
 void TelemetryModel::setHeaterOn(bool on)    { writeCommand(QStringLiteral("heater_on"), on ? 1 : 0); }
 void TelemetryModel::setHeaterLevel(int level) { writeCommand(QStringLiteral("heater_level"), level); }
+void TelemetryModel::setHeaterSetpointF(int degF) { writeCommand(QStringLiteral("heater_setpoint_f"), degF); }
+void TelemetryModel::clearHeaterFault()       { writeCommand(QStringLiteral("heater_clear_fault"), 1); }
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-ui/files/TelemetryModel.h b/meta-ecofleet/recipes-ecofleet/gobi-ui/files/TelemetryModel.h
index 08620ad..ed46357 100644
--- a/meta-ecofleet/recipes-ecofleet/gobi-ui/files/TelemetryModel.h
+++ b/meta-ecofleet/recipes-ecofleet/gobi-ui/files/TelemetryModel.h
@@ -52,6 +52,16 @@ class TelemetryModel : public QObject
     Q_PROPERTY(bool    heaterSafeOff      READ heaterSafeOff      NOTIFY dataChanged)
     Q_PROPERTY(bool    heaterCommsOk      READ heaterCommsOk      NOTIFY dataChanged)
     Q_PROPERTY(int     heaterFlags        READ heaterFlags        NOTIFY dataChanged)
+    // Heater coprocessor extended block (fw regs 68-75); heaterExt false on
+    // older firmware, which then behaves exactly as before.
+    Q_PROPERTY(bool    heaterExt          READ heaterExt          NOTIFY dataChanged)
+    Q_PROPERTY(QString heaterType         READ heaterType         NOTIFY dataChanged)
+    Q_PROPERTY(QString heaterPhase        READ heaterPhase        NOTIFY dataChanged)
+    Q_PROPERTY(QString heaterControl      READ heaterControl      NOTIFY dataChanged)
+    Q_PROPERTY(int     heaterSetpointF    READ heaterSetpointF    NOTIFY dataChanged)
+    Q_PROPERTY(QString heaterVendorState  READ heaterVendorState  NOTIFY dataChanged)
+    Q_PROPERTY(bool    heaterFault        READ heaterFault        NOTIFY dataChanged)
+    Q_PROPERTY(int     heaterCmdResult    READ heaterCmdResult    NOTIFY dataChanged)
     /* Firmware update notice (see UpdateNotice.h): updateKind "none" | "busy" |
      * "failed"; updateKey identifies a failure so a dismissal can stick. */
     Q_PROPERTY(QString updateKind   READ updateKind   NOTIFY dataChanged)
@@ -77,6 +87,8 @@ public:
     Q_INVOKABLE void setTestRelay(int index, bool on);   // diag_out = (index<<8)|state
     Q_INVOKABLE void setHeaterOn(bool on);               // heater_on 0|1
     Q_INVOKABLE void setHeaterLevel(int level);          // heater_level 1..10
+    Q_INVOKABLE void setHeaterSetpointF(int degF);       // heater_setpoint_f 41..86
+    Q_INVOKABLE void clearHeaterFault();                 // heater_clear_fault 1
 
     double  cabinTempF()    const { return m_cabinTempF; }
     double  extTempF()      const { return m_extTempF; }
@@ -118,6 +130,14 @@ public:
     bool    heaterSafeOff()      const { return m_heaterSafeOff; }
     bool    heaterCommsOk()      const { return m_heaterCommsOk; }
     int     heaterFlags()        const { return m_heaterFlags; }
+    bool    heaterExt()          const { return m_heaterExt; }
+    QString heaterType()         const { return m_heaterType; }
+    QString heaterPhase()        const { return m_heaterPhase; }
+    QString heaterControl()      const { return m_heaterControl; }
+    int     heaterSetpointF()    const { return m_heaterSetpointF; }
+    QString heaterVendorState()  const { return m_heaterVendorState; }
+    bool    heaterFault()        const { return m_heaterFault; }
+    int     heaterCmdResult()    const { return m_heaterCmdResult; }
     QString updateKind()   const;
     QString updateTitle()  const { return m_update.title; }
     QString updateDetail() const { return m_update.detail; }
@@ -165,6 +185,14 @@ private:
     bool    m_heaterSafeOff      = false;
     bool    m_heaterCommsOk      = false;
     int     m_heaterFlags        = 0;
+    bool    m_heaterExt          = false;
+    QString m_heaterType         = QStringLiteral("none");
+    QString m_heaterPhase        = QStringLiteral("off");
+    QString m_heaterControl      = QStringLiteral("level");
+    int     m_heaterSetpointF    = 68;
+    QString m_heaterVendorState;
+    bool    m_heaterFault        = false;
+    int     m_heaterCmdResult    = 0;
 
     UpdateNotice m_update;
 };
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/HeaterCard.qml b/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/HeaterCard.qml
index 12d4a8e..056ab10 100644
--- a/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/HeaterCard.qml
+++ b/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/HeaterCard.qml
@@ -4,9 +4,10 @@ import "."
 import "atoms"
 
 // Compact Heater control card for the Home screen. Reads telemetry.heater*
-// (VEVOR XMZ-F-D5 diesel air heater, Modbus regs 53-67) and issues an
-// optimistic On/Off toggle + a debounced 1-10 level stepper, mirroring
-// HomeScreen's uiMode/target idioms.
+// (Modbus regs 53-75 via the heater coprocessor: VEVOR level 1-10 or AUTOTERM
+// setpoint) and issues an optimistic On/Off toggle + a debounced level or
+// setpoint stepper, mirroring HomeScreen's uiMode/target idioms. On firmware
+// without the coprocessor block (heaterExt false) it behaves exactly as before.
 //
 // The heater runs its own state machine (off/preheat/ignition/running/
 // cooldown) that is UNRELATED to the APU's control_status enum, so it gets
@@ -27,6 +28,8 @@ Rectangle {
     // ---- On/Off (optimistic; cleared once telemetry reconciles) ----
     property var uiOn: null
     readonly property bool effOn: uiOn !== null ? uiOn : (telemetry.heaterState !== "off")
+    readonly property bool useSetpoint: telemetry.heaterExt && telemetry.heaterControl === "setpoint"
+    readonly property bool faulted: telemetry.heaterExt && telemetry.heaterFault
     function setOn(v) { card.uiOn = v; telemetry.setHeaterOn(v) }
     // NOTE: turning OFF only reconciles once heaterState actually reaches
     // "off" — the heater runs a several-minute cooldown first, so the
@@ -42,17 +45,36 @@ Rectangle {
     Timer { id: lvlSend; interval: 350; onTriggered: telemetry.setHeaterLevel(card.level) }
     function bumpLevel(d) { card.levelDirty = true; card.level = clampLevel(card.level + d); lvlSend.restart() }
 
+    // ---- Setpoint 41-86 degF (AUTOTERM): same follow/debounce/reconcile idiom.
+    // The firmware stores whole degC, so the echo may differ by 1 degF.
+    function clampSp(v) { return Math.max(41, Math.min(86, v || 68)) }
+    property int setpoint: clampSp(telemetry.heaterSetpointF)
+    property bool spDirty: false
+    Timer { id: spSend; interval: 350; onTriggered: telemetry.setHeaterSetpointF(card.setpoint) }
+    function bumpSp(d) { card.spDirty = true; card.setpoint = clampSp(card.setpoint + d); spSend.restart() }
+
+    // ---- Clear fault: BUSY (1) means the heater is not in standby yet.
+    property bool clearTried: false
+
     Connections {
         target: telemetry
         function onDataChanged() {
             if (card.uiOn !== null && (telemetry.heaterState !== "off") === card.uiOn) card.uiOn = null
             if (card.levelDirty && telemetry.heaterTargetLevel === card.level) card.levelDirty = false
             if (!card.levelDirty) card.level = card.clampLevel(telemetry.heaterTargetLevel)
+            if (card.spDirty && Math.abs(telemetry.heaterSetpointF - card.setpoint) <= 1) card.spDirty = false
+            if (!card.spDirty) card.setpoint = card.clampSp(telemetry.heaterSetpointF)
+            if (!telemetry.heaterFault) card.clearTried = false
         }
     }
 
     // ---- State line ----
+    // Phase names (coprocessor firmware) extend the legacy state names.
     function stateLabel(s) {
+        if (s === "detecting") return "Detecting…"
+        if (s === "starting") return "Starting"
+        if (s === "stopping") return "Stopping…"
+        if (s === "fault") return "FAULT"
         if (s === "off") return "Off"
         if (s === "preheat") return "Preheat"
         if (s === "ignition") return "Ignition"
@@ -61,13 +83,26 @@ Rectangle {
         return s || "—"
     }
     function stateColor(s) {
+        if (s === "fault") return Theme.fault
         if (s === "running") return Theme.ok
+        if (s === "stopping") return Theme.warn
+        if (s === "starting" || s === "detecting") return Theme.info
         if (s === "cooldown") return Theme.warn
         if (s === "preheat" || s === "ignition") return Theme.info
         return Theme.textMute   // off / unknown
     }
 
-    readonly property bool showFault: telemetry.heaterError !== 0 || !telemetry.heaterCommsOk
+    readonly property string curState: telemetry.heaterExt ? telemetry.heaterPhase : telemetry.heaterState
+    // Badge: NO COMMS, or a real vendor error code. A coprocessor fault with no
+    // code (255) is already spelled out by the FAULT state label.
+    readonly property bool hasCode: telemetry.heaterError !== 0 && telemetry.heaterError !== 255
+    readonly property bool showFault: card.faulted ? card.hasCode
+                                                   : (telemetry.heaterError !== 0 || !telemetry.heaterCommsOk)
+    function faultLabel() {
+        if (!telemetry.heaterCommsOk && !card.faulted) return "NO COMMS"
+        return "ERR " + telemetry.heaterError
+    }
+    function typeTag(t) { return t === "vevor" ? "VEVOR" : (t === "autoterm" ? "AUTOTERM" : "") }
 
     RowLayout {
         anchors.fill: parent
@@ -77,10 +112,14 @@ Rectangle {
         // label + live state (or the fault badge in its place)
         ColumnLayout {
             Layout.fillWidth: true; spacing: 2
-            Text { Layout.fillWidth: true; text: "HEATER"; color: Theme.textMute; font.pixelSize: Theme.fsCaption
+            Text { Layout.fillWidth: true
+                text: "HEATER" + (card.typeTag(telemetry.heaterType) ? " · " + card.typeTag(telemetry.heaterType) : "")
+                color: Theme.textMute; font.pixelSize: Theme.fsCaption
                 font.letterSpacing: Theme.lsCaps; font.weight: Font.DemiBold }
             RowLayout { spacing: 8
-                Text { text: card.stateLabel(telemetry.heaterState); color: card.stateColor(telemetry.heaterState)
+                Text { text: (card.faulted && card.clearTried && telemetry.heaterCmdResult === 1)
+                             ? "Still cooling — retry" : card.stateLabel(card.curState)
+                    color: card.stateColor(card.curState)
                     font.pixelSize: Theme.fsBody; font.weight: Font.DemiBold }
                 Rectangle {
                     visible: card.showFault
@@ -91,7 +130,7 @@ Rectangle {
                     Text {
                         id: faultText
                         anchors.centerIn: parent
-                        text: !telemetry.heaterCommsOk ? "NO COMMS" : ("ERR " + telemetry.heaterError)
+                        text: card.faultLabel()
                         color: Theme.fault; font.pixelSize: Theme.fsCaption - 1; font.weight: Font.Bold
                         font.letterSpacing: 0.6
                     }
@@ -109,20 +148,31 @@ Rectangle {
                     Text { text: modelData.l; color: Theme.textMute; font.pixelSize: Theme.fsCaption - 1 } } }
         }
 
-        // level stepper
+        // level (VEVOR / legacy) or setpoint (AUTOTERM) stepper
         RowLayout { Layout.fillWidth: false; spacing: 6
-            Text { text: "LEVEL"; color: Theme.textMute; font.pixelSize: Theme.fsCaption
+            Text { text: card.useSetpoint ? "SET" : "LEVEL"; color: Theme.textMute; font.pixelSize: Theme.fsCaption
                 font.letterSpacing: Theme.lsCaps; font.weight: Font.DemiBold }
-            Stepper { Layout.fillWidth: false; text: card.level; textSize: 22; textWidth: 32
-                onDecrement: card.bumpLevel(-1); onIncrement: card.bumpLevel(1) }
+            Stepper { Layout.fillWidth: false
+                text: card.useSetpoint ? (card.setpoint + "°") : card.level
+                textSize: 22; textWidth: card.useSetpoint ? 52 : 32
+                onDecrement: card.useSetpoint ? card.bumpSp(-2) : card.bumpLevel(-1)
+                onIncrement: card.useSetpoint ? card.bumpSp(2) : card.bumpLevel(1) }
         }
 
-        // on / off
+        // on / off — replaced by a two-tap CLEAR FAULT while faulted (clearing
+        // never starts the heater; ON is a separate, later tap)
         SegmentedControl {
+            visible: !card.faulted
             Layout.preferredWidth: 132
             options: [{label:"ON", value:true}, {label:"OFF", value:false}]
             current: card.effOn
             onPicked: function(v) { if (v !== card.effOn) card.setOn(v) }
         }
+        ConfirmButton {
+            visible: card.faulted
+            label: "CLEAR FAULT"; confirmLabel: "Tap again to clear"
+            Layout.preferredWidth: armed ? 168 : 132
+            onConfirmed: { card.clearTried = true; card.uiOn = null; telemetry.clearHeaterFault() }
+        }
     }
 }
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/preview/Mocks.qml b/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/preview/Mocks.qml
index d26ed70..73642d5 100644
--- a/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/preview/Mocks.qml
+++ b/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/preview/Mocks.qml
@@ -31,6 +31,10 @@ QtObject {
         property int    heaterStateSeconds: 0; property int    heaterAgeMs: 0
         property bool   heaterSafeOff: false;  property bool   heaterCommsOk: false
         property int    heaterFlags: 16
+        property bool   heaterExt: false;      property string heaterType: "none"
+        property string heaterPhase: "off";    property string heaterControl: "level"
+        property int    heaterSetpointF: 72;   property string heaterVendorState: ""
+        property bool   heaterFault: false;    property int    heaterCmdResult: 0
         // firmware update notice (TelemetryModel.update*: kind none|busy|failed)
         property string updateKind: "none";   property string updateTitle: ""
         property string updateDetail: "";     property string updateKey: ""
@@ -47,6 +51,8 @@ QtObject {
         function setTestRelay(i, on) {}
         function setHeaterOn(v) {}
         function setHeaterLevel(v) {}
+        function setHeaterSetpointF(v) {}
+        function clearHeaterFault() {}
     }
     // eventlog mock — mirrors EventLogModel (newest first; endMs 0 = active)
     property QtObject eventlog: QtObject {
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/preview/Shots.qml b/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/preview/Shots.qml
index 5c4b44f..ebcb288 100644
--- a/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/preview/Shots.qml
+++ b/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/preview/Shots.qml
@@ -69,10 +69,22 @@ Item {
                                           telemetry.fanAuto = true; telemetry.heaterCommsOk = true
                                           telemetry.heaterState = "running"; telemetry.heaterFanRpm = 2600
                                           telemetry.heaterExchanger = 180; root.poke() }],
+        ["02b-heater-autoterm", function() { telemetry.heaterExt = true; telemetry.heaterType = "autoterm"
+                                          telemetry.heaterControl = "setpoint"; telemetry.heaterPhase = "running"
+                                          telemetry.heaterState = "running"; telemetry.heaterSetpointF = 72
+                                          telemetry.heaterCommsOk = true; root.poke() }],
+        ["02c-heater-fault", function() { telemetry.heaterType = "vevor"; telemetry.heaterControl = "level"
+                                          telemetry.heaterPhase = "fault"; telemetry.heaterState = "off"
+                                          telemetry.heaterFault = true; telemetry.heaterError = 255
+                                          telemetry.heaterFanRpm = 0; telemetry.heaterExchanger = 0; root.poke() }],
+        ["02d-heater-detecting", function() { telemetry.heaterFault = false; telemetry.heaterError = 0
+                                          telemetry.heaterType = "none"; telemetry.heaterPhase = "detecting"
+                                          telemetry.heaterCommsOk = false; root.poke() }],
         ["03-battery",       function() { telemetry.mode = "off"; telemetry.controlStatus = "off"
                                           telemetry.fanAuto = false; telemetry.heaterCommsOk = false
                                           telemetry.heaterState = "off"; telemetry.heaterFanRpm = 0
-                                          telemetry.heaterExchanger = 0; root.poke(); shell.selectRail(1) }],
+                                          telemetry.heaterExchanger = 0; telemetry.heaterExt = false
+                                          telemetry.heaterPhase = "off"; root.poke(); shell.selectRail(1) }],
         ["04-menu",          function() { shell.selectRail(2) }],
         ["05-diagnostics",   function() { root.sub(diagC) }],
         ["06-usermaint",     function() { root.sub(usermaintC) }],
````

- [ ] **Step 2: Build gobi-ui natively and lint the card**

```bash
F=meta-ecofleet/recipes-ecofleet/gobi-ui/files
cmake -S $F -B /tmp/gobiui-build -DCMAKE_PREFIX_PATH=/opt/homebrew/opt/qt >/dev/null && cmake --build /tmp/gobiui-build -j8 2>&1 | grep -E "error|warning" ; echo build-done
qmllint -I $F/qml $F/qml/HeaterCard.qml 2>&1 | grep '^Warning' | grep -v '\[unqualified\]'
```
Expected: `build-done` with no error/warning lines; qmllint prints nothing (the remaining `[unqualified]` warnings are the `telemetry` context property, same as before).

- [ ] **Step 3: Render preview shots and check them**

```bash
cmake -S $F/qml/preview/runner -B /tmp/shots-build -DCMAKE_PREFIX_PATH=/opt/homebrew/opt/qt >/dev/null && cmake --build /tmp/shots-build
rm -rf /tmp/shots && mkdir /tmp/shots
QT_QPA_PLATFORM=offscreen QT_QUICK_CONTROLS_STYLE=Basic QT_QUICK_BACKEND=software /tmp/shots-build/shots $PWD/$F/qml $PWD/$F/fonts /tmp/shots preview/Shots.qml
```
Expected: stderr only `app font "Inter"`. View `01-home.png` (legacy card unchanged: HEATER / Off / NO COMMS / LEVEL / ON-OFF), `02b-heater-autoterm.png` (HEATER · AUTOTERM, Running, SET 72°), `02c-heater-fault.png` (HEATER · VEVOR, FAULT, no ERR badge, CLEAR FAULT button instead of ON/OFF), `02d-heater-detecting.png` (Detecting…).

- [ ] **Step 4: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-ui
git commit -m "feat(gobi-ui): HeaterCard type/phase, AUTOTERM setpoint, two-tap clear fault

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017uxgfN1Y67gVKWmTWmpxxk"
```

---

### Task 4: Cloud backend — ingest, telemetry view, command validation, contract doc

**Files:** Modify `cloud/lambda/ingest/telemetry-map.js` (+test), `cloud/lambda/api/telemetry-view.js` (+test), `cloud/lambda/api/permissions.js` (+test), `cloud/CONTRACT.md`.

**Interfaces — Produces:** ingest `OPT_TAGS` (`heater_type, heater_phase, heater_control, heater_vendor_state`), `OPT_INT` (`heater_setpoint_f, heater_cmd_result`), `OPT_BOOL` (`heater_fault`) mapped only when present; view passes the same 7 keys; `validateCommand` accepts `heater.setpoint_f` (int 41–86) and `heater.clear_fault` (`true`).

- [ ] **Step 1: Write the failing tests** — apply:

`.superpowers/patches/t4-test.patch`:

````diff
diff --git a/cloud/lambda/api/permissions.test.js b/cloud/lambda/api/permissions.test.js
index 01a50ee..d9a6339 100644
--- a/cloud/lambda/api/permissions.test.js
+++ b/cloud/lambda/api/permissions.test.js
@@ -42,6 +42,24 @@ check('valid heater command', () => {
 check('heater level out of range rejected', () => {
   assert.strictEqual(validateCommand({ heater: { on: 1, level: 11 } }).ok, false);
 });
+check('heater setpoint_f and clear_fault accepted', () => {
+  const r = validateCommand({ heater: { setpoint_f: 72, clear_fault: true } });
+  assert.strictEqual(r.ok, true);
+  assert.deepStrictEqual(r.desired, { heater: { setpoint_f: 72, clear_fault: true } });
+  assert.deepStrictEqual(commandActions(r.desired), ['heater']);
+});
+check('heater setpoint_f out of range / non-integer rejected', () => {
+  assert.strictEqual(validateCommand({ heater: { setpoint_f: 40 } }).ok, false);
+  assert.strictEqual(validateCommand({ heater: { setpoint_f: 87 } }).ok, false);
+  assert.strictEqual(validateCommand({ heater: { setpoint_f: 72.5 } }).ok, false);
+});
+check('heater clear_fault must be true', () => {
+  assert.strictEqual(validateCommand({ heater: { clear_fault: false } }).ok, false);
+  assert.strictEqual(validateCommand({ heater: { clear_fault: 1 } }).ok, false);
+});
+check('empty heater object rejected', () => {
+  assert.strictEqual(validateCommand({ heater: {} }).ok, false);
+});
 check('apu climate valid, requires apu action', () => {
   const r = validateCommand({ apu_command: 'climate' });
   assert.strictEqual(r.ok, true);
diff --git a/cloud/lambda/api/telemetry-view.test.js b/cloud/lambda/api/telemetry-view.test.js
index 40a6455..580ff52 100644
--- a/cloud/lambda/api/telemetry-view.test.js
+++ b/cloud/lambda/api/telemetry-view.test.js
@@ -34,5 +34,15 @@ check('carries STM32 OTA fields (bundled + flash state)', () => {
 });
 check('no _time leaks through', () => assert.ok(!('_time' in out)));
 
-console.log(`\n${6 - failed}/6 checks passed`);
+check('coprocessor heater keys passed through when present', () => {
+  const o = mapTelemetryRow({ ...row, heater_phase: 'running', heater_type: 'vevor', heater_fault: false,
+    heater_setpoint_f: 70, heater_control: 'level', heater_vendor_state: '3.0', heater_cmd_result: 0 });
+  assert.strictEqual(o.heater_phase, 'running');
+  assert.strictEqual(o.heater_type, 'vevor');
+  assert.strictEqual(o.heater_fault, false);
+  assert.strictEqual(o.heater_setpoint_f, 70);
+  assert.strictEqual('heater_phase' in out, false);              // absent stays absent
+});
+
+console.log(`\n${7 - failed}/7 checks passed`);
 process.exit(failed === 0 ? 0 : 1);
diff --git a/cloud/lambda/ingest/telemetry-map.test.js b/cloud/lambda/ingest/telemetry-map.test.js
index dc6520c..fa2ffed 100644
--- a/cloud/lambda/ingest/telemetry-map.test.js
+++ b/cloud/lambda/ingest/telemetry-map.test.js
@@ -51,5 +51,20 @@ check('missing fields tolerated', () => {
   assert.strictEqual(bare.fields.batt_v.value, 0);
 });
 
-console.log(`\n${10 - failed}/10 checks passed`);
+check('coprocessor heater keys mapped only when present', () => {
+  assert.strictEqual('heater_phase' in p.tags, false);           // VEVOR-era fixture
+  assert.strictEqual('heater_setpoint_f' in p.fields, false);
+  const q = mapTelemetry({ ...fx, heater_type: 'autoterm', heater_phase: 'fault',
+    heater_control: 'setpoint', heater_vendor_state: '4.0', heater_setpoint_f: 72,
+    heater_cmd_result: 1, heater_fault: true });
+  assert.strictEqual(q.tags.heater_type, 'autoterm');
+  assert.strictEqual(q.tags.heater_phase, 'fault');
+  assert.strictEqual(q.tags.heater_control, 'setpoint');
+  assert.strictEqual(q.tags.heater_vendor_state, '4.0');
+  assert.deepStrictEqual(q.fields.heater_setpoint_f, { type: 'int', value: 72 });
+  assert.deepStrictEqual(q.fields.heater_cmd_result, { type: 'int', value: 1 });
+  assert.deepStrictEqual(q.fields.heater_fault, { type: 'bool', value: true });
+});
+
+console.log(`\n${11 - failed}/11 checks passed`);
 process.exit(failed === 0 ? 0 : 1);
````

- [ ] **Step 2: Run them to verify they fail**

Run: `(cd cloud/lambda/ingest && node telemetry-map.test.js | tail -1); (cd cloud/lambda/api && node telemetry-view.test.js | tail -1; node permissions.test.js | tail -1)`
Expected: `10/11`, `6/7` and `31/32` checks passed — the new ingest/view checks and the "setpoint_f and clear_fault accepted" check fail (the reject checks already pass, since the old code rejects an object with no on/level).

- [ ] **Step 3: Implement** — apply:

`.superpowers/patches/t4-impl.patch`:

````diff
diff --git a/cloud/CONTRACT.md b/cloud/CONTRACT.md
index 352b3fa..7c884b6 100644
--- a/cloud/CONTRACT.md
+++ b/cloud/CONTRACT.md
@@ -39,7 +39,7 @@ Every field is authoritative. Enum fields carry **both** a string label and a ra
 | `diag_active` | bool | Component-Test (OP_DIAG) mode active |
 | `diag_outputs` | int (bitmask) | Energized output bitmask |
 | `apu_fw_version` | int | APU firmware version (encoded) |
-| `heater_present` | bool | Heater block answered Modbus |
+| `heater_present` | bool | Heater block answered Modbus (coprocessor firmware: and a heater type is detected) |
 | `heater_state` | string | off / preheat / ignition / running / cooldown |
 | `heater_target_level`, `heater_active_level` | int | Requested / active level (1–10) |
 | `heater_error` | int | Heater ECU error code |
@@ -53,6 +53,20 @@ Every field is authoritative. Enum fields carry **both** a string label and a ra
 | `heater_safe_off`, `heater_comms_ok` | bool | Derived from `heater_flags` |
 | `heater_valid_frames`, `heater_checksum_failures`, `heater_transport_errors` | int | One-wire link health counters |
 
+Heater coprocessor keys — **optional**: sent only by units whose G0B1 firmware
+has the coprocessor block (Modbus regs 68–75); absent on older units, and the
+ingest stores them only when present.
+
+| Field | Type | Meaning |
+|---|---|---|
+| `heater_type` | string | `none` / `vevor` / `autoterm` / `unknown` (tag) |
+| `heater_phase` | string | `off` / `detecting` / `starting` / `running` / `stopping` / `cooldown` / `fault` (tag) |
+| `heater_control` | string | `level` (1–10) or `setpoint` (°F) — which control the heater takes (tag) |
+| `heater_setpoint_f` | int | Setpoint, °F (firmware stores whole °C) |
+| `heater_vendor_state` | string | Raw vendor state `major.sub`, e.g. `4.0` (tag) |
+| `heater_fault` | bool | Coprocessor latched a fault (cleared only by `clear_fault`) |
+| `heater_cmd_result` | int | Result of the last coprocessor command: 0 OK, 1 BUSY, 2 BAD_ARG, 3 NOT_SUPPORTED, 4 NO_TYPE |
+
 ### InfluxDB storage
 
 Written by `lambda/ingest/telemetry-map.js` to measurement `telemetry`:
@@ -84,7 +98,7 @@ and `POST /fleet/config`):
 
 | Key | Type | Notes |
 |---|---|---|
-| `heater` | `{on: 0\|1, level: 1..10}` | Heater remote control |
+| `heater` | `{on?: 0\|1, level?: 1..10, setpoint_f?: 41..86, clear_fault?: true}` | Heater remote control; at least one field. `clear_fault` never starts the heater; the agent applies clear → setpoint → level → on |
 | `apu_command` | `"climate"` \| `"battery"` \| `"stop"` | APU op-state → firmware mode reg 10 (`1`/`2`/`0`). Agent also accepts legacy `"start"` as `"climate"`; the API does not. |
 | `firmware_target` | semver string | Triggers OTA (see §4) |
 | `reboot` | bool | Reboot request |
diff --git a/cloud/lambda/api/permissions.js b/cloud/lambda/api/permissions.js
index eca2792..f4b81a2 100644
--- a/cloud/lambda/api/permissions.js
+++ b/cloud/lambda/api/permissions.js
@@ -45,7 +45,17 @@ function validateCommand(body) {
         return { ok: false, error: 'heater.level must be an integer 1–10' };
       out.level = h.level;
     }
-    if (Object.keys(out).length === 0) return { ok: false, error: 'heater needs on and/or level' };
+    if (h.setpoint_f !== undefined) {
+      if (!Number.isInteger(h.setpoint_f) || h.setpoint_f < 41 || h.setpoint_f > 86)
+        return { ok: false, error: 'heater.setpoint_f must be an integer 41–86 (°F)' };
+      out.setpoint_f = h.setpoint_f;
+    }
+    if (h.clear_fault !== undefined) {
+      if (h.clear_fault !== true) return { ok: false, error: 'heater.clear_fault must be true' };
+      out.clear_fault = true;
+    }
+    if (Object.keys(out).length === 0)
+      return { ok: false, error: 'heater needs at least one of on, level, setpoint_f, clear_fault' };
     desired.heater = out;
   }
 
diff --git a/cloud/lambda/api/telemetry-view.js b/cloud/lambda/api/telemetry-view.js
index ce25d20..5a7fdeb 100644
--- a/cloud/lambda/api/telemetry-view.js
+++ b/cloud/lambda/api/telemetry-view.js
@@ -16,6 +16,9 @@ const TELEMETRY_FIELD_NAMES = [
   'heater_exchanger', 'heater_state_seconds', 'heater_age_ms', 'heater_flags',
   'heater_safe_off', 'heater_comms_ok',
   'heater_valid_frames', 'heater_checksum_failures', 'heater_transport_errors',
+  // heater coprocessor (optional; present only from coprocessor firmware)
+  'heater_type', 'heater_phase', 'heater_control', 'heater_setpoint_f',
+  'heater_vendor_state', 'heater_fault', 'heater_cmd_result',
 ];
 
 function mapTelemetryRow(r) {
diff --git a/cloud/lambda/ingest/telemetry-map.js b/cloud/lambda/ingest/telemetry-map.js
index 3e37411..c40980f 100644
--- a/cloud/lambda/ingest/telemetry-map.js
+++ b/cloud/lambda/ingest/telemetry-map.js
@@ -24,6 +24,13 @@ const BOOL = [
   'heater_safe_off', 'heater_comms_ok',
 ];
 
+// Heater coprocessor keys (firmware regs 68-75). Only sent by agents talking
+// to coprocessor firmware, so they are mapped ONLY when present — older units
+// never get placeholder 'unknown'/0 values for them.
+const OPT_TAGS = ['heater_type', 'heater_phase', 'heater_control', 'heater_vendor_state'];
+const OPT_INT = ['heater_setpoint_f', 'heater_cmd_result'];
+const OPT_BOOL = ['heater_fault'];
+
 function mapTelemetry(msg) {
   const tags = { unit: String(msg.unit) };
   for (const t of TAGS) tags[t] = msg[t] != null ? String(msg[t]) : 'unknown';
@@ -32,8 +39,11 @@ function mapTelemetry(msg) {
   for (const f of FLOAT) fields[f] = { type: 'float', value: Number(msg[f] ?? 0) };
   for (const f of INT)   fields[f] = { type: 'int',   value: Math.trunc(Number(msg[f] ?? 0)) };
   for (const f of BOOL)  fields[f] = { type: 'bool',  value: Boolean(msg[f] ?? false) };
+  for (const t of OPT_TAGS) if (msg[t] != null) tags[t] = String(msg[t]);
+  for (const f of OPT_INT)  if (msg[f] != null) fields[f] = { type: 'int', value: Math.trunc(Number(msg[f])) };
+  for (const f of OPT_BOOL) if (msg[f] != null) fields[f] = { type: 'bool', value: Boolean(msg[f]) };
 
   return { measurement: 'telemetry', tags, fields, timestamp: msg.ts };
 }
 
-module.exports = { mapTelemetry, TAGS, FLOAT, INT, BOOL };
+module.exports = { mapTelemetry, TAGS, FLOAT, INT, BOOL, OPT_TAGS, OPT_INT, OPT_BOOL };
````

- [ ] **Step 4: Verify**

Run: `(cd cloud/lambda/ingest && node telemetry-map.test.js | tail -1); (cd cloud/lambda/api && for t in telemetry-view permissions demo; do node $t.test.js | tail -1; done); node cloud/fixtures/fixture.test.js | tail -1`
Expected: `11/11`, `7/7`, `32/32`, `7/7` checks passed; `45/45 keys present`.

- [ ] **Step 5: Commit**

```bash
git add cloud/lambda cloud/CONTRACT.md
git commit -m "feat(cloud): heater coprocessor keys in ingest/API, setpoint_f + clear_fault commands

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017uxgfN1Y67gVKWmTWmpxxk"
```

---

### Task 5: Dashboard Heater tab — type/phase, setpoint, clear fault

**Files:** Modify `cloud/frontend/src/api/contract.js` (+test), `cloud/frontend/src/components/unit/HeaterTab.jsx` (+test), `cloud/frontend/src/api/mock.js`.

**Interfaces — Produces:** `heaterExt(tele)`, `heaterPhaseLabel(phase)`, `heaterTypeLabel(type)` in `contract.js`.

- [ ] **Step 1: Write the failing tests** — apply:

`.superpowers/patches/t5-test.patch`:

````diff
diff --git a/cloud/frontend/src/api/contract.test.js b/cloud/frontend/src/api/contract.test.js
index d38b391..be6f018 100644
--- a/cloud/frontend/src/api/contract.test.js
+++ b/cloud/frontend/src/api/contract.test.js
@@ -1,5 +1,6 @@
 import { describe, it, expect } from 'vitest'
 import { unitStatus, statusDotClass, isStale, heaterStateLabel, fmt,
+  heaterExt, heaterPhaseLabel, heaterTypeLabel,
          heaterFlags, diagOutputs, connLabel, otaStatusView,
          chronological, ageText, modeLabel, unitView, byAttention,
          activeFaults, faultInfo, reportView } from './contract.js'
@@ -51,6 +52,24 @@ describe('heaterStateLabel', () => {
   it('handles unknown', () => expect(heaterStateLabel('')).toBe('Unknown'))
 })
 
+describe('heater coprocessor helpers', () => {
+  it('heaterExt only when heater_phase is present', () => {
+    expect(heaterExt({ heater_state: 'off' })).toBe(false)
+    expect(heaterExt({ heater_phase: 'off' })).toBe(true)
+    expect(heaterExt(null)).toBe(false)
+  })
+  it('phase labels', () => {
+    expect(heaterPhaseLabel('stopping')).toBe('Stopping')
+    expect(heaterPhaseLabel('fault')).toBe('FAULT')
+    expect(heaterPhaseLabel('weird')).toBe('Weird')
+  })
+  it('type labels', () => {
+    expect(heaterTypeLabel('autoterm')).toBe('AUTOTERM')
+    expect(heaterTypeLabel('vevor')).toBe('VEVOR')
+    expect(heaterTypeLabel('none')).toBe(null)
+  })
+})
+
 describe('fmt', () => {
   it('volts', () => expect(fmt.volts(12.64)).toBe('12.6 V'))
   it('dash on null', () => expect(fmt.volts(null)).toBe('—'))
diff --git a/cloud/frontend/src/components/unit/HeaterTab.test.jsx b/cloud/frontend/src/components/unit/HeaterTab.test.jsx
index 37949e7..694c22c 100644
--- a/cloud/frontend/src/components/unit/HeaterTab.test.jsx
+++ b/cloud/frontend/src/components/unit/HeaterTab.test.jsx
@@ -28,6 +28,37 @@ describe('HeaterTab control', () => {
     expect(mutate.mock.calls[0][0]).toEqual({ unit: 'APU-1', body: { heater: { on: 1 } } })
   })
 
+  it('keeps the legacy title when the unit has no coprocessor keys', () => {
+    render(<HeaterTab tele={OFF} unit="APU-1" isDemo={false} />)
+    expect(screen.getByText('VEVOR diesel heater — Off')).toBeTruthy()
+  })
+
+  it('AUTOTERM: shows type + phase and sends a setpoint', () => {
+    mutate.mockClear()
+    const T = { ...OFF, heater_comms_ok: true, heater_type: 'autoterm', heater_phase: 'running',
+      heater_control: 'setpoint', heater_setpoint_f: 72, heater_fault: false }
+    render(<HeaterTab tele={T} unit="APU-1" isDemo={false} />)
+    expect(screen.getByText('AUTOTERM diesel heater — Running')).toBeTruthy()
+    expect(screen.queryByText('Level')).toBeNull()
+    fireEvent.click(screen.getAllByRole('button', { name: '+' })[0])
+    fireEvent.click(screen.getByRole('button', { name: 'Set' }))
+    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
+    expect(mutate.mock.calls[0][0]).toEqual({ unit: 'APU-1', body: { heater: { setpoint_f: 74 } } })
+  })
+
+  it('FAULT: Clear fault sends clear_fault and Turn on is disabled', () => {
+    mutate.mockClear()
+    const F = { ...OFF, heater_type: 'vevor', heater_phase: 'fault', heater_control: 'level',
+      heater_fault: true, heater_error: 255 }
+    render(<HeaterTab tele={F} unit="APU-1" isDemo={false} />)
+    expect(screen.getByRole('button', { name: 'Turn on' }).disabled).toBe(true)
+    expect(screen.queryByText(/Heater error code/)).toBeNull()       // 255 = no vendor code
+    fireEvent.click(screen.getByRole('button', { name: 'Clear fault' }))
+    expect(screen.getByText(/does not start the heater/)).toBeTruthy()
+    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
+    expect(mutate.mock.calls[0][0]).toEqual({ unit: 'APU-1', body: { heater: { clear_fault: true } } })
+  })
+
   it('disables controls for demo units', () => {
     render(<HeaterTab tele={OFF} unit="APU-DEMO-01" isDemo={true} />)
     expect(screen.getByRole('button', { name: 'Turn on' }).disabled).toBe(true)
````

- [ ] **Step 2: Run them to verify they fail**

Run: `cd cloud/frontend && npx vitest run src/api/contract.test.js src/components/unit/HeaterTab.test.jsx 2>&1 | tail -6`
Expected: FAIL — `heaterExt is not a function` / missing "AUTOTERM diesel heater — Running" / no "Clear fault" button.

- [ ] **Step 3: Implement** — apply:

`.superpowers/patches/t5-impl.patch`:

````diff
diff --git a/cloud/frontend/src/api/contract.js b/cloud/frontend/src/api/contract.js
index 98d9dd2..b77da86 100644
--- a/cloud/frontend/src/api/contract.js
+++ b/cloud/frontend/src/api/contract.js
@@ -21,6 +21,23 @@ export function heaterStateLabel(state) {
   return String(state).charAt(0).toUpperCase() + String(state).slice(1)
 }
 
+// Heater coprocessor firmware adds heater_type/phase/control/setpoint_f/fault
+// (cloud/CONTRACT.md). heaterExt() is false for older units, which keep the
+// legacy heater_state view.
+export function heaterExt(tele) {
+  return !!tele && tele.heater_phase != null
+}
+const HEATER_PHASE_LABELS = {
+  off: 'Off', detecting: 'Detecting', starting: 'Starting', running: 'Running',
+  stopping: 'Stopping', cooldown: 'Cooling down', fault: 'FAULT',
+}
+export function heaterPhaseLabel(phase) {
+  return HEATER_PHASE_LABELS[phase] || heaterStateLabel(phase)
+}
+export function heaterTypeLabel(type) {
+  return { vevor: 'VEVOR', autoterm: 'AUTOTERM' }[type] || null
+}
+
 const dash = (v) => v == null || Number.isNaN(Number(v))
 export const fmt = {
   volts: (v) => dash(v) ? '—' : `${Number(v).toFixed(1)} V`,
diff --git a/cloud/frontend/src/api/mock.js b/cloud/frontend/src/api/mock.js
index 9add9ea..fcce97c 100644
--- a/cloud/frontend/src/api/mock.js
+++ b/cloud/frontend/src/api/mock.js
@@ -37,6 +37,8 @@ const SNAPSHOTS = {
     batt_v: 13.9, fan_speed: 65, cabin_temp_f: 74.2, engine_hrs: 812,
     heater_present: true, heater_state: 'running', heater_active_level: 4,
     heater_fan_rpm: 2600, heater_exchanger: 168, heater_comms_ok: true, heater_flags: 1,
+    heater_type: 'vevor', heater_phase: 'running', heater_control: 'level',
+    heater_setpoint_f: 72, heater_vendor_state: '3.0', heater_fault: false, heater_cmd_result: 0,
   }),
   'APU-DEMO-02': baseSnapshot('APU-DEMO-02', {
     demo: true, batt_v: 11.6, error: 'Low battery voltage', error_n: 4,
@@ -162,6 +164,13 @@ export const mockApi = {
         snap.heater_target_level = body.heater.level
         if (snap.heater_state === 'running') snap.heater_active_level = body.heater.level
       }
+      if (body.heater.setpoint_f !== undefined) snap.heater_setpoint_f = body.heater.setpoint_f
+      if (body.heater.clear_fault && snap.heater_fault) {
+        snap.heater_fault = false
+        snap.heater_phase = 'off'
+      }
+      if (snap.heater_phase != null && body.heater.on !== undefined)
+        snap.heater_phase = body.heater.on ? 'running' : 'off'
     }
     if (snap && body.apu_command) {
       // apu_command is the target op-state: 'climate' | 'battery' | 'stop'.
diff --git a/cloud/frontend/src/components/unit/HeaterTab.jsx b/cloud/frontend/src/components/unit/HeaterTab.jsx
index 87e5a81..4e34386 100644
--- a/cloud/frontend/src/components/unit/HeaterTab.jsx
+++ b/cloud/frontend/src/components/unit/HeaterTab.jsx
@@ -1,5 +1,6 @@
 import { useState, useEffect } from 'react'
-import { heaterStateLabel, heaterFlags, fmt, heaterCmdSeq, heaterDesiredPending } from '../../api/contract.js'
+import { heaterStateLabel, heaterFlags, fmt, heaterCmdSeq, heaterDesiredPending,
+  heaterExt, heaterPhaseLabel, heaterTypeLabel } from '../../api/contract.js'
 import { useCommand, useShadow } from '../../data/hooks.js'
 import { useCan } from '../../components/RoleGate.jsx'
 import ConfirmDialog from '../../components/ConfirmDialog.jsx'
@@ -19,6 +20,7 @@ export default function HeaterTab({ tele, unit, isDemo }) {
   const { allowed, reason } = useCan('heater')
   const [confirm, setConfirm] = useState(null) // { title, body, cmd }
   const [level, setLevel] = useState(tele?.heater_target_level || 3)
+  const [setpoint, setSetpoint] = useState(tele?.heater_setpoint_f || 72)
 
   // Ack tracking: capture the reported seq at send; the command is "applied"
   // once the device bumps heater_desired_seq past that baseline.
@@ -40,8 +42,14 @@ export default function HeaterTab({ tele, unit, isDemo }) {
   if (!tele.heater_present) return <div className="notice">No heater detected on this unit.</div>
 
   const flags = heaterFlags(tele.heater_flags)
-  const err = Number(tele.heater_error) !== 0
-  const on = tele.heater_state !== 'off'
+  const ext = heaterExt(tele)
+  const fault = ext && !!tele.heater_fault
+  // 255 = coprocessor fault without a vendor code (shown via the FAULT pill)
+  const err = Number(tele.heater_error) !== 0 && !(fault && Number(tele.heater_error) === 255)
+  const on = ext ? !['off', 'fault', 'detecting'].includes(tele.heater_phase) : tele.heater_state !== 'off'
+  const useSetpoint = ext && tele.heater_control === 'setpoint'
+  const typeLabel = heaterTypeLabel(tele.heater_type) || 'VEVOR'
+  const stateText = ext ? heaterPhaseLabel(tele.heater_phase) : heaterStateLabel(tele.heater_state)
   const disabled = !allowed || isDemo
   const disabledReason = isDemo ? 'Demo units cannot be controlled.' : reason
   const showPending = pending || heaterDesiredPending(shadow)
@@ -57,14 +65,19 @@ export default function HeaterTab({ tele, unit, isDemo }) {
   return (
     <div className="card">
       <div className="sec-hd">
-        <span className="sec-title">VEVOR diesel heater — {heaterStateLabel(tele.heater_state)}</span>
-        <span className={`pill ${tele.heater_comms_ok ? 'p-g' : 'p-r'}`}>
-          {tele.heater_comms_ok ? 'COMMS OK' : 'NO COMMS'}
+        <span className="sec-title">{typeLabel} diesel heater — {stateText}</span>
+        <span style={{ display: 'flex', gap: 5 }}>
+          {fault && <span className="pill p-r">FAULT</span>}
+          <span className={`pill ${tele.heater_comms_ok ? 'p-g' : 'p-r'}`}>
+            {tele.heater_comms_ok ? 'COMMS OK' : 'NO COMMS'}
+          </span>
         </span>
       </div>
 
       <div className="tgrid" style={{ marginTop: 4 }}>
-        <Cell label="Target level" value={fmt.int(tele.heater_target_level)} />
+        {useSetpoint
+          ? <Cell label="Setpoint" value={fmt.tempF(tele.heater_setpoint_f)} />
+          : <Cell label="Target level" value={fmt.int(tele.heater_target_level)} />}
         <Cell label="Active level" value={fmt.int(tele.heater_active_level)} />
         <Cell label="Exchanger" value={fmt.int(tele.heater_exchanger)} />
         <Cell label="Fan RPM" value={fmt.int(tele.heater_fan_rpm)} />
@@ -99,7 +112,8 @@ export default function HeaterTab({ tele, unit, isDemo }) {
       <div style={{ marginTop: 14, paddingTop: 12, borderTop: '0.5px solid var(--color-border-tertiary)' }}>
         <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
              title={disabled ? disabledReason : undefined}>
-          <button className={`btn btn-sm ${on ? 'btn-red' : 'btn-primary'}`} disabled={disabled}
+          <button className={`btn btn-sm ${on ? 'btn-red' : 'btn-primary'}`} disabled={disabled || (fault && !on)}
+            title={fault && !on ? 'Clear the fault before starting the heater.' : undefined}
             onClick={() => ask(
               on ? `Turn heater OFF` : `Turn heater ON`,
               `${on ? 'Stop' : 'Start'} the diesel heater on ${unit}?`,
@@ -107,6 +121,27 @@ export default function HeaterTab({ tele, unit, isDemo }) {
             {on ? 'Turn off' : 'Turn on'}
           </button>
 
+          {fault && (
+            <button className="btn btn-sm btn-red" disabled={disabled}
+              onClick={() => ask('Clear heater fault',
+                `Clear the heater fault on ${unit}? This does not start the heater; it only allows a new start once the heater reports standby.`,
+                { heater: { clear_fault: true } })}>
+              Clear fault
+            </button>
+          )}
+
+          {useSetpoint ? (
+          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
+            <span style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>Setpoint</span>
+            <button className="btn btn-sm" disabled={disabled || setpoint <= 41} onClick={() => setSetpoint((v) => Math.max(41, v - 2))}>−</button>
+            <span style={{ minWidth: 34, textAlign: 'center', fontWeight: 600 }}>{setpoint}°F</span>
+            <button className="btn btn-sm" disabled={disabled || setpoint >= 86} onClick={() => setSetpoint((v) => Math.min(86, v + 2))}>+</button>
+            <button className="btn btn-sm btn-primary" disabled={disabled}
+              onClick={() => ask('Set heater setpoint', `Set heater setpoint to ${setpoint}°F on ${unit}?`, { heater: { setpoint_f: setpoint } })}>
+              Set
+            </button>
+          </div>
+          ) : (
           <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
             <span style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>Level</span>
             <button className="btn btn-sm" disabled={disabled || level <= 1} onClick={() => setLevel((l) => Math.max(1, l - 1))}>−</button>
@@ -117,6 +152,7 @@ export default function HeaterTab({ tele, unit, isDemo }) {
               Set
             </button>
           </div>
+          )}
 
           {showPending && <span className="pill p-a">Pending…</span>}
           {applied && !showPending && <span className="pill p-g">Applied ✓</span>}
````

- [ ] **Step 4: Verify**

Run: `cd cloud/frontend && npx vitest run 2>&1 | grep -E "Test Files|Tests "` → `25 passed`, `194 passed`.
Run: `cd cloud/frontend && npx vite build --outDir /tmp/vite-out 2>&1 | tail -1` → `✓ built`.

- [ ] **Step 5: Commit**

```bash
git add cloud/frontend/src
git commit -m "feat(dashboard): Heater tab shows type/phase, AUTOTERM setpoint, Clear fault

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017uxgfN1Y67gVKWmTWmpxxk"
```

---

## After merge (user-run)

- Release a device image: tag `vX.Y.Z` on `main` + `gh workflow run build.yml --ref vX.Y.Z -R delorean1483/cortex-yocto`.
- Deploy cloud: `deploy-lambda.sh` for ingest + api (verify CodeSha256), `vercel --prod` for the frontend.
