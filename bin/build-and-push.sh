#!/usr/bin/env bash
#
# Build all three ConceptsOS images and push to Artifact Registry.
#
#   api          — provisioning API + reconcile loop (api.conceptsos.com)
#   wg-gateway   — shared WireGuard endpoint
#   vm           — per-user pod image (ConceptsOS-VM)
#
# Usage:
#   bin/build-and-push.sh              # all three
#   bin/build-and-push.sh api          # just one
#
# Requires: docker (or `gcloud builds submit`), auth against GAR.

set -euo pipefail

PROJECT="${GCP_PROJECT:-conceptsos-prd}"
REGION="${GCP_REGION:-us-central1}"
REPO="${GAR_REPO:-conceptsos}"
REGISTRY="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}"

# Preferred: buildx --push. Fall back to docker push.
have_buildx() {
  docker buildx version >/dev/null 2>&1
}

build_image() {
  local name="$1" dockerfile="$2" context="$3"
  local tag="${REGISTRY}/${name}:latest"
  local sha_tag="${REGISTRY}/${name}:$(git rev-parse --short HEAD 2>/dev/null || echo local)"

  echo "==> building $name  →  $tag"
  if have_buildx; then
    docker buildx build \
      --platform linux/amd64 \
      -f "$dockerfile" \
      -t "$tag" -t "$sha_tag" \
      --push \
      "$context"
  else
    docker build --platform linux/amd64 -f "$dockerfile" -t "$tag" -t "$sha_tag" "$context"
    docker push "$tag"
    docker push "$sha_tag"
  fi
}

targets=("${@:-api wg-gateway vm}")
# When no args, "${@:-api wg-gateway vm}" yields a single string; split.
if [[ "${#targets[@]}" -eq 1 && "${targets[0]}" == "api wg-gateway vm" ]]; then
  targets=(api wg-gateway vm)
fi

for t in "${targets[@]}"; do
  case "$t" in
    api)         build_image api        api/Dockerfile               api ;;
    wg-gateway)  build_image wg-gateway docker/wg-gateway/Dockerfile docker/wg-gateway ;;
    vm)          build_image vm         ConceptsOS-VM/Dockerfile     . ;;
    *) echo "unknown target: $t (want: api|wg-gateway|vm)" >&2; exit 1 ;;
  esac
done
