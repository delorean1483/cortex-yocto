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

deploy_function() {
  local key="$1"
  local fn_name src_dir

  case "$key" in
    ingest) fn_name="${PROJECT}-${ENV}-ingest";       src_dir="${LAMBDA_ROOT}/ingest" ;;
    api)    fn_name="${PROJECT}-${ENV}-api";           src_dir="${LAMBDA_ROOT}/api"    ;;
    fault)  fn_name="${PROJECT}-${ENV}-fault-handler"; src_dir="${LAMBDA_ROOT}/fault"  ;;
    *) echo "Unknown function key: $key" >&2; return 1 ;;
  esac

  local zip_path="${BUILD_DIR}/${key}.zip"

  echo ""
  echo "── ${fn_name} ────────────────────────────────────────────────────────"

  if [[ ! -d "$src_dir" ]]; then
    echo "  SKIP: source directory not found: ${src_dir}"
    return
  fi

  # Install production deps (npm ci if lock file exists, else npm install)
  if [[ -f "${src_dir}/package.json" ]]; then
    if [[ -f "${src_dir}/package-lock.json" ]]; then
      echo "  npm ci --omit=dev"
      (cd "$src_dir" && npm ci --omit=dev --silent)
    else
      echo "  npm install --omit=dev"
      (cd "$src_dir" && npm install --omit=dev --silent)
    fi
  fi

  # Zip source
  mkdir -p "$BUILD_DIR"
  rm -f "$zip_path"
  echo "  zipping → ${zip_path}"
  (cd "$src_dir" && zip -qr "$zip_path" . --exclude "*.test.js" --exclude ".env*")

  # Deploy — wait for any in-flight update to settle, push ONCE, wait again.
  # (A previous version had a `|| aws lambda update-function-code ...` fallback
  # that re-invoked the update; the second call would race the first and fail
  # with ResourceConflictException even though the deploy had succeeded.)
  echo "  aws lambda update-function-code"
  aws lambda wait function-updated \
    --function-name "$fn_name" --region "$REGION" 2>/dev/null || true

  aws lambda update-function-code \
    --function-name "$fn_name" \
    --zip-file "fileb://${zip_path}" \
    --region "$REGION" \
    --output text --query 'LastUpdateStatus' >/dev/null

  # Block until the update finishes so failures surface here, not silently later.
  aws lambda wait function-updated \
    --function-name "$fn_name" --region "$REGION"

  aws lambda get-function-configuration \
    --function-name "$fn_name" \
    --region "$REGION" \
    --query '{fn:FunctionName,status:LastUpdateStatus,sha:CodeSha256,size:CodeSize}' \
    --output json \
    | jq -r '"  deployed: " + .fn + "  (" + (.status // "?") + ", sha " + (.sha // "?") + ", " + (.size|tostring) + " bytes)"' 2>/dev/null \
    || echo "  deployed: ${fn_name}"
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
