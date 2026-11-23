#!/usr/bin/env bash
# mobile/.maestro/solartest/run.sh — Maestro flows as real SolarCRM people on
# SolarTest (private copy of the client DB) via the owner's backend on :5001.
# Usage: mobile/.maestro/solartest/run.sh [flow ...]   (default: all, in order)
# Env: DEVICE (default emulator-5554), SHOTS (screenshot dir, default a temp dir).
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
DEVICE="${DEVICE:-emulator-5554}"
SHOTS="${SHOTS:-$(mktemp -d -t maestro-solartest)}"
# Maestro's logs record typed text, the password included: temp dir, deleted on exit.
DEBUG="$(mktemp -d -t maestro-solartest-debug)"
keep_shots() { find "$DEBUG" -path '*/takeScreenshot/*.png' -exec cp {} "$SHOTS"/ \; 2>/dev/null || true; }
trap 'keep_shots; rm -rf "$DEBUG"' EXIT

grep -qx 'EXPO_PUBLIC_API_BASE_URL=http://localhost:5001' "$REPO/mobile/.env.local" \
  || { echo "run.sh: mobile/.env.local must set EXPO_PUBLIC_API_BASE_URL=http://localhost:5001" >&2; exit 1; }
PASSWORD="$(grep '^LIVE_PASSWORD=' "$REPO/backend/.env.live" | cut -d= -f2-)"
[ -n "$PASSWORD" ] || { echo "run.sh: LIVE_PASSWORD missing in backend/.env.live" >&2; exit 1; }

# SolarTest proof: :5001 is up, and "Neha " signs in with the test-only password
# (it exists only on SolarTest). Body sent on stdin so the password is not in argv.
[ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:5001/health)" = 200 ] \
  || { echo "run.sh: http://localhost:5001/health is not 200" >&2; exit 1; }
code="$(PW="$PASSWORD" node -e 'process.stdout.write(JSON.stringify({username:"Neha ",password:process.env.PW}))' \
  | curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' --data-binary @- http://localhost:5001/api/auth/loginUser)"
[ "$code" = 200 ] || { echo "run.sh: 'Neha ' cannot sign in — not SolarTest, stopping" >&2; exit 1; }

adb -s "$DEVICE" reverse tcp:5001 tcp:5001 >/dev/null
adb -s "$DEVICE" reverse tcp:8081 tcp:8081 >/dev/null

RUN="$DEBUG/run.json"
LIVE_PASSWORD="$PASSWORD" node "$HERE/setup.js" "$RUN" >/dev/null || { echo "run.sh: setup failed" >&2; exit 1; }
val() { node -e "console.log(require('$RUN').$1)"; }
ENV=()
for k in TAG CUST REASON ESC KASAK_ALL KASAK_MINE NEHA_LEAD T60; do ENV+=(-e "$k=$(val $k)"); done

# Fresh app process per person: the dev build's heap grows while flows drive it.
restart_app() {
  adb -s "$DEVICE" shell am force-stop com.shadowider.eCRM
  adb -s "$DEVICE" shell am start -a android.intent.action.VIEW \
    -d "exp+ecrm://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081" >/dev/null
}
m() { maestro --device "$DEVICE" test --debug-output "$DEBUG/debug" --test-output-dir "$DEBUG/out" "${ENV[@]}" "$@"; }

# flow -> username (exact; trailing spaces matter)
FLOWS=(neha-leads vinod-complaint nitin-log-reassign kasak-leads rohit-escalated)
declare -A WHO=([neha-leads]="Neha " [vinod-complaint]="Vinod " [nitin-log-reassign]="Nitin " [kasak-leads]="Kasak " [rohit-escalated]="Rohit ")
[ $# -gt 0 ] && FLOWS=("$@")

failed=0; summary=()
for f in "${FLOWS[@]}"; do
  adb -s "$DEVICE" get-state >/dev/null 2>&1 || { echo "run.sh: $DEVICE is gone" >&2; exit 2; }
  restart_app
  start=$SECONDS
  if out="$(m -e LOGIN="${WHO[$f]}" -e PASSWORD="$PASSWORD" "$REPO/mobile/.maestro/access/sign-in.yaml" 2>&1)" \
     && out="$(m "$HERE/$f.yaml" 2>&1)"; then line="[Passed] $f ($((SECONDS - start))s)"
  else
    failed=$((failed + 1))
    line="[Failed] $f ($((SECONDS - start))s) ($(grep -m1 -E 'Element not found|Assertion is false|Error|failed' <<<"$out" | sed 's/^ *//'))"
  fi
  echo "$line"; summary+=("$line")
done
echo; printf '%s\n' "${summary[@]}"
echo "$failed/${#FLOWS[@]} flows failed. Screenshots: $SHOTS"
[ "$failed" -eq 0 ]
