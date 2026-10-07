# On-Panel Software Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a technician check for and install a newer unit software release from the panel (Menu → Maintenance → Software Update), using the existing signed OTA path.

**Architecture:** CI publishes `releases/latest.json` on clean tag releases. gobi-agent fetches it on demand (libcurl) when the panel drops `{"ota_check":1}`, decides with a pure host-tested `ota_offer` module whether to offer it, and publishes the result in `latest.json`; `{"ota_install":"N.N.N"}` is honoured only for the exact offered version and hands off to the existing `ota_trigger()` → root `gobi-ota-apply`. The panel adds a Software Update screen; the existing UpdateOverlay shows progress.

**Tech Stack:** C11 + cJSON + libcurl (gobi-agent, `tests/run.sh`), Qt6/QML (gobi-ui, offscreen preview runner), GitHub Actions + aws-cli.

**Spec:** `docs/superpowers/specs/2026-10-07-panel-software-update-design.md`

## Global Constraints

- Manifest URL `https://ecofleet-ota.s3.amazonaws.com/releases/latest.json`; body `{"version":"N.N.N","published":"<ISO>"}`; only strict `N.N.N` is valid.
- Panel never downgrades or reinstalls (offer only if latest > running) and never installs while an OTA (`downloading…`/`installing…`) or an APU flash is in progress.
- Install accepted only for the exact version of the last successful check.
- Check: 8 s timeout, 4 KB body cap, TLS verification on; never installs anything.
- Screen lives under Maintenance (PIN-gated hub); install is a two-tap `ConfirmButton`.
- CI writes `latest.json` only for clean `vN.N.N` tags, and only after the `.swu` upload.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017uxgfN1Y67gVKWmTWmpxxk
  ```

## Review Focus

1. **Lexical vs numeric versions** (1.2.9 vs 1.2.10): must compare numerically → `test_ota_offer` (Task 1).
2. **S3 404/403 HTML body or a huge body** must be "bad manifest", never a crash or a bogus offer → `test_ota_offer` parse cases (Task 1) + 4 KB cap in `ota_on_data` (Task 2).
3. **Install of a version not (or no longer) offered** — e.g. a stale screen after a newer release, or a busy unit — must be refused → `ota_install_request` (Task 2), decide truth table (Task 1).
4. **Prerelease tags** (`-rc`, `-diag`) must never become `latest.json` → CI dry run (Task 4).
5. **WiFi Forget button unchanged** after `ConfirmButton` gains a `tone` → preview shot `21h2-wifi-saved-forget-armed` still red (Task 3).

## How to apply each patch

Each block below is labelled with a path under `.superpowers/patches/`. Save its contents there and `git apply` it from the repo root (`git apply --check` first). Generated against `feat/panel-ota` @ the spec commit and verified to apply in task order.

---

### Task 1: `ota_offer` pure module

**Files:** Create `gobi-agent/files/ota_offer.h`, `ota_offer.c`, `tests/test_ota_offer.c`; modify `tests/run.sh`, `files/CMakeLists.txt` (adds `ota_offer.c`, and links libcurl for Task 2), `gobi-agent_1.0.bb`.

**Interfaces — Produces:** `bool ota_ver_valid(const char*)`, `int ota_ver_cmp(const char*, const char*)`, `bool ota_parse_latest(const char *json, char *ver, size_t len)`, `bool ota_status_busy(const char*)`, `ota_offer_t ota_decide(const char *running, const char *latest, bool ota_busy, bool apu_flash_busy)` with `OTA_OFFER_NONE / OTA_OFFER_AVAILABLE / OTA_OFFER_BLOCKED_BUSY`.

- [ ] **Step 1: Write the failing test** — apply:

`.superpowers/patches/t1-test.patch`:

````diff
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-agent/tests/run.sh b/meta-ecofleet/recipes-ecofleet/gobi-agent/tests/run.sh
index b59984d..d579ee0 100755
--- a/meta-ecofleet/recipes-ecofleet/gobi-agent/tests/run.sh
+++ b/meta-ecofleet/recipes-ecofleet/gobi-agent/tests/run.sh
@@ -136,3 +136,8 @@ cc -std=c11 -Wall -Wextra -Wpedantic -g -fsanitize=address,undefined \
    "$here/test_shadow_heater.c" "$files/location.c" "$files/state_path.c" \
    -L"$cjson/lib" -lcjson -lpthread \
    -o "$here/test_shadow_heater" && "$here/test_shadow_heater"
+
+# On-panel software update: manifest parse, version compare, offer decision.
+cc -std=c11 -Wall -Wextra -Wpedantic -g -fsanitize=address,undefined \
+   -I"$files" -I"$cjson/include" "$here/test_ota_offer.c" "$files/ota_offer.c" \
+   -L"$cjson/lib" -lcjson -o "$here/test_ota_offer" && "$here/test_ota_offer"
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-agent/tests/test_ota_offer.c b/meta-ecofleet/recipes-ecofleet/gobi-agent/tests/test_ota_offer.c
new file mode 100644
index 0000000..625d05b
--- /dev/null
+++ b/meta-ecofleet/recipes-ecofleet/gobi-agent/tests/test_ota_offer.c
@@ -0,0 +1,49 @@
+#include "ota_offer.h"
+#include <stdio.h>
+#include <string.h>
+static int fails;
+#define CHECK(c) do{ if(!(c)){ printf("FAIL %s:%d %s\n",__FILE__,__LINE__,#c); fails++; } }while(0)
+int main(void){
+    char v[16];
+    /* version validity */
+    CHECK(ota_ver_valid("1.2.73"));
+    CHECK(!ota_ver_valid("1.2"));       CHECK(!ota_ver_valid("1.2.3.4"));
+    CHECK(!ota_ver_valid("v1.2.3"));    CHECK(!ota_ver_valid("1.2.3-rc1"));
+    CHECK(!ota_ver_valid("1..3"));      CHECK(!ota_ver_valid(""));
+    CHECK(!ota_ver_valid("123456.1.1")); CHECK(!ota_ver_valid(NULL));
+
+    /* compare: numeric, not lexical */
+    CHECK(ota_ver_cmp("1.2.9","1.2.10") < 0);
+    CHECK(ota_ver_cmp("1.10.0","1.9.9") > 0);
+    CHECK(ota_ver_cmp("1.2.73","1.2.73") == 0);
+    CHECK(ota_ver_cmp("garbage","1.0.0") < 0);
+    CHECK(ota_ver_cmp("1.0.0","garbage") > 0);
+
+    /* manifest parse */
+    CHECK(ota_parse_latest("{\"version\":\"1.2.74\",\"published\":\"x\"}", v, sizeof v) && strcmp(v,"1.2.74")==0);
+    CHECK(!ota_parse_latest("{\"published\":\"x\"}", v, sizeof v));
+    CHECK(!ota_parse_latest("{\"version\":174}", v, sizeof v));
+    CHECK(!ota_parse_latest("{\"version\":\"1.2.74-rc1\"}", v, sizeof v));
+    CHECK(!ota_parse_latest("<html>404</html>", v, sizeof v));
+    CHECK(!ota_parse_latest("{\"version\":\"1.2.74\"}", v, 4));   /* too small buffer */
+    CHECK(!ota_parse_latest(NULL, v, sizeof v));
+
+    /* busy */
+    CHECK(ota_status_busy("downloading 1.2.74"));
+    CHECK(ota_status_busy("installing 1.2.74"));
+    CHECK(!ota_status_busy("idle")); CHECK(!ota_status_busy("failed: install 1.2.74 (rc 1)"));
+    CHECK(!ota_status_busy("success 1.2.74")); CHECK(!ota_status_busy(NULL));
+
+    /* decide */
+    CHECK(ota_decide("1.2.73","1.2.74",false,false) == OTA_OFFER_AVAILABLE);
+    CHECK(ota_decide("1.2.73","1.2.73",false,false) == OTA_OFFER_NONE);   /* same */
+    CHECK(ota_decide("1.2.74","1.2.73",false,false) == OTA_OFFER_NONE);   /* no downgrade */
+    CHECK(ota_decide("1.2.73","bad",false,false)    == OTA_OFFER_NONE);
+    CHECK(ota_decide("1.2.73","1.2.74",true,false)  == OTA_OFFER_BLOCKED_BUSY);
+    CHECK(ota_decide("1.2.73","1.2.74",false,true)  == OTA_OFFER_BLOCKED_BUSY);
+    CHECK(ota_decide("","1.2.74",false,false)       == OTA_OFFER_AVAILABLE); /* unknown running */
+    CHECK(ota_decide("1.2.73","",false,false)       == OTA_OFFER_NONE);
+
+    printf(fails?"test_ota_offer FAILED (%d)\n":"test_ota_offer ok\n", fails);
+    return fails?1:0;
+}
````

- [ ] **Step 2: Run it to verify it fails**

Run: `sh meta-ecofleet/recipes-ecofleet/gobi-agent/tests/run.sh 2>&1 | tail -3`
Expected: FAIL — `ota_offer.h: No such file or directory` (or the `ota_offer.c` source missing) at the new last block.

- [ ] **Step 3: Implement** — apply:

`.superpowers/patches/t1-impl.patch`:

````diff
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-agent/files/CMakeLists.txt b/meta-ecofleet/recipes-ecofleet/gobi-agent/files/CMakeLists.txt
index dbca958..9c1d8ba 100644
--- a/meta-ecofleet/recipes-ecofleet/gobi-agent/files/CMakeLists.txt
+++ b/meta-ecofleet/recipes-ecofleet/gobi-agent/files/CMakeLists.txt
@@ -51,6 +51,7 @@ target_sources(gobi-agent PRIVATE
     heater_ext.c
     apu_command.c
     ota_status.c
+    ota_offer.c
 )
 
 target_include_directories(gobi-agent PRIVATE
@@ -59,6 +60,7 @@ target_include_directories(gobi-agent PRIVATE
     ${MOSQUITTO_INCLUDE_DIR}
     ${SQLITE3_INCLUDE_DIR}
     ${CJSON_INCLUDE_DIR}
+    ${CURL_INCLUDE_DIR}
 )
 
 target_link_libraries(gobi-agent PRIVATE
@@ -66,6 +68,7 @@ target_link_libraries(gobi-agent PRIVATE
     ${MOSQUITTO_LIB}
     ${SQLITE3_LIB}
     ${CJSON_LIB}
+    ${CURL_LIB}
     pthread
 )
 
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-agent/files/ota_offer.c b/meta-ecofleet/recipes-ecofleet/gobi-agent/files/ota_offer.c
new file mode 100644
index 0000000..6e554b2
--- /dev/null
+++ b/meta-ecofleet/recipes-ecofleet/gobi-agent/files/ota_offer.c
@@ -0,0 +1,75 @@
+#include "ota_offer.h"
+#include <cjson/cJSON.h>
+#include <stdlib.h>
+#include <string.h>
+
+bool ota_ver_valid(const char *v)
+{
+    int parts = 0, digits = 0;
+    if (!v || !*v) return false;
+    for (const char *p = v; ; p++) {
+        if (*p >= '0' && *p <= '9') {
+            if (++digits > 5) return false;
+        } else if (*p == '.' || *p == '\0') {
+            if (digits == 0) return false;
+            parts++;
+            digits = 0;
+            if (*p == '\0') break;
+        } else {
+            return false;
+        }
+    }
+    return parts == 3;
+}
+
+static void ver_parts(const char *v, long out[3])
+{
+    char *end;
+    out[0] = strtol(v, &end, 10);
+    out[1] = strtol(end + 1, &end, 10);
+    out[2] = strtol(end + 1, &end, 10);
+}
+
+int ota_ver_cmp(const char *a, const char *b)
+{
+    bool va = ota_ver_valid(a), vb = ota_ver_valid(b);
+    if (!va || !vb) return (int)va - (int)vb;
+    long pa[3], pb[3];
+    ver_parts(a, pa);
+    ver_parts(b, pb);
+    for (int i = 0; i < 3; i++)
+        if (pa[i] != pb[i]) return pa[i] < pb[i] ? -1 : 1;
+    return 0;
+}
+
+bool ota_parse_latest(const char *json, char *ver, size_t len)
+{
+    bool ok = false;
+    if (!json || !ver || len == 0) return false;
+    ver[0] = '\0';
+    cJSON *root = cJSON_Parse(json);
+    if (!root) return false;
+    const cJSON *v = cJSON_GetObjectItemCaseSensitive(root, "version");
+    if (cJSON_IsString(v) && v->valuestring && ota_ver_valid(v->valuestring) &&
+        strlen(v->valuestring) < len) {
+        strcpy(ver, v->valuestring);
+        ok = true;
+    }
+    cJSON_Delete(root);
+    return ok;
+}
+
+bool ota_status_busy(const char *s)
+{
+    if (!s) return false;
+    return strncmp(s, "downloading", 11) == 0 || strncmp(s, "installing", 10) == 0;
+}
+
+ota_offer_t ota_decide(const char *running, const char *latest,
+                       bool ota_busy, bool apu_flash_busy)
+{
+    if (!ota_ver_valid(latest)) return OTA_OFFER_NONE;
+    if (running && running[0] && ota_ver_cmp(latest, running) <= 0) return OTA_OFFER_NONE;
+    if (ota_busy || apu_flash_busy) return OTA_OFFER_BLOCKED_BUSY;
+    return OTA_OFFER_AVAILABLE;
+}
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-agent/files/ota_offer.h b/meta-ecofleet/recipes-ecofleet/gobi-agent/files/ota_offer.h
new file mode 100644
index 0000000..0fbe0ea
--- /dev/null
+++ b/meta-ecofleet/recipes-ecofleet/gobi-agent/files/ota_offer.h
@@ -0,0 +1,35 @@
+/* ota_offer.h — pure decisions for the on-panel software update: parse the
+ * public releases/latest.json manifest, compare N.N.N versions, and decide
+ * whether an update may be offered/installed. No I/O; host-tested by
+ * ../tests/test_ota_offer.c.
+ */
+#pragma once
+#include <stdbool.h>
+#include <stddef.h>
+
+typedef enum {
+    OTA_OFFER_NONE = 0,        /* latest invalid, or not newer than running   */
+    OTA_OFFER_AVAILABLE,       /* newer release, nothing else in progress     */
+    OTA_OFFER_BLOCKED_BUSY     /* newer release, but an OTA/APU flash is busy */
+} ota_offer_t;
+
+/* true if v is exactly N.N.N (digits only, each part 1..5 digits). */
+bool ota_ver_valid(const char *v);
+
+/* Numeric N.N.N compare: <0, 0, >0. An invalid version sorts below any valid
+ * one; two invalid versions compare equal. */
+int ota_ver_cmp(const char *a, const char *b);
+
+/* Extract "version" from a latest.json body into ver (NUL-terminated).
+ * False if the JSON is unparseable, the key is missing/not a string, or the
+ * value is not N.N.N. */
+bool ota_parse_latest(const char *json, char *ver, size_t len);
+
+/* true while the root worker reports an install in flight
+ * ("downloading <v>" / "installing <v>"). */
+bool ota_status_busy(const char *ota_status);
+
+/* Decide what the panel may offer. running may be "" (unknown): then any valid
+ * latest is offered. */
+ota_offer_t ota_decide(const char *running, const char *latest,
+                       bool ota_busy, bool apu_flash_busy);
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-agent/gobi-agent_1.0.bb b/meta-ecofleet/recipes-ecofleet/gobi-agent/gobi-agent_1.0.bb
index 7e5bd30..37c9d95 100644
--- a/meta-ecofleet/recipes-ecofleet/gobi-agent/gobi-agent_1.0.bb
+++ b/meta-ecofleet/recipes-ecofleet/gobi-agent/gobi-agent_1.0.bb
@@ -16,7 +16,9 @@ SRC_URI = " \
     file://apu_command.h \
     file://apu_command.c \
     file://ota_status.h \
+    file://ota_offer.h \
     file://ota_status.c \
+    file://ota_offer.c \
     file://weather.h \
     file://weather.c \
     file://location.h \
````

- [ ] **Step 4: Run the agent suite**

Run: `sh meta-ecofleet/recipes-ecofleet/gobi-agent/tests/run.sh 2>&1 | tail -1`
Expected: exit 0, `test_ota_offer ok`.

- [ ] **Step 5: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-agent
git commit -m "feat(gobi-agent): ota_offer — manifest parse, version compare, offer decision

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017uxgfN1Y67gVKWmTWmpxxk"
```

