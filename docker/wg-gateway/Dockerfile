# syntax=docker/dockerfile:1.7
#
# wg-gateway: the single public WireGuard endpoint for all ConceptsOS users.
#
# One public UDP LoadBalancer terminates here. This container:
#   - runs `wg` on UDP :51820, one peer per user
#   - runs a small HTTP admin server on :8080 (cluster-internal ONLY) that
#     the api service calls to add/remove peers + DNAT rules
#   - DNATs decrypted traffic to the correct user pod based on source IP
#
# Isolation guarantees:
#   * WireGuard decrypts each peer's packets into its own tunnel; peer A
#     cannot spoof peer B (different keys).
#   * iptables rules match on source wg IP + destination port and route
#     to exactly one pod ClusterIP.
#   * The admin API is only reachable from inside the cluster.

FROM node:22-bookworm-slim AS runner
WORKDIR /app

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        wireguard-tools iproute2 iptables procps tini ca-certificates; \
    rm -rf /var/lib/apt/lists/*

# No third-party deps (we use only node:core). If we ever add one, restore
# the deps stage and COPY --from=deps /app/node_modules ./node_modules.
COPY package.json ./
COPY src ./src
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Public: UDP :51820 (WireGuard). Cluster-internal: TCP :8080 (admin).
EXPOSE 51820/udp
EXPOSE 8080/tcp

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
