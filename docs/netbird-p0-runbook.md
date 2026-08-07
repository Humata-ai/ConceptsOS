# P0 Runbook — NetBird Rollout

This is the concrete, ordered checklist to get from "code merged" to
"P1 pilot green". Every step is either a shell command you can run
against the cluster, or a human-only step (marked **HUMAN**) that
requires a credential no automation on this repo can obtain.

Prereqs on your workstation:
- `gcloud`, `kubectl`, `kustomize`, `docker`, `jq`, `yq` installed.
- `gcloud auth login` as `dan@humata.ai`.
- `gcloud container clusters get-credentials <cluster> --region us-central1` so
  `kubectl` targets `conceptsos-prd`.

---

## 1. Build & push the `v5-nb` dual-client image

```bash
# From repo root.
IMAGE=us-central1-docker.pkg.dev/conceptsos-prd/conceptsos/vpn
docker build \
  --build-arg INSTALL_TAILSCALE=true \
  --build-arg INSTALL_HEADSCALE=true \
  --build-arg INSTALL_NETBIRD=true \
  -t "$IMAGE:v5-nb" .
docker push "$IMAGE:v5-nb"
```

Sanity:

```bash
docker run --rm "$IMAGE:v5-nb" netbird version
docker run --rm "$IMAGE:v5-nb" tailscale --version
docker run --rm "$IMAGE:v5-nb" headscale version
```

## 2. **HUMAN** — Google Workspace OIDC client

In `console.cloud.google.com` under the `humata.ai` GCP project:

1. APIs & Services → Credentials → **Create OAuth client ID** → *Web app*.
   - Name: `NetBird management (conceptsos)`
   - Authorized redirect URIs:
     - `https://nb.conceptsos.com/auth/callback`
     - `https://nb.conceptsos.com/silent-auth`
   - Copy the client ID + secret.
2. Create a service account `netbird-directory-sync@…iam.gserviceaccount.com`,
   generate a JSON key.
3. Google Workspace Admin console → Security → API controls →
   **Domain-wide delegation** → add the service account with scopes:
   ```
   https://www.googleapis.com/auth/admin.directory.user.readonly
   https://www.googleapis.com/auth/admin.directory.group.readonly
   ```
4. Note the Workspace **Customer ID** (Admin console → Account settings).

Then locally:

```bash
cp k8s/overlays/netbird-prod/oidc.env.example k8s/overlays/netbird-prod/oidc.env
$EDITOR k8s/overlays/netbird-prod/oidc.env   # fill in the values above

cp k8s/overlays/netbird-prod/turn.env.example k8s/overlays/netbird-prod/turn.env
sed -i "s/REPLACE_ME.*/$(openssl rand -hex 32)/" k8s/overlays/netbird-prod/turn.env
```

Both files are `.gitignore`d.

## 3. **HUMAN** — DNS records

Point these A records at the LB IPs that step 4 will create (you'll
apply once, read the IPs, then set DNS, then re-apply):

| Host                          | Points at              |
|-------------------------------|------------------------|
| `nb.conceptsos.com`           | Service `netbird/netbird-management` (LB IP, port 443) |
| `signal.nb.conceptsos.com`    | Service `netbird/netbird-signal`     (LB IP, port 10000) |
| `turn.conceptsos.com`         | Service `netbird/coturn`             (LB IP, port 3478 udp+tcp) |

## 4. Deploy the NetBird control plane

```bash
kubectl apply -k k8s/overlays/netbird-prod/

# Wait for LBs, then update DNS (step 3), then wait for cert issuance.
kubectl -n netbird get svc -w

# Health checks
kubectl -n netbird get pods
curl -fsS https://nb.conceptsos.com/api/health   # 200
```

## 5. **HUMAN** — Admin login smoke test

Open `https://nb.conceptsos.com/` in a browser, sign in with your
`@humata.ai` Google account, verify you land on the dashboard.

## 6. Bootstrap the pilot customer overlay (P1)

```bash
export NB_API_URL=https://nb.conceptsos.com
export NB_API_TOKEN=$(pass show humata/netbird/service-user-token)  # after you mint one in the dashboard

bin/provision-nb.sh dans-computer

kubectl -n cust-dans-computer-nb get pods -w
kubectl -n cust-dans-computer-nb exec deploy/conceptsos-node -- \
  netbird status --json | jq .
```

Then on your laptop / phone:
- Install the NetBird client (iOS / macOS / Linux).
- Sign in with your `@humata.ai` Google account (device flow or PKCE).
- `curl -f http://dans-computer.netbird.conceptsos.com:3000/api/health` → 200.

## 7. Apply starter ACLs

```bash
bin/apply-policies.sh --dry-run   # inspect
bin/apply-policies.sh
```

Verify default-deny: from a peer *not* in `cust-dans-computer`,
`curl http://dans-computer.netbird.conceptsos.com:3000/` should time out.

## 8. Side-by-side pilot for 1 week

Both stacks are live. Rollback = `kubectl delete ns netbird`.

Once satisfied, proceed to P2 (per-customer cutover) — for each existing
`cust-<name>` namespace, run `bin/provision-nb.sh <name>`, verify, then
`kubectl delete -k k8s/overlays/customers/<name>/`.

## 9. P3 — decommission

After every customer is off Headscale for at least a week:

```bash
# Rebuild image without the legacy stack.
docker build \
  --build-arg INSTALL_TAILSCALE=false \
  --build-arg INSTALL_HEADSCALE=false \
  --build-arg INSTALL_NETBIRD=true \
  -t "$IMAGE:v6-nb-only" .
docker push "$IMAGE:v6-nb-only"

# Bump image tags in all overlays, apply, then:
kubectl delete -k k8s/overlays/control-prod/
# Remove hs.conceptsos.com DNS.
```
