#!/usr/bin/env bash
#
# Provision a new customer against the shared control plane.
#
#   bin/provision.sh <customer-name>
#
# What this does (same steps the signup server will do, wrapped in bash):
#   1. Ensure a headscale user exists for the customer.
#   2. Mint a preauth key against that user.
#   3. Materialize k8s/overlays/customers/<name>/ (config.env + secret.env).
#   4. kubectl apply -k the overlay.
#
# Assumptions:
#   * kubectl is configured for the target cluster.
#   * The control-plane overlay is already applied
#       (kubectl -n conceptsos-control get deploy/headscale).

set -euo pipefail

NAME="${1:-}"
if ! [[ "$NAME" =~ ^[a-z0-9][a-z0-9-]{0,40}[a-z0-9]$ ]]; then
  echo "usage: $(basename "$0") <lowercase-dns-safe-name>" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CTRL_NS="${CTRL_NS:-conceptsos-control}"

k() { kubectl -n "$CTRL_NS" "$@"; }

CTRL_POD=$(k get pod -l app=headscale -o jsonpath='{.items[0].metadata.name}')
hs() { k exec "$CTRL_POD" -- headscale -c /etc/conceptsos-vpn/headscale.yaml "$@"; }

# 1. user
if ! hs users list -o json | jq -e ".[] | select(.name==\"$NAME\")" >/dev/null; then
  echo "[+] creating headscale user '$NAME'"
  hs users create "$NAME" >/dev/null
fi

# 2. preauth key
echo "[+] minting preauth key for '$NAME'"
KEY=$(hs preauthkeys create -u "$NAME" --reusable=false --ephemeral=false -e 24h -o json | jq -r '.key')
if [[ -z "$KEY" || "$KEY" == "null" ]]; then
  echo "failed to mint preauth key" >&2; exit 1
fi

# 3. materialize overlay
DEST="$ROOT/k8s/overlays/customers/$NAME"
if [[ ! -d "$DEST" ]]; then
  TEMPLATE="$ROOT/k8s/overlays/customers/dans-computer"
  mkdir -p "$DEST"
  for f in kustomization.yaml namespace.yaml config.env; do
    sed "s/dans-computer/$NAME/g" "$TEMPLATE/$f" > "$DEST/$f"
  done
fi
cat > "$DEST/secret.env" <<EOF
TS_AUTHKEY=$KEY
EOF
chmod 0600 "$DEST/secret.env"
echo "[+] wrote $DEST/{kustomization.yaml,namespace.yaml,config.env,secret.env}"

# 4. apply
echo "[+] kubectl apply -k $DEST"
kubectl apply -k "$DEST"

cat <<EOF

Customer '$NAME' provisioned.
  namespace : cust-$NAME
  hostname  : $NAME.vpn.conceptsos.com  (resolvable only inside this customer's tailnet)
  join key  : minted, valid 24h, stored in $DEST/secret.env (gitignored)

Watch it come up:
  kubectl -n cust-$NAME get pods -w
EOF
