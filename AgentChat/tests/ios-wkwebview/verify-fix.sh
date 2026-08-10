#!/usr/bin/env bash
# End-to-end regression test for the iOS WKWebView chat-composer bug.
#
# Builds the ConceptsOS iOS wrapper for the iPhone 17 Pro Max Simulator
# on `mac-mini`, points it at the local AgentChat dev server over
# Tailscale, screenshots the empty-state, and asserts that the composer
# is inside the visible viewport by parsing `os_log` output from the
# WKWebView debug bridge (see iOS-overrides/WebView.swift).
#
# Prereqs: see README.md.
#
# Exit code 0 on success (composer visible), non-zero if the composer's
# bottom edge is below the CSS viewport height (bug reintroduced).

set -euo pipefail

MAC="${MAC:-mac-mini}"
UDID="${UDID:-657C55A5-D024-4BCD-93A3-4BB4CACFFF8B}"     # iPhone 17 Pro Max
DEV_HOST="${DEV_HOST:-100.69.188.4}"                      # dans-linux-mini tailnet IP
DEV_URL="${DEV_URL:-http://${DEV_HOST}:3050}"
CONCEPTOS="${CONCEPTOS:-$HOME/github/Humata-ai/ConceptsOS}"
OUTDIR="${OUTDIR:-$(cd "$(dirname "$0")/../.." && pwd)/test-results/ios-wkwebview}"

mkdir -p "$OUTDIR"

echo "==> Checking dev server is reachable at $DEV_URL"
if ! curl -sf -o /dev/null -w '%{http_code}\n' "$DEV_URL/" | grep -qE '^(200|3..)$'; then
  echo "FAIL: dev server not responding at $DEV_URL. Start it with 'npm run dev' first." >&2
  exit 2
fi

echo "==> Verifying mac-mini SSH + Xcode"
ssh "$MAC" bash <<'REMOTE' || { echo "FAIL: mac-mini not reachable / Xcode not set up" >&2; exit 2; }
set -e
which xcodebuild >/dev/null
which xcrun      >/dev/null
xcrun simctl list devices | grep -q Booted || xcrun simctl boot 657C55A5-D024-4BCD-93A3-4BB4CACFFF8B
REMOTE

# Nushell is the login shell on mac-mini; force bash for anything that
# uses `$HOME`, heredocs, `&&`, or other bash-isms.
REMOTE_ROOT="$(ssh "$MAC" 'bash -lc "echo \$HOME"')/github/Humata-ai/ConceptsOS/iOS/ConceptsOS"

# Ship debug overrides + fresh copy of the iOS project fixture files.
# All state changes are reverted in the trap below.
scp "$(dirname "$0")/iOS-overrides/DebugContentView.swift" "$MAC:/tmp/e2e-DebugContentView.swift"
scp "$(dirname "$0")/iOS-overrides/WebView.swift"          "$MAC:/tmp/e2e-WebView.swift"

cleanup() {
  echo "==> Restoring iOS source files on $MAC"
  ssh "$MAC" bash <<REMOTE || true
cd "$REMOTE_ROOT"
[ -f /tmp/e2e-ContentView.swift.orig ] && cp /tmp/e2e-ContentView.swift.orig ConceptsOS/ContentView.swift
[ -f /tmp/e2e-WebView.swift.orig     ] && cp /tmp/e2e-WebView.swift.orig     ConceptsOS/WebView.swift
[ -f /tmp/e2e-Info.plist.orig        ] && cp /tmp/e2e-Info.plist.orig        ConceptsOS/Info.plist
REMOTE
}
trap cleanup EXIT

echo "==> Patching iOS source on $MAC"
ssh "$MAC" bash <<REMOTE
set -e
cd "$REMOTE_ROOT"
cp ConceptsOS/ContentView.swift /tmp/e2e-ContentView.swift.orig
cp ConceptsOS/WebView.swift     /tmp/e2e-WebView.swift.orig
cp ConceptsOS/Info.plist        /tmp/e2e-Info.plist.orig
cp /tmp/e2e-DebugContentView.swift ConceptsOS/ContentView.swift
cp /tmp/e2e-WebView.swift          ConceptsOS/WebView.swift

# ATS exception for the tailnet dev-server IP. Idempotent.
/usr/libexec/PlistBuddy -c "Delete :NSAppTransportSecurity:NSExceptionDomains:${DEV_HOST}" ConceptsOS/Info.plist 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity:NSExceptionDomains:${DEV_HOST} dict" ConceptsOS/Info.plist
/usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity:NSExceptionDomains:${DEV_HOST}:NSExceptionAllowsInsecureHTTPLoads bool true" ConceptsOS/Info.plist
/usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity:NSExceptionDomains:${DEV_HOST}:NSIncludesSubdomains bool true" ConceptsOS/Info.plist
REMOTE

