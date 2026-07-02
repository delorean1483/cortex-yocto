#!/usr/bin/env bash
# EcoFleet — apu-command-e2e.sh
# Cloud command round-trip test (test-plan matrix row 11).
#
# Exercises the full path:
#   set shadow desired apu_command  ->  IoT update/delta  ->  gobi-agent writes
#   Modbus coil 0  ->  APU changes state  ->  agent reports apu_state back to the
#   shadow. Verifies BOTH directions (start->running, stop->off) end to end by
#   polling the device shadow's reported.apu_state, and checks the one-shot
#   command is cleared from desired afterwards.
#
# This drives the DEVICE side, which must be running:
#   - AWS creds (AWS_PROFILE=ecofleet) with iot-data access
#   - a gobi-agent for thing gobi-apu-<UNIT> connected to AWS IoT, its Modbus
#     pointed at a real APU or the simulator. Bench setup with the simulator:
#         socat -d -d pty,raw,echo=0 pty,raw,echo=0     # note the two pty paths
#         python3 sim/apu_sim.py --rtu /dev/pts/5 --spin-time 8
#         # point gobi-agent MODBUS_DEVICE at /dev/pts/6
#
# WARNING: against a real unit this physically starts and stops the APU. Only
# run it on a bench rig or a unit you are cleared to actuate.
#
# Usage: apu-command-e2e.sh <UNIT-ID>          e.g. apu-command-e2e.sh TRUCK-001

set -euo pipefail

UNIT="${1:?Usage: apu-command-e2e.sh <UNIT-ID>  e.g. TRUCK-001}"
REGION="${AWS_REGION:-us-east-1}"
THING="gobi-apu-${UNIT}"
POLL_RETRIES="${POLL_RETRIES:-30}"      # POLL_RETRIES * POLL_INTERVAL = max wait/phase
POLL_INTERVAL="${POLL_INTERVAL:-2}"

export AWS_PROFILE="${AWS_PROFILE:-ecofleet}"

PASS=0
FAIL=0
report() {
  local st="$1" msg="$2"
  echo "  [${st}] ${msg}"
  if [[ "$st" == "PASS" ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
}

# Read one field from state.reported (empty string if absent).
get_reported() {
  local field="$1"
  aws iot-data get-thing-shadow --thing-name "$THING" --region "$REGION" \
      /dev/stdout 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('state',{}).get('reported',{}).get('${field}',''))" \
      2>/dev/null || true
}

# Read one field from state.desired (empty string if absent).
get_desired() {
  local field="$1"
  aws iot-data get-thing-shadow --thing-name "$THING" --region "$REGION" \
      /dev/stdout 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('state',{}).get('desired',{}).get('${field}',''))" \
      2>/dev/null || true
}

send_command() {
  local cmd="$1"
  aws iot-data update-thing-shadow --thing-name "$THING" --region "$REGION" \
    --cli-binary-format raw-in-base64-out \
    --payload "{\"state\":{\"desired\":{\"apu_command\":\"${cmd}\"}}}" \
    /dev/stdout >/dev/null
}

# Poll reported.apu_state until it equals $1; echoes last-seen state on timeout.
wait_for_state() {
  local want="$1" i state=""
  for i in $(seq 1 "$POLL_RETRIES"); do
    state="$(get_reported apu_state)"
    if [[ "$state" == "$want" ]]; then return 0; fi
    sleep "$POLL_INTERVAL"
  done
  echo "$state"
  return 1
}

echo "═══════════════════════════════════════════════════════════════"
echo " EcoFleet APU Command Round-Trip — ${UNIT}"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ── Preflight: shadow reachable ──────────────────────────────────────────────
echo "── Preflight"
if aws iot-data get-thing-shadow --thing-name "$THING" --region "$REGION" \
     /dev/stdout &>/dev/null; then
  report PASS "shadow for ${THING} reachable"
else
  report FAIL "no shadow for ${THING} — is the device/agent online?"
  echo ""
  echo "Cannot run the round-trip without a device shadow."
  echo "  PASS: ${PASS}   FAIL: ${FAIL}"
  exit 1
fi

# ── Phase 1: start → running ─────────────────────────────────────────────────
echo ""
echo "── Phase 1: apu_command=start → running"
send_command start
report PASS "desired apu_command=start sent"
if last="$(wait_for_state running)"; then
  report PASS "reported apu_state reached 'running'"
else
  report FAIL "apu_state did not reach 'running' within $((POLL_RETRIES * POLL_INTERVAL))s (last='${last:-none}')"
fi

# ── Phase 2: stop → off ──────────────────────────────────────────────────────
echo ""
echo "── Phase 2: apu_command=stop → off"
send_command stop
report PASS "desired apu_command=stop sent"
if last="$(wait_for_state off)"; then
  report PASS "reported apu_state returned to 'off'"
else
  report FAIL "apu_state did not return to 'off' within $((POLL_RETRIES * POLL_INTERVAL))s (last='${last:-none}')"
fi

# ── Phase 3: one-shot ack (desired cleared by the agent) ─────────────────────
echo ""
echo "── Phase 3: one-shot ack"
sleep "$POLL_INTERVAL"
DES="$(get_desired apu_command)"
if [[ -z "$DES" ]]; then
  report PASS "desired apu_command cleared after apply (one-shot honored)"
else
  report FAIL "desired apu_command still set to '${DES}' — agent did not ack"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
TOTAL=$((PASS + FAIL))
echo " Results: ${PASS}/${TOTAL} passed"
if [[ "$FAIL" -eq 0 ]]; then
  echo " STATUS: ALL PASS — cloud command round-trip works for ${UNIT}"
else
  echo " STATUS: FAIL (${FAIL} check(s) failed — see above)"
fi
echo "═══════════════════════════════════════════════════════════════"

[[ "$FAIL" -eq 0 ]]
