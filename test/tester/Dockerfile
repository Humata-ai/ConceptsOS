FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg iproute2 jq tini procps; \
    curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.noarmor.gpg \
        -o /usr/share/keyrings/tailscale-archive-keyring.gpg; \
    curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.tailscale-keyring.list \
        -o /etc/apt/sources.list.d/tailscale.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends tailscale; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/*; \
    mkdir -p /var/run/tailscale /var/lib/tailscale

COPY tester-entrypoint.sh /usr/local/bin/tester-entrypoint.sh
RUN chmod +x /usr/local/bin/tester-entrypoint.sh

ENTRYPOINT ["/usr/bin/tini", "--"]
