# syntax=docker/dockerfile:1.7
#
# ConceptsOS runtime image (NetBird-only, aka `v6-nb-only`).
#
# Legacy Headscale + Tailscale stacks were removed after the NetBird
# migration completed. See docs/netbird-migration.md.
#
# Rollback path (should we ever need to reintroduce the legacy stack):
# `git revert` this commit and the accompanying entrypoint/manifest
# deletions, then rebuild. History is preserved in git.

# --- deps: install node_modules for the Next.js app -------------------------
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY app/package.json ./
RUN npm install --no-audit --no-fund

# --- builder: build Next.js standalone output -------------------------------
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY app/ ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- runtime ---------------------------------------------------------------
FROM debian:bookworm-slim AS runner

# Pinned upstream version. Bump in a single commit so rollback is a
# single `git revert`.
ARG NETBIRD_VERSION=0.30.2
ARG TARGETARCH=amd64

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    STATE_DIR=/var/lib/conceptsos-vpn \
    VPN_MODE=netbird-node

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg iproute2 iptables jq tini procps; \
    # Node.js 20.x (nodesource)
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -; \
    apt-get install -y --no-install-recommends nodejs; \
    # NetBird client
    curl -fsSL -o /tmp/netbird.tar.gz \
        "https://github.com/netbirdio/netbird/releases/download/v${NETBIRD_VERSION}/netbird_${NETBIRD_VERSION}_linux_${TARGETARCH}.tar.gz"; \
    tar -xzf /tmp/netbird.tar.gz -C /usr/local/bin netbird; \
    rm -f /tmp/netbird.tar.gz; \
    chmod +x /usr/local/bin/netbird; \
    /usr/local/bin/netbird version; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Next.js standalone output: server.js + minimal node_modules
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Entrypoint
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
 && mkdir -p /var/lib/conceptsos-vpn/netbird /var/run/netbird

# NOTE: port 3000 (Next.js) is intentionally NOT exposed — the app is
# reachable only via the NetBird overlay (interface wt0). STUN/TURN
# lives in the coturn Deployment, not in this image.

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
