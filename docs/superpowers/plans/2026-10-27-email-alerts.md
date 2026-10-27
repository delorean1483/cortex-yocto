# Email Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each dashboard login can turn email alerts on or off for itself; people with alerts on get low-battery emails (under 12 V, further-volt drops, daily reminders, recovery) and the existing APU fault emails.

**Architecture:** A pure battery rule (`ingest/battery-alert.js`) runs in the ingest Lambda after each InfluxDB write, with per-unit state in a new DynamoDB table guarded by a version number. Both ingest and the fault handler send through one shared mailer (`lambda/shared/alert-mail.js`, symlinked into each Lambda) that emails opted-in users via SES once `ALERT_FROM` is set, and otherwise publishes to the existing SNS topic exactly as today. The preference is `email_alerts` on the users-table item, read and written by `GET/PUT /fleet/me/alerts` and a switch in the side menu.

**Tech Stack:** Node 22 Lambdas (CommonJS, `node:assert` test files run with `node`), AWS SDK v3 (`client-sesv2`, `client-dynamodb`, `lib-dynamodb`, `client-sns`), Terraform (AWS provider), React 18 + @tanstack/react-query + vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-email-alerts-design.md`

**Precondition:** PR #113 (`feat/telemetry-history-ranges`) is merged. Rebase `feat/email-alerts` onto `origin/main` before Task 1 (`git fetch && git rebase origin/main`); it also edits `cloud/lambda/api/api.js`.

## Global Constraints

- Low battery threshold `12.0` V; a reading of exactly 12.00 V is not low. Further-drop step `1.0` V. Hold `10` minutes (every reading in the run must meet the condition). Daily reminder `24` h. Replay cutoff: skip a message whose `ts` is more than `5` minutes older than arrival.
- Durations use the Lambda clock (`Date.now()` at arrival), never message `ts`.
- Email times in `America/Chicago`, formatted like `Oct 25, 2026, 1:42 AM CDT`. Voltages with 2 decimals.
- Sender `EcoFleet Alerts <alerts@goecofleet.com>` (`ALERT_FROM`); empty `ALERT_FROM` = SNS fallback, unchanged from today.
- The switch defaults to off; it is the caller's own preference only; every role may use it.
- An alerting failure never fails ingest or the fault handler's InfluxDB write path.
- CloudWatch system-health alarms stay on SNS, untouched.
- Terraform: review a full `plan` before apply; never `-target`; zero destroys expected.
- Never write fake readings into `TRUCK-001`.
- Lambda tests are files run with `node <file>.test.js` (no framework); frontend tests are vitest (`npx vitest run` in `cloud/frontend`).

## Review Focus

1. Telemetry with `batt_v` missing, `null` or non-numeric (an agent that couldn't read the APU) must leave battery state untouched, not count as 0 V. Test in Task 1.
2. Two overlapping ingest invocations for one unit must send one email, not two. Test in Task 3.
3. DynamoDB, SES or SNS failing must not make ingest throw (a throw makes IoT retry and DLQ the reading). Test in Task 3.
4. One recipient address SES rejects must not stop the others. Test in Task 2.
5. The switch when saving fails (expired login, network) must show it didn't save and keep showing the real stored state. Test in Task 6.

---

### Task 1: Battery rule and email text

**Files:**
- Create: `cloud/lambda/ingest/battery-alert.js`
- Test: `cloud/lambda/ingest/battery-alert.test.js`

**Interfaces:**
- Produces:
  - `INITIAL_STATE = { alerting: false, lastV: null, lastSentMs: null, runKind: null, runSinceMs: null }`
  - `stepBattery(state | null, { v, tsMs }, nowMs) -> { state, changed: boolean, email: null | { kind: 'low'|'lower'|'daily'|'recovered', v: number } }`
  - `batteryEmail(kind, unit, v, nowMs, dashboardUrl) -> { subject: string, text: string }`
  - constants `LOW_V, STEP_V, HOLD_MS, DAILY_MS, REPLAY_MS`

- [ ] **Step 1: Write the failing tests** (same `check(name, fn)` harness as `cloud/lambda/api/telemetry-view.test.js`). Helper: `feed(readings)` runs `stepBattery` over `[{ at, v, tsMs? }]` (ms; `tsMs` defaults to `at`) and returns `{ state, emails: [{ kind, v, at }] }`.

  - `no email for an engine crank`: 12.6 V every 20 s for 5 min, 10.4 V for 30 s, 12.6 V for 20 min → `emails` empty.
  - `first alert after 10 minutes under 12 V`: 11.8 V every 20 s from t=0 → one `{ kind: 'low', v: 11.8 }` at the first reading with `at - 0 >= HOLD_MS`; none before.
  - `12.00 V is not low`: 12.0 V for an hour → no email, `state.runKind === null`.
  - `hovering around 12 V never holds`: alternating 11.98 / 12.01 every 60 s for 2 h → no email.
  - `a lone 0.00 reading while alerting at 5.3 V`: alerting with `lastV: 5.3`, readings 5.3 then one 0.0 then 5.3 for 20 min → no email.
  - `further-volt drop needs its own 10 minutes`: alerting `lastV: 11.5`, readings 10.5 for 9 min → none; continue to 10 min → `{ kind: 'lower', v: 10.5 }`; then `state.lastV === 10.5`.
  - `daily reminder 24 h after the last email`: alerting `lastV: 11.5, lastSentMs: 0`, 11.5 V every 10 min → `daily` at the first reading with `at >= DAILY_MS`, the next at `>= 2 * DAILY_MS` after that email.
  - `recovery after 10 minutes at or above 12 V, then re-arms`: alerting, 12.4 V for 10 min → `{ kind: 'recovered', v: 12.4 }`, state equals `INITIAL_STATE`; then 11.7 V for 10 min → `low` again.
  - `replayed rows are ignored`: reading with `tsMs = at - 6 * 60_000` → `changed === false`, `email === null`; `tsMs = at - 4 * 60_000` counts.
  - `a unit clock running ahead still counts`: `tsMs = at + 3_600_000` counts.
  - `missing or non-numeric batt_v changes nothing` (Review Focus 1): `v` of `undefined`, `null`, `NaN`, `'abc'` → `changed === false`, `email === null`.
  - `unchanged state reports changed=false`: not alerting, 12.6 V → `changed === false` (so ingest skips the write).
  - `the Oct 17-27 bench sequence`: readings every 60 s from `T0 = Date.UTC(2026, 9, 17, 11)` following plateaus `[T0: 11.67], [Oct 18 11:00: 11.5], [Oct 25 07:00: 9.31], [Oct 26 11:00: 7.25], [Oct 26 23:00: 5.3], [Oct 27 05:20: 3.35]` until `Oct 27 06:27`, plus a single 0.0 at `Oct 27 05:25`. Assert kinds `['low', 'daily' ×7, 'lower', 'daily', 'lower', 'lower', 'lower']` and the `lower` levels `[9.31, 7.25, 5.3, 3.35]`. (If the rule as specified yields a different list, the spec says the rule wins: fix the expectation, not the rule.)
  - `batteryEmail` subjects: `low` → `[EcoFleet] Low battery — TRUCK-001: 11.42 V`; `lower` → `[EcoFleet] Battery still falling — TRUCK-001: 9.31 V`; `daily` → `[EcoFleet] Battery still low — TRUCK-001: 11.40 V`; `recovered` → `[EcoFleet] Battery recovered — TRUCK-001: 12.48 V`.
  - `batteryEmail` text contains `Unit     : TRUCK-001`, `Battery  : 11.42 V`, `Time     : Oct 25, 2026, 1:42 AM CDT` for `nowMs = Date.UTC(2026, 9, 25, 6, 42)`, and `https://dash.example/units/TRUCK-001` for `dashboardUrl = 'https://dash.example'`.

