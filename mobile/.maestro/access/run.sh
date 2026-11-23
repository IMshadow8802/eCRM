#!/usr/bin/env bash
# mobile/.maestro/access/run.sh — the access-model Maestro run (Task 30).
# See README.md. Usage, from anywhere:
#   mobile/.maestro/access/run.sh                 every flow, in order
#   mobile/.maestro/access/run.sh desk-nitin ...  only these (records still fresh)
# Env: DEVICE (default emulator-5554), SHOTS (screenshot dir, default a temp dir).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
DEVICE="${DEVICE:-emulator-5554}"
SHOTS="${SHOTS:-$(mktemp -d -t maestro-access)}"
# Maestro's logs record every typed text, the password included: they go to a
# temp dir deleted on exit, never to ~/.maestro. Only the screenshots
# (takeScreenshot) are copied out to $SHOTS.
DEBUG="$(mktemp -d -t maestro-access-debug)"
keep_shots() { find "$DEBUG" -path '*/takeScreenshot/*.png' -exec cp {} "$SHOTS"/ \; 2>/dev/null || true; }
trap 'keep_shots; rm -rf "$DEBUG"' EXIT

# The app must talk to the local backend on TestCRM (owner ruling L3).
grep -qx 'EXPO_PUBLIC_API_BASE_URL=http://localhost:5001' "$REPO/mobile/.env.local" \
  || { echo "run.sh: mobile/.env.local must set EXPO_PUBLIC_API_BASE_URL=http://localhost:5001" >&2; exit 1; }
adb -s "$DEVICE" reverse tcp:5001 tcp:5001 >/dev/null
adb -s "$DEVICE" reverse tcp:8081 tcp:8081 >/dev/null

# Never echoed, never written: passed to Maestro for sign-in.yaml only.
PASSWORD="$(grep '^LIVE_PASSWORD=' "$REPO/backend/.env.live" | cut -d= -f2-)"
[ -n "$PASSWORD" ] || { echo "run.sh: LIVE_PASSWORD missing in backend/.env.live" >&2; exit 1; }

# A fresh app process per persona (session kept: no clearState). The dev
# build's native heap grows ~40 MB a minute while flows drive it (flat when
# idle) until the JS thread stalls: taps and typing are no longer handled
# (2026-11-23: 1.6 GB after hours; 376 -> 762 MB in one 10-minute stretch).
restart_app() {
  adb -s "$DEVICE" shell dumpsys meminfo com.shadowider.eCRM | grep -E "Native Heap:" || true
  adb -s "$DEVICE" shell am force-stop com.shadowider.eCRM
  adb -s "$DEVICE" shell am start -a android.intent.action.VIEW \
    -d "exp+ecrm://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081" >/dev/null
}

live() { node "$HERE/live.js" "$@"; }
live run
trap 'live cleanup || true; live active nitin 1 || true; keep_shots; rm -rf "$DEBUG"' EXIT

# This run's names, as Maestro env.
RUN="$REPO/mobile/.maestro/.run.json"
val() { node -e "const r=require('$RUN'); console.log($1)"; }
ENV=(
  -e TAG="$(val r.tag)"
  -e CUST_HO="$(val r.customers.HO.name)"
  -e L01="$(val r.leads.L01.name)"
)
for k in C01 C02 C04 C07 C08 C09 C15 C16; do ENV+=(-e "$k=$(val "r.complaints.$k.subject")"); done

m() { maestro --device "$DEVICE" test --debug-output "$DEBUG/debug" --test-output-dir "$DEBUG/out" "${ENV[@]}" "$@"; }
as() { restart_app; m -e LOGIN="am_$1" -e PASSWORD="$PASSWORD" "$HERE/sign-in.yaml"; }
step() { m "$HERE/$1.yaml"; }

SELECTED=" $* "
want() { [ -z "${SELECTED// /}" ] || [[ "$SELECTED" == *" $1 "* ]]; }

if want desk-nitin; then as nitin; step desk-nitin; fi
if want agent-vinod; then
  as vinod
  step agent-vinod
  # Send back refused: the giver (nitin) is deactivated while the screen is open.
  step agent-vinod-open-c08
  live active nitin 0
  step agent-vinod-send-back-refused
  live active nitin 1
  # Stale screen: amit moves C15 away while vinod has it open.
  step agent-vinod-open-c15
  live move C15 vivek
  step agent-vinod-gone
fi
if want agent-vivek; then as vivek; step agent-vivek; fi
if want teamlead-rohit; then as rohit; step teamlead-rohit; fi
if want manager-neha; then as neha; step manager-neha; fi
if want admin-amit; then as amit; step admin-amit; fi
if want sales-kasak; then as kasak; step sales-kasak; fi
if want sales-roshan; then as roshan; step sales-roshan; fi
if want field-via2; then as field; step field-via2; fi
adb -s "$DEVICE" shell dumpsys meminfo com.shadowider.eCRM | grep -E "Native Heap:" || true
echo "run.sh: all flows passed. Screenshots: $SHOTS"
