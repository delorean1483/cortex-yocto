#!/usr/bin/env bash
# EcoFleet — shadow-tools.sh
# CLI wrappers for common Device Shadow operations.
# Source this file or copy individual functions into your shell profile.
#
# Usage:
#   source scripts/shadow-tools.sh
#   shadow_status TRUCK-001
#   shadow_set_config TRUCK-001 '{"poll_interval_s": 10}'
#   shadow_set_config TRUCK-001 '{"report_mode": "eco"}'
#   shadow_reboot TRUCK-001
#   shadow_watch TRUCK-001
#   shadow_clear_desired TRUCK-001

set -euo pipefail

export AWS_PROFILE="${AWS_PROFILE:-ecofleet}"
REGION="us-east-1"
API_ENDPOINT="https://tphro82ot9.execute-api.us-east-1.amazonaws.com"

# ── Helper: get API token ─────────────────────────────────────────────────────
_get_token() {
  local email="${ECOFLEET_EMAIL:-}"
  local pass="${ECOFLEET_PASSWORD:-}"

  if [[ -z "$email" ]]; then
    read -r -p "Email: " email
  fi
  if [[ -z "$pass" ]]; then
    read -s -r -p "Password: " pass
    echo ""
  fi

  curl -sf -X POST "${API_ENDPOINT}/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${email}\",\"password\":\"${pass}\"}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])"
}

# ── shadow_status: print human-readable shadow state ─────────────────────────
shadow_status() {
  local unit="${1:?Usage: shadow_status TRUCK-001}"
  local thing="gobi-apu-${unit}"

  echo "Shadow for ${unit}:"
  aws iot-data get-thing-shadow \
    --thing-name "$thing" \
    --region "$REGION" \
    /dev/stdout 2>/dev/null \
    | python3 -c "
import sys, json
raw = json.load(sys.stdin)
state = raw.get('state', {})
rep   = state.get('reported', {})
des   = state.get('desired',  {})
dlt   = state.get('delta',    {})

import time
ts = rep.get('last_seen_ts')
if ts:
    stale = round((time.time() * 1000 - ts) / 1000)
    online = '✓ online' if stale < 30 else f'✗ offline ({stale}s ago)'
else:
    online = '✗ never seen'

print(f'  status:       {online}')
print(f'  apu_state:    {rep.get(\"apu_state\",\"?\")}'  )
print(f'  dc_v:         {rep.get(\"dc_v\",\"?\")}'       )
print(f'  batt_soc:     {rep.get(\"batt_soc\",\"?\")}%'  )
print(f'  fault:        {rep.get(\"fault\",\"?\")}'       )
print(f'  fw_version:   {rep.get(\"firmware_version\",\"?\")}'  )
print(f'  poll_interval:{rep.get(\"poll_interval_s\",\"?\")}s'  )
print(f'  report_mode:  {rep.get(\"report_mode\",\"?\")}'        )
print()
if des:
    print(f'  desired:      {json.dumps(des)}')
if dlt:
    print(f'  pending delta:{json.dumps(dlt)}  ← not yet applied by device')
print(f'  shadow v{raw.get(\"version\",\"?\")}'           )
" || echo "  No shadow found — device has not connected yet."
}

# ── shadow_set_config: push desired config via API ────────────────────────────
shadow_set_config() {
  local unit="${1:?Usage: shadow_set_config TRUCK-001 '{\"poll_interval_s\":10}'}"
  local config_json="${2:?Provide config JSON}"
  local token

  token=$(_get_token)

  curl -sf -X POST "${API_ENDPOINT}/fleet/config" \
    -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" \
    -d "{\"unit\":\"${unit}\",\"config\":${config_json}}" \
    | python3 -m json.tool
}

# ── shadow_reboot: send a reboot command to a device ─────────────────────────
shadow_reboot() {
  local unit="${1:?Usage: shadow_reboot TRUCK-001}"
  echo "Sending reboot command to ${unit}..."
  read -r -p "Confirm reboot for ${unit}? [y/N] " confirm
  if [[ "${confirm,,}" != "y" ]]; then
    echo "Aborted."
    return 1
  fi
  shadow_set_config "$unit" '{"reboot": true}'
}

# ── shadow_watch: poll shadow every 5s and show diff ─────────────────────────
shadow_watch() {
  local unit="${1:?Usage: shadow_watch TRUCK-001}"
  echo "Watching shadow for ${unit} (Ctrl-C to stop)..."
  while true; do
    clear
    echo "$(date '+%Y-%m-%d %H:%M:%S') — Shadow: ${unit}"
    echo "────────────────────────────────────"
    shadow_status "$unit"
    sleep 5
  done
}

# ── shadow_clear_desired: wipe desired state (use with care) ─────────────────
# Useful when a bad config is stuck in desired. Sets each known key to null
# which IoT Core interprets as "clear this key from desired".
shadow_clear_desired() {
  local unit="${1:?Usage: shadow_clear_desired TRUCK-001}"
  local thing="gobi-apu-${unit}"

  echo "Clearing desired state for ${unit}..."
  read -r -p "Confirm? This will clear all pending desired config. [y/N] " confirm
  if [[ "${confirm,,}" != "y" ]]; then echo "Aborted."; return 1; fi

  # Setting desired keys to null removes them from the shadow
  aws iot-data update-thing-shadow \
    --thing-name "$thing" \
    --region "$REGION" \
    --payload '{"state":{"desired":{"poll_interval_s":null,"report_mode":null,"firmware_target":null,"reboot":null}}}' \
    /dev/stdout | python3 -m json.tool

  echo "Desired state cleared. Device will no longer receive these deltas."
}

# ── shadow_bulk_status: quick table of all provisioned units ─────────────────
shadow_bulk_status() {
  local fleet_id="${1:-FLEET-001}"
  echo "Bulk shadow status for fleet ${fleet_id}:"
  printf "%-15s %-12s %-8s %-8s %-10s %-8s\n" "UNIT" "STATUS" "APU" "SOC%" "FAULT" "FW"
  echo "────────────────────────────────────────────────────────────────────"

  aws iot list-things \
    --attribute-name fleet_id \
    --attribute-value "$fleet_id" \
    --region "$REGION" \
    --query 'things[*].thingName' \
    --output text \
  | tr '\t' '\n' \
  | sed 's/gobi-apu-//' \
  | while read -r unit; do
      thing="gobi-apu-${unit}"
      ROW=$(aws iot-data get-thing-shadow \
        --thing-name "$thing" \
        --region "$REGION" \
        /dev/stdout 2>/dev/null \
        | python3 -c "
import sys,json,time
d = json.load(sys.stdin)
r = d.get('state',{}).get('reported',{})
ts = r.get('last_seen_ts')
stale = round((time.time()*1000 - ts)/1000) if ts else 9999
status = 'online' if stale < 30 else f'off({stale}s)'
print(r.get('apu_state','?'), r.get('batt_soc','?'), r.get('fault','?'), r.get('firmware_version','?'), status)
" 2>/dev/null || echo "? ? ? ? no-shadow")
      read -r apu soc fault fw status <<< "$ROW"
      printf "%-15s %-12s %-8s %-8s %-10s %-8s\n" "$unit" "$status" "$apu" "$soc" "$fault" "$fw"
    done
}
