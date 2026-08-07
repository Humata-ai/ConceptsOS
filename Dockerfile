# syntax=docker/dockerfile:1.7
#
# ConceptsOS runtime image.
#
# Tagged variants:
#   v4        : headscale + tailscale + Next.js (legacy, in production today).
#   v5-nb     : headscale + tailscale + NetBird + Next.js — DUAL stack for
#               the parallel-overlay pilot (P0/P1 of the NetBird migration).
#   v6-nb-only: NetBird + Next.js only (P3 decommission; Tailscale + Headscale
#               removed).
#
# The variant is chosen at CI build time via --build-arg VARIANT=v5-nb (etc).
# See docs/netbird-migration.md.
#
# Legacy docs: notes/GTD/projects/active_projects/ConceptsOS/tailscale_headscale_single_image_design.md

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

# Pinned upstream versions. Bump these together in a single commit so
# rollback is a single `git revert`.
ARG HEADSCALE_VERSION=0.23.0
ARG NETBIRD_VERSION=0.30.2
ARG TARGETARCH=amd64

# Which VPN stacks to install. Default is v5-nb (dual). CI overrides for
# v4 and v6-nb-only builds.
#   INSTALL_TAILSCALE={true,false}
#   INSTALL_HEADSCALE={true,false}
#   INSTALL_NETBIRD  ={true,false}
ARG INSTALL_TAILSCALE=true
ARG INSTALL_HEADSCALE=true
ARG INSTALL_NETBIRD=true

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    STATE_DIR=/var/lib/conceptsos-vpn

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg iproute2 iptables jq tini gettext-base procps; \
    # Node.js 20.x (nodesource)
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -; \
    apt-get install -y --no-install-recommends nodejs; \
    # Tailscale (legacy stack; skipped in v6-nb-only)
    if [ "$INSTALL_TAILSCALE" = "true" ]; then \
      curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.noarmor.gpg \
          -o /usr/share/keyrings/tailscale-archive-keyring.gpg; \
      curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.tailscale-keyring.list \
          -o /etc/apt/sources.list.d/tailscale.list; \
      apt-get update; \
      apt-get install -y --no-install-recommends tailscale; \
    fi; \
    # Headscale .deb (legacy stack; skipped in v6-nb-only)
    if [ "$INSTALL_HEADSCALE" = "true" ]; then \
      curl -fsSL -o /tmp/headscale.deb \
          "https://github.com/juanfont/headscale/releases/download/v${HEADSCALE_VERSION}/headscale_${HEADSCALE_VERSION}_linux_${TARGETARCH}.deb"; \
      dpkg -i /tmp/headscale.deb; \
      rm -f /tmp/headscale.deb; \
    fi; \
    # NetBird client (new stack; skipped in v4)
    if [ "$INSTALL_NETBIRD" = "true" ]; then \
      curl -fsSL -o /tmp/netbird.tar.gz \
          "https://github.com/netbirdio/netbird/releases/download/v${NETBIRD_VERSION}/netbird_${NETBIRD_VERSION}_linux_${TARGETARCH}.tar.gz"; \
      tar -xzf /tmp/netbird.tar.gz -C /usr/local/bin netbird; \
      rm -f /tmp/netbird.tar.gz; \
      chmod +x /usr/local/bin/netbird; \
      /usr/local/bin/netbird version; \
    fi; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Next.js standalone output: server.js + minimal node_modules
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Entrypoint + config templates
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY docker/headscale.yaml.tmpl /etc/conceptsos-vpn/headscale.yaml.tmpl
RUN chmod +x /usr/local/bin/entrypoint.sh \
 && mkdir -p /var/lib/conceptsos-vpn/headscale \
             /var/lib/conceptsos-vpn/tailscaled \
             /var/lib/conceptsos-vpn/netbird \
             /var/run/tailscale /var/run/netbird

# Headscale HTTP(S) API + ACME challenge + embedded DERP STUN.
# Port 3478/udp is retired in v6-nb-only (moves to the coturn Deployment).
EXPOSE 80 443 8080 3478/udp
# NOTE: port 3000 (Next.js) is intentionally NOT exposed — the app is
# reachable only via the overlay (tailnet in v4/v5, netbird wt0 in v5/v6).

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