- [ ] **Step 2: Run to verify they fail**

Run: `node cloud/lambda/ingest/battery-alert.test.js`
Expected: FAIL, `Cannot find module './battery-alert'`

- [ ] **Step 3: Implement `battery-alert.js`**

Order of evaluation in `stepBattery` (the tests don't fix it, and it matters):

```
if typeof v !== 'number' or !Number.isFinite(v), or tsMs < nowMs - REPLAY_MS:
    return { state, changed: false, email: null }      // never coerce: Number(null) is 0
s = state ?? INITIAL_STATE
if s.alerting and v < LOW_V and nowMs - s.lastSentMs >= DAILY_MS:
    -> email daily at v; lastV = v, lastSentMs = nowMs; keep the current run; return
kind = !s.alerting ? (v < LOW_V ? 'low' : null)
     : v <= s.lastV - STEP_V ? 'lower'
     : v >= LOW_V ? 'high' : null
if kind !== s.runKind: runKind = kind, runSinceMs = kind ? nowMs : null
else if kind and nowMs - s.runSinceMs >= HOLD_MS:
    low    -> email low; alerting = true; lastV = v; lastSentMs = nowMs; clear run
    lower  -> email lower; lastV = v; lastSentMs = nowMs; clear run
    high   -> email recovered; state = INITIAL_STATE
changed = any field differs from the input state
```

`batteryEmail` body lines (plain text), in order: `Unit     : <unit>`, `Battery  : <v.toFixed(2)> V`, `Time     : <America/Chicago time>`, blank, `<dashboardUrl>/units/<encodeURIComponent(unit)>`. Use `toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })`.

- [ ] **Step 4: Run to verify they pass**

Run: `node cloud/lambda/ingest/battery-alert.test.js`
Expected: every `[PASS]`, last line `battery-alert.test.js: all checks passed`

- [ ] **Step 5: Commit**

```bash
git add cloud/lambda/ingest/battery-alert.js cloud/lambda/ingest/battery-alert.test.js
git commit -m "feat(alerts): low-battery rule with 10-minute hold, further-volt and daily reminders"
```

### Task 2: Shared alert mailer

**Files:**
- Create: `cloud/lambda/shared/alert-mail.js`
- Test: `cloud/lambda/shared/alert-mail.test.js`
- Create symlinks: `cloud/lambda/ingest/alert-mail.js -> ../shared/alert-mail.js`, `cloud/lambda/fault/alert-mail.js -> ../shared/alert-mail.js`

**Interfaces:**
- Produces:
  - `recipientsFrom(items) -> string[]`: emails of items with `email_alerts === true` and a non-empty `email`, de-duplicated, sorted.
  - `withFooter(text, dashboardUrl) -> string`
  - `sendAlert({ subject, text }, io, cfg) -> Promise<{ via: 'ses'|'sns', sent: number, failed: string[] }>` where `io = { scanUsers: () => Promise<object[]>, sendEmail: ({ from, to, subject, text }) => Promise<void>, publish: ({ subject, text }) => Promise<void> }` and `cfg = { alertFrom: string, dashboardUrl: string }`.
- The module has **no `require`s**: it is symlinked into two Lambdas and all AWS calls come in through `io`.

- [ ] **Step 1: Write the failing tests** (fakes are plain objects recording calls)
  - `recipientsFrom keeps only opted-in people`: `[{ email: 'a@x', email_alerts: true }, { email: 'b@x', email_alerts: false }, { email: 'c@x' }, { email: '', email_alerts: true }, { email: 'a@x', email_alerts: true }]` → `['a@x']`.
  - `empty alertFrom publishes once to SNS with the text unchanged`: `sendAlert({ subject: 'S', text: 'T' }, io, { alertFrom: '', dashboardUrl: 'https://d' })` → `publish` called once with `{ subject: 'S', text: 'T' }`, `scanUsers` and `sendEmail` not called, result `{ via: 'sns', sent: 1, failed: [] }`.
  - `with alertFrom, one email per opted-in person, with the footer`: two opted-in users → two `sendEmail` calls, each `from === cfg.alertFrom`, `text === withFooter('T', 'https://d')`, no `publish`.
  - `one rejected address doesn't stop the others` (Review Focus 4): `sendEmail` rejects for `bad@x` → the other address still sent; result `{ via: 'ses', sent: 1, failed: ['bad@x'] }`.
  - `nobody opted in sends nothing`: result `{ via: 'ses', sent: 0, failed: [] }`.
  - `withFooter` returns `T` + `\n\n—\nYou get this because you turned on email alerts in EcoFleet.\nTurn them off: https://d`.

- [ ] **Step 2: Run to verify they fail**

Run: `node cloud/lambda/shared/alert-mail.test.js`
Expected: FAIL, `Cannot find module './alert-mail'`

- [ ] **Step 3: Implement `alert-mail.js`, then create both symlinks** (`ln -s ../shared/alert-mail.js cloud/lambda/ingest/alert-mail.js`, same for `fault`). Use `Promise.allSettled` for the sends; `console.error` each failure with the address.

- [ ] **Step 4: Run to verify they pass, and that the symlinks resolve and survive packaging**

Run: `node cloud/lambda/shared/alert-mail.test.js && node -e "require('./cloud/lambda/ingest/alert-mail.js'); require('./cloud/lambda/fault/alert-mail.js'); console.log('ok')" && (cd cloud/lambda/ingest && zip -qr /tmp/alert-mail-check.zip alert-mail.js && unzip -p /tmp/alert-mail-check.zip alert-mail.js | head -3)`
Expected: `all checks passed`, `ok`, then the first lines of the real file (zip follows symlinks; `scripts/deploy-lambda.sh` zips without `-y`).

- [ ] **Step 5: Commit**

```bash
git add cloud/lambda/shared cloud/lambda/ingest/alert-mail.js cloud/lambda/fault/alert-mail.js
git commit -m "feat(alerts): shared mailer: SES per opted-in person, SNS fallback"
```

### Task 3: Battery check in the ingest Lambda

**Files:**
- Create: `cloud/lambda/ingest/battery-check.js`
- Test: `cloud/lambda/ingest/battery-check.test.js`
- Modify: `cloud/lambda/ingest/index.js` (after `writeApi.close()` succeeds), `cloud/lambda/ingest/package.json` + `package-lock.json` (add `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-sesv2`, `@aws-sdk/client-sns`, all `^3.540.0`)

**Interfaces:**
- Consumes: `stepBattery`, `batteryEmail` (Task 1); `sendAlert` (Task 2).
- Produces: `checkBattery(msg, nowMs, io, dashboardUrl) -> Promise<{ email: string | null, error?: string }>` where `io = { loadState(unit) -> Promise<{ state, ver } | null>, saveState(unit, state, prevVer | null) -> Promise<boolean>, sendAlert({ subject, text }) -> Promise<void> }`. Never throws.

- [ ] **Step 1: Write the failing tests** (in-memory `io` whose `saveState` implements the version check)
  - `sends the rule's email after the state write wins`: state already holding a 10-minute `low` run → `sendAlert` called once with `batteryEmail('low', …)`, stored `ver` incremented.
  - `no write when the rule reports no change`: 12.6 V, no stored state → `saveState` not called.
  - `a lost write sends nothing` (Review Focus 2): `saveState` returns `false` → `sendAlert` not called, result `{ email: null }`.
  - `two overlapping calls send one email` (Review Focus 2): both `loadState` before either `saveState` on the same `ver` → exactly one `sendAlert`.
  - `failures are swallowed` (Review Focus 3): `loadState`, `saveState`, then `sendAlert` each rejecting in turn → `checkBattery` resolves with an `error` string; nothing thrown.

- [ ] **Step 2: Run to verify they fail**

Run: `node cloud/lambda/ingest/battery-check.test.js`
Expected: FAIL, `Cannot find module './battery-check'`

- [ ] **Step 3: Implement `battery-check.js`, then wire `index.js`**

`index.js` builds `io` from env `BATTERY_ALERTS_TABLE`, `USERS_TABLE`, `ALERT_FROM`, `SNS_TOPIC_ARN`, `DASHBOARD_URL`:
- `loadState`: `GetCommand` by `unit`; map the flat item (`alerting, lastV, lastSentMs, runKind, runSinceMs, ver`) to `{ state, ver }`.
- `saveState`: `PutCommand` with the flat item and `ver: (prevVer ?? 0) + 1`, `ConditionExpression` `attribute_not_exists(#u)` when `prevVer` is null, else `#v = :prev`. `ConditionalCheckFailedException` → `false`.
- `sendAlert`: Task 2's `sendAlert` with `scanUsers` = paged `ScanCommand` on `USERS_TABLE` (follow `LastEvaluatedKey`), `sendEmail` = sesv2 `SendEmailCommand` (`Content.Simple`, text body), `publish` = SNS `PublishCommand` (`Subject`, `Message`).
- Call `await checkBattery({ unit, batt_v, ts }, Date.now(), io, DASHBOARD_URL)` after the existing success log line; log a non-null `error`.

- [ ] **Step 4: Run to verify they pass, plus the existing ingest test**

Run: `node cloud/lambda/ingest/battery-check.test.js && node cloud/lambda/ingest/battery-alert.test.js && node cloud/lambda/ingest/telemetry-map.test.js && (cd cloud/lambda/ingest && node -e "require('./index.js'); console.log('loads')")`
Expected: all pass; `loads`.

- [ ] **Step 5: Commit**

```bash
git add cloud/lambda/ingest
git commit -m "feat(alerts): ingest checks battery state per unit and emails opted-in people"
```

### Task 4: Fault emails through the shared mailer

**Files:**
- Modify: `cloud/lambda/fault/faults.js:91-123` (the SNS block), `cloud/lambda/fault/package.json` + lock (add `@aws-sdk/client-sesv2`, `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`)
- Test: `cloud/lambda/fault/faults.test.js`

**Interfaces:**
- Consumes: `sendAlert` (Task 2).
- Produces: `faultEmail(unit, fault, state, tsMs) -> { subject, text }` exported next to `describeFault`.

- [ ] **Step 1: Write the failing tests** pinning today's copy:
  - `faultEmail('TRUCK-001', '0x0004', 'running', Date.UTC(2026, 9, 25, 6, 42))` → subject `[EcoFleet] Fault — TRUCK-001: Low battery voltage`, text lines `Unit     : TRUCK-001`, `Fault    : 0x0004  (Low battery voltage)`, `APU state: running`, `Time     : 2026-10-25T06:42:00.000Z`.
  - `faultEmail(…, '0x0000', …)` → subject `[EcoFleet] Recovered — TRUCK-001: APU fault cleared`, text line `Status   : fault cleared (0x0000)`.

- [ ] **Step 2: Run to verify they fail**

Run: `node cloud/lambda/fault/faults.test.js`
Expected: FAIL, `faultEmail is not a function`

- [ ] **Step 3: Move the subject/message building into `faultEmail` unchanged; replace `sns.send(...)` with `sendAlert(faultEmail(...), io, { alertFrom: process.env.ALERT_FROM || '', dashboardUrl: process.env.DASHBOARD_URL })`**, `io` built as in Task 3 (scan, SES, SNS). Keep the existing catch: a mail failure is logged, never thrown.

- [ ] **Step 4: Run to verify they pass**

Run: `node cloud/lambda/fault/faults.test.js && (cd cloud/lambda/fault && node -e "require('./faults.js'); console.log('loads')")`
Expected: pass; `loads`.

- [ ] **Step 5: Commit**

```bash
git add cloud/lambda/fault
git commit -m "feat(alerts): fault emails go to opted-in people (SNS until ALERT_FROM is set)"
```

### Task 5: `/fleet/me/alerts` API

**Files:**
- Create: `cloud/lambda/api/me-alerts.js`
- Test: `cloud/lambda/api/me-alerts.test.js`
- Modify: `cloud/lambda/api/api.js` (handlers + routes before the `/fleet/units/` block)

**Interfaces:**
- Produces:
  - `parseAlertsBody(rawBody) -> { email_alerts: boolean } | { error: string }`
  - HTTP: `GET /fleet/me/alerts` → `200 { email, email_alerts }` (`false` when the item or attribute is missing). `PUT /fleet/me/alerts` body `{ email_alerts: boolean }` → `200 { email, email_alerts }`; bad body → `400`. Both use `claims.email` only; any role.

- [ ] **Step 1: Write the failing tests**
  - `parseAlertsBody('{"email_alerts":true}')` → `{ email_alerts: true }`; same for `false`.
  - `'{"email_alerts":"true"}'`, `'{}'`, `'not json'`, `undefined` → each `{ error }` (string).
  - `'{"email_alerts":true,"email":"other@x"}'` → `{ email_alerts: true }` (any other key is ignored; the handler never reads an email from the body).

- [ ] **Step 2: Run to verify they fail**

Run: `node cloud/lambda/api/me-alerts.test.js`
Expected: FAIL, `Cannot find module './me-alerts'`

- [ ] **Step 3: Implement `me-alerts.js`; add `handleGetMyAlerts(claims)` (`GetCommand` on `USERS_TABLE`) and `handlePutMyAlerts(event, claims)` (`UpdateCommand`, `SET email_alerts = :on`, Key `{ email: claims.email }`, no other attributes so a missing item is created without a role) to `api.js`; route `if (path.endsWith('/fleet/me/alerts'))` for GET/PUT.**

- [ ] **Step 4: Run to verify they pass, plus the API suite**

Run: `cd cloud/lambda/api && for t in *.test.js; do node $t >/dev/null && echo "pass $t" || echo "FAIL $t"; done && node -e "require('./api.js'); console.log('loads')"`
Expected: every file `pass`; `loads`.

- [ ] **Step 5: Commit**

```bash
git add cloud/lambda/api/me-alerts.js cloud/lambda/api/me-alerts.test.js cloud/lambda/api/api.js
git commit -m "feat(alerts): GET/PUT /fleet/me/alerts for the caller's own preference"
```

### Task 6: The switch in the side menu

**Files:**
- Create: `cloud/frontend/src/components/AlertsSwitch.jsx`, `cloud/frontend/src/components/AlertsSwitch.test.jsx`
- Modify: `cloud/frontend/src/api/client.js` (`realApi`), `cloud/frontend/src/api/mock.js`, `cloud/frontend/src/data/hooks.js`, `cloud/frontend/src/components/Layout.jsx` (account area, ~line 76), `cloud/frontend/src/components/Layout.test.jsx` (stub the switch)

**Interfaces:**
- Consumes: Task 5's HTTP routes.
- Produces: `realApi.getMyAlerts()`, `realApi.setMyAlerts(on: boolean)` (PUT JSON `{ email_alerts }`), the same two on the mock API (in-memory, starts `false`); hooks `useMyAlerts()` (query key `['me', 'alerts']`) and `useSetMyAlerts()` (mutation invalidating that key); `<AlertsSwitch compact={boolean} email={string} />`.

- [ ] **Step 1: Write the failing tests** (`AlertsSwitch.test.jsx`, mocking `../data/hooks.js` like `OverviewTab.test.jsx`)
  - full width: `getByRole('switch', { name: 'Email alerts' })` reflects `email_alerts` (`aria-checked`); text `Sent to tech@ecofleet.io`.
  - clicking it calls the mutation with `true` when off, `false` when on.
  - while the mutation is pending the switch is disabled.
  - save failure (Review Focus 5): mutation `isError` → text `Couldn't save. Try again.` and `aria-checked` still shows the query's value.
  - compact: `getByRole('button', { name: 'Email alerts: off' })` with `aria-pressed="false"`; on → name `Email alerts: on`.
  - while the preference is loading the control is disabled.

- [ ] **Step 2: Run to verify they fail**

Run: `cd cloud/frontend && npx vitest run src/components/AlertsSwitch.test.jsx`
Expected: FAIL, cannot resolve `./AlertsSwitch.jsx`

- [ ] **Step 3: Implement** the API methods, hooks, and `AlertsSwitch` (full: a `role="switch"` button labelled `Email alerts` with the `Sent to <email>` line under it; compact: a bell button, `IconBell` / `IconBellOff` from `@tabler/icons-react`). Render it in `SidebarContent`'s bottom section: full width as its own row above the avatar/email/sign-out row; compact between the avatar and the sign-out button. In `Layout.test.jsx` add `vi.mock('./AlertsSwitch.jsx', () => ({ default: () => null }))` (Layout tests render without a QueryClient).

- [ ] **Step 4: Run the whole frontend suite and the build**

Run: `cd cloud/frontend && npx vitest run && npx vite build`
Expected: all test files pass (React Router future-flag warnings are pre-existing); build succeeds.

- [ ] **Step 5: Commit**

```bash
git add cloud/frontend/src
git commit -m "feat(alerts): email alerts switch in the side menu"
```

### Task 7: Infrastructure (Terraform)

**Files:**
- Create: `cloud/terraform/ses.tf`
- Modify: `cloud/terraform/variables.tf`, `cloud/terraform/dynamodb.tf`, `cloud/terraform/lambda.tf`, `cloud/terraform/api.tf`, `cloud/terraform/outputs.tf`

**Interfaces:**
- Produces: variables `alert_from` (string, default `""`), `dashboard_url` (default `"https://frontend-murex-xi-74.vercel.app"`), `alert_domain` (default `"goecofleet.com"`); table `${var.project}-${var.env}-battery-alerts` (hash key `unit`, `PAY_PER_REQUEST`); `aws_sesv2_email_identity.alerts` for `var.alert_domain`; output `ses_dkim_records` (one `"<token>._domainkey.<domain> CNAME <token>.dkim.amazonses.com"` string per DKIM token); env on ingest `BATTERY_ALERTS_TABLE, USERS_TABLE, ALERT_FROM, SNS_TOPIC_ARN, DASHBOARD_URL` and on fault-handler `USERS_TABLE, ALERT_FROM, DASHBOARD_URL` (it already has `SNS_TOPIC_ARN`).

- [ ] **Step 1: Write the changes**
  - `ses.tf`: the identity (Easy DKIM default).
  - `dynamodb.tf`: the table; a statement in `aws_iam_role_policy.lambda_dynamodb` allowing `dynamodb:GetItem`, `dynamodb:PutItem` on it (the users-table statement already allows `Scan`, `GetItem`, `UpdateItem`).
  - `lambda.tf`: statement `SESSend` allowing `ses:SendEmail` on `aws_sesv2_email_identity.alerts.arn` in `aws_iam_role_policy.lambda`; the env vars above.
  - `api.tf`: add `"PUT"` to `cors_configuration.allow_methods`; routes `GET /fleet/me/alerts` and `PUT /fleet/me/alerts` targeting `integrations/${aws_apigatewayv2_integration.api.id}`.
  - `outputs.tf`: `ses_dkim_records`.

- [ ] **Step 2: Check formatting and validity (no AWS calls)**

Run: `cd cloud/terraform && terraform fmt -check && terraform validate`
Expected: no `fmt` output; `Success! The configuration is valid.` (If `.terraform/` is missing, `terraform init -backend=false` first.)

- [ ] **Step 3: Commit**

```bash
git add cloud/terraform/*.tf
git commit -m "infra(alerts): battery-alerts table, SES identity, /fleet/me/alerts routes, env"
```

### Task 8: Ship (user-run steps marked)

- [ ] **Step 1: Push, open the PR, whole-branch review.** PR body ends with the go-live steps below.
- [ ] **Step 2 (user): `terraform plan`** from `cloud/terraform` with the `ecofleet` profile. Expected: adds (table, identity, 2 routes, IAM statements), in-place updates (2 Lambda envs, API CORS, IAM policies), **0 to destroy**. Anything else: stop and investigate before apply.
- [ ] **Step 3 (user): `terraform apply`**, then `terraform output ses_dkim_records` for the DNS step later.
- [ ] **Step 4 (user): deploy code**: `scripts/deploy-lambda.sh all`; then check each `CodeSha256` changed (see `feedback-lambda-deploy`). Frontend: from the deploy worktree, check out the merged `main`, run vitest, `vercel --prod --yes` in `cloud/frontend`.
- [ ] **Step 5: End-to-end on the SNS fallback** (`alert_from` still empty), with the user's OK for the prod writes: invoke `ecofleet-prod-ingest` asynchronously once a minute for 11 minutes with `{ "unit": "ALERT-TEST", "ts": <now ms>, "batt_v": 11.5 }` → one `[EcoFleet] Low battery — ALERT-TEST: 11.50 V` email at the address on the SNS topic. Then remove `ALERT-TEST`: its `battery-alerts` item, and its InfluxDB points (`influx delete --bucket telemetry --predicate 'unit="ALERT-TEST"' --start 1970-01-01T00:00:00Z --stop <now>` on the InfluxDB host via SSM).
- [ ] **Step 6: Signed-in check**: the switch toggles and survives a reload; `GET /fleet/me/alerts` returns the new value.

**Go-live (later, user):** add the `ses_dkim_records` CNAMEs to goecofleet.com; wait for the identity to show verified; request SES production access in the AWS console; people turn their switch on (including the current SNS recipient); set `alert_from = "EcoFleet Alerts <alerts@goecofleet.com>"` in `terraform.tfvars`, plan (expect only the two env changes), apply.
