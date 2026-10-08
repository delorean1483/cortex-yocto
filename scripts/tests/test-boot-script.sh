#!/bin/sh
# Static checks for the u-boot hush boot script (no u-boot on the host).
# - u-boot's old hush only accepts NAME=value / for-loop variables whose name
#   starts with a letter: `for _try in 1 2` runs "_try=1" as a command and
#   leaves ${_try} empty (bench 2026-10-08: the same-pass slot fallback never
#   ran and the unit stopped at the u-boot prompt).
# - no `reset`: u-boot's reset is the WDOG path that hangs this board.
F=$(cd "$(dirname "$0")/../.." && pwd)/meta-ecofleet/recipes-bsp/ecofleet-bootscript/files/ecofleet-boot.cmd
code=$(grep -v '^[[:space:]]*#' "$F")
fail=0
bad=$(echo "$code" | grep -oE '(^|[;[:space:]])for[[:space:]]+[^[:space:]]+[[:space:]]+in([[:space:]]|$)' | awk '{print $2}' | grep -v '^[A-Za-z]')
[ -z "$bad" ] && echo "ok   - for-loop variables start with a letter" || { echo "FAIL - for-loop variable(s) not starting with a letter: $bad"; fail=1; }
echo "$code" | grep -qw reset && { echo "FAIL - reset command present"; fail=1; } || echo "ok   - no reset command"
[ $fail = 0 ] && echo PASS || { echo FAILED; exit 1; }
