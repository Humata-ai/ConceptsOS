#!/usr/bin/env bash
#
# Apply NetBird ACL policies from docs/acl-netbird.yaml idempotently.
#
# Policy semantics: each YAML doc under `policies:` is one NetBird policy
# with source-group → destination-group + protocol/ports. The script:
#   - resolves group names to IDs (creating groups that don't exist),
#   - upserts each policy by name (PUT if exists, POST if new),
#   - deletes any policies present in NetBird whose name starts with
#     `conceptsos:` but is not in the file (drift detection).
#
# Requires:
#   $NB_API_URL   (default: https://nb.conceptsos.com)
#   $NB_API_TOKEN
#
# Usage:
#   bin/apply-policies.sh [--dry-run]

set -euo pipefail

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

: "${NB_API_URL:=https://nb.conceptsos.com}"
: "${NB_API_TOKEN:?NB_API_TOKEN required}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FILE="$ROOT/docs/acl-netbird.yaml"

command -v yq >/dev/null || { echo "yq required (https://github.com/mikefarah/yq)"; exit 2; }

nb_api() {
  local method="$1" path="$2"
  shift 2
  curl -fsS -X "$method" \
    -H "Authorization: Token $NB_API_TOKEN" \
    -H "Content-Type: application/json" \
    "$NB_API_URL/api${path}" "$@"
}

ensure_group() {
  local name="$1" id
  id=$(nb_api GET /groups | jq -r ".[] | select(.name==\"$name\") | .id")
  if [[ -z "$id" || "$id" == "null" ]]; then
    if (( DRY_RUN )); then
      echo "[dry-run] would create group $name" >&2
      echo "DRY_GROUP_$name"
    else
      id=$(nb_api POST /groups -d "{\"name\":\"$name\"}" | jq -r '.id')
      echo "$id"
    fi
  else
    echo "$id"
  fi
}

# Enumerate policies in the file.
POLICY_COUNT=$(yq '.policies | length' "$FILE")
KEEP_NAMES=()

for i in $(seq 0 $((POLICY_COUNT - 1))); do
  NAME=$(yq ".policies[$i].name" "$FILE")
  DESC=$(yq ".policies[$i].description // \"\"" "$FILE")
  ACTION=$(yq ".policies[$i].action" "$FILE")   # accept|drop
  PROTO=$(yq ".policies[$i].protocol // \"all\"" "$FILE")
  BIDIR=$(yq ".policies[$i].bidirectional // true" "$FILE")

  SRC_GROUPS=()
  for g in $(yq ".policies[$i].sources[]" "$FILE"); do
    SRC_GROUPS+=("$(ensure_group "$g")")
  done
  DST_GROUPS=()
  for g in $(yq ".policies[$i].destinations[]" "$FILE"); do
    DST_GROUPS+=("$(ensure_group "$g")")
  done
  PORTS=$(yq -o=json ".policies[$i].ports // []" "$FILE")

  BODY=$(jq -n \
    --arg name "conceptsos:$NAME" \
    --arg desc "$DESC" \
    --arg action "$ACTION" \
    --arg proto "$PROTO" \
    --argjson bidir "$BIDIR" \
    --argjson srcs "$(printf '%s\n' "${SRC_GROUPS[@]}" | jq -R . | jq -s .)" \
    --argjson dsts "$(printf '%s\n' "${DST_GROUPS[@]}" | jq -R . | jq -s .)" \
    --argjson ports "$PORTS" \
    '{
       name: $name,
       description: $desc,
       enabled: true,
       rules: [{
         name: $name,
         description: $desc,
         enabled: true,
         action: $action,
         bidirectional: $bidir,
         protocol: $proto,
         sources: $srcs,
         destinations: $dsts,
         ports: $ports
       }]
     }')

  KEEP_NAMES+=("conceptsos:$NAME")
  EXISTING_ID=$(nb_api GET /policies | jq -r ".[] | select(.name==\"conceptsos:$NAME\") | .id")
  if [[ -n "$EXISTING_ID" && "$EXISTING_ID" != "null" ]]; then
    if (( DRY_RUN )); then
      echo "[dry-run] PUT /policies/$EXISTING_ID (name=conceptsos:$NAME)"
    else
      nb_api PUT "/policies/$EXISTING_ID" -d "$BODY" >/dev/null
      echo "[=] updated policy conceptsos:$NAME"
    fi
  else
    if (( DRY_RUN )); then
      echo "[dry-run] POST /policies (name=conceptsos:$NAME)"
    else
      nb_api POST /policies -d "$BODY" >/dev/null
      echo "[+] created policy conceptsos:$NAME"
    fi
  fi
done

# Drift: delete conceptsos:* policies no longer in the file.
for row in $(nb_api GET /policies | jq -r '.[] | select(.name | startswith("conceptsos:")) | "\(.id)\t\(.name)"'); do
  ID=$(cut -f1 <<<"$row")
  N=$(cut -f2 <<<"$row")
  keep=0
  for k in "${KEEP_NAMES[@]}"; do [[ "$k" == "$N" ]] && keep=1; done
  if (( !keep )); then
    if (( DRY_RUN )); then
      echo "[dry-run] DELETE /policies/$ID ($N)"
    else
      nb_api DELETE "/policies/$ID" >/dev/null
      echo "[-] deleted policy $N"
    fi
  fi
done

echo "done."
