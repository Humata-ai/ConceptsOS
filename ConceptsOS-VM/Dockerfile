# syntax=docker/dockerfile:1.7
#
# ConceptsOS-VM: the per-user pod image.
#
# One process, one origin. AgentChat (Next.js) serves everything:
#
#   /             → DesktopUI static (Prozilla-OS-derived CRA build baked
#                   into AgentChat/public/ at build time; rewritten via
#                   src/middleware.ts).
#   /chat         → AgentChat's own UI (src/app/chat/page.tsx).
#   /api/*        → AgentChat API routes (sessions, chat SSE, abort).
#   /static/*, favicon, manifest, images → public/ passthrough.
#
# CONCEPTSOS_WG selects binding:
#   external (hosted): Next.js binds 0.0.0.0:3000; shared wg-gateway pod
#                      handles VPN termination outside the pod.
#   embedded (self-hosters): wg-quick up wg0, Next.js binds the wg0 IP so
#                      only VPN peers reach it.

# ---- 1. DesktopUI (CRA static) build ----------------------------------
FROM node:22-bookworm-slim AS desktopui-deps
WORKDIR /app
COPY DesktopUI/package.json DesktopUI/package-lock.json ./
RUN npm install --no-audit --no-fund

FROM node:22-bookworm-slim AS desktopui-builder
WORKDIR /app
COPY --from=desktopui-deps /app/node_modules ./node_modules
COPY DesktopUI/ ./
# Serve at site root; AI Agent tile uses an absolute /chat URL.
ENV CI=true \
    DISABLE_ESLINT_PLUGIN=true \
    PUBLIC_URL=/
RUN npm run build

# ---- 2. AgentChat (Next.js) build --------------------------------------
FROM node:22-bookworm-slim AS agentchat-deps
WORKDIR /app
COPY AgentChat/package.json AgentChat/package-lock.json ./
RUN npm install --no-audit --no-fund

FROM node:22-bookworm-slim AS agentchat-builder
WORKDIR /app
COPY --from=agentchat-deps /app/node_modules ./node_modules
COPY AgentChat/ ./
# Drop DesktopUI's built output into AgentChat's public/ before `next
# build` so Next takes them along in its output-standalone tree. index.html
# is served on / via src/middleware.ts (rewrites / → /index.html).
COPY --from=desktopui-builder /app/build/ ./public/
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- 3. Runner ---------------------------------------------------------
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    CONCEPTSOS_WG=external

# wireguard-tools is only used in embedded mode but adds ~5MB; harmless in
# external mode.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        wireguard-tools iproute2 iptables procps tini ca-certificates; \
    rm -rf /var/lib/apt/lists/*

# Bake the pi CLI into the pod so users get a ready-to-use coding agent
# in-terminal if they want it, without needing to `npm i -g` on first login.
# (AgentChat itself uses the SDK, not the CLI.)
RUN npm install -g --no-audit --no-fund @earendil-works/pi-coding-agent@0.84.1

# Global pi extension that redirects the built-in Anthropic provider through
# our reverse proxy for CLI users (see docker/pi-extensions/conceptsos-
# provider.ts). AgentChat's SDK path applies the same rewiring in-process
# via AgentChat/src/lib/pi-server.ts:getModelRuntime() — the SDK API doesn't
# consume extension provider registrations, so we can't rely on this file
# alone.
COPY docker/pi-extensions/conceptsos-provider.ts /root/.pi/agent/extensions/conceptsos-provider.ts

COPY --from=agentchat-builder /app/.next/standalone ./
COPY --from=agentchat-builder /app/.next/static ./.next/static
COPY --from=agentchat-builder /app/public ./public

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# UDP :51820 is only used in embedded mode (self-hosters). Exposing it
# here is harmless in external mode — nothing binds to it.
EXPOSE 51820/udp
EXPOSE 3000/tcp

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
