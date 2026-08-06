#!/usr/bin/env bash
#
# End-to-end test for the ConceptsOS single-image build.
#
#   1. Build the all-in-one image + a tester image.
#   2. Bring up `conceptsos` and wait for headscale + Next.js.
#   3. Bring up `outside-tester` (not on tailnet).
#      Assert: curl http://conceptsos:3000 FAILS  (proves app is not on eth0)
#   4. Mint a headscale preauth key inside the all-in-one container.
#   5. Bring up `inside-tester` with that key so it joins the tailnet.
#      Assert: curl http://<app-tailnet-ip>:3000 SUCCEEDS and returns
#              "hello next js" (proves app IS reachable via tailnet)
#      Assert: curl http://conceptsos:3000 STILL FAILS from inside-tester
#              (proves the docker-network path is closed even from a tailnet peer)
#
# Usage: ./test/run.sh
set -euo pipefail

cd "$(dirname "$0")"

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; RST=$'\033[0m'
pass() { echo "${GRN}✔ PASS${RST}  $*"; }
fail() { echo "${RED}✘ FAIL${RST}  $*"; FAILED=1; }
info() { echo "${YEL}→${RST}      $*"; }

FAILED=0

cleanup() {
  info "docker compose down"
  docker compose down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

# --- 1. Build --------------------------------------------------------------
info "building conceptsos:test + conceptsos-tester:test"
docker compose --profile build-only build tester-build
docker compose build conceptsos

# --- 2. Bring up the all-in-one container ---------------------------------
info "starting conceptsos (all-in-one)"
docker compose up -d conceptsos

info "waiting for conceptsos to become healthy…"
for i in $(seq 1 90); do
  status=$(docker inspect -f '{{.State.Health.Status}}' conceptsos 2>/dev/null || echo starting)
  [[ "$status" == "healthy" ]] && break
  sleep 1
done
if [[ "$status" != "healthy" ]]; then
  fail "conceptsos never became healthy"
  docker compose logs conceptsos | tail -80
  exit 1
fi
pass "conceptsos healthy"

# Wait until the container's own tailscale is Running and has an IP.
info "waiting for conceptsos to join its own tailnet…"
APP_TS_IP=""
for i in $(seq 1 60); do
  APP_TS_IP=$(docker compose exec -T conceptsos tailscale ip -4 2>/dev/null | tr -d '\r' | head -n1 || true)
  [[ -n "$APP_TS_IP" ]] && break
  sleep 1
done
if [[ -z "$APP_TS_IP" ]]; then
  fail "conceptsos never got a tailnet IP"
  docker compose logs conceptsos | tail -100
  exit 1
fi
pass "conceptsos tailnet IP = $APP_TS_IP"

# Wait for Next.js to actually be listening on that IP (from inside the container).
info "waiting for Next.js on tailnet IP inside container…"
for i in $(seq 1 30); do
  if docker compose exec -T conceptsos curl -fsS -m 2 "http://$APP_TS_IP:3000/" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! docker compose exec -T conceptsos curl -fsS -m 2 "http://$APP_TS_IP:3000/" >/dev/null 2>&1; then
  fail "Next.js never came up on $APP_TS_IP:3000 inside container"
  docker compose logs conceptsos | tail -100
  exit 1
fi
pass "Next.js listening on tailnet IP $APP_TS_IP:3000"

# --- 3. Outside tester: NOT on tailnet, must NOT reach the app ------------
info "starting outside-tester (not on tailnet)"
docker compose up -d outside-tester
sleep 1

echo
echo "════ Test 1: outside-tester → conceptsos:3000 (via docker network) ════"
if docker compose exec -T outside-tester curl -fsS -m 3 "http://conceptsos:3000/" >/dev/null 2>&1; then
  fail "outside-tester reached conceptsos:3000 — app IS exposed on eth0 (leak!)"
else
  pass "outside-tester CANNOT reach conceptsos:3000 (app not on eth0)"
fi

echo
echo "════ Test 2: outside-tester → $APP_TS_IP:3000 (via tailnet IP, no tailnet) ════"
if docker compose exec -T outside-tester curl -fsS -m 3 "http://$APP_TS_IP:3000/" >/dev/null 2>&1; then
  fail "outside-tester reached $APP_TS_IP:3000 without joining tailnet (leak!)"
else
  pass "outside-tester CANNOT reach the tailnet IP without joining the tailnet"
fi

# --- 4. Mint a preauth key for inside-tester ------------------------------
info "minting preauth key for inside-tester"
TS_AUTHKEY=$(docker compose exec -T conceptsos \
  headscale -c /etc/conceptsos-vpn/headscale.yaml preauthkeys create \
    -u default --reusable=false --ephemeral=true -e 1h -o json \
  | jq -r '.key')
if [[ -z "$TS_AUTHKEY" || "$TS_AUTHKEY" == "null" ]]; then
  fail "could not mint preauth key"; exit 1
fi
pass "minted preauth key ${TS_AUTHKEY:0:12}…"

# --- 5. Inside tester: joins tailnet, must reach the app -----------------
info "starting inside-tester (joins tailnet)"
TS_AUTHKEY="$TS_AUTHKEY" docker compose up -d inside-tester

info "waiting for inside-tester to reach BackendState=Running…"
for i in $(seq 1 60); do
  state=$(docker compose exec -T inside-tester tailscale status --json 2>/dev/null \
          | jq -r '.BackendState // empty' 2>/dev/null || true)
  [[ "$state" == "Running" ]] && break
  sleep 1
done
if [[ "${state:-}" != "Running" ]]; then
  fail "inside-tester never reached Running (state=$state)"
  docker compose logs inside-tester | tail -80
  exit 1
fi
pass "inside-tester on tailnet"

# Give DERP a moment to establish peer routing.
sleep 3

echo
echo "════ Test 3: inside-tester → $APP_TS_IP:3000 (via tailnet) ════"
body=$(docker compose exec -T inside-tester curl -fsS -m 15 "http://$APP_TS_IP:3000/" 2>&1 || true)
if echo "$body" | grep -q "hello next js"; then
  pass "inside-tester reached the app via tailnet and got the expected body"
else
  fail "inside-tester could NOT reach the app over the tailnet"
  echo "---- response ----"
  echo "$body" | head -20
  echo "---- inside-tester tailscale status ----"
  docker compose exec -T inside-tester tailscale status || true
  echo "---- conceptsos tailscale status ----"
  docker compose exec -T conceptsos tailscale status || true
fi

echo
echo "════ Test 4: inside-tester → conceptsos:3000 (docker network path) ════"
if docker compose exec -T inside-tester curl -fsS -m 3 "http://conceptsos:3000/" >/dev/null 2>&1; then
  fail "inside-tester reached conceptsos:3000 via docker network — app exposed on eth0!"
else
  pass "even a tailnet peer cannot reach the app on the docker-network eth0"
fi

echo
if [[ "$FAILED" -eq 0 ]]; then
  echo "${GRN}════════════════════════════════════════════${RST}"
  echo "${GRN}  ALL TESTS PASSED${RST}"
  echo "${GRN}════════════════════════════════════════════${RST}"
  exit 0
else
  echo "${RED}════════════════════════════════════════════${RST}"
  echo "${RED}  ONE OR MORE TESTS FAILED${RST}"
  echo "${RED}════════════════════════════════════════════${RST}"
  exit 1
fi
