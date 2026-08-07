#!/usr/bin/env bash
#
# Provision a new customer against the NetBird control plane.
#
#   bin/provision-nb.sh <customer-name>
#
# Steps:
#   1. Ensure a NetBird group `cust-<name>` exists (POST /api/groups).
#   2. Mint a single-use, group-scoped setup key (POST /api/setup-keys).
#   3. Materialize k8s/overlays/customers/<name>-nb/ (config.env + secret.env).
#   4. kubectl apply -k the overlay.
#
# Requires:
#   * kubectl configured for the target cluster.
#   * $NB_API_URL   (default: https://nb.conceptsos.com)
#   * $NB_API_TOKEN — a NetBird service-user PAT with admin scope.
#
# See docs/netbird-migration.md for context.

set -euo pipefail

NAME="${1:-}"
if ! [[ "$NAME" =~ ^[a-z0-9][a-z0-9-]{0,40}[a-z0-9]$ ]]; then
  echo "usage: $(basename "$0") <lowercase-dns-safe-name>" >&2
  exit 2
fi

: "${NB_API_URL:=https://nb.conceptsos.com}"
: "${NB_API_TOKEN:?NB_API_TOKEN required (create via NetBird dashboard → Users → Service Users)}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

nb_api() {
  local method="$1" path="$2"
  shift 2
  curl -fsS -X "$method" \
    -H "Authorization: Token $NB_API_TOKEN" \
    -H "Content-Type: application/json" \
    "$NB_API_URL/api${path}" "$@"
}

GROUP_NAME="cust-$NAME"

# 1. group (idempotent)
GROUP_ID=$(nb_api GET /groups | jq -r ".[] | select(.name==\"$GROUP_NAME\") | .id" || true)
if [[ -z "$GROUP_ID" || "$GROUP_ID" == "null" ]]; then
  echo "[+] creating NetBird group '$GROUP_NAME'"
  GROUP_ID=$(nb_api POST /groups -d "{\"name\":\"$GROUP_NAME\"}" | jq -r '.id')
fi
echo "[+] group id: $GROUP_ID"

# 2. setup key — single use, ephemeral=false, 24h TTL, group-scoped.
echo "[+] minting setup key for '$NAME'"
KEY_JSON=$(nb_api POST /setup-keys -d "$(jq -n --arg name "$NAME" --arg gid "$GROUP_ID" '
  {
    name: $name,
    type: "one-off",
    expires_in: 86400,
    usage_limit: 1,
    ephemeral: false,
    auto_groups: [$gid]
  }')")
KEY=$(jq -r '.key' <<<"$KEY_JSON")
if [[ -z "$KEY" || "$KEY" == "null" ]]; then
  echo "failed to mint setup key" >&2
  echo "$KEY_JSON" >&2
  exit 1
fi

# 3. materialize overlay
DEST="$ROOT/k8s/overlays/customers/${NAME}-nb"
if [[ ! -d "$DEST" ]]; then
  TEMPLATE="$ROOT/k8s/overlays/customers/dans-computer-nb"
  mkdir -p "$DEST"
  for f in kustomization.yaml namespace.yaml config.env; do
    sed "s/dans-computer/$NAME/g" "$TEMPLATE/$f" > "$DEST/$f"
  done
fi
cat > "$DEST/secret.env" <<EOF
NB_SETUP_KEY=$KEY
EOF
chmod 0600 "$DEST/secret.env"
echo "[+] wrote $DEST/{kustomization.yaml,namespace.yaml,config.env,secret.env}"

# 4. apply
echo "[+] kubectl apply -k $DEST"
kubectl apply -k "$DEST"

cat <<EOF

Customer '$NAME' provisioned on NetBird overlay.
  namespace : cust-${NAME}-nb
  group     : $GROUP_NAME ($GROUP_ID)
  hostname  : $NAME.netbird.conceptsos.com  (resolvable only inside the NetBird overlay)
  setup key : minted, one-off, 24h TTL, stored in $DEST/secret.env (gitignored)

Watch it come up:
  kubectl -n cust-${NAME}-nb get pods -w
  kubectl -n cust-${NAME}-nb exec deploy/conceptsos-node -- netbird status --json | jq .
EOF
