#!/usr/bin/env bash
#
# ConceptsOS-VM entrypoint. Single Next.js process serves DesktopUI + AgentChat.
# CONCEPTSOS_WG picks the bind address:
#
#   external — hosted deployment. Bind 0.0.0.0:$PORT. wg-gateway pod
#              handles VPN termination outside this container.
#   embedded — self-hosters. Bring up wg0 from a mounted config, bind
#              the wg0 tunnel IP so only VPN peers can reach the app.

set -euo pipefail

log() { echo "[entrypoint $(date -u +%H:%M:%S)] $*" >&2; }

MODE="${CONCEPTSOS_WG:-external}"
PORT="${PORT:-3000}"

# ---- Persistent HOME ---------------------------------------------------
#
# The pod's PVC is mounted at /data (see api/src/lib/k8s.ts,
# volumeClaimTemplates "data"). Everything the pi coding agent and the
# AgentChat user care about lives under $HOME:
#
#   ~/.pi/agent/sessions/…    persisted chat history
#   ~/.pi/agent/extensions/…  user-installed pi extensions
#   ~/<anything>              files the agent writes with relative paths
#                             (AgentChat/src/lib/pi-server.ts sets
#                              cwd = homedir() for every session)
#   ~/.npm-global/…           user-installed CLI tools (`npm i -g foo`)
#
# Point HOME at /data/home so all of the above survives pod restarts.
# On first boot, seed it from the image's baked /root/ so the pre-
# installed pi extension (conceptsos-provider.ts) and any future skills
# we ship in the image are visible to CLI users.

PERSIST_HOME="/data/home"
SEED_MARKER="$PERSIST_HOME/.conceptsos-seeded"

if [[ -d /data ]]; then
  if [[ ! -f "$SEED_MARKER" ]]; then
    log "seeding persistent HOME at $PERSIST_HOME from /root"
    mkdir -p "$PERSIST_HOME"
    # -a preserves perms/symlinks; dotfiles included via /root/. trailing dot.
    cp -a /root/. "$PERSIST_HOME/" 2>/dev/null || true
    date -u +%FT%TZ > "$SEED_MARKER"
  else
    log "persistent HOME already seeded ($PERSIST_HOME)"
  fi
  export HOME="$PERSIST_HOME"
  cd "$HOME"

  # npm's global prefix — so `npm i -g foo` persists too. Prepending to
  # PATH lets user-installed CLIs shadow baked-in ones if they want.
  export NPM_CONFIG_PREFIX="$HOME/.npm-global"
  mkdir -p "$NPM_CONFIG_PREFIX/bin"
  export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
else
  log "WARNING: /data is not mounted — HOME will be ephemeral (/root)"
  log "         user files and pi sessions will NOT survive pod restart"
fi

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
