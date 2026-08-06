# syntax=docker/dockerfile:1.7
#
# ConceptsOS: single Debian image running Headscale + Tailscale + the Next.js
# app in one container. The Next.js app binds only to the tailnet interface,
# so it is reachable *only* by peers that have joined this container's tailnet.
#
# See: notes/GTD/projects/active_projects/ConceptsOS/tailscale_headscale_single_image_design.md

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

# --- runtime: single Debian image with headscale + tailscale + node ---------
FROM debian:bookworm-slim AS runner

ARG HEADSCALE_VERSION=0.23.0
ARG TARGETARCH=amd64

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    STATE_DIR=/var/lib/conceptsos-vpn

# Base packages, Node.js runtime, tailscale apt repo, headscale .deb.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg iproute2 iptables jq tini gettext-base procps; \
    # Node.js 20.x (nodesource)
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -; \
    apt-get install -y --no-install-recommends nodejs; \
    # Tailscale
    curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.noarmor.gpg \
        -o /usr/share/keyrings/tailscale-archive-keyring.gpg; \
    curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.tailscale-keyring.list \
        -o /etc/apt/sources.list.d/tailscale.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends tailscale; \
    # Headscale (.deb from upstream releases)
    curl -fsSL -o /tmp/headscale.deb \
        "https://github.com/juanfont/headscale/releases/download/v${HEADSCALE_VERSION}/headscale_${HEADSCALE_VERSION}_linux_${TARGETARCH}.deb"; \
    dpkg -i /tmp/headscale.deb; \
    rm -f /tmp/headscale.deb; \
    # Cleanup
    apt-get clean; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Next.js standalone output: server.js + minimal node_modules
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Entrypoint + headscale config template
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY docker/headscale.yaml.tmpl /etc/conceptsos-vpn/headscale.yaml.tmpl
RUN chmod +x /usr/local/bin/entrypoint.sh \
 && mkdir -p /var/lib/conceptsos-vpn/headscale /var/lib/conceptsos-vpn/tailscaled /var/run/tailscale

# Headscale HTTP(S) API + ACME challenge + embedded DERP STUN
EXPOSE 80 443 8080 3478/udp
# NOTE: port 3000 (Next.js) is intentionally NOT exposed — the app is
# reachable only via the tailnet.

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
