#!/usr/bin/env bash
# EcoFleet — provision-device.sh
# Creates an AWS IoT Thing + X.509 certificate for one fleet unit, then writes
# the credentials into the gobi-agent Yocto recipe so the next `kas build`
# bakes them into the image.
#
# WARNING: device.crt and device.key are written into the source tree for the
# build but are gitignored.  Never commit those files.  Each provisioned unit
# gets a unique cert — re-run this script before building for a new unit.
#
# Usage: provision-device.sh <UNIT-ID>
# Example: provision-device.sh TRUCK-001

set -euo pipefail

UNIT="${1:?Usage: provision-device.sh <UNIT-ID>  e.g. TRUCK-001}"
THING_NAME="gobi-apu-${UNIT}"
POLICY_NAME="ecofleet-prod-apu-policy"
THING_TYPE="ecofleet-prod-apu"
REGION="us-east-1"
CERTS_DIR="meta-ecofleet/recipes-ecofleet/gobi-agent/files"

export AWS_PROFILE="${AWS_PROFILE:-ecofleet}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}/.."

echo "==> Provisioning ${UNIT}  (thing: ${THING_NAME})"

# 1. Create IoT Thing (idempotent — safe to re-run if thing already exists)
THING_ARN=$(aws iot create-thing \
  --thing-name "$THING_NAME" \
  --thing-type-name "$THING_TYPE" \
  --attribute-payload "attributes={unit_serial=${UNIT}}" \
  --region "$REGION" \
  --output json \
  | jq -r '.thingArn')
echo "    Thing ARN : ${THING_ARN}"

# 2. Create certificate + key pair (one-shot — private key is only available now)
echo "==> Creating certificate"
CERT_JSON=$(aws iot create-keys-and-certificate \
  --set-as-active \
  --region "$REGION" \
  --output json)

CERT_ARN=$(echo "$CERT_JSON" | jq -r '.certificateArn')
CERT_ID=$(echo "$CERT_JSON" | jq -r '.certificateId')
echo "    Cert ID   : ${CERT_ID}"

# 3. Write cert + private key into the recipe files directory
echo "$CERT_JSON" | jq -r '.certificatePem'        > "${CERTS_DIR}/device.crt"
echo "$CERT_JSON" | jq -r '.keyPair.PrivateKey'    > "${CERTS_DIR}/device.key"
chmod 600 "${CERTS_DIR}/device.key"
echo "    device.crt: ${CERTS_DIR}/device.crt"
echo "    device.key: ${CERTS_DIR}/device.key  (chmod 600)"

# 4. Write unit serial (read by gobi-agent at runtime to build MQTT client-id)
echo "$UNIT" > "${CERTS_DIR}/unit-serial"
echo "    unit-serial: ${UNIT}"

# 5. Attach policy to certificate
aws iot attach-policy \
  --policy-name "$POLICY_NAME" \
  --target "$CERT_ARN" \
  --region "$REGION"
echo "    Policy '${POLICY_NAME}' attached"

# 6. Attach certificate to thing
aws iot attach-thing-principal \
  --thing-name "$THING_NAME" \
  --principal "$CERT_ARN" \
  --region "$REGION"
echo "    Certificate attached to thing"

echo ""
echo "==> ${UNIT} provisioned successfully."
echo "    Next: kas build   (certs are now baked into the recipe)"
echo ""
echo "    REMINDER: device.crt and device.key are gitignored."
echo "    Keep them out of version control — they are per-unit secrets."