---

### Task 2: Agent — check, install, latest.json keys

**Files:** Modify `gobi-agent/files/main.c`.

**Interfaces:**
- Consumes: Task 1; existing `running_version()`, `read_ota_status()`, `ota_trigger()`, `stm32_flash_status()`.
- Produces: `command.json` keys `ota_check` (1) and `ota_install` ("N.N.N"); `latest.json` keys `ota_running`, `ota_latest`, `ota_available`, `ota_check_state` (`idle`/`ok`/`failed: network`/`failed: bad manifest`/`failed: busy`/`failed: not offered`), `ota_check_ts`.

The network fetch is not host-unit-tested (I/O); the decisions it relies on are (Task 1). The gate here is a strict compile + a full native link of gobi-agent against libcurl.

- [ ] **Step 1: Apply**

`.superpowers/patches/t2-impl.patch`:

````diff
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-agent/files/main.c b/meta-ecofleet/recipes-ecofleet/gobi-agent/files/main.c
index 311065b..169336e 100644
--- a/meta-ecofleet/recipes-ecofleet/gobi-agent/files/main.c
+++ b/meta-ecofleet/recipes-ecofleet/gobi-agent/files/main.c
@@ -18,6 +18,7 @@
 #include "heater_ext.h"
 #include "apu_command.h"
 #include "ota_status.h"
