#!/usr/bin/env bash
#
# ConceptsOS single-image entrypoint.
#
# Boots, in order, inside ONE container:
#   1. headscale serve                       (control plane on :8080, DERP on :3478/udp)
#   2. tailscaled --tun=userspace-networking (data plane, userspace WireGuard)
#   3. tailscale up --login-server=http://127.0.0.1:8080 --authkey=<self-minted>
#   4. Next.js server, bound *only* to the tailnet IP (100.64.x.x)
#
# The Next.js app is therefore unreachable from the container's eth0 —
# the only way to reach it is to be a peer on the same headscale tailnet.

set -euo pipefail

log() { echo "[entrypoint $(date -u +%H:%M:%S)] $*" >&2; }

# --- Passthrough for admin commands ----------------------------------------
# `docker run --rm image headscale users list`  → run headscale directly
# `docker run --rm image tailscale status`      → run tailscale directly
if [[ $# -gt 0 ]]; then
  case "$1" in
    headscale|tailscale|tailscaled|bash|sh|node)
      exec "$@"
      ;;
  esac
fi

STATE_DIR="${STATE_DIR:-/var/lib/conceptsos-vpn}"
HS_STATE="$STATE_DIR/headscale"
TS_STATE="$STATE_DIR/tailscaled"
mkdir -p "$HS_STATE" "$TS_STATE" /var/run/tailscale
chmod 0700 "$HS_STATE" "$TS_STATE" || true

# --- Config knobs (with sensible defaults for the all-in-one case) ---------
export HEADSCALE_SERVER_URL="${HEADSCALE_SERVER_URL:-http://127.0.0.1:8080}"
export HEADSCALE_LISTEN_ADDR="${HEADSCALE_LISTEN_ADDR:-0.0.0.0:8080}"
export HEADSCALE_METRICS_ADDR="${HEADSCALE_METRICS_ADDR:-127.0.0.1:9090}"
export HEADSCALE_DB_PATH="${HEADSCALE_DB_PATH:-$HS_STATE/db.sqlite}"
export HEADSCALE_NOISE_KEY="${HEADSCALE_NOISE_KEY:-$HS_STATE/noise_private.key}"
export HEADSCALE_PRIVATE_KEY="${HEADSCALE_PRIVATE_KEY:-$HS_STATE/private.key}"

TS_HOSTNAME="${TS_HOSTNAME:-$(hostname)}"
TS_USER="${TS_USER:-default}"
APP_PORT="${PORT:-3000}"

# --- 1. Render headscale.yaml from template --------------------------------
mkdir -p /etc/conceptsos-vpn
envsubst < /etc/conceptsos-vpn/headscale.yaml.tmpl > /etc/conceptsos-vpn/headscale.yaml
log "rendered /etc/conceptsos-vpn/headscale.yaml"

# --- 2. Start headscale ----------------------------------------------------
log "starting headscale…"
headscale -c /etc/conceptsos-vpn/headscale.yaml serve &
HS_PID=$!

# Wait for /health
for i in $(seq 1 60); do
  if curl -fsS -m 1 "http://127.0.0.1:8080/health" >/dev/null 2>&1; then
    log "headscale healthy after ${i}s"
    break
  fi
  if ! kill -0 "$HS_PID" 2>/dev/null; then
    log "headscale exited before becoming healthy"; exit 1
  fi
  sleep 1
done

# --- 3. Ensure default user + mint a preauth key for ourselves -------------
if ! headscale -c /etc/conceptsos-vpn/headscale.yaml users list -o json | jq -e ".[] | select(.name==\"$TS_USER\")" >/dev/null 2>&1; then
  log "creating headscale user '$TS_USER'"
  headscale -c /etc/conceptsos-vpn/headscale.yaml users create "$TS_USER"
fi

log "minting preauth key for self…"
SELF_AUTHKEY=$(headscale -c /etc/conceptsos-vpn/headscale.yaml preauthkeys create \
    -u "$TS_USER" --reusable=false --ephemeral=false -e 1h -o json \
  | jq -r '.key')
if [[ -z "$SELF_AUTHKEY" || "$SELF_AUTHKEY" == "null" ]]; then
  log "failed to mint preauth key"; exit 1
fi

# --- 4. Start tailscaled ---------------------------------------------------
# Prefer a real TUN interface so the app can bind() to the tailnet IP.
# Falls back to userspace-networking if /dev/net/tun isn't available (in
# which case Next.js will need `tailscale serve` — not covered here).
TUN_MODE="userspace-networking"
if [[ -c /dev/net/tun ]] && ip tuntap add mode tun name ts-probe 2>/dev/null; then
  ip tuntap del mode tun name ts-probe 2>/dev/null || true
  TUN_MODE="tailscale0"
  # forwarding is required if we ever advertise routes; harmless otherwise.
  sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true
  sysctl -w net.ipv6.conf.all.forwarding=1 >/dev/null 2>&1 || true
fi
log "starting tailscaled (tun=$TUN_MODE)"
tailscaled \
  --state="$TS_STATE/state.json" \
  --socket=/var/run/tailscale/tailscaled.sock \
  --tun="$TUN_MODE" \
  --port=41641 &
TSD_PID=$!

# Wait for the socket
for i in $(seq 1 30); do
  [[ -S /var/run/tailscale/tailscaled.sock ]] && break
  sleep 0.5
done

# --- 5. tailscale up (join our own tailnet) --------------------------------
log "joining self tailnet as '$TS_HOSTNAME'…"
tailscale up \
  --login-server="http://127.0.0.1:8080" \
  --authkey="$SELF_AUTHKEY" \
  --hostname="$TS_HOSTNAME" \
  --accept-dns=false \
  --reset

# --- 6. Discover our tailnet IP and start Next.js bound to it --------------
TS_IP=""
for i in $(seq 1 30); do
  TS_IP=$(tailscale ip -4 2>/dev/null | head -n1 || true)
  [[ -n "$TS_IP" ]] && break
  sleep 1
done
if [[ -z "$TS_IP" ]]; then
  log "never got a tailnet IP; aborting"; exit 1
fi
log "tailnet IP = $TS_IP — binding Next.js to it (port $APP_PORT)"

# HOSTNAME env is honoured by Next.js standalone server.js
export HOSTNAME="$TS_IP"
export PORT="$APP_PORT"

node /app/server.js &
APP_PID=$!

log "all-in-one up: headscale=$HS_PID tailscaled=$TSD_PID next=$APP_PID"

# --- 7. Propagate signals + wait -------------------------------------------
term() {
  log "SIGTERM received, shutting down"
  kill -TERM "$APP_PID" "$TSD_PID" "$HS_PID" 2>/dev/null || true
}
trap term SIGTERM SIGINT

# Exit when any of the three dies
while true; do
  for pid in "$HS_PID" "$TSD_PID" "$APP_PID"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      log "child $pid exited; tearing down"
      kill -TERM "$APP_PID" "$TSD_PID" "$HS_PID" 2>/dev/null || true
      wait
      exit 1
    fi
  done
  sleep 2
done
