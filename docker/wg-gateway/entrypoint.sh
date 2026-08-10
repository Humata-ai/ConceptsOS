#!/usr/bin/env bash
#
# wg-gateway entrypoint.
#
# 1. Ensure /var/lib/wg-gateway (the persistent volume mount) contains a
#    server keypair. Generate one on first boot.
# 2. Write /etc/wireguard/wg0.conf with no peers (peers are added at
#    runtime by the admin server via `wg set`).
# 3. Bring wg0 up.
# 4. Enable IP forwarding + baseline iptables rules.
# 5. Start the Node admin server on :8080.

set -euo pipefail

log() { echo "[wg-gateway $(date -u +%H:%M:%S)] $*" >&2; }

STATE_DIR="${WG_STATE_DIR:-/var/lib/wg-gateway}"
mkdir -p "$STATE_DIR"
chmod 0700 "$STATE_DIR"

if [[ ! -f "$STATE_DIR/server.key" ]]; then
  log "generating new server keypair in $STATE_DIR"
  umask 077
  wg genkey | tee "$STATE_DIR/server.key" | wg pubkey > "$STATE_DIR/server.pub"
fi

SERVER_PRIV=$(cat "$STATE_DIR/server.key")
SERVER_PUB=$(cat "$STATE_DIR/server.pub")
log "server pubkey: $SERVER_PUB"

SUBNET="${WG_CLIENT_SUBNET:-10.10.0.0/16}"
GATEWAY_ADDR="${WG_GATEWAY_ADDR:-10.10.0.1/16}"

install -d -m 0700 /etc/wireguard
cat > /etc/wireguard/wg0.conf <<EOF
[Interface]
Address = ${GATEWAY_ADDR}
ListenPort = 51820
PrivateKey = ${SERVER_PRIV}
# Peers are added at runtime via \`wg set\` by the admin server.
EOF
chmod 0600 /etc/wireguard/wg0.conf

log "bringing up wg0"
# If a previous container in this pod's netns left wg0 behind, wg-quick
# will refuse to re-add it. Tear it down first; swallow errors.
wg-quick down wg0 2>/dev/null || true
ip link delete wg0 2>/dev/null || true
wg-quick up wg0

log "enabling IPv4 forwarding + baseline NAT"
sysctl -w net.ipv4.ip_forward=1 >/dev/null
# Outgoing traffic from the tunnel subnet (return path from user pods) will
# come back to us via the pod cluster network. MASQUERADE so pods see us as
# the source and reply to us.
iptables -t nat -C POSTROUTING -s "$SUBNET" -o eth0 -j MASQUERADE 2>/dev/null \
  || iptables -t nat -A POSTROUTING -s "$SUBNET" -o eth0 -j MASQUERADE

log "starting admin server on :8080"
export WG_SERVER_PUBKEY="$SERVER_PUB"
export WG_STATE_DIR="$STATE_DIR"

trap 'log "shutting down"; wg-quick down wg0 2>/dev/null || true' EXIT

exec node /app/src/server.js
