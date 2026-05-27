#!/usr/bin/env bash
# EcoFleet — deploy-lambda.sh
# Builds and deploys all three Lambda functions from source.
#
# Sequence per function:
#   npm ci --omit=dev   →  zip source + node_modules  →  aws lambda update-function-code
#
# Usage:
#   deploy-lambda.sh              # deploy all three functions
#   deploy-lambda.sh ingest       # deploy only the ingest function
#   deploy-lambda.sh api          # deploy only the api function
#   deploy-lambda.sh fault        # deploy only the fault-handler function

set -euo pipefail

REGION="us-east-1"
PROJECT="ecofleet"
ENV="prod"
export AWS_PROFILE="${AWS_PROFILE:-ecofleet}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAMBDA_ROOT="${SCRIPT_DIR}/../cloud/lambda"
BUILD_DIR="${SCRIPT_DIR}/../cloud/terraform/dist"

TARGET="${1:-all}"

declare -A FUNCTION_MAP=(
  [ingest]="${PROJECT}-${ENV}-ingest"
  [api]="${PROJECT}-${ENV}-api"
  [fault]="${PROJECT}-${ENV}-fault-handler"
)

declare -A SOURCE_MAP=(
  [ingest]="${LAMBDA_ROOT}/ingest"
  [api]="${LAMBDA_ROOT}/api"
  [fault]="${LAMBDA_ROOT}/fault"
)

deploy_function() {
  local key="$1"
  local fn_name="${FUNCTION_MAP[$key]}"
  local src_dir="${SOURCE_MAP[$key]}"
  local zip_path="${BUILD_DIR}/${key}.zip"

  echo ""
  echo "── ${fn_name} ────────────────────────────────────────────────────────"

  if [[ ! -d "$src_dir" ]]; then
    echo "  SKIP: source directory not found: ${src_dir}"
    return
  fi

  # Install production deps
  if [[ -f "${src_dir}/package.json" ]]; then
    echo "  npm ci --omit=dev"
    (cd "$src_dir" && npm ci --omit=dev --silent)
  fi

  # Zip source
  mkdir -p "$BUILD_DIR"
  rm -f "$zip_path"
  echo "  zipping → ${zip_path}"
  (cd "$src_dir" && zip -qr "$zip_path" . --exclude "*.test.js" --exclude ".env*")

  # Deploy
  echo "  aws lambda update-function-code"
  aws lambda update-function-code \
    --function-name "$fn_name" \
    --zip-file "fileb://${zip_path}" \
    --region "$REGION" \
    --output json \
    | jq -r '"  deployed: " + .FunctionName + "  v" + (.Version // "latest") + "  (" + .CodeSize + " bytes)"' 2>/dev/null \
    || aws lambda update-function-code \
         --function-name "$fn_name" \
         --zip-file "fileb://${zip_path}" \
         --region "$REGION" \
         --output text --query 'FunctionName' \
         | xargs -I{} echo "  deployed: {}"
}

case "$TARGET" in
  all)
    for key in ingest api fault; do
      deploy_function "$key"
    done
    ;;
  ingest|api|fault)
    deploy_function "$TARGET"
    ;;
  *)
    echo "Usage: deploy-lambda.sh [all|ingest|api|fault]" >&2
    exit 1
    ;;
esac

echo ""
echo "==> Lambda deploy complete."
