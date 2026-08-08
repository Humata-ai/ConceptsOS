#!/usr/bin/env bash
#
# Add another WireGuard peer to the running endpoint.
#
# Reads server key + existing peers from ./.wg-state/, appends the new peer,
# re-applies the k8s Secret, restarts the pod, and prints the new client
# .conf to stdout.
#
# Usage:
#   bin/wg-add-peer.sh <peer-name>

set -euo pipefail

PEER_NAME="${1:?usage: bin/wg-add-peer.sh <peer-name>}"
STATE_DIR="$(cd "$(dirname "$0")/.." && pwd)/.wg-state"

if [[ ! -f "$STATE_DIR/server.key" ]]; then
  echo "no server key at $STATE_DIR/server.key — run bin/wg-bootstrap.sh first" >&2
  exit 1
fi

SERVER_PRIV=$(cat "$STATE_DIR/server.key")
SERVER_PUB=$(cat "$STATE_DIR/server.pub")

WG_IMAGE="${WG_IMAGE:-us-central1-docker.pkg.dev/conceptsos-prd/conceptsos/app:latest}"
if command -v wg >/dev/null; then
  wg_() { wg "$@"; }
else
  command -v docker >/dev/null || { echo "need wg or docker" >&2; exit 1; }
  wg_() { docker run --rm -i --entrypoint wg "$WG_IMAGE" "$@"; }
fi

# next free IP (start from .2, .1 is the server)
LAST_OCTET=$(awk -F'\t' '!/^#/ && NF>0 { split($2,a,"."); if (a[4]>m) m=a[4] } END { print (m ? m : 1) }' "$STATE_DIR/peers.tsv")
NEXT_OCTET=$((LAST_OCTET + 1))
if (( NEXT_OCTET > 254 )); then
  echo "10.10.0.0/24 subnet full (>253 peers). Widen it in .wg-state/wg0.conf and re-run." >&2
  exit 1
fi
PEER_IP="10.10.0.${NEXT_OCTET}"

CLIENT_PRIV=$(wg_ genkey)
CLIENT_PUB=$(echo "$CLIENT_PRIV" | wg_ pubkey)
PSK=$(wg_ genpsk)

umask 077
echo -e "${PEER_NAME}\t${PEER_IP}\t${CLIENT_PUB}\t${PSK}\t${CLIENT_PRIV}" >> "$STATE_DIR/peers.tsv"

# rebuild server wg0.conf from peers.tsv
SERVER_CONF="$STATE_DIR/wg0.conf"
{
  echo "[Interface]"
  echo "Address = 10.10.0.1/24"
  echo "ListenPort = 51820"
  echo "PrivateKey = ${SERVER_PRIV}"
  awk -F'\t' '!/^#/ && NF>0 {
    printf("\n[Peer]\n# %s\nPublicKey = %s\nPresharedKey = %s\nAllowedIPs = %s/32\n", $1,$3,$4,$2)
  }' "$STATE_DIR/peers.tsv"
} > "$SERVER_CONF"
chmod 0600 "$SERVER_CONF"

kubectl create secret generic wg-server \
  --from-file=wg0.conf="$SERVER_CONF" \
  --dry-run=client -o yaml \
  | kubectl apply -f -

kubectl rollout restart deploy/conceptsos >/dev/null 2>&1 || true

ENDPOINT_IP=$(kubectl get svc conceptsos -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
ENDPOINT="${ENDPOINT_IP:-<REPLACE-WITH-PUBLIC-IP>}:51820"

CLIENT_CONF="$STATE_DIR/${PEER_NAME}.conf"
cat > "$CLIENT_CONF" <<EOF
[Interface]
PrivateKey = ${CLIENT_PRIV}
Address = ${PEER_IP}/32

[Peer]
PublicKey = ${SERVER_PUB}
PresharedKey = ${PSK}
Endpoint = ${ENDPOINT}
AllowedIPs = 10.10.0.0/24
PersistentKeepalive = 25
EOF
chmod 0600 "$CLIENT_CONF"

echo
echo "==== client conf (${PEER_NAME}) ===="
cat "$CLIENT_CONF"
echo
echo "saved to: $CLIENT_CONF"
if command -v qrencode >/dev/null; then
  echo; qrencode -t ansiutf8 < "$CLIENT_CONF"
fi
