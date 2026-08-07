#!/usr/bin/env bash
#
# ConceptsOS single-image entrypoint (NetBird-only).
#
# Mode ($VPN_MODE), default `netbird-node`:
#
#   netbird-node  — netbird agent + Next.js. Joins $NB_MANAGEMENT_URL with
#                   $NB_SETUP_KEY. Next.js binds to the NetBird WgIP on
#                   interface wt0.
#
# Admin passthrough:
#   docker run --rm image netbird status --json
#   docker run --rm image bash

set -euo pipefail

log() { echo "[entrypoint $(date -u +%H:%M:%S)] $*" >&2; }

if [[ $# -gt 0 ]]; then
  case "$1" in
    netbird|bash|sh|node)
      exec "$@"
      ;;
  esac
fi

MODE="${VPN_MODE:-netbird-node}"
STATE_DIR="${STATE_DIR:-/var/lib/conceptsos-vpn}"
NB_STATE="$STATE_DIR/netbird"
mkdir -p "$NB_STATE" /var/run/netbird
chmod 0700 "$NB_STATE" || true

log "VPN_MODE=$MODE"

start_netbird_agent() {
  : "${NB_MANAGEMENT_URL:?NB_MANAGEMENT_URL required in netbird-node mode}"
  : "${NB_SETUP_KEY:?NB_SETUP_KEY required in netbird-node mode}"

  # Enable v4 forwarding + tun.
  if [[ -c /dev/net/tun ]]; then
    sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true
  else
    log "WARN: /dev/net/tun missing; netbird will fall back to userspace"
  fi

  # netbird service daemon listens on this socket; the CLI talks to it.
  export NB_CONFIG="$NB_STATE/config.json"
  export NB_LOG_FILE="$NB_STATE/daemon.log"
  export NB_DAEMON_ADDR="unix://$NB_STATE/daemon.sock"

  log "starting netbird daemon (mgmt=$NB_MANAGEMENT_URL)"
  netbird service run \
    --config "$NB_CONFIG" \
    --daemon-addr "$NB_DAEMON_ADDR" \
    --log-file "$NB_LOG_FILE" \
    --log-level info &
  NBD_PID=$!

  # Wait for the daemon socket.
  for i in $(seq 1 30); do
    [[ -S "$NB_STATE/daemon.sock" ]] && break
    sleep 0.5
  done

  NB_HOSTNAME="${NB_HOSTNAME:-$(hostname)}"
  log "netbird up as '$NB_HOSTNAME'"
  netbird --daemon-addr "$NB_DAEMON_ADDR" up \
    --management-url "$NB_MANAGEMENT_URL" \
    --setup-key "$NB_SETUP_KEY" \
    --hostname "$NB_HOSTNAME"
}

start_next_on_nb_ip() {
  local wg_ip=""
  for i in $(seq 1 60); do
    wg_ip=$(netbird --daemon-addr "$NB_DAEMON_ADDR" status --json 2>/dev/null \
              | jq -r '.wgIP // .WgIP // empty')
    [[ -n "$wg_ip" && "$wg_ip" != "null" ]] && break
    sleep 1
  done
  if [[ -z "$wg_ip" ]]; then
    log "never got a NetBird WgIP; aborting"; exit 1
  fi
  log "netbird WgIP = $wg_ip — binding Next.js to it (port ${PORT:-3000})"
  export HOSTNAME="$wg_ip"
  export PORT="${PORT:-3000}"
  node /app/server.js &
  APP_PID=$!
}

case "$MODE" in
  netbird-node)
    start_netbird_agent
    start_next_on_nb_ip
    trap 'kill -TERM "$APP_PID" "$NBD_PID" 2>/dev/null || true' SIGTERM SIGINT
    while true; do
      for pid in "$NBD_PID" "$APP_PID"; do
        if ! kill -0 "$pid" 2>/dev/null; then
          log "child $pid exited; tearing down"
          kill -TERM "$APP_PID" "$NBD_PID" 2>/dev/null || true
          wait; exit 1
        fi
      done
      sleep 2
    done
    ;;

  *)
    log "unknown VPN_MODE=$MODE (only 'netbird-node' is supported)"
    exit 2
    ;;
esac
