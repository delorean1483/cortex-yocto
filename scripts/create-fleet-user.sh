#!/usr/bin/env bash
# EcoFleet — create-fleet-user.sh
# Creates a Cognito user in the EcoFleet user pool.
# AWS sends a temporary password to the email; user must change it on first login.
#
# Usage: create-fleet-user.sh <email> [fleet_id]
# Example: create-fleet-user.sh skang@protekweb.com

set -euo pipefail

REGION="us-east-1"
PROJECT="ecofleet"
ENV="prod"
export AWS_PROFILE="${AWS_PROFILE:-ecofleet}"

EMAIL="${1:?Usage: create-fleet-user.sh <email> [fleet_id]}"
FLEET_ID="${2:-}"
POOL_NAME="${PROJECT}-${ENV}-user-pool"

echo "==> Looking up Cognito user pool: ${POOL_NAME}"
POOL_ID=$(aws cognito-idp list-user-pools \
  --max-results 60 \
  --region "$REGION" \
  --output json \
  | jq -r --arg n "$POOL_NAME" '.UserPools[] | select(.Name == $n) | .Id')

if [[ -z "$POOL_ID" ]]; then
  echo "ERROR: User pool '${POOL_NAME}' not found — has terraform apply been run?" >&2
  exit 1
fi
echo "    Pool ID: ${POOL_ID}"

# Build user-attributes array
ATTRS=(
  "Name=email,Value=${EMAIL}"
  "Name=email_verified,Value=true"
)
if [[ -n "$FLEET_ID" ]]; then
  ATTRS+=("Name=custom:fleet_id,Value=${FLEET_ID}")
fi

echo "==> Creating user: ${EMAIL}"
aws cognito-idp admin-create-user \
  --user-pool-id "$POOL_ID" \
  --username "$EMAIL" \
  --user-attributes "${ATTRS[@]}" \
  --desired-delivery-mediums EMAIL \
  --region "$REGION" \
  --output json \
  | jq -r '"    Status: " + .User.UserStatus'

echo ""
echo "==> Done. Temporary password sent to ${EMAIL}."
[[ -n "$FLEET_ID" ]] && echo "    Fleet ID: ${FLEET_ID}"
echo "    User must change password on first login (Cognito FORCE_CHANGE_PASSWORD)."
