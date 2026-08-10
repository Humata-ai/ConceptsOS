#!/usr/bin/env bash
# Register an iOS device UDID with our Apple Developer account via the
# App Store Connect API. Needed once per phone before dev-signed builds
# will install on it (see wifi-install.sh).
#
# Usage:
#   DEVICE_UDID=00008150-XXXXXXXXXXXXXX \
#   DEVICE_NAME="Dan iPhone 17 Pro Max" \
#     bash iOS/scripts/register-device.sh
#
# How to find the UDID:
#   - Easiest: run wifi-install.sh once; on failure it prints the UDID
#     parsed from the "isn't registered" error.
#   - Or: `xcrun devicectl list devices` gives the *coredevice* id
#     (GUID form) — NOT what we want here. We need the classic UDID
#     that appears in Xcode's device picker error text.
#   - Or, with the phone plugged in:
#       system_profiler SPUSBDataType | awk '/iPhone:/,/Serial/ {print}'
#     The Serial Number is the classic UDID (24-char, no dashes on
#     modern phones — insert a dash after the 8th char to get the
#     Apple-portal form).
#
# Environment overrides (all optional):
#   APP_STORE_CONNECT_KEY_ID      [GM74A69PB6]
#   APP_STORE_CONNECT_ISSUER_ID   [77dc709e-01d8-4583-8730-d0b967d0d689]
#   APP_STORE_CONNECT_KEY_PATH    [~/.private_keys/AuthKey_${KEY_ID}.p8]

set -euo pipefail

: "${DEVICE_UDID:?DEVICE_UDID is required, e.g. 00008150-001269083A6A401C}"
: "${DEVICE_NAME:=iPhone}"
: "${APP_STORE_CONNECT_KEY_ID:=GM74A69PB6}"
: "${APP_STORE_CONNECT_ISSUER_ID:=77dc709e-01d8-4583-8730-d0b967d0d689}"
: "${APP_STORE_CONNECT_KEY_PATH:=$HOME/.private_keys/AuthKey_${APP_STORE_CONNECT_KEY_ID}.p8}"

[[ -f "$APP_STORE_CONNECT_KEY_PATH" ]] || {
  echo "FAIL: private key not found at $APP_STORE_CONNECT_KEY_PATH" >&2
  exit 2
}

# Mint a short-lived ES256 JWT for the ASC API.
NOW=$(date +%s)
EXP=$((NOW + 900))
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
HEADER=$(printf '{"alg":"ES256","kid":"%s","typ":"JWT"}' "$APP_STORE_CONNECT_KEY_ID" | b64url)
PAYLOAD=$(printf '{"iss":"%s","iat":%d,"exp":%d,"aud":"appstoreconnect-v1"}' \
  "$APP_STORE_CONNECT_ISSUER_ID" "$NOW" "$EXP" | b64url)
SIG=$(printf '%s' "${HEADER}.${PAYLOAD}" \
  | openssl dgst -sha256 -sign "$APP_STORE_CONNECT_KEY_PATH" \
  | openssl asn1parse -inform DER \
  | awk -F: '/INTEGER/{gsub(":","",$4); printf "%s", $4}' \
  | tr 'a-f' 'A-F' \
  | xxd -r -p \
  | b64url)
JWT="${HEADER}.${PAYLOAD}.${SIG}"

echo "==> Registering '$DEVICE_NAME' → $DEVICE_UDID"
RESP=$(curl -sS -w '\n%{http_code}' -X POST https://api.appstoreconnect.apple.com/v1/devices \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"data":{"type":"devices","attributes":{"name":"%s","platform":"IOS","udid":"%s"}}}' \
        "$DEVICE_NAME" "$DEVICE_UDID")")
CODE=$(echo "$RESP" | tail -n1)
BODY=$(echo "$RESP" | sed '$d')
echo "$BODY"
if [[ "$CODE" =~ ^2 ]]; then
  echo "==> OK (HTTP $CODE) — now re-run wifi-install.sh"
else
  echo "FAIL: HTTP $CODE" >&2
  exit 3
fi
