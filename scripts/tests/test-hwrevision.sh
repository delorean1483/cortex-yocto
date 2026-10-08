#!/bin/sh
# The boot-partition layout (p1 boot, p2/p3 slots, p4 data) is incompatible with
# the old one (p1/p2 slots, p3 data): an old bundle's pre-install would write the
# running root or the boot partition of a new unit, and vice versa. swupdate's
# hardware-compatibility check is what keeps them apart, so the bundle's
# revision and the image's /etc/hwrevision must both say the new-layout revision.
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WANT=2.0
fail=0
sw=$(sed -n 's/^[[:space:]]*hardware-compatibility[[:space:]]*=[[:space:]]*\[\(.*\)\];.*/\1/p' "$ROOT/scripts/sw-description")
[ "$sw" = "\"$WANT\"" ] && echo "ok   - sw-description hardware-compatibility = [\"$WANT\"]" || { echo "FAIL - sw-description hardware-compatibility is [$sw], want [\"$WANT\"]"; fail=1; }
img=$(grep -o 'imx8mm-var-dart [0-9.]*' "$ROOT/meta-ecofleet/recipes-core/images/ecofleet-image.bb" | head -1)
[ "$img" = "imx8mm-var-dart $WANT" ] && echo "ok   - image writes /etc/hwrevision 'imx8mm-var-dart $WANT'" || { echo "FAIL - image /etc/hwrevision is '$img', want 'imx8mm-var-dart $WANT'"; fail=1; }
[ $fail = 0 ] && echo PASS || { echo FAILED; exit 1; }
