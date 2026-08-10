#!/usr/bin/env bash
#
# ConceptsOS-VM entrypoint. Branches on CONCEPTSOS_WG:
#
#   external — default in our hosted deployment. No wg in the container.
#              Bind Next.js to 0.0.0.0 on $PORT. The shared wg-gateway
#              handles VPN termination outside the pod.
#
#   embedded — self-hosters. Bring up wg0 from a mounted wg0.conf, then
#              bind Next.js to the wg0 tunnel IP so the app is only
#              reachable to authorized WireGuard peers.

set -euo pipefail

log() { echo "[entrypoint $(date -u +%H:%M:%S)] $*" >&2; }

MODE="${CONCEPTSOS_WG:-external}"
PORT="${PORT:-3000}"

case "$MODE" in
  external)
    log "wg mode: external (no in-container VPN)"
    export HOSTNAME="0.0.0.0"
    export PORT
    log "starting Next.js on ${HOSTNAME}:${PORT}"
    exec node /app/server.js
    ;;

  embedded)
    log "wg mode: embedded (in-container wg-quick)"
    SRC_CONF="${WG_CONF:-/etc/wireguard-src/wg0.conf}"
    DST_CONF="/etc/wireguard/wg0.conf"

    if [[ ! -f "$SRC_CONF" ]]; then
      log "no WireGuard config at $SRC_CONF"
      log "mount one at /etc/wireguard-src/wg0.conf (or set WG_CONF)"
      exit 1
    fi

    install -d -m 0700 /etc/wireguard
    install -m 0600 "$SRC_CONF" "$DST_CONF"

    log "bringing up wg0"
    wg-quick up wg0

    WG_IP=$(ip -4 addr show wg0 | awk '/inet /{print $2}' | cut -d/ -f1 | head -n1)
    if [[ -z "$WG_IP" ]]; then
      log "wg0 came up but has no IPv4 address"; exit 1
    fi
    log "wg0 = $WG_IP"

    export HOSTNAME="$WG_IP"
    export PORT
    log "starting Next.js on ${HOSTNAME}:${PORT}"

    trap 'log "shutting down"; wg-quick down wg0 2>/dev/null || true' EXIT
    exec node /app/server.js
    ;;

  *)
    log "unknown CONCEPTSOS_WG mode: $MODE (want external|embedded)"
    exit 1
    ;;
esac
