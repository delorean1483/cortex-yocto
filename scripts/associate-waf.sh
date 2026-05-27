#!/usr/bin/env bash
# EcoFleet — associate-waf.sh
# Associates the WAF web ACL with the API Gateway HTTP API $default stage.
# Run once after `terraform apply` (Terraform's APIGW v2 WAF association is
# not yet stable; the manual wafv2 call is the reliable path).
#
# Usage: associate-waf.sh

set -euo pipefail

REGION="us-east-1"
PROJECT="ecofleet"
ENV="prod"
export AWS_PROFILE="${AWS_PROFILE:-ecofleet}"

WAF_NAME="${PROJECT}-${ENV}-api-waf"
API_NAME="${PROJECT}-${ENV}-api"

echo "==> Looking up WAF web ACL: ${WAF_NAME}"
WAF_ARN=$(aws wafv2 list-web-acls \
  --scope REGIONAL \
  --region "$REGION" \
  --output json \
  | jq -r --arg n "$WAF_NAME" '.WebACLs[] | select(.Name == $n) | .ARN')

if [[ -z "$WAF_ARN" ]]; then
  echo "ERROR: WAF web ACL '${WAF_NAME}' not found — has terraform apply been run?" >&2
  exit 1
fi
echo "    WAF ARN: ${WAF_ARN}"

echo "==> Looking up API Gateway: ${API_NAME}"
API_ID=$(aws apigatewayv2 get-apis \
  --region "$REGION" \
  --output json \
  | jq -r --arg n "$API_NAME" '.Items[] | select(.Name == $n) | .ApiId')

if [[ -z "$API_ID" ]]; then
  echo "ERROR: API '${API_NAME}' not found — has terraform apply been run?" >&2
  exit 1
fi
echo "    API ID: ${API_ID}"

# HTTP API stage ARN format understood by WAFv2 associate-web-acl
STAGE_ARN="arn:aws:apigateway:${REGION}::/apis/${API_ID}/stages/\$default"

echo "==> Associating WAF → API Gateway (\$default stage)"
aws wafv2 associate-web-acl \
  --web-acl-arn  "$WAF_ARN" \
  --resource-arn "$STAGE_ARN" \
  --region "$REGION"

echo "==> Verifying association"
aws wafv2 get-web-acl-for-resource \
  --resource-arn "$STAGE_ARN" \
  --region "$REGION" \
  | jq -r '"    Web ACL: " + .WebACL.Name + " (" + .WebACL.ARN + ")"'

echo "Done."
