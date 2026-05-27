#!/usr/bin/env bash
# EcoFleet — e2e-smoke-test.sh
# End-to-end smoke test: device → MQTT → Lambda → InfluxDB → API
#
# What it checks:
#   1. IoT Thing exists and has a certificate attached
#   2. Publish a synthetic telemetry message via IoT Data-ATS
#   3. Wait for the ingest Lambda to process it (poll API)
#   4. Verify GET /fleet/units returns the unit
#   5. Verify GET /fleet/units/{unit}/telemetry returns data
#   6. Verify GET /fleet/shadow?unit=UNIT shows shadow exists
#
# Usage: e2e-smoke-test.sh <UNIT-ID> [api-endpoint]
# Example: e2e-smoke-test.sh TRUCK-001

set -euo pipefail

UNIT="${1:?Usage: e2e-smoke-test.sh <UNIT-ID>  e.g. TRUCK-001}"
API_ENDPOINT="${2:-https://tphro82ot9.execute-api.us-east-1.amazonaws.com}"
REGION="us-east-1"
THING_NAME="gobi-apu-${UNIT}"
TOPIC="ecofleet/${UNIT}/telemetry"
POLL_RETRIES=12
POLL_INTERVAL=5

export AWS_PROFILE="${AWS_PROFILE:-ecofleet}"

