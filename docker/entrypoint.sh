#!/usr/bin/env bash
#
# ConceptsOS single-image entrypoint.
#
# The image supports THREE modes, selected by $VPN_MODE:
#
#   control    — headscale only (multi-tenant control plane).
#                Terminates TLS via Let's Encrypt; exposes :80 (ACME) + :443.
#                No tailscaled, no app.
#
#   node       — tailscaled + Next.js app, joined to an *external* headscale
#                specified by $HEADSCALE_SERVER_URL using $TS_AUTHKEY.
#                Next.js binds to the tailnet IP; unreachable outside the tailnet.
#                No headscale, no cert.
#
#   all-in-one — everything in one container (default). Boots headscale,
#                self-registers a tailscaled, runs the app. Useful for demos
#                and single-tenant / air-gapped installs.
#
# Passthrough for admin commands:
#   `docker run --rm image headscale users list`
# still works in any mode.

set -euo pipefail

log() { echo "[entrypoint $(date -u +%H:%M:%S)] $*" >&2; }

if [[ $# -gt 0 ]]; then
  case "$1" in
    headscale|tailscale|tailscaled|bash|sh|node)
      exec "$@"
      ;;
  esac
fi

MODE="${VPN_MODE:-all-in-one}"
STATE_DIR="${STATE_DIR:-/var/lib/conceptsos-vpn}"
HS_STATE="$STATE_DIR/headscale"
TS_STATE="$STATE_DIR/tailscaled"
mkdir -p "$HS_STATE" "$TS_STATE" /var/run/tailscale
chmod 0700 "$HS_STATE" "$TS_STATE" || true

log "VPN_MODE=$MODE"

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

render_headscale_config() {
  export HEADSCALE_SERVER_URL="${HEADSCALE_SERVER_URL:-http://127.0.0.1:8080}"
  export HEADSCALE_METRICS_ADDR="${HEADSCALE_METRICS_ADDR:-127.0.0.1:9090}"
  export HEADSCALE_DB_PATH="${HEADSCALE_DB_PATH:-$HS_STATE/db.sqlite}"
  export HEADSCALE_NOISE_KEY="${HEADSCALE_NOISE_KEY:-$HS_STATE/noise_private.key}"
  export HEADSCALE_PRIVATE_KEY="${HEADSCALE_PRIVATE_KEY:-$HS_STATE/private.key}"
  export HEADSCALE_DERP_KEY="${HEADSCALE_DERP_KEY:-$HS_STATE/derp_server_private.key}"
  export HEADSCALE_TLS_LETSENCRYPT_HOSTNAME="${HEADSCALE_TLS_LETSENCRYPT_HOSTNAME:-}"
  export HEADSCALE_TLS_CACHE_DIR="${HEADSCALE_TLS_CACHE_DIR:-$HS_STATE/cache}"
  export HEADSCALE_TLS_CHALLENGE_TYPE="${HEADSCALE_TLS_CHALLENGE_TYPE:-HTTP-01}"
  export HEADSCALE_TLS_CERT_PATH="${HEADSCALE_TLS_CERT_PATH:-}"
  export HEADSCALE_TLS_KEY_PATH="${HEADSCALE_TLS_KEY_PATH:-}"
  export HEADSCALE_ACME_HTTP_PORT="${HEADSCALE_ACME_HTTP_PORT:-80}"
  export HEADSCALE_BASE_DOMAIN="${HEADSCALE_BASE_DOMAIN:-ts.local}"

  if [[ -n "$HEADSCALE_TLS_LETSENCRYPT_HOSTNAME" || -n "$HEADSCALE_TLS_CERT_PATH" ]]; then
    export HEADSCALE_LISTEN_ADDR="${HEADSCALE_LISTEN_ADDR:-0.0.0.0:443}"
  else
    export HEADSCALE_LISTEN_ADDR="${HEADSCALE_LISTEN_ADDR:-0.0.0.0:8080}"
  fi
  mkdir -p "$HEADSCALE_TLS_CACHE_DIR"

  mkdir -p /etc/conceptsos-vpn
  envsubst < /etc/conceptsos-vpn/headscale.yaml.tmpl > /etc/conceptsos-vpn/headscale.yaml
  log "rendered /etc/conceptsos-vpn/headscale.yaml"
}

start_tailscaled() {
  local tun_mode="userspace-networking"
  if [[ -c /dev/net/tun ]] && ip tuntap add mode tun name ts-probe 2>/dev/null; then
    ip tuntap del mode tun name ts-probe 2>/dev/null || true
    tun_mode="tailscale0"
    sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true
    sysctl -w net.ipv6.conf.all.forwarding=1 >/dev/null 2>&1 || true
  fi
  log "starting tailscaled (tun=$tun_mode)"
  tailscaled \
    --state="$TS_STATE/state.json" \
    --socket=/var/run/tailscale/tailscaled.sock \
    --tun="$tun_mode" \
    --port=41641 &
  TSD_PID=$!
  for i in $(seq 1 30); do
    [[ -S /var/run/tailscale/tailscaled.sock ]] && break
    sleep 0.5
  done
}

start_next_on_ts_ip() {
  local ts_ip=""
  for i in $(seq 1 60); do
    ts_ip=$(tailscale ip -4 2>/dev/null | head -n1 || true)
    [[ -n "$ts_ip" ]] && break
    sleep 1
  done
  if [[ -z "$ts_ip" ]]; then
    log "never got a tailnet IP; aborting"; exit 1
  fi
  log "tailnet IP = $ts_ip — binding Next.js to it (port ${PORT:-3000})"
  export HOSTNAME="$ts_ip"
  export PORT="${PORT:-3000}"
  node /app/server.js &
  APP_PID=$!
}

# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------

case "$MODE" in

  control)
    render_headscale_config
    log "starting headscale (control plane)"
    exec headscale -c /etc/conceptsos-vpn/headscale.yaml serve
    ;;

  node)
    : "${HEADSCALE_SERVER_URL:?HEADSCALE_SERVER_URL required in node mode}"
    : "${TS_AUTHKEY:?TS_AUTHKEY required in node mode}"
    TS_HOSTNAME="${TS_HOSTNAME:-$(hostname)}"
    start_tailscaled
    log "joining $HEADSCALE_SERVER_URL as '$TS_HOSTNAME'"
    tailscale up \
      --login-server="$HEADSCALE_SERVER_URL" \
      --authkey="$TS_AUTHKEY" \
      --hostname="$TS_HOSTNAME" \
      --accept-dns=true \
      --reset
    start_next_on_ts_ip
    trap 'kill -TERM "$APP_PID" "$TSD_PID" 2>/dev/null || true' SIGTERM SIGINT
    while true; do
      for pid in "$TSD_PID" "$APP_PID"; do
        if ! kill -0 "$pid" 2>/dev/null; then
          log "child $pid exited; tearing down"
          kill -TERM "$APP_PID" "$TSD_PID" 2>/dev/null || true
          wait; exit 1
        fi
      done
      sleep 2
    done
    ;;

  all-in-one)
    render_headscale_config
    log "starting headscale…"
    headscale -c /etc/conceptsos-vpn/headscale.yaml serve &
    HS_PID=$!

    HEALTH_URL="http://127.0.0.1:8080/health"
    SELF_LOGIN_URL="http://127.0.0.1:8080"
    if [[ -n "${HEADSCALE_TLS_LETSENCRYPT_HOSTNAME:-}" || -n "${HEADSCALE_TLS_CERT_PATH:-}" ]]; then
      HEALTH_URL="https://127.0.0.1/health"
      SELF_LOGIN_URL="$HEADSCALE_SERVER_URL"
    fi
    for i in $(seq 1 120); do
      if curl -fsS -k -m 2 "$HEALTH_URL" >/dev/null 2>&1; then
        log "headscale healthy after ${i}s"
        break
      fi
      if ! kill -0 "$HS_PID" 2>/dev/null; then
        log "headscale exited before becoming healthy"; exit 1
      fi
      sleep 1
    done

    TS_USER="${TS_USER:-default}"
    TS_HOSTNAME="${TS_HOSTNAME:-$(hostname)}"
    if ! headscale -c /etc/conceptsos-vpn/headscale.yaml users list -o json | jq -e ".[] | select(.name==\"$TS_USER\")" >/dev/null 2>&1; then
      headscale -c /etc/conceptsos-vpn/headscale.yaml users create "$TS_USER"
    fi
    SELF_AUTHKEY=$(headscale -c /etc/conceptsos-vpn/headscale.yaml preauthkeys create \
        -u "$TS_USER" --reusable=false --ephemeral=false -e 1h -o json | jq -r '.key')
    start_tailscaled
    tailscale up \
      --login-server="$SELF_LOGIN_URL" \
      --authkey="$SELF_AUTHKEY" \
      --hostname="$TS_HOSTNAME" \
      --accept-dns=true \
      --reset
    start_next_on_ts_ip
    trap 'kill -TERM "$APP_PID" "$TSD_PID" "$HS_PID" 2>/dev/null || true' SIGTERM SIGINT
    while true; do
      for pid in "$HS_PID" "$TSD_PID" "$APP_PID"; do
        if ! kill -0 "$pid" 2>/dev/null; then
          log "child $pid exited; tearing down"
          kill -TERM "$APP_PID" "$TSD_PID" "$HS_PID" 2>/dev/null || true
          wait; exit 1
        fi
      done
      sleep 2
    done
    ;;

  *)
    log "unknown VPN_MODE=$MODE (want control|node|all-in-one)"
    exit 2
    ;;
esac