+#include "ota_offer.h"
 
 #include <stdio.h>
 #include <stdlib.h>
@@ -36,6 +37,7 @@
 #include <mosquitto.h>
 #include <sqlite3.h>
 #include <cjson/cJSON.h>
+#include <curl/curl.h>
 
 /* ── EF-G0B1R enum → label helpers ───────────────────────────────────────── */
 /* Mirror the firmware enums in App/services/control.h. */
@@ -354,6 +356,74 @@ static void read_ota_status(char *out, size_t out_len)
     out[out_len - 1] = '\0';
 }
 
+/* ── On-panel software update (Maintenance → Software Update) ───────────────
+ * The panel asks for a check ({"ota_check":1}); we fetch the public manifest
+ * CI writes on every normal tag release and publish the outcome in
+ * latest.json. An install ({"ota_install":"N.N.N"}) is honoured only for the
+ * exact version a successful check offered, and only while nothing else is
+ * updating; it then follows the same root-worker path as a dashboard OTA.
+ * Telemetry thread only (same thread as apply_command_file). */
+#define OTA_LATEST_URL     "https://ecofleet-ota.s3.amazonaws.com/releases/latest.json"
+#define OTA_CHECK_TIMEOUT_S 8L
+#define OTA_MANIFEST_MAX   4096u
+
+static char     g_ota_latest[16];          /* last fetched manifest version     */
+static char     g_ota_check_state[32] = "idle";
+static uint64_t g_ota_check_ts;            /* epoch ms of last completed check   */
+
+typedef struct { char data[OTA_MANIFEST_MAX + 1]; size_t len; bool overflow; } ota_buf_t;
+
+static size_t ota_on_data(char *ptr, size_t size, size_t nmemb, void *ud)
+{
+    ota_buf_t *b = ud;
+    size_t add = size * nmemb;
+    if (b->len + add > OTA_MANIFEST_MAX) { b->overflow = true; return 0; }  /* abort */
+    memcpy(b->data + b->len, ptr, add);
+    b->len += add;
+    b->data[b->len] = '\0';
+    return add;
+}
+
+static uint64_t now_ms(void)
+{
+    struct timespec ts;
+    clock_gettime(CLOCK_REALTIME, &ts);
+    return (uint64_t)ts.tv_sec * 1000u + (uint64_t)(ts.tv_nsec / 1000000);
+}
+
+static void ota_check_now(void)
+{
+    ota_buf_t buf = { .len = 0, .overflow = false };
+    buf.data[0] = '\0';
+    CURL *c = curl_easy_init();
+    if (!c) { snprintf(g_ota_check_state, sizeof(g_ota_check_state), "failed: network"); return; }
+    curl_easy_setopt(c, CURLOPT_URL, OTA_LATEST_URL);
+    curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, ota_on_data);
+    curl_easy_setopt(c, CURLOPT_WRITEDATA, &buf);
+    curl_easy_setopt(c, CURLOPT_TIMEOUT, OTA_CHECK_TIMEOUT_S);
+    curl_easy_setopt(c, CURLOPT_CONNECTTIMEOUT, OTA_CHECK_TIMEOUT_S);
+    curl_easy_setopt(c, CURLOPT_NOSIGNAL, 1L);
+    curl_easy_setopt(c, CURLOPT_USERAGENT, "gobi-agent-ota-check/1.0");
+    CURLcode rc = curl_easy_perform(c);
+    long http = 0;
+    curl_easy_getinfo(c, CURLINFO_RESPONSE_CODE, &http);
+    curl_easy_cleanup(c);
+
+    char ver[sizeof(g_ota_latest)];
+    if (rc != CURLE_OK && !buf.overflow) {
+        syslog(LOG_WARNING, "ota-check: fetch failed: %s", curl_easy_strerror(rc));
+        snprintf(g_ota_check_state, sizeof(g_ota_check_state), "failed: network");
+    } else if (buf.overflow || http != 200 || !ota_parse_latest(buf.data, ver, sizeof(ver))) {
+        syslog(LOG_WARNING, "ota-check: bad manifest (HTTP %ld, %zu bytes)", http, buf.len);
+        snprintf(g_ota_check_state, sizeof(g_ota_check_state), "failed: bad manifest");
+    } else {
+        snprintf(g_ota_latest, sizeof(g_ota_latest), "%s", ver);
+        snprintf(g_ota_check_state, sizeof(g_ota_check_state), "ok");
+        syslog(LOG_INFO, "ota-check: latest release %s", ver);
+    }
+    g_ota_check_ts = now_ms();
+}
+
 /* Atomically drop a one-line request for the root gobi-ota-apply worker (temp
  * file + rename, so the .path unit never triggers on a partial line). */
 static void write_ota_request(const char *line)
