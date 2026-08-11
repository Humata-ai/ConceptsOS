# syntax=docker/dockerfile:1.7
#
# ConceptsOS-VM: the per-user pod image.
#
# Runs the AgentChat Next.js app (with the pi coding agent inside it). The
# same image serves two topologies:
#
#   CONCEPTSOS_WG=external   (default in our hosted deployment)
#     No WireGuard in the container. Next.js binds to 0.0.0.0:3000. Traffic
#     reaches the pod via a ClusterIP Service; the shared wg-gateway pod
#     handles all VPN termination. This is the mode our GKE cluster uses.
#
#   CONCEPTSOS_WG=embedded   (self-hosters)
#     Runs wg-quick inside the container against a mounted wg0.conf, then
#     binds Next.js to the wg0 IP so the app is only reachable via VPN.
#     This is the original single-tenant model.
#
# Set the mode via the CONCEPTSOS_WG env var. The entrypoint branches on it.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY AgentChat/package.json AgentChat/package-lock.json ./
RUN npm install --no-audit --no-fund

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY AgentChat/ ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

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
# without needing to `npm i -g` on first login.
RUN npm install -g --no-audit --no-fund @earendil-works/pi-coding-agent@0.84.1

# Global pi extension that redirects the built-in Anthropic provider through
# our reverse proxy (see docker/pi-extensions/anthropic-proxy.ts). pi
# auto-discovers *.ts files under ~/.pi/agent/extensions/.
COPY docker/pi-extensions/anthropic-proxy.ts /root/.pi/agent/extensions/anthropic-proxy.ts

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# UDP :51820 is only used in embedded mode (self-hosters). Exposing it
# here is harmless in external mode — nothing binds to it.
EXPOSE 51820/udp
EXPOSE 3000/tcp

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