PASS=0
FAIL=0
report() {
  local st="$1" msg="$2"
  echo "  [${st}] ${msg}"
  if [[ "$st" == "PASS" ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
}

echo "═══════════════════════════════════════════════════════════════"
echo " EcoFleet E2E Smoke Test — ${UNIT}"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ── 1. IoT Thing exists ───────────────────────────────────────────────────────
echo "── Step 1: IoT Thing"
if aws iot describe-thing --thing-name "$THING_NAME" --region "$REGION" &>/dev/null; then
  report PASS "Thing '${THING_NAME}' exists in IoT Core"
else
  report FAIL "Thing '${THING_NAME}' NOT found — run provision-device.sh first"
fi

CERTS=$(aws iot list-thing-principals --thing-name "$THING_NAME" --region "$REGION" \
  --output json | jq -r '.principals | length')
if [[ "$CERTS" -gt 0 ]]; then
  report PASS "${CERTS} certificate(s) attached to thing"
else
  report FAIL "No certificates attached — run provision-device.sh"
fi

# ── 2. Publish synthetic telemetry ───────────────────────────────────────────
echo ""
echo "── Step 2: Publish synthetic telemetry via IoT Data-ATS"
NOW_MS=$(python3 -c "import time; print(int(time.time()*1000))")
PAYLOAD=$(cat <<JSON
{
  "unit":         "${UNIT}",
  "ts":           ${NOW_MS},
  "dc_v":         24.1,
  "batt_soc":     82,
  "apu_state":    "running",
  "fault":        null,
  "firmware_version": "smoke-test",
  "poll_interval_s": 5,
  "report_mode":  "normal",
  "last_seen_ts": ${NOW_MS}
}
JSON
)

if aws iot-data publish \
    --topic "$TOPIC" \
    --payload "$PAYLOAD" \
    --cli-binary-format raw-in-base64-out \
    --region "$REGION" &>/dev/null; then
  report PASS "Published to ${TOPIC}"
else
  report FAIL "Failed to publish to ${TOPIC} — check AWS_PROFILE and IoT permissions"
fi

# ── 3. Authenticate against API ───────────────────────────────────────────────
echo ""
echo "── Step 3: API authentication"
if [[ -z "${ECOFLEET_EMAIL:-}" || -z "${ECOFLEET_PASSWORD:-}" ]]; then
  echo "  (set ECOFLEET_EMAIL and ECOFLEET_PASSWORD to skip interactive auth prompt)"
  read -r -p "  Email: " ECOFLEET_EMAIL
  read -s -r -p "  Password: " ECOFLEET_PASSWORD; echo ""
fi

TOKEN=$(curl -sf -X POST "${API_ENDPOINT}/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${ECOFLEET_EMAIL}\",\"password\":\"${ECOFLEET_PASSWORD}\"}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])" 2>/dev/null || true)

if [[ -n "$TOKEN" ]]; then
  report PASS "API login succeeded, JWT received"
else
  report FAIL "API login failed — check credentials or API endpoint"
  echo ""
  echo "Cannot proceed with API checks without a token. Partial results:"
  echo "  PASS: ${PASS}   FAIL: ${FAIL}"
  exit 1
fi

AUTH_HEADER="Authorization: Bearer ${TOKEN}"

# ── 4. GET /fleet/units ───────────────────────────────────────────────────────
echo ""
echo "── Step 4: GET /fleet/units"
UNITS_RESP=$(curl -sf -H "$AUTH_HEADER" "${API_ENDPOINT}/fleet/units" 2>/dev/null || true)
if echo "$UNITS_RESP" | jq -e . &>/dev/null; then
  report PASS "/fleet/units returned valid JSON"
  if echo "$UNITS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); units=d.get('units',d) if isinstance(d,dict) else d; exit(0 if '${UNIT}' in units else 1)" &>/dev/null; then
    report PASS "${UNIT} appears in fleet units list"
  else
    report FAIL "${UNIT} NOT found in /fleet/units response (may need a moment to index)"
  fi
else
  report FAIL "/fleet/units did not return valid JSON"
fi

# ── 5. GET /fleet/units/{unit}/telemetry (with retry) ────────────────────────
echo ""
echo "── Step 5: GET /fleet/units/${UNIT}/telemetry  (polling up to $((POLL_RETRIES * POLL_INTERVAL))s)"
TELEM_OK=false
for i in $(seq 1 "$POLL_RETRIES"); do
  TELEM_RESP=$(curl -sf -H "$AUTH_HEADER" "${API_ENDPOINT}/fleet/units/${UNIT}/telemetry" 2>/dev/null || true)
  if echo "$TELEM_RESP" | jq -e 'if type=="array" then length > 0 elif type=="object" then . != {} else false end' &>/dev/null; then
    TELEM_OK=true
    break
  fi
  echo "  attempt ${i}/${POLL_RETRIES} — waiting ${POLL_INTERVAL}s"
  sleep "$POLL_INTERVAL"
done

if $TELEM_OK; then
  report PASS "Telemetry data returned from API (Lambda→InfluxDB pipeline working)"
else
  report FAIL "No telemetry data after $((POLL_RETRIES * POLL_INTERVAL))s — check ingest Lambda logs in CloudWatch"
fi

# ── 6. GET /fleet/shadow ─────────────────────────────────────────────────────
echo ""
echo "── Step 6: GET /fleet/shadow?unit=${UNIT}"
SHADOW_RESP=$(curl -sf -H "$AUTH_HEADER" "${API_ENDPOINT}/fleet/shadow?unit=${UNIT}" 2>/dev/null || true)
if echo "$SHADOW_RESP" | jq -e '.shadow_exists == true' &>/dev/null; then
  ONLINE=$(echo "$SHADOW_RESP" | jq -r '.reported.online // false')
  report PASS "Shadow exists  (online: ${ONLINE})"
elif echo "$SHADOW_RESP" | jq -e '.shadow_exists == false' &>/dev/null; then
  report FAIL "Shadow not yet created — device has not connected since provisioning"
else
  report FAIL "/fleet/shadow endpoint error or not deployed — check api Lambda"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
TOTAL=$((PASS + FAIL))
echo " Results: ${PASS}/${TOTAL} passed"
if [[ "$FAIL" -eq 0 ]]; then
  echo " STATUS: ALL PASS — stack is healthy for ${UNIT}"
else
  echo " STATUS: FAIL (${FAIL} check(s) failed — see above)"
fi
echo "═══════════════════════════════════════════════════════════════"

[[ "$FAIL" -eq 0 ]]
