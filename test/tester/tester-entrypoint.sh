#!/usr/bin/env bash
set -euo pipefail

log() { echo "[tester $(date -u +%H:%M:%S)] $*" >&2; }

if [[ "${JOIN_TAILNET:-false}" != "true" ]]; then
  log "JOIN_TAILNET=false — staying off the tailnet, sleeping"
  exec sleep infinity
fi

: "${HEADSCALE_URL:?HEADSCALE_URL required for inside-tester}"
: "${TS_AUTHKEY:?TS_AUTHKEY required for inside-tester}"
TS_HOSTNAME="${TS_HOSTNAME:-tester-$(hostname)}"

TUN_MODE="userspace-networking"
if [[ -c /dev/net/tun ]] && ip tuntap add mode tun name ts-probe 2>/dev/null; then
  ip tuntap del mode tun name ts-probe 2>/dev/null || true
  TUN_MODE="tailscale0"
fi
log "starting tailscaled (tun=$TUN_MODE)"
tailscaled \
  --state=/var/lib/tailscale/state.json \
  --socket=/var/run/tailscale/tailscaled.sock \
  --tun="$TUN_MODE" \
  --port=41641 &
TSD_PID=$!

for i in $(seq 1 30); do
  [[ -S /var/run/tailscale/tailscaled.sock ]] && break
  sleep 0.5
done

log "tailscale up → $HEADSCALE_URL as $TS_HOSTNAME"
tailscale up \
  --login-server="$HEADSCALE_URL" \
  --authkey="$TS_AUTHKEY" \
  --hostname="$TS_HOSTNAME" \
  --accept-dns=false \
  --reset

log "joined tailnet:"
tailscale ip -4 || true
tailscale status || true

wait "$TSD_PID"
