# Email alerts: per-person opt-in, low battery + APU faults

Date: 2026-10-27. Status: draft for review.

## Why

On 2026-10-27 TRUCK-001's gobi board lost power at 01:27 CDT. The battery it
reports had sat at 11.4-11.7 V since at least Oct 17, then fell in four ~2 V
steps (Sun Oct 25 ~01:00-03:00, Mon Oct 26 ~05:00-07:00, Mon ~17:00-19:00,
Tue Oct 27 ~00:10-00:30; 11.4 -> 9.3 -> 7.3 -> 5.3 -> 3.3 V). Nobody heard about
any of it: the dashboard shows "Low battery" below 12 V only to someone looking
at the page, and the only alert email today (APU faults, via SNS) goes to one
fixed address set in Terraform (`var.alert_email`).

## What the user decided

- **Each person chooses for themselves** whether to get alert emails, in the
  dashboard. Admins don't manage it for others.
- **One switch covers both** the new low-battery alert and the existing APU
  fault emails.
- **Low battery = under 12 V.**
- **Reminders:** after the first email, email again when the battery falls a
  further volt below the last level emailed about, and once a day while it
  stays under 12 V.
- **Sender:** an address on goecofleet.com (the user will add the DNS records
  later; until then see "Before goecofleet.com is ready").

## Goals

1. A person signed into the dashboard can turn "Email alerts" on or off for
   their own login, and see its current state.
2. Everyone with alerts on gets an email when any unit's battery stays under
   12 V, again on each further 1 V drop or after 24 h still under, and an
   all-clear when it recovers.
3. Everyone with alerts on gets the APU fault and fault-cleared emails that
   today go only to `var.alert_email`.
4. Nothing about this is lost before the DNS records exist: emails keep going
   out the current way until the new sender works.

## Non-goals

- An alert when a unit stops reporting altogether (what happened at 01:27).
  Separate feature, later.
- Choosing which trucks a person hears about. Everyone with alerts on hears
  about every real unit. Nothing in the site ties a person to trucks today.
- SMS, push, or per-alert-type switches. Per-unit thresholds. Changing the
  12 V threshold from the site.
- The CloudWatch system-health alarms (Lambda errors, IoT DLQ). They stay on
  the SNS topic to `var.alert_email`, unchanged.

## Anti-goals (failure even if it "works")

- Emails during an engine crank or from a single glitch reading. The bench
  data has a lone 0.00 V reading at 05:30 UTC Oct 27; cranking pulls a truck
  battery well under 12 V for seconds.
- An email on every telemetry message (a unit reports about every 21 s).
- Fault emails silently stopping for the current recipient during the switch
  to per-person delivery.

## Behaviour

### The switch (decided by Claude, not by the user)

