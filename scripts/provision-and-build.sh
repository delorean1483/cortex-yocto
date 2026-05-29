#!/usr/bin/env bash
# EcoFleet — provision-and-build.sh
# Provisions an AWS IoT Thing for a unit, updates CI secrets, tags a release,
# and triggers a Yocto build — all in one step.
#
# Usage: provision-and-build.sh <UNIT-ID> <FIRMWARE-VERSION>
# Example: provision-and-build.sh TRUCK-002 1.0.0

set -euo pipefail

UNIT="${1:?Usage: provision-and-build.sh <UNIT-ID> <FIRMWARE-VERSION>  e.g. TRUCK-002 1.0.0}"
VERSION="${2:?Usage: provision-and-build.sh <UNIT-ID> <FIRMWARE-VERSION>  e.g. TRUCK-002 1.0.0}"
TAG="v${VERSION}-${UNIT}"
CERTS_DIR="meta-ecofleet/recipes-ecofleet/gobi-agent/files"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}/.."

echo "==> Provisioning ${UNIT} at tag ${TAG}"

# 1. Provision AWS IoT Thing + cert
./scripts/provision-device.sh "$UNIT"

# 2. Update GitHub Actions secrets with the real unit cert
echo "==> Updating CI secrets"
gh secret set DEVICE_CRT < "${CERTS_DIR}/device.crt"
gh secret set DEVICE_KEY < "${CERTS_DIR}/device.key"
echo "    DEVICE_CRT and DEVICE_KEY updated"

# 3. Tag the commit
if git rev-parse "$TAG" >/dev/null 2>&1; then
    echo "    Tag ${TAG} already exists — skipping tag creation"
else
    git tag "$TAG"
    git push origin "$TAG"
    echo "    Tagged and pushed ${TAG}"
fi

# 4. Trigger the build on this tag
echo "==> Triggering build for ${TAG}"
RUN_URL=$(gh workflow run build.yml --ref "$TAG" --json url -q .url 2>/dev/null || true)
sleep 3
RUN_ID=$(gh run list --workflow=build.yml --limit 1 --json databaseId -q '.[0].databaseId')
echo "    Run ID: ${RUN_ID}"
echo ""
echo "==> Watching build — press Ctrl+C to detach (build continues in CI)"
gh run watch "$RUN_ID"

echo ""
echo "==> Done. Release: https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/releases/tag/${TAG}"
