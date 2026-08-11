# syntax=docker/dockerfile:1.7
#
# ConceptsOS-VM: the per-user pod image.
#
# What the pod actually serves:
#
#   /            → DesktopUI  (a Prozilla-OS-derived web desktop; static)
#   /agent/*     → AgentChat  (Next.js server; hosts the pi coding agent)
#
# Inside the container:
#
#   127.0.0.1:3050  Next.js (AgentChat) — bound to loopback only
#   0.0.0.0:3000    Caddy — serves DesktopUI static + reverse-proxies /agent/
#
# iOS opens `http://<pod>:3000/` → DesktopUI. The AI Agent app inside the
# desktop is an iframe pointing at `/agent/`, which caddy proxies to the
# Next.js server on the loopback. One port, one URL, one origin — makes
# WKWebView + WireGuard routing simple.
#
# CONCEPTSOS_WG selects how caddy binds:
#   external (default in our hosted deployment): caddy binds 0.0.0.0:3000,
#            the shared wg-gateway pod handles VPN termination outside.
#   embedded (self-hosters): wg-quick comes up first inside the container,
#            caddy binds the wg0 IP so only VPN peers can reach it.

# ---- 1. AgentChat (Next.js) build --------------------------------------
FROM node:22-bookworm-slim AS agentchat-deps
WORKDIR /app
COPY AgentChat/package.json AgentChat/package-lock.json ./
RUN npm install --no-audit --no-fund

FROM node:22-bookworm-slim AS agentchat-builder
WORKDIR /app
COPY --from=agentchat-deps /app/node_modules ./node_modules
COPY AgentChat/ ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- 2. DesktopUI (CRA static) build -----------------------------------
FROM node:22-bookworm-slim AS desktopui-deps
WORKDIR /app
COPY DesktopUI/package.json DesktopUI/package-lock.json ./
RUN npm install --no-audit --no-fund

FROM node:22-bookworm-slim AS desktopui-builder
WORKDIR /app
COPY --from=desktopui-deps /app/node_modules ./node_modules
COPY DesktopUI/ ./
# Serve at site root; the AI Agent iframe uses a relative /agent/ URL.
ENV CI=true \
    DISABLE_ESLINT_PLUGIN=true \
    PUBLIC_URL=/
RUN npm run build

# ---- 3. Runner ---------------------------------------------------------
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    AGENTCHAT_PORT=3050 \
    CONCEPTSOS_WG=external

# wireguard-tools is only used in embedded mode but adds ~5MB; harmless in
# external mode. `caddy` is our single-binary reverse proxy + static server.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        wireguard-tools iproute2 iptables procps tini ca-certificates \
        debian-keyring debian-archive-keyring apt-transport-https curl gnupg; \
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
        | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg; \
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
        > /etc/apt/sources.list.d/caddy-stable.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends caddy; \
    apt-get purge -y curl gnupg; apt-get autoremove -y; \
    rm -rf /var/lib/apt/lists/*

# Bake the pi CLI into the pod so users get a ready-to-use coding agent
# without needing to `npm i -g` on first login.
RUN npm install -g --no-audit --no-fund @earendil-works/pi-coding-agent@0.84.1

# Global pi extension that redirects the built-in Anthropic provider through
# our reverse proxy (see docker/pi-extensions/conceptsos-provider.ts). pi
# auto-discovers *.ts files under ~/.pi/agent/extensions/.
COPY docker/pi-extensions/conceptsos-provider.ts /root/.pi/agent/extensions/conceptsos-provider.ts

# AgentChat (Next.js standalone) — served on 127.0.0.1:3050.
COPY --from=agentchat-builder /app/.next/standalone ./
COPY --from=agentchat-builder /app/.next/static ./.next/static
COPY --from=agentchat-builder /app/public ./public

# DesktopUI (CRA static build) — served by caddy at /.
COPY --from=desktopui-builder /app/build /srv/desktopui

# Caddy config + entrypoint.
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# UDP :51820 is only used in embedded mode (self-hosters). Exposing it
# here is harmless in external mode — nothing binds to it.
EXPOSE 51820/udp
EXPOSE 3000/tcp

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