- Lives in the account area at the bottom of the side menu, next to the
  signed-in email, so every role reaches it (the Alerts page is not in the
  Maintenance role's menu). In the narrow icon-only menu it is a bell icon
  button whose look shows on/off, with an accessible label saying which.
- Defaults to **off** for every existing and new login, including the address
  that receives fault emails today: that person turns it on like anyone else.
- Shows a short line saying where emails go (the login email).

### Low-battery rule (thresholds decided by the user; timing by Claude)

Evaluated per unit on each telemetry message's `batt_v`. Durations use the
Lambda's own clock (arrival time), never the message `ts`: unit clocks can be
wrong after a cold boot (RTC loses time).

A condition counts only once **every reading for 10 minutes** has met it.
That one rule covers cranking dips, glitch readings, and the first alert alike.

**Only live readings count** (Claude's call). While MQTT is down the agent
stores up to ~12 h of rows in SQLite and re-sends them after reconnecting
(`db_flush()` in `gobi-agent/files/main.c`, 50 per cycle, interleaved with live
rows, each a separate async Lambda call). Counting those would squeeze hours
into minutes, email about stale levels, and let old above-12 V rows break a real
under-12 V run. So the rule skips any message whose `ts` is more than 5 minutes
older than its arrival time; durations still use arrival time. A truck that
comes back with a low battery is caught by its live readings 10 minutes later.

| Situation | Email |
|---|---|
| Not alerting; readings have been under 12 V for 10 min | **Low battery** at the current reading |
| Alerting; readings have been at or below (last emailed level - 1.0 V) for 10 min | **Battery still falling** at the current reading |
| Alerting; 24 h since the last email for this unit, still under 12 V | **Daily reminder** at the current reading |
| Alerting; readings have been at or above 12 V for 10 min | **Battery recovered**; back to not alerting |

"Last emailed level" is the reading in the most recent Low / Still falling /
Daily email for that unit. A reading of exactly 12.00 V counts as not low.
Against the Oct 17-27 bench data this sends: Low (whenever it first went under
12 V), daily reminders, then Still falling at ~9.3, ~7.3, ~5.3 and ~3.3 V.

### APU fault emails

Same content and triggers as today (`cloud/lambda/fault/faults.js`: an email
per fault event, "Recovered" on a 0x0000 clear), sent to the people with the
switch on instead of to the SNS topic.

### Email content (Claude's call)

- From `EcoFleet Alerts <alerts@goecofleet.com>`.
- Subject like today's: `[EcoFleet] Low battery — TRUCK-001: 11.42 V`,
  `[EcoFleet] Battery still falling — TRUCK-001: 9.31 V`,
  `[EcoFleet] Battery recovered — TRUCK-001: 12.48 V`.
- Body: unit, reading, time in US Central with the zone shown (every unit is
  in America/Chicago today), and a link to the unit page
  (`<dashboard>/units/<unit>`). Plain text is enough.
- Footer: why they got it and a link to the dashboard to turn alerts off.

## How it is built (Claude's calls unless marked)

- **Preference:** a boolean `email_alerts` on the person's item in the existing
  `ecofleet-prod-users` DynamoDB table (key `email`). A login can exist in
  Cognito without an item there (role then defaults to `eu`), so setting the
  preference must create the item without inventing a role.
- **API:** `GET /fleet/me/alerts` and `PUT /fleet/me/alerts` `{ email_alerts }`
  in `cloud/lambda/api/api.js`, acting only on the caller's own email from the
  JWT claims; any role. New API Gateway routes in `cloud/terraform/api.tf`,
  and PUT added to its CORS allowed methods.
- **Branch order:** PR #113 (`feat/telemetry-history-ranges`, telemetry trend
  charts) also changes `cloud/lambda/api/api.js` and was not merged or deployed
  as of 2026-10-27. Merge #113 first and rebase this work onto main, so that
  deploying either Lambda from its branch never drops the other's changes.
- **Low-battery state:** a new DynamoDB table `ecofleet-prod-battery-alerts`,
  key `unit`, holding whatever the rule needs (e.g. alerting yes/no, the start
  of the current "condition has held since" run, last emailed level and time).
  The rule itself is a pure function (state + reading + now -> new state +
  email to send or none) with node tests, like `telemetry-view.js` or
  `reports-view.js`. Overlapping Lambda calls for one unit must not send the
  same email twice: update the state with a conditional write and send only
  if the write wins.
- **Where it runs:** the ingest Lambda (`cloud/lambda/ingest/index.js`) after
  the InfluxDB write succeeds. An alerting failure (DynamoDB, email) is logged
  and must not fail ingest or trigger the IoT retry/DLQ path.
- **Sending:** Amazon SES (v2 `SendEmail`), one message per recipient,
  recipients = users-table items with `email_alerts = true`. The ingest,
  fault and API Lambdas share `aws_iam_role.lambda`; it needs `ses:SendEmail`
  on the goecofleet.com identity and DynamoDB access to the new table. The
  Lambdas sit in private subnets with a NAT gateway, so SES is reachable.
- **Infrastructure:** Terraform: SES domain identity for goecofleet.com with
  Easy DKIM (outputs the CNAME records the user adds), the new table, IAM, API
  routes, Lambda env vars. Review a full `terraform plan` before apply; never
  `-target` (a targeted apply once replaced the InfluxDB instance).

### Before goecofleet.com is ready

SES can't send from goecofleet.com until (1) the user adds the DKIM DNS records
and the identity verifies, and (2) the account leaves the SES sandbox (today:
`ProductionAccessEnabled=false`, no identities). Until a Lambda env var such as
`ALERT_FROM` is set, both low-battery and fault emails go to the existing SNS
topic exactly as fault emails do today, so the current recipient keeps
getting them. Setting `ALERT_FROM` switches both to per-person SES delivery.
`ALERT_FROM` is a Terraform variable (empty by default) feeding the Lambda env,
not a hand-set value: Terraform owns those env vars and would undo a manual
change.
The switch in the site saves in both modes but has no effect on delivery until
`ALERT_FROM` is set; it doesn't say so (only internal logins exist today).

Go-live steps, in order: apply Terraform; user adds the DNS records; user
requests SES production access (AWS console; it describes the use case to AWS
and needs the user's sign-off); users turn their switch on; set `alert_from`
in `terraform.tfvars` and apply.

## Testing

- Node tests for the battery rule covering: crank dip (seconds under 12 V, no
  email), a lone 0.00 reading, hovering around 12.0, the first alert after
  10 min, each further-volt drop, the 24 h reminder, recovery and re-arming,
  replayed rows (old `ts`) ignored, and the Oct 17-27 bench sequence producing
  the emails listed above. If the raw data gives a slightly different list
  than this doc predicts, the rule as written wins; update the expected list.
- API handler tests for the two `/fleet/me/alerts` routes (own email only).
- Vitest for the switch (on/off, saving, error state) in both menu widths.
- End to end before `ALERT_FROM` is set: the SNS fallback delivers a
  low-battery email. Don't write fake low readings into TRUCK-001's history;
  use a throwaway unit id or invoke the rule directly.

## Left to the builder

Table attribute names, module layout, exact email wording within the above,
the switch's styling, and how the API caches the recipient list.
