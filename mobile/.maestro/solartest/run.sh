#!/usr/bin/env bash
# mobile/.maestro/solartest/run.sh — Maestro flows as real SolarCRM people on
# SolarTest (private copy of the client DB) via the owner's backend on :5001.
# Usage: mobile/.maestro/solartest/run.sh [flow ...]   the slices (default: all, in order)
#        mobile/.maestro/solartest/run.sh full [flow ...]  journeys A (complaint), B (lead), C (menus, all 14 people)
#        mobile/.maestro/solartest/run.sh screens [user ...]  every bottom tab + More item per person, screenshots
#        mobile/.maestro/solartest/run.sh calling  calling lists: Ashish + Pawan work their 5, support has no Calling
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

# The bundle proof, before any password is typed. .env.local alone proves nothing:
# Metro can serve a bundle transformed before it existed (start it with --clear),
# and then the app signs in wherever its persisted company points — a live client.
# With the app's data wiped there is no persisted company, so the sign-in screen
# skips the company-code step only when the bundle carries the localhost override.
adb -s "$DEVICE" shell pm clear com.shadowider.eCRM >/dev/null
adb -s "$DEVICE" shell am start -a android.intent.action.VIEW \
  -d "exp+ecrm://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081" >/dev/null
seen=""
for _ in $(seq 1 60); do
  seen="$(adb -s "$DEVICE" exec-out uiautomator dump /dev/tty 2>/dev/null)"
  # A wiped dev client opens its developer menu (intro, then the menu) over the app: Continue, then Close.
  if grep -q 'Runtime version' <<<"$seen"; then
    for want in 'text="Continue"' 'content-desc="Close"'; do
      node_="$(grep -oE "<node [^>]*${want}[^>]*>" <<<"$seen" | head -1)"
      [ -n "$node_" ] || continue
      read -r x1 y1 x2 y2 <<<"$(grep -oE 'bounds="[^"]+"' <<<"$node_" | grep -oE '[0-9]+' | tr '\n' ' ')"
      adb -s "$DEVICE" shell input tap $(((x1 + x2) / 2)) $(((y1 + y2) / 2)); break
    done
    sleep 2; continue
  fi
  grep -qE 'text="(Username|Enter your company code)"' <<<"$seen" && break
  sleep 3
done
grep -q 'text="Username"' <<<"$seen" && ! grep -q 'company code' <<<"$seen" \
  || { echo "run.sh: the app's bundle has no localhost override (company-code step shown) — restart Metro with --clear; stopping before any sign-in" >&2; exit 1; }

RUN="$DEBUG/run.json"
MODE=slices; [ "${1:-}" = full ] && MODE=full; [ "${1:-}" = screens ] && MODE=screens; [ "${1:-}" = calling ] && MODE=calling
val() { node -e "console.log(require('$RUN').$1)"; }
ENV=()
if [ "$MODE" = calling ]; then
  # Its own list (calling-setup.mjs); calling hours opened for the run and restored, everything pulled back, on exit.
  node "$HERE/calling-setup.mjs" "$RUN" >/dev/null || { echo "run.sh: calling setup failed" >&2; exit 1; }
  trap 'node "$HERE/calling-setup.mjs" teardown >/dev/null 2>&1; keep_shots; rm -rf "$DEBUG"' EXIT
  for k in TAG LIST A1 A2 A3 A4 A5 P1 P2 P3 P4 P5 ANEXT PNEXT; do ENV+=(-e "$k=$(val $k)"); done
else
  LIVE_PASSWORD="$PASSWORD" node "$HERE/setup.js" "$RUN" "$([ "$MODE" = slices ] && echo slices || echo full)" >/dev/null || { echo "run.sh: setup failed" >&2; exit 1; }
  for k in TAG CUST REASON ESC KASAK_ALL KASAK_MINE NEHA_LEAD T60 ROSHAN_LEAD RESOLUTION RESOLVED_LABEL; do ENV+=(-e "$k=$(val $k)"); done
fi

# Fresh app process per person: the dev build's heap grows while flows drive it.
restart_app() {
  adb -s "$DEVICE" shell am force-stop com.shadowider.eCRM
  adb -s "$DEVICE" shell am start -a android.intent.action.VIEW \
    -d "exp+ecrm://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081" >/dev/null
}
m() { maestro --device "$DEVICE" test --debug-output "$DEBUG/debug" --test-output-dir "$DEBUG/out" "${ENV[@]}" "$@"; }

# Steps: "journey|username|flow" (exact usernames; trailing spaces matter). A
# journey's steps build on each other: after a failure the rest of it is skipped.
if [ "$MODE" = full ]; then
  STEPS=(
    "A|Nitin |a1-nitin-logs" "A|Vinod |a2-vinod-sends-back" "A|Nitin |a3-nitin-reassigns" "A|Vivek|a4-vivek-escalates"
    "A|Rohit |a5-rohit-reassigns" "A|Vivek|a6-vivek-lost-it" "A|Vinod |a7-vinod-resolves" "A|Neha |a8-neha-reopens"
    "A|Prasant |a9-prasant-finds-nothing"
    "B|Kasak |b1-kasak-hands-over" "B|Roshan|b2-roshan-has-it" "B|Neha |b3-neha-hands-back" "B|Kasak |b4-kasak-has-it"
  )
  for u in "Amit" "Neha "; do STEPS+=("C|$u|c-menu-both"); done
  for u in "Deeksha" "Roshan" "Kasak " "Sarika " "Tanu " "Ashish " "Pawan "; do STEPS+=("C|$u|c-menu-sales"); done
  for u in "Nitin " "Prasant " "Rohit " "Vinod " "Vivek"; do STEPS+=("C|$u|c-menu-support"); done
  # run.sh full <flow ...>: only those steps (for a retry; a journey's records must already be in place).
  if [ $# -gt 1 ]; then
    keep=(); for st in "${STEPS[@]}"; do for f in "${@:2}"; do [ "${st##*|}" = "$f" ] && keep+=("$st"); done; done
    STEPS=("${keep[@]}")
  fi
elif [ "$MODE" = calling ]; then
  STEPS=("-|Ashish |calling-ashish" "-|Pawan |calling-pawan" "-|Rohit |calling-none" "-|Nitin |calling-none" "-|Vivek|calling-none")
  [ $# -gt 1 ] && { keep=(); for st in "${STEPS[@]}"; do for f in "${@:2}"; do [[ "$st" == *"|$f" || "$st" == *"|$f "* ]] && keep+=("$st"); done; done; STEPS=("${keep[@]}"); }
elif [ "$MODE" = screens ]; then
  # run.sh screens [user ...]: every screen per person (default: all 14).
  USERS=("Amit" "Neha " "Deeksha" "Roshan" "Kasak " "Sarika " "Tanu " "Ashish " "Pawan " "Nitin " "Prasant " "Rohit " "Vinod " "Vivek")
  [ $# -gt 1 ] && USERS=("${@:2}")
  STEPS=(); for u in "${USERS[@]}"; do STEPS+=("S|$u|screens"); done
else
  declare -A WHO=([neha-leads]="Neha " [vinod-complaint]="Vinod " [nitin-log-reassign]="Nitin " [kasak-leads]="Kasak " [rohit-escalated]="Rohit ")
  FLOWS=(neha-leads vinod-complaint nitin-log-reassign kasak-leads rohit-escalated)
  [ $# -gt 0 ] && FLOWS=("$@")
  STEPS=(); for f in "${FLOWS[@]}"; do STEPS+=("-|${WHO[$f]}|$f"); done
fi

failed=0; skipped=0; summary=(); broken=""
for st in "${STEPS[@]}"; do
  IFS='|' read -r j who f <<<"$st"
  label="$f (${who% })"
  if [ "$j" != "-" ] && [ "$j" != C ] && [ "$j" != S ] && [[ "$broken" == *"$j"* ]]; then
    skipped=$((skipped + 1)); line="[Skipped] $label"; echo "$line"; summary+=("$line"); continue
  fi
  adb -s "$DEVICE" get-state >/dev/null 2>&1 || { echo "run.sh: $DEVICE is gone" >&2; exit 2; }
  restart_app
  start=$SECONDS
  # Typed without trailing spaces (the server trims): the emulator keyboard turns
  # "Prasant " into "Peasant " on the space, autoCorrect={false} notwithstanding.
  login="${who%"${who##*[! ]}"}"
  if out="$(m -e LOGIN="$login" -e PASSWORD="$PASSWORD" "$REPO/mobile/.maestro/access/sign-in.yaml" 2>&1)" \
     && out="$(m -e WHO="$(tr '[:upper:]' '[:lower:]' <<<"$login")" "$HERE/$f.yaml" 2>&1)"; then line="[Passed] $label ($((SECONDS - start))s)"
  else
    failed=$((failed + 1)); broken+="$j"
    line="[Failed] $label ($((SECONDS - start))s) ($(grep -m1 -E 'Element not found|Assertion is false|Error|failed' <<<"$out" | sed 's/^ *//'))"
  fi
  echo "$line"; summary+=("$line")
done
echo; printf '%s\n' "${summary[@]}"
echo "$failed/${#STEPS[@]} steps failed, $skipped skipped. Screenshots: $SHOTS"
[ "$failed" -eq 0 ] && [ "$skipped" -eq 0 ]
