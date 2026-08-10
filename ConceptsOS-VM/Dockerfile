# syntax=docker/dockerfile:1.7
#
# ConceptsOS: Next.js app + WireGuard endpoint in a single container.
#
# The app binds to the WireGuard tunnel IP (10.10.0.1) — it is NOT
# reachable from the public internet. The only public port on the pod
# is UDP :51820 (WireGuard). Peers who have imported a client .conf
# reach the app at http://10.10.0.1:${PORT} (or on any other port the
# app binds to the tunnel interface).

# --- deps: install node_modules ---------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# `npm ci` doesn't work here: @earendil-works/pi-coding-agent ships its own
# npm-shrinkwrap.json, and its nested entries in the root lockfile lack
# `resolved`/`integrity` fields (they're provided by the child shrinkwrap at
# install time). `npm install` handles that composition correctly.
COPY AgentChat/package.json AgentChat/package-lock.json ./
RUN npm install --no-audit --no-fund

# --- builder: build Next.js standalone output -------------------------------
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY AgentChat/ ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- runtime: node + wireguard-tools ----------------------------------------
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        wireguard-tools iproute2 iptables procps tini ca-certificates; \
    rm -rf /var/lib/apt/lists/*

# Next.js standalone output: server.js + minimal node_modules
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Entrypoint: bring wg0 up, then exec the Next.js server bound to the tunnel IP.
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Only 51820/udp is meant to be exposed publicly; the Next.js port is
# bound to wg0 and never touches the public interface.
EXPOSE 51820/udp

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
