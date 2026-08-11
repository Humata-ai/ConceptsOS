#!/usr/bin/env bash
#
# ConceptsOS-VM entrypoint.
#
# The pod runs two processes:
#
#   1. AgentChat (Next.js standalone)  →  127.0.0.1:$AGENTCHAT_PORT (3050)
#   2. Caddy                           →  $CADDY_BIND (:3000 or wg0-ip:3000)
#
# Caddy serves DesktopUI static at /, and reverse-proxies /agent/* to
# AgentChat. iOS opens http://<pod>:3000/ → the desktop shell, whose
# "AI Agent" app iframes /agent/ into a WKWebView-friendly single origin.
#
# CONCEPTSOS_WG branches only on caddy's bind address:
#
#   external — default in hosted deployment. Caddy binds :3000 on all
#              interfaces. wg-gateway pod terminates VPN outside.
#   embedded — self-hosters. wg-quick brings up wg0 from the mounted
#              config, caddy binds the wg0 IP so only VPN peers can
#              reach the pod.

set -euo pipefail

log() { echo "[entrypoint $(date -u +%H:%M:%S)] $*" >&2; }

MODE="${CONCEPTSOS_WG:-external}"
PORT="${PORT:-3000}"
AGENTCHAT_PORT="${AGENTCHAT_PORT:-3050}"

# Resolve caddy bind address per mode.
case "$MODE" in
  external)
    log "wg mode: external (no in-container VPN)"
    CADDY_BIND=":${PORT}"
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

    CADDY_BIND="${WG_IP}:${PORT}"
    trap 'log "shutting down"; wg-quick down wg0 2>/dev/null || true' EXIT
    ;;

  *)
    log "unknown CONCEPTSOS_WG mode: $MODE (want external|embedded)"
    exit 1
    ;;
esac

# 1. Start AgentChat on loopback in the background.
export HOSTNAME="127.0.0.1"
export PORT="$AGENTCHAT_PORT"
log "starting AgentChat (Next.js) on 127.0.0.1:${AGENTCHAT_PORT}"
node /app/server.js &
AGENTCHAT_PID=$!

# 2. Start caddy in the foreground (main process — tini reaps it).
export CADDY_BIND
export AGENTCHAT_UPSTREAM="127.0.0.1:${AGENTCHAT_PORT}"
log "starting caddy on ${CADDY_BIND} (proxying /agent/* → ${AGENTCHAT_UPSTREAM})"

# If AgentChat crashes we want the whole pod to restart, not silently
# serve DesktopUI with a broken /agent/. Kill caddy if the node child dies.
(
  wait "$AGENTCHAT_PID"
  rc=$?
  log "AgentChat exited (rc=$rc); shutting down caddy"
  pkill -TERM caddy 2>/dev/null || true
) &

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
