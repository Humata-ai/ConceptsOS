#!/usr/bin/env bash
#
# ConceptsOS-VM (dev) entrypoint.
#
# Runs both dev servers side-by-side in the pod:
#
#   DesktopUI (CRA)   → :3000   ← this is what the k8s readiness probe
#                                 and Ingress/wg-gateway hit
#   AgentChat (Next)  → :3050   ← DesktopUI's "AI Agent" tile links to
#                                 <same-host>:3050/chat (or via ingress)
#
# Prod (Dockerfile) collapses these into one Next.js standalone that
# serves DesktopUI as baked static content on :3000. In dev we want HMR
# on both, so we keep them as two processes.
#
# Signals: tini is PID 1. We start CRA in the background, Next.js in the
# foreground; when either exits the container exits so kubelet restarts
# the pod (matches prod semantics).

set -euo pipefail

log() { echo "[entrypoint.dev $(date -u +%H:%M:%S)] $*" >&2; }

REPO=/workspace/ConceptsOS

DESKTOP_PORT="${DESKTOP_PORT:-3000}"
AGENT_PORT="${AGENT_PORT:-3050}"

# CRA respects PORT/HOST. BROWSER=none stops it from trying to xdg-open.
# CI=true also silences the "browser opened" prompt and disables the
# interactive watcher hint.
log "starting DesktopUI (CRA) on 0.0.0.0:${DESKTOP_PORT}"
(
  cd "$REPO/DesktopUI"
  HOST=0.0.0.0 PORT="$DESKTOP_PORT" BROWSER=none CI=true \
    npm run dev
) &
DESKTOP_PID=$!

# If DesktopUI dies, kill the whole container so k8s restarts it.
trap 'log "shutting down (signal)"; kill 0' TERM INT

log "starting AgentChat (Next.js) on 0.0.0.0:${AGENT_PORT}"
(
  cd "$REPO/AgentChat"
  # AgentChat's `npm run dev` already binds 0.0.0.0:3050.
  exec npm run dev
) &
AGENT_PID=$!

# Wait for whichever exits first, then exit with its status so kubelet
# sees the crash and recreates the pod.
if wait -n "$DESKTOP_PID" "$AGENT_PID"; then
  status=0
else
  status=$?
fi
log "child exited with status ${status}; tearing down"
kill 0 2>/dev/null || true
exit "$status"
