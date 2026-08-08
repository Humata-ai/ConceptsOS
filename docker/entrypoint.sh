#!/usr/bin/env bash
#
# Bring up wg0 from the config mounted at /etc/wireguard-src/wg0.conf
# (a k8s Secret projected read-only), then bind Next.js to the tunnel IP.

set -euo pipefail

log() { echo "[entrypoint $(date -u +%H:%M:%S)] $*" >&2; }

SRC_CONF="${WG_CONF:-/etc/wireguard-src/wg0.conf}"
DST_CONF="/etc/wireguard/wg0.conf"

if [[ ! -f "$SRC_CONF" ]]; then
  log "no WireGuard config at $SRC_CONF"
  log "run bin/wg-bootstrap.sh to generate one and create the k8s Secret"
  exit 1
fi

# wg-quick refuses world-readable configs and writes state next to the file,
# so copy the projected read-only Secret into a writable location first.
install -d -m 0700 /etc/wireguard
install -m 0600 "$SRC_CONF" "$DST_CONF"

log "bringing up wg0"
wg-quick up wg0

WG_IP=$(ip -4 addr show wg0 | awk '/inet /{print $2}' | cut -d/ -f1 | head -n1)
if [[ -z "$WG_IP" ]]; then
  log "wg0 came up but has no IPv4 address"; exit 1
fi
log "wg0 = $WG_IP"

# Bind Next.js to the tunnel IP so it is unreachable from anywhere but wg0 peers.
export HOSTNAME="$WG_IP"
export PORT="${PORT:-3000}"
log "starting Next.js on ${HOSTNAME}:${PORT}"

# Clean shutdown: tear the interface down on SIGTERM/EXIT so a rolling
# restart doesn't leave an orphaned wg0 in the pod's netns.
trap 'log "shutting down"; wg-quick down wg0 2>/dev/null || true' EXIT

exec node /app/server.js