@@ -637,6 +707,35 @@ static const char *apu_flash_state_str(stu_status_t s)
     }
 }
 
+/* Current offer for the panel, re-evaluated against live busy state. */
+static ota_offer_t ota_current_offer(void)
+{
+    char running[32], st[64];
+    running_version(running, sizeof(running));
+    read_ota_status(st, sizeof(st));
+    return ota_decide(running, g_ota_latest, ota_status_busy(st),
+                      stm32_flash_status() == STU_FLASHING);
+}
+
+static void ota_install_request(const char *version)
+{
+    if (strcmp(version, g_ota_latest) != 0 || !ota_ver_valid(version)) {
+        syslog(LOG_WARNING, "ota: panel install of '%s' refused — not offered", version);
+        snprintf(g_ota_check_state, sizeof(g_ota_check_state), "failed: not offered");
+        return;
+    }
+    ota_offer_t o = ota_current_offer();
+    if (o != OTA_OFFER_AVAILABLE) {
+        syslog(LOG_WARNING, "ota: panel install of %s refused — %s", version,
+               o == OTA_OFFER_BLOCKED_BUSY ? "busy" : "not newer");
+        snprintf(g_ota_check_state, sizeof(g_ota_check_state),
+                 o == OTA_OFFER_BLOCKED_BUSY ? "failed: busy" : "failed: not offered");
+        return;
+    }
+    syslog(LOG_INFO, "ota: panel install of %s", version);
+    ota_trigger(version);
+}
+
 static cJSON *telemetry_object(const telemetry_t *t)
 {
     cJSON *root = cJSON_CreateObject();
@@ -742,6 +841,17 @@ static char *build_latest_json(const telemetry_t *t)
     char ota[64];
     read_ota_status(ota, sizeof(ota));
     cJSON_AddStringToObject(root, "ota_status", ota[0] ? ota : "idle");
+    /* On-panel software update state (Maintenance → Software Update). */
+    {
+        char running[32];
+        running_version(running, sizeof(running));
+        cJSON_AddStringToObject(root, "ota_running",     running);
+        cJSON_AddStringToObject(root, "ota_latest",      g_ota_latest);
+        cJSON_AddStringToObject(root, "ota_available",
+            ota_current_offer() == OTA_OFFER_AVAILABLE ? g_ota_latest : "");
+        cJSON_AddStringToObject(root, "ota_check_state", g_ota_check_state);
+        cJSON_AddNumberToObject(root, "ota_check_ts",    (double)g_ota_check_ts);
+    }
     char *json = cJSON_PrintUnformatted(root);
     cJSON_Delete(root);
     return json;
@@ -917,6 +1027,14 @@ static void apply_command_file(void)
         for (int i = 0; i < n; i++) mb_write_reg(hw[i].reg, hw[i].value, hw[i].what);
     }
 
+    /* ota_check: 1 -> fetch releases/latest.json (never installs anything) */
+    const cJSON *och = cJSON_GetObjectItemCaseSensitive(root, "ota_check");
+    if (cJSON_IsNumber(och) && (int)och->valuedouble == 1) ota_check_now();
+
+    /* ota_install: "N.N.N" -> only the version a successful check offered */
+    const cJSON *oin = cJSON_GetObjectItemCaseSensitive(root, "ota_install");
+    if (cJSON_IsString(oin) && oin->valuestring) ota_install_request(oin->valuestring);
+
     cJSON_Delete(root);
 }
 
