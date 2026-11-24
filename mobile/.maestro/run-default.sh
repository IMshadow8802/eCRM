#!/usr/bin/env bash
# mobile/.maestro/run-default.sh — the default suite (config.yaml) with a fresh
# app process before every flow: the dev build's native heap grows while
# flows drive it until the JS thread stalls (see access/run.sh restart_app).
# Signs in once first with OWNER_USER / OWNER_PASSWORD from the environment
# (never echoed; Maestro's logs, which record typed text, go to a temp dir
# deleted on exit). Usage, from anywhere:
#   OWNER_USER=... OWNER_PASSWORD=... mobile/.maestro/run-default.sh [flow ...]
# Env: DEVICE (default emulator-5554).
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEVICE="${DEVICE:-emulator-5554}"
: "${OWNER_USER:?OWNER_USER not set}" "${OWNER_PASSWORD:?OWNER_PASSWORD not set}"
DEBUG="$(mktemp -d -t maestro-default-debug)"
trap 'rm -rf "$DEBUG"' EXIT

adb -s "$DEVICE" reverse tcp:5001 tcp:5001 >/dev/null
adb -s "$DEVICE" reverse tcp:8081 tcp:8081 >/dev/null

restart_app() {
  adb -s "$DEVICE" shell am force-stop com.shadowider.eCRM
  adb -s "$DEVICE" shell am start -a android.intent.action.VIEW \
    -d "exp+ecrm://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081" >/dev/null
}
m() { maestro --device "$DEVICE" test --debug-output "$DEBUG/debug" --test-output-dir "$DEBUG/out" "$@"; }

# Flows in config.yaml order (or the ones named).
if [ $# -gt 0 ]; then FLOWS=("$@"); else
  FLOWS=($(sed -n 's/^  - \(.*\)\.yaml$/\1/p' "$HERE/config.yaml"))
fi

restart_app
m -e LOGIN="$OWNER_USER" -e PASSWORD="$OWNER_PASSWORD" "$HERE/access/sign-in.yaml" >/dev/null \
  || { echo "run-default.sh: sign-in failed" >&2; exit 1; }

failed=0; summary=()
for f in "${FLOWS[@]}"; do
  # An emulator that died fails every flow after it: stop, do not count them.
  adb -s "$DEVICE" get-state >/dev/null 2>&1 || { echo "run-default.sh: $DEVICE is gone (emulator crashed)" >&2; exit 2; }
  restart_app
  start=$SECONDS
  if out="$(m "$HERE/$f.yaml" 2>&1)"; then line="[Passed] $f ($((SECONDS - start))s)"
  else
    failed=$((failed + 1))
    line="[Failed] $f ($((SECONDS - start))s) ($(grep -m1 -E 'Element not found|Assertion is false|Error|failed' <<<"$out" | sed 's/^ *//'))"
  fi
  echo "$line"; summary+=("$line")
done
echo; printf '%s\n' "${summary[@]}"
echo "$failed/${#FLOWS[@]} Flows Failed"
[ "$failed" -eq 0 ]
