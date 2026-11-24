#!/bin/sh
# gobi-agent recipe lists its sources one by one in SRC_URI. A file the build
# uses but the recipe doesn't fetch passes every host test (tests/run.sh reads
# files/ directly) and only fails in the Yocto build. Check that every .c in
# CMakeLists.txt, and every local header those .c files include, is fetched.
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
R=$ROOT/meta-ecofleet/recipes-ecofleet/gobi-agent
F=$R/files
BB=$R/gobi-agent_1.0.bb
fail=0
ok()  { echo "ok   - $1"; }
bad() { echo "FAIL - $1"; fail=1; }

srcs=$(sed -n '/target_sources(gobi-agent/,/)/p' "$F/CMakeLists.txt" | grep -oE '[A-Za-z0-9_.-]+\.c' | sort -u)
[ -n "$srcs" ] || bad "no sources found in CMakeLists.txt"
hdrs=$(cd "$F" && cat $srcs 2>/dev/null | sed -n 's/^#include "\([^"]*\)".*/\1/p' | sort -u)
for f in $srcs $hdrs; do
    if [ ! -f "$F/$f" ]; then bad "$f is used but not in files/"
    elif grep -q "file://$f\b" "$BB"; then :
    else bad "$f is built but not in SRC_URI of gobi-agent_1.0.bb"; fi
done
[ $fail = 0 ] && ok "every built source and local header is in SRC_URI ($(echo $srcs $hdrs | wc -w | tr -d ' ') files)"
[ $fail = 0 ] && echo PASS || { echo FAILED; exit 1; }