@@ -949,6 +1067,10 @@ int main(void)
     openlog("gobi-agent", LOG_PID | LOG_CONS | LOG_PERROR, LOG_DAEMON);
     syslog(LOG_INFO, "gobi-agent starting (agent build %s)", FIRMWARE_VERSION);
 
+    /* libcurl (on-panel update check): global init once, before any thread
+     * starts — curl_easy_init()'s lazy init is not thread-safe. */
+    curl_global_init(CURL_GLOBAL_DEFAULT);
+
     signal(SIGTERM, handle_signal);
     signal(SIGINT,  handle_signal);
     signal(SIGCHLD, SIG_IGN);   /* auto-reap OTA child processes */
@@ -1296,6 +1418,7 @@ int main(void)
     mosquitto_loop_stop(g_mosq, true);
     mosquitto_destroy(g_mosq);
     mosquitto_lib_cleanup();
+    curl_global_cleanup();
     modbus_close(g_modbus);
     modbus_free(g_modbus);
     sqlite3_close(g_db);
````

- [ ] **Step 2: Verify**

```bash
sh meta-ecofleet/recipes-ecofleet/gobi-agent/tests/run.sh 2>&1 | tail -1          # test_ota_offer ok
F=meta-ecofleet/recipes-ecofleet/gobi-agent/files
cc -std=gnu11 -Wall -Wextra -fsyntax-only -DMQTT_ENDPOINT='"x"' -DFIRMWARE_VERSION='"1.0"' -I$F \
   -I$(brew --prefix cjson)/include -I$(brew --prefix libmodbus)/include/modbus -I$(brew --prefix libmodbus)/include \
   -I$(brew --prefix mosquitto)/include $F/main.c && echo OK main.c
cmake -S $F -B /tmp/agent-b -DCMAKE_PREFIX_PATH="$(brew --prefix libmodbus);$(brew --prefix mosquitto);$(brew --prefix cjson);$(brew --prefix sqlite);$(brew --prefix curl)" \
   -DMQTT_ENDPOINT=x -DFIRMWARE_VERSION=1.0 >/dev/null && cmake --build /tmp/agent-b --target gobi-agent 2>&1 | grep -E "error|warning: "; echo link-done
```
Expected: `test_ota_offer ok`, `OK main.c`, `link-done` with no error/warning lines.