echo "==> Building iOS app for simulator"
ssh "$MAC" bash <<REMOTE
set -e
cd "$REMOTE_ROOT"
sudo xcode-select --switch /Applications/Xcode-26.6.0.app 2>/dev/null || true
xcodebuild \
  -project ConceptsOS.xcodeproj -scheme ConceptsOS -configuration Debug \
  -sdk iphonesimulator \
  -destination "platform=iOS Simulator,id=${UDID}" \
  -derivedDataPath /tmp/conceptsos-e2e-dd \
  CODE_SIGNING_ALLOWED=NO build 2>&1 | tail -2
REMOTE

echo "==> Resetting server-side sessions so we screenshot the empty state"
python3 - <<PY
import json, urllib.request
d = json.load(urllib.request.urlopen("${DEV_URL}/api/sessions", timeout=5))
for s in d.get("sessions", []):
    urllib.request.urlopen(urllib.request.Request(
        "${DEV_URL}/api/sessions?id=" + s["id"], method="DELETE"), timeout=5).read()
print("deleted", len(d.get("sessions", [])), "sessions")
PY

echo "==> Installing + launching, streaming WKWebView bridge log"
ssh "$MAC" bash <<REMOTE
set -e
UDID=${UDID}
APP=/tmp/conceptsos-e2e-dd/Build/Products/Debug-iphonesimulator/ConceptsOS.app
xcrun simctl terminate \$UDID ai.humata.ConceptsOS 2>/dev/null || true
xcrun simctl uninstall  \$UDID ai.humata.ConceptsOS 2>/dev/null || true
# Nuke prior WKWebView site data so localStorage.chatui-active doesn't
# resurrect a stale session id from a previous run.
find ~/Library/Developer/CoreSimulator/Devices/\$UDID/data/Containers/Data/Application \
  -type d -name WebKit -exec rm -rf {} + 2>/dev/null || true
xcrun simctl install \$UDID \$APP
xcrun simctl spawn \$UDID log stream \
  --predicate 'subsystem == "ai.humata.ConceptsOS"' \
  --style compact > /tmp/e2e-dbg.log 2>&1 &
LOGPID=\$!
sleep 1
xcrun simctl launch \$UDID ai.humata.ConceptsOS
sleep 12
kill \$LOGPID 2>/dev/null || true
xcrun simctl io \$UDID screenshot /tmp/e2e-wk_empty.png
REMOTE

echo "==> Pulling artifacts"
scp "$MAC:/tmp/e2e-wk_empty.png" "$OUTDIR/wk_empty.png"
scp "$MAC:/tmp/e2e-dbg.log"      "$OUTDIR/dbg.log"

echo "==> Layout dump:"
grep -E 'boot:|didFinishNavigation|layout:|error|Fail' "$OUTDIR/dbg.log" || true

# Parse the last `layout:` line and assert composer is fully inside body.
# Line format:
#   ... layout: body.children=15 html.h=956 body.h=956 ta=true paper=12,894 416x50
last=$(grep 'layout:' "$OUTDIR/dbg.log" | tail -1 || true)
if [ -z "$last" ]; then
  echo "FAIL: no layout dump captured — bridge JS didn't run. Check dbg.log for JS errors." >&2
  exit 3
fi

body_h=$(echo "$last" | sed -nE 's/.*body\.h=([0-9.]+).*/\1/p')
paper_y=$(echo "$last" | sed -nE 's/.*paper=[0-9]+,([0-9]+) .*/\1/p')
paper_h=$(echo "$last" | sed -nE 's/.*paper=[0-9]+,[0-9]+ [0-9]+x([0-9]+).*/\1/p')

if [ -z "$body_h" ] || [ -z "$paper_y" ] || [ -z "$paper_h" ]; then
  echo "FAIL: couldn't parse layout dump: $last" >&2
  exit 3
fi

paper_bottom=$(python3 -c "print(int(${paper_y}) + int(${paper_h}))")
echo
echo "=== VERDICT ==="
echo "  body height:      ${body_h}"
echo "  composer y:       ${paper_y}"
echo "  composer bottom:  ${paper_bottom}"

if python3 -c "import sys; sys.exit(0 if int(${paper_bottom}) <= float(${body_h}) + 1 else 1)"; then
  echo "  composer visible: YES ✅"
  echo "screenshot: $OUTDIR/wk_empty.png"
  exit 0
else
  echo "  composer visible: NO ❌  (composer bottom > body height — Dan's bug)"
  echo "screenshot: $OUTDIR/wk_empty.png"
  exit 1
fi
