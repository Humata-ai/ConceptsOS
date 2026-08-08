#!/usr/bin/env bash
#
# One-shot bootstrap for the ConceptsOS WireGuard endpoint:
#
#   1. Generate a server keypair.
#   2. Generate ONE client keypair (10.10.0.2) with a preshared key.
#   3. Compose the server-side wg0.conf and apply it as k8s Secret 'wg-server'.
#   4. Print the client .conf to stdout — save it, AirDrop it, or QR-encode
#      it into the WireGuard iOS app.
#
# State (private keys) is written to ./.wg-state/ so you can add more peers
# later with bin/wg-add-peer.sh. .wg-state/ is gitignored.
#
# Usage:
#   bin/wg-bootstrap.sh [client-name]
#
# The public endpoint is auto-detected from the k8s Service 'conceptsos'.
# If the LB IP isn't allocated yet, pass it explicitly:
#
#   WG_ENDPOINT=203.0.113.5:51820 bin/wg-bootstrap.sh iphone

set -euo pipefail

CLIENT_NAME="${1:-client1}"
STATE_DIR="$(cd "$(dirname "$0")/.." && pwd)/.wg-state"
mkdir -p "$STATE_DIR"
chmod 0700 "$STATE_DIR"

if [[ -f "$STATE_DIR/server.key" ]]; then
  echo "refusing to overwrite existing $STATE_DIR/server.key" >&2
  echo "use bin/wg-add-peer.sh to add another peer" >&2
  exit 1
fi

need() { command -v "$1" >/dev/null || { echo "missing tool: $1" >&2; exit 1; }; }
need kubectl

# `wg` may not be installed on the operator's machine. Fall back to running
# it inside the app image (which ships wireguard-tools).
WG_IMAGE="${WG_IMAGE:-us-central1-docker.pkg.dev/conceptsos-prd/conceptsos/app:latest}"
if command -v wg >/dev/null; then
  wg_() { wg "$@"; }
else
  need docker
  wg_() { docker run --rm -i --entrypoint wg "$WG_IMAGE" "$@"; }
fi

resolve_endpoint() {
  if [[ -n "${WG_ENDPOINT:-}" ]]; then
    echo "$WG_ENDPOINT"; return
  fi
  local ip
  ip=$(kubectl get svc conceptsos -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
  if [[ -z "$ip" ]]; then
    echo "" ; return
  fi
  echo "${ip}:51820"
}

# --- keys -------------------------------------------------------------------
SERVER_PRIV=$(wg_ genkey)
SERVER_PUB=$(echo "$SERVER_PRIV" | wg_ pubkey)
CLIENT_PRIV=$(wg_ genkey)
CLIENT_PUB=$(echo "$CLIENT_PRIV" | wg_ pubkey)
PSK=$(wg_ genpsk)

umask 077
echo "$SERVER_PRIV" > "$STATE_DIR/server.key"
echo "$SERVER_PUB"  > "$STATE_DIR/server.pub"

cat > "$STATE_DIR/peers.tsv" <<EOF
# name	ip	pubkey	psk	privkey
${CLIENT_NAME}	10.10.0.2	${CLIENT_PUB}	${PSK}	${CLIENT_PRIV}
EOF
chmod 0600 "$STATE_DIR/peers.tsv"

# --- server config ----------------------------------------------------------
SERVER_CONF="$STATE_DIR/wg0.conf"
cat > "$SERVER_CONF" <<EOF
[Interface]
Address = 10.10.0.1/24
ListenPort = 51820
PrivateKey = ${SERVER_PRIV}

[Peer]
# ${CLIENT_NAME}
PublicKey = ${CLIENT_PUB}
PresharedKey = ${PSK}
AllowedIPs = 10.10.0.2/32
EOF
chmod 0600 "$SERVER_CONF"

# --- apply Secret -----------------------------------------------------------
kubectl create secret generic wg-server \
  --from-file=wg0.conf="$SERVER_CONF" \
  --dry-run=client -o yaml \
  | kubectl apply -f -

# Kick the pod so it picks up the new Secret.
kubectl rollout restart deploy/conceptsos >/dev/null 2>&1 || true

# --- client config ----------------------------------------------------------
ENDPOINT=$(resolve_endpoint)
if [[ -z "$ENDPOINT" ]]; then
  ENDPOINT="<REPLACE-WITH-PUBLIC-IP>:51820"
  echo "note: LB IP not allocated yet — replace ${ENDPOINT} in the client conf once 'kubectl get svc conceptsos' shows an EXTERNAL-IP" >&2
fi

CLIENT_CONF="$STATE_DIR/${CLIENT_NAME}.conf"
cat > "$CLIENT_CONF" <<EOF
[Interface]
PrivateKey = ${CLIENT_PRIV}
Address = 10.10.0.2/32

[Peer]
PublicKey = ${SERVER_PUB}
PresharedKey = ${PSK}
Endpoint = ${ENDPOINT}
# Route only the tunnel subnet; not full-tunnel. Change to 0.0.0.0/0 for
# full-tunnel VPN behavior.
AllowedIPs = 10.10.0.0/24
PersistentKeepalive = 25
EOF
chmod 0600 "$CLIENT_CONF"

echo
echo "==== client conf (${CLIENT_NAME}) ===="
cat "$CLIENT_CONF"
echo
echo "saved to: $CLIENT_CONF"
if command -v qrencode >/dev/null; then
  echo
  echo "QR (import into WireGuard iOS app):"
  qrencode -t ansiutf8 < "$CLIENT_CONF"
fi
echo
echo "server-side Secret 'wg-server' applied. Server keys and peer table in $STATE_DIR/."
echo "The app will be reachable at http://10.10.0.1:3000 from any peer."