- [ ] **Step 3: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-agent
git commit -m "feat(gobi-agent): on-panel update check + install (ota_check / ota_install)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017uxgfN1Y67gVKWmTWmpxxk"
```

---

### Task 3: gobi-ui — Software Update screen

**Files:** Create `gobi-ui/files/qml/screens/SoftwareUpdateScreen.qml`; modify `TelemetryModel.h/.cpp`, `qml/screens/MaintenanceScreen.qml`, `qml/atoms/ConfirmButton.qml` (new `tone`, default fault red), `qml/preview/Mocks.qml`, `qml/preview/Shots.qml`, `gobi-ui_1.0.bb`.

**Interfaces — Produces:** Q_PROPERTYs `otaRunning, otaLatest, otaAvailable, otaCheckState, otaCheckTs`; `Q_INVOKABLE checkForUpdate()`, `installUpdate(QString)`; `ConfirmButton.tone`.

- [ ] **Step 1: Apply**

`.superpowers/patches/t3-ui.patch`:

````diff
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-ui/files/TelemetryModel.cpp b/meta-ecofleet/recipes-ecofleet/gobi-ui/files/TelemetryModel.cpp
index be12383..de21a3c 100644
--- a/meta-ecofleet/recipes-ecofleet/gobi-ui/files/TelemetryModel.cpp
+++ b/meta-ecofleet/recipes-ecofleet/gobi-ui/files/TelemetryModel.cpp
@@ -105,6 +105,12 @@ void TelemetryModel::poll()
     m_heaterFault        = o[u"heater_fault"].toBool();
     m_heaterCmdResult    = static_cast<int>(o[u"heater_cmd_result"].toDouble());
 
+    m_otaRunning    = o[u"ota_running"].toString();
+    m_otaLatest     = o[u"ota_latest"].toString();
+    m_otaAvailable  = o[u"ota_available"].toString();
+    m_otaCheckState = o[u"ota_check_state"].toString(QStringLiteral("idle"));
+    m_otaCheckTs    = o[u"ota_check_ts"].toDouble();
+
     m_update = describeUpdate(o[u"ota_status"].toString(),
                               o[u"apu_flash_state"].toString(),
                               static_cast<int>(o[u"stm32_update_pct"].toDouble()));
@@ -137,4 +143,6 @@ void TelemetryModel::setTestRelay(int index, bool on)  { writeCommand(QStringLit
 void TelemetryModel::setHeaterOn(bool on)    { writeCommand(QStringLiteral("heater_on"), on ? 1 : 0); }
 void TelemetryModel::setHeaterLevel(int level) { writeCommand(QStringLiteral("heater_level"), level); }
 void TelemetryModel::setHeaterSetpointF(int degF) { writeCommand(QStringLiteral("heater_setpoint_f"), degF); }
+void TelemetryModel::checkForUpdate()        { writeCommand(QStringLiteral("ota_check"), 1); }
+void TelemetryModel::installUpdate(const QString &ver) { writeCommand(QStringLiteral("ota_install"), ver); }
 void TelemetryModel::clearHeaterFault()       { writeCommand(QStringLiteral("heater_clear_fault"), 1); }
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-ui/files/TelemetryModel.h b/meta-ecofleet/recipes-ecofleet/gobi-ui/files/TelemetryModel.h
index ed46357..fd79194 100644
--- a/meta-ecofleet/recipes-ecofleet/gobi-ui/files/TelemetryModel.h
+++ b/meta-ecofleet/recipes-ecofleet/gobi-ui/files/TelemetryModel.h
@@ -69,6 +69,12 @@ class TelemetryModel : public QObject
     Q_PROPERTY(QString updateDetail READ updateDetail NOTIFY dataChanged)
     Q_PROPERTY(QString updateKey    READ updateKey    NOTIFY dataChanged)
     Q_PROPERTY(int     updateProgress READ updateProgress NOTIFY dataChanged)   // 0-100, -1 = indeterminate
+    /* On-panel software update (Maintenance → Software Update). */
+    Q_PROPERTY(QString otaRunning    READ otaRunning    NOTIFY dataChanged)
+    Q_PROPERTY(QString otaLatest     READ otaLatest     NOTIFY dataChanged)
+    Q_PROPERTY(QString otaAvailable  READ otaAvailable  NOTIFY dataChanged)
+    Q_PROPERTY(QString otaCheckState READ otaCheckState NOTIFY dataChanged)
+    Q_PROPERTY(double  otaCheckTs    READ otaCheckTs    NOTIFY dataChanged)
 
 public:
     explicit TelemetryModel(QObject *parent = nullptr);
@@ -88,6 +94,8 @@ public:
     Q_INVOKABLE void setHeaterOn(bool on);               // heater_on 0|1
     Q_INVOKABLE void setHeaterLevel(int level);          // heater_level 1..10
     Q_INVOKABLE void setHeaterSetpointF(int degF);       // heater_setpoint_f 41..86
+    Q_INVOKABLE void checkForUpdate();                   // ota_check 1
+    Q_INVOKABLE void installUpdate(const QString &ver);  // ota_install "N.N.N"
     Q_INVOKABLE void clearHeaterFault();                 // heater_clear_fault 1
 
     double  cabinTempF()    const { return m_cabinTempF; }
@@ -140,6 +148,11 @@ public:
     int     heaterCmdResult()    const { return m_heaterCmdResult; }
     QString updateKind()   const;
     QString updateTitle()  const { return m_update.title; }
+    QString otaRunning()    const { return m_otaRunning; }
+    QString otaLatest()     const { return m_otaLatest; }
+    QString otaAvailable()  const { return m_otaAvailable; }
+    QString otaCheckState() const { return m_otaCheckState; }
+    double  otaCheckTs()    const { return m_otaCheckTs; }
     QString updateDetail() const { return m_update.detail; }
     QString updateKey()    const { return m_update.key; }
     int     updateProgress() const { return m_update.progress; }
@@ -193,6 +206,11 @@ private:
     QString m_heaterVendorState;
     bool    m_heaterFault        = false;
     int     m_heaterCmdResult    = 0;
+    QString m_otaRunning;
+    QString m_otaLatest;
+    QString m_otaAvailable;
+    QString m_otaCheckState      = QStringLiteral("idle");
+    double  m_otaCheckTs         = 0;
 
     UpdateNotice m_update;
 };
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/atoms/ConfirmButton.qml b/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/atoms/ConfirmButton.qml
index b7adb4c..994539b 100644
--- a/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/atoms/ConfirmButton.qml
+++ b/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/atoms/ConfirmButton.qml
@@ -9,18 +9,19 @@ Rectangle {
     property string label: "Forget"
     property string confirmLabel: "Tap again to forget"
     property int armMs: 3000
+    property color tone: Theme.fault   // fault red for destructive actions; accent for e.g. Install
     property bool armed: false
     signal confirmed()
 
     Layout.preferredWidth: armed ? 168 : 96
     Layout.preferredHeight: 38
     radius: Theme.radiusSm
-    color: armed ? Theme.fault : (ma.pressed ? Theme.surface2 : "transparent")
-    border.color: Theme.fault
+    color: armed ? cb.tone : (ma.pressed ? Theme.surface2 : "transparent")
+    border.color: cb.tone
     Behavior on Layout.preferredWidth { NumberAnimation { duration: 120 } }
 
     Text { anchors.centerIn: parent; text: cb.armed ? cb.confirmLabel : cb.label
-        color: cb.armed ? Theme.text : Theme.fault
+        color: cb.armed ? Theme.text : cb.tone
         font.pixelSize: Theme.fsLabel + 1; font.weight: Font.DemiBold }
 
     Timer { id: disarm; interval: cb.armMs; onTriggered: cb.armed = false }
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/preview/Mocks.qml b/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/preview/Mocks.qml
index 73642d5..4f2e01c 100644
--- a/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/preview/Mocks.qml
+++ b/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/preview/Mocks.qml
@@ -35,6 +35,9 @@ QtObject {
         property string heaterPhase: "off";    property string heaterControl: "level"
         property int    heaterSetpointF: 72;   property string heaterVendorState: ""
         property bool   heaterFault: false;    property int    heaterCmdResult: 0
+        property string otaRunning: "1.2.73"; property string otaLatest: "1.2.73"
+        property string otaAvailable: "";     property string otaCheckState: "ok"
+        property real   otaCheckTs: Date.now() - 120000
         // firmware update notice (TelemetryModel.update*: kind none|busy|failed)
         property string updateKind: "none";   property string updateTitle: ""
         property string updateDetail: "";     property string updateKey: ""
@@ -53,6 +56,8 @@ QtObject {
         function setHeaterLevel(v) {}
         function setHeaterSetpointF(v) {}
         function clearHeaterFault() {}
+        function checkForUpdate() {}
+        function installUpdate(v) {}
     }
     // eventlog mock — mirrors EventLogModel (newest first; endMs 0 = active)
     property QtObject eventlog: QtObject {
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/preview/Shots.qml b/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/preview/Shots.qml
index ebcb288..4e0f5aa 100644
--- a/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/preview/Shots.qml
+++ b/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/preview/Shots.qml
@@ -31,6 +31,7 @@ Item {
     Component { id: cloudC;     CloudScreen {} }
     Component { id: lockC;      ScreenLockScreen {} }
     Component { id: maintC;     MaintenanceScreen {} }
+    Component { id: swupdC;     SoftwareUpdateScreen {} }
     Component { id: supportC;   SupportScreen {} }
     Component { id: wifiC;      WifiScreen {} }
     Component { id: wifiJoinC;  WifiJoinScreen { ssid: "Pilot-Travel-Center" } }
@@ -105,6 +106,11 @@ Item {
         ["12d-cloud-nowifi", function() { wifi.state = "idle"; wifi.ssid = ""; wifi.ip = ""; root.sub(cloudC) }],
         ["13-screenlock",    function() { wifi.state = "connected"; wifi.ssid = "EcoFleet-Staff"; wifi.ip = "192.168.0.206"; root.sub(lockC) }],
         ["14-maintenance",   function() { root.sub(maintC) }],
+        ["14b-swupdate-uptodate", function() { var p = root.sub(swupdC); p.checking = false }],
+        ["14c-swupdate-available", function() { telemetry.otaLatest = "1.2.74"; telemetry.otaAvailable = "1.2.74"
+                                                 root.poke(); var p = root.sub(swupdC); p.checking = false }],
+        ["14d-swupdate-failed", function() { telemetry.otaAvailable = ""; telemetry.otaCheckState = "failed: network"
+                                              root.poke(); var p = root.sub(swupdC); p.checking = false }],
         ["15-comptest-lock", function() { root.sub(comptestC) }],
         ["16-comptest",      function() { var p = root.sub(comptestC); p.tryUnlock(MaintController.defaultPin)
                                           telemetry.diagActive = true; root.poke() }],
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/screens/MaintenanceScreen.qml b/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/screens/MaintenanceScreen.qml
index 68d8757..b88fe6b 100644
--- a/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/screens/MaintenanceScreen.qml
+++ b/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/screens/MaintenanceScreen.qml
@@ -9,6 +9,7 @@ Item {
     Component { id: comptestC;  ComponentTestScreen {} }
     Component { id: diagC;      DiagnosticsScreen {} }
     Component { id: usermaintC; UserMaintScreen {} }
+    Component { id: swupdC;     SoftwareUpdateScreen {} }
     function open(c) { if (page.StackView.view) page.StackView.view.push(c) }
 
     ColumnLayout {
@@ -20,7 +21,8 @@ Item {
             model: [
                 { icon: "mode",   title: "Component Test",   desc: "Actuate relays one at a time — maintenance passcode required", c: comptestC, locked: true },
                 { icon: "diag",   title: "Live Diagnostics", desc: "Live sensor, engine and service readings", c: diagC, locked: false },
-                { icon: "wrench", title: "User Maintenance", desc: "Service hours and oil-timer reset", c: usermaintC, locked: false }
+                { icon: "wrench", title: "User Maintenance", desc: "Service hours and oil-timer reset", c: usermaintC, locked: false },
+                { icon: "cpu",    title: "Software Update",  desc: "Check for and install new unit software", c: swupdC, locked: false }
             ]
             Rectangle {
                 Layout.fillWidth: true; Layout.preferredHeight: 76
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/screens/SoftwareUpdateScreen.qml b/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/screens/SoftwareUpdateScreen.qml
new file mode 100644
index 0000000..292fa1b
--- /dev/null
+++ b/meta-ecofleet/recipes-ecofleet/gobi-ui/files/qml/screens/SoftwareUpdateScreen.qml
@@ -0,0 +1,104 @@
+import QtQuick
+import QtQuick.Controls
+import QtQuick.Layouts
+import ".."
+import "../atoms"
+// Technician screen (Maintenance hub, PIN-gated): check the public release
+// manifest and install a newer unit software build. The agent only installs
+// the exact version its last successful check offered; progress then shows on
+// the global UpdateOverlay (downloading → installing → restart).
+Item {
+    id: page
+
+    // UI-side "checking" between the tap and the agent's next snapshot.
+    property bool checking: false
+    property double checkStartTs: 0
+    function check() {
+        page.checking = true
+        page.checkStartTs = telemetry.otaCheckTs
+        telemetry.checkForUpdate()
+        checkTimeout.restart()
+    }
+    Timer { id: checkTimeout; interval: 15000; onTriggered: page.checking = false }
+    Connections {
+        target: telemetry
+        function onDataChanged() {
+            if (page.checking && telemetry.otaCheckTs !== page.checkStartTs) page.checking = false
+        }
+    }
+    Component.onCompleted: check()
+
+    readonly property bool busy: telemetry.updateKind === "busy"
+    readonly property bool available: telemetry.otaAvailable !== ""
+
+    function ago(ts) {
+        if (!ts) return ""
+        var m = Math.max(0, Math.round((Date.now() - ts) / 60000))
+        return m < 1 ? "just now" : (m === 1 ? "1 min ago" : (m < 60 ? m + " min ago" : Math.round(m / 60) + " h ago"))
+    }
+    function statusText() {
+        if (page.checking) return "Checking for updates…"
+        var s = telemetry.otaCheckState
+        if (s === "failed: network") return "Couldn't check — no internet connection"
+        if (s === "failed: bad manifest") return "Couldn't check — update service unavailable"
+        if (s === "failed: busy") return "An update is already in progress"
+        if (s === "failed: not offered") return "That version is no longer offered — check again"
+        if (page.available) return "Update available: " + telemetry.otaAvailable
+        if (s === "ok") return "Up to date (checked " + page.ago(telemetry.otaCheckTs) + ")"
+        return "Not checked yet"
+    }
+    function statusColor() {
+        if (page.checking) return Theme.info
+        if (telemetry.otaCheckState.indexOf("failed") === 0) return Theme.warn
+        if (page.available) return Theme.accent
+        return Theme.ok
+    }
+
+    ColumnLayout {
+        anchors.fill: parent; anchors.margins: 14; spacing: 12
+        ScreenHeader { title: "Software Update"; subtitle: "Unit software"
+            onBack: if (page.StackView.view) page.StackView.view.pop() }
+
+        Rectangle {
+            Layout.fillWidth: true; Layout.preferredHeight: 150
+            radius: Theme.radius; color: Theme.surface
+            ColumnLayout {
+                anchors.fill: parent; anchors.margins: Theme.pad; spacing: 8
+                RowLayout { spacing: 10
+                    Text { text: "INSTALLED"; color: Theme.textMute; font.pixelSize: Theme.fsCaption
+                        font.letterSpacing: Theme.lsCaps; font.weight: Font.DemiBold }
+                    Text { text: telemetry.otaRunning || "—"; color: Theme.text
+                        font.pixelSize: Theme.fsBody + 6; font.weight: Font.DemiBold }
+                }
+                Text { Layout.fillWidth: true; text: page.statusText(); color: page.statusColor()
+                    font.pixelSize: Theme.fsBody + 1; font.weight: Font.DemiBold; elide: Text.ElideRight }
+                Item { Layout.fillHeight: true }
+                RowLayout { spacing: 12
+                    Rectangle { Layout.preferredWidth: 190; Layout.preferredHeight: 44; radius: Theme.radiusSm
+                        color: cka.pressed ? Theme.surface2 : Theme.bg; border.color: Theme.border
+                        opacity: page.checking ? 0.5 : 1
+                        Text { anchors.centerIn: parent; text: "Check for updates"
+                            color: Theme.accent; font.pixelSize: Theme.fsLabel + 1; font.weight: Font.DemiBold }
+                        MouseArea { id: cka; anchors.fill: parent; enabled: !page.checking; onClicked: page.check() } }
+                    ConfirmButton {
+                        visible: page.available && !page.busy && !page.checking
+                        label: "Install " + telemetry.otaAvailable
+                        confirmLabel: "Tap again to install"
+                        Layout.preferredWidth: armed ? 190 : 170; Layout.preferredHeight: 44
+                        tone: Theme.accent
+                        onConfirmed: telemetry.installUpdate(telemetry.otaAvailable)
+                    }
+                }
+            }
+        }
+
+        Text {
+            Layout.fillWidth: true; wrapMode: Text.WordWrap
+            visible: page.available || page.busy
+            text: page.busy ? "An update is in progress — keep the unit powered."
+                            : "The unit restarts after installing (about 3 minutes). The APU and heater keep running."
+            color: Theme.textMute; font.pixelSize: Theme.fsLabel
+        }
+        Item { Layout.fillHeight: true }
+    }
+}
diff --git a/meta-ecofleet/recipes-ecofleet/gobi-ui/gobi-ui_1.0.bb b/meta-ecofleet/recipes-ecofleet/gobi-ui/gobi-ui_1.0.bb
index 8003d91..1c4fc54 100644
--- a/meta-ecofleet/recipes-ecofleet/gobi-ui/gobi-ui_1.0.bb
+++ b/meta-ecofleet/recipes-ecofleet/gobi-ui/gobi-ui_1.0.bb
@@ -61,6 +61,7 @@ SRC_URI = " \
     file://qml/screens/DiagnosticsScreen.qml \
     file://qml/screens/ComponentTestScreen.qml \
     file://qml/screens/UserMaintScreen.qml \
+    file://qml/screens/SoftwareUpdateScreen.qml \
     file://qml/screens/UnitInfoScreen.qml \
     file://qml/screens/AlertsScreen.qml \
     file://qml/screens/ErrorLogScreen.qml \
````

- [ ] **Step 2: Build natively**

```bash
F=meta-ecofleet/recipes-ecofleet/gobi-ui/files
cmake -S $F -B /tmp/gobiui-b -DCMAKE_PREFIX_PATH=/opt/homebrew/opt/qt >/dev/null && cmake --build /tmp/gobiui-b -j8 2>&1 | grep -E " error|warning:"; echo build-done
```
Expected: `build-done`, nothing else.

- [ ] **Step 3: Preview shots**

```bash
cmake -S $F/qml/preview/runner -B /tmp/shots-build -DCMAKE_PREFIX_PATH=/opt/homebrew/opt/qt >/dev/null && cmake --build /tmp/shots-build
rm -rf /tmp/shots && mkdir /tmp/shots
QT_QPA_PLATFORM=offscreen QT_QUICK_CONTROLS_STYLE=Basic QT_QUICK_BACKEND=software /tmp/shots-build/shots $PWD/$F/qml $PWD/$F/fonts /tmp/shots preview/Shots.qml
```
Expected (view the PNGs): `14-maintenance` has a 4th row "Software Update"; `14b-swupdate-uptodate` "Up to date (checked 2 min ago)"; `14c-swupdate-available` "Update available: 1.2.74" + accent **Install 1.2.74** button + restart note; `14d-swupdate-failed` amber "Couldn't check — no internet connection"; `21h2-wifi-saved-forget-armed` Forget still red.

- [ ] **Step 4: Commit**

```bash
git add meta-ecofleet/recipes-ecofleet/gobi-ui
git commit -m "feat(gobi-ui): Maintenance → Software Update screen (check + two-tap install)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017uxgfN1Y67gVKWmTWmpxxk"
```

---

### Task 4: CI — publish `releases/latest.json`

**Files:** Modify `.github/workflows/build.yml` ("Publish signed bundle to OTA bucket" step).

- [ ] **Step 1: Apply**

`.superpowers/patches/t4-ci.patch`:

````diff
diff --git a/.github/workflows/build.yml b/.github/workflows/build.yml
index e0f1d13..8addef7 100644
--- a/.github/workflows/build.yml
+++ b/.github/workflows/build.yml
@@ -190,6 +190,25 @@ jobs:
 
           echo "Published s3://ecofleet-ota/releases/${VERSION}/ecofleet-${VERSION}.swu"
 
+          # On-panel software update (Maintenance → Software Update) reads
+          # releases/latest.json. Only a clean N.N.N release becomes "latest" —
+          # suffixed bench tags (-rc/-diag/-validate) never do — and it is
+          # written AFTER the bundle so it can never point at a missing .swu.
+          if printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
+            mkdir -p /tmp/yocto-latest
+            printf '{"version":"%s","published":"%s"}\n' "$VERSION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
+              > /tmp/yocto-latest/latest.json
+            docker run --rm \
+              -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY \
+              -e AWS_DEFAULT_REGION=us-east-1 \
+              -v /tmp/yocto-latest:/lat \
+              amazon/aws-cli s3 cp /lat/latest.json s3://ecofleet-ota/releases/latest.json \
+              --content-type application/json --cache-control max-age=60
+            echo "Published s3://ecofleet-ota/releases/latest.json -> ${VERSION}"
+          else
+            echo "Prerelease tag ${VERSION}: releases/latest.json left unchanged"
+          fi
+
       - name: Upload release assets
         uses: softprops/action-gh-release@v2
         if: startsWith(github.ref, 'refs/tags/')
````

- [ ] **Step 2: Validate + dry run**

```bash
ruby -ryaml -e 'YAML.load_file(".github/workflows/build.yml"); puts "yaml ok"'
T=$(mktemp -d); awk '/# On-panel software update \(Maintenance/{f=1} f{print} f&&/^          fi$/{exit}' .github/workflows/build.yml \
  | sed 's/^          //' | sed "s#/tmp/yocto-latest#$T/out#g; s/docker run --rm/echo DOCKER-RUN/" > $T/snip.sh
for V in 1.2.74 1.2.74-rc1; do VERSION=$V bash $T/snip.sh | tail -1; done; cat $T/out/latest.json
```
Expected: `yaml ok`; `Published s3://ecofleet-ota/releases/latest.json -> 1.2.74`; `Prerelease tag 1.2.74-rc1: releases/latest.json left unchanged`; `{"version":"1.2.74","published":"…Z"}`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci: publish releases/latest.json on clean tag releases (panel update check)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017uxgfN1Y67gVKWmTWmpxxk"
```

---

## After merge (user-run)

- Cut the next release (e.g. v1.2.74). Its CI run creates `releases/latest.json`; check with `curl -s https://ecofleet-ota.s3.amazonaws.com/releases/latest.json`.
- Units must be on that release (or newer) to have the screen; the first panel-initiated update is therefore from 1.2.74 to the release after it. Optional: seed `latest.json` by hand with `{"version":"1.2.73"}` (`aws s3 cp … --content-type application/json`) to exercise "Up to date" on the bench sooner.
