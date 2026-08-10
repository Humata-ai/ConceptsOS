#!/usr/bin/env bash
# Build + sign + install + launch ConceptsOS on a paired physical iPhone
# over Wi-Fi (or USB), using dev signing driven by the App Store Connect
# API key. Runs on the Mac Mini (where Xcode lives). No TestFlight
# processing delay — ~45s from `git pull` to app-launched.
#
# Prereqs (all one-time):
#   1. Phone paired with the Mac (plug in via USB once, tap "Trust").
#   2. Developer Mode on the phone (Settings → Privacy & Security).
#   3. Phone's UDID registered on the developer portal (use
#      register-device.sh — this script will tell you if it isn't).
#   4. Login keychain unlocked on the Mac (see xcode skill).
#
# Usage (from the Mac):
#   bash iOS/scripts/wifi-install.sh
#
# Usage (from the Linux box):
#   ssh mac-mini bash ~/github/Humata-ai/ConceptsOS/iOS/scripts/wifi-install.sh
#
# Environment overrides (all optional):
#   DEVICE_ID                     devicectl device identifier. If unset,
#                                 auto-picks when exactly one device is
#                                 paired.
#   DEVELOPMENT_TEAM              Apple Team ID.       [2U53525V55]
#   BUNDLE_ID                     iOS bundle id.       [ai.humata.ConceptsOS]
#   SCHEME                        Xcode scheme.        [ConceptsOS]
#   PROJECT_DIR                   Path to .xcodeproj parent.
#                                 [<repo>/iOS/ConceptsOS]
#   DERIVED_DATA_DIR              Build output.
#                                 [~/Library/Developer/Xcode/DerivedData/
#                                  ConceptsOS-wifi-install]
#   APP_STORE_CONNECT_KEY_ID      [GM74A69PB6]
#   APP_STORE_CONNECT_ISSUER_ID   [77dc709e-01d8-4583-8730-d0b967d0d689]
#   APP_STORE_CONNECT_KEY_PATH    [~/.private_keys/AuthKey_${KEY_ID}.p8]
#   XCODE_APP                     [/Applications/Xcode-26.6.0.app]
#   NO_LAUNCH=1                   Install but don't launch.

set -euo pipefail

: "${DEVELOPMENT_TEAM:=2U53525V55}"
: "${BUNDLE_ID:=ai.humata.ConceptsOS}"
: "${SCHEME:=ConceptsOS}"
: "${APP_STORE_CONNECT_KEY_ID:=GM74A69PB6}"
: "${APP_STORE_CONNECT_ISSUER_ID:=77dc709e-01d8-4583-8730-d0b967d0d689}"
: "${APP_STORE_CONNECT_KEY_PATH:=$HOME/.private_keys/AuthKey_${APP_STORE_CONNECT_KEY_ID}.p8}"
: "${XCODE_APP:=/Applications/Xcode-26.6.0.app}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
: "${PROJECT_DIR:=$REPO_ROOT/iOS/ConceptsOS}"
: "${DERIVED_DATA_DIR:=$HOME/Library/Developer/Xcode/DerivedData/ConceptsOS-wifi-install}"

# 1. Pick device.
if [[ -z "${DEVICE_ID:-}" ]]; then
  echo "==> Auto-detecting paired device"
  mapfile -t IDS < <(xcrun devicectl list devices 2>/dev/null \
    | awk '/available/ && /paired/ {
        for (i=1;i<=NF;i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F-]+$/) print $i
      }' \
    | sort -u)
  if [[ ${#IDS[@]} -eq 0 ]]; then
    echo "FAIL: no paired iOS device found. Plug in via USB, tap Trust, and retry." >&2
    exit 2
  fi
  if [[ ${#IDS[@]} -gt 1 ]]; then
    echo "FAIL: multiple paired devices — set DEVICE_ID explicitly. Found:" >&2
    xcrun devicectl list devices | sed 's/^/  /' >&2
    exit 2
  fi
  DEVICE_ID="${IDS[0]}"
fi
echo "==> Using device: $DEVICE_ID"

# 2. Xcode 26 (needed for iOS 26 SDK).
sudo -n xcode-select --switch "$XCODE_APP" 2>/dev/null || true

# 3. Build.
cd "$PROJECT_DIR"
BUILD_LOG="$(mktemp -t conceptsos-build.XXXXXX.log)"
trap 'rm -f "$BUILD_LOG"' EXIT
echo "==> Building (Debug, iphoneos)"
set +e
xcodebuild \
  -project ConceptsOS.xcodeproj \
  -scheme "$SCHEME" \
  -configuration Debug \
  -sdk iphoneos \
  -destination "platform=iOS,id=${DEVICE_ID}" \
  -derivedDataPath "$DERIVED_DATA_DIR" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$APP_STORE_CONNECT_KEY_PATH" \
  -authenticationKeyID "$APP_STORE_CONNECT_KEY_ID" \
  -authenticationKeyIssuerID "$APP_STORE_CONNECT_ISSUER_ID" \
  DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" \
  build 2>&1 | tee "$BUILD_LOG" | tail -8
BUILD_RC=${PIPESTATUS[0]}
set -e

if [[ $BUILD_RC -ne 0 ]]; then
  if grep -q "isn't registered in your developer account" "$BUILD_LOG"; then
    UDID=$(grep -oE 'identifier "[0-9A-F-]+"' "$BUILD_LOG" | head -1 | sed -E 's/.*"([^"]+)".*/\1/')
    cat >&2 <<EOF

FAIL: Device UDID is not registered on the developer portal.
      Classic UDID from the build error: ${UDID:-<parse failed>}

Register it:
  DEVICE_UDID="$UDID" DEVICE_NAME="My iPhone" \\
    bash $SCRIPT_DIR/register-device.sh

Then re-run this script.
EOF
    exit 3
  fi
  echo "FAIL: build failed. Full log at $BUILD_LOG" >&2
  exit $BUILD_RC
fi

APP="$DERIVED_DATA_DIR/Build/Products/Debug-iphoneos/${SCHEME}.app"
[[ -d "$APP" ]] || { echo "FAIL: .app missing at $APP" >&2; exit 4; }

# 4. Install.
echo "==> Installing to device"
xcrun devicectl device install app --device "$DEVICE_ID" "$APP" | tail -8

# 5. Launch.
if [[ "${NO_LAUNCH:-0}" != "1" ]]; then
  echo "==> Launching $BUNDLE_ID"
  xcrun devicectl device process launch --device "$DEVICE_ID" "$BUNDLE_ID" | tail -3
fi

echo "==> DONE"
