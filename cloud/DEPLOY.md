# EcoFleet Dashboard — Deploy

Two deployables: the **backend Lambdas** (AWS) and the **web app** (Vercel).
Both need your credentials, so these are run by you, not CI.

Prereqs: `aws` CLI (profile `ecofleet`), `terraform`, `jq`, `zip`, Node ≥ 18,
and the `vercel` CLI (`npm i -g vercel`).

---

## 1. Backend — Lambdas + config

The three functions (`ingest`, `api`, `fault`) share the code in
`cloud/lambda/`. Terraform owns their infrastructure + env vars; the deploy
script pushes updated code.

**a. Apply the env-var change** (adds `DEMO_UNITS=on` to the api Lambda):

```bash
cd cloud/terraform
terraform plan      # review: only the api Lambda env should change
terraform apply
```

**b. Push the reconciled code:**

```bash
AWS_PROFILE=ecofleet ./scripts/deploy-lambda.sh        # all three
# or one at a time: ./scripts/deploy-lambda.sh ingest|api|fault
```

The script installs prod deps, zips (excluding `*.test.js`), and calls
`update-function-code` **once** with `wait function-updated` on both sides —
so the old spurious `ResourceConflictException` no longer occurs. It prints the
new `CodeSha256` per function; that's your confirmation.

**c. Verify** against the live device once it has published:

```bash
curl -s https://tphro82ot9.execute-api.us-east-1.amazonaws.com/fleet/units/APU-<serial>/latest \
  -H "Authorization: Bearer <token>" | jq .latest.heater_state
```

You should get the full contract (heater/sensor/climate fields), not the old
`dc_v`/`oil_psi` subset.

---

## 2. Frontend — Vercel

The app is linked to Vercel project `frontend`
(`prj_ikOUiWJImDPeb61ts075JGqeq07l`).

**a. Turn OFF the local dev mock** so production hits the real API. The mock is
enabled only by `VITE_MOCK=on` in the git-ignored `cloud/frontend/.env.local`;
that file never ships, so a clean Vercel build already uses the real API. Just
confirm the API base is set (defaults to the prod URL in `src/api/client.js`;
override with `VITE_API_URL` if needed):

```bash
cd cloud/frontend
# optional: vercel env add VITE_API_URL production   # if the API URL differs
```

**b. Deploy:**

```bash
vercel --prod
```

First production build compiles the full bundle (the `@tabler/icons-react`
barrel makes it a minute or two — normal). Open the deployment URL and sign in
with a Cognito user.

---

## 3. Post-deploy checks

- Dashboard lists the real unit + three `(demo)` peers (if `DEMO_UNITS=on`).
- A unit's **Heater** / **Overview** tabs show live contract fields.
- **Remote control**: as admin/fleet-manager, heater on/off + APU start/stop +
  OTA prompt a confirm and write the device shadow; as end-user they're
  disabled. Demo units reject writes.
- **Reports** shows fleet totals (runtime, est. fuel saved, MTBF, faults).

---

## Notes / current limits

- **Setpoints & component-test actuation are read-only** — the on-device agent's
  shadow (`apply_desired`) only applies `heater{on,level}`, `apu_command`,
  `firmware_target`, `reboot`, `poll_interval_s`, `report_mode`. Wiring the
  others needs an agent change (out of scope for the dashboard).
- **Reports `operators` is empty from real data** — device telemetry carries no
  operator identity. Totals are real; operator activity would need a separate
  source.
- **Fuel-saved is a documented estimate** (`APU_SAVINGS_USD_PER_HR` in
  `cloud/lambda/api/reports-view.js`), not a metered value.
