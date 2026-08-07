# NetBird Runbook

Operational runbook for the NetBird overlay. The historical P0/P1/P2
rollout notes live in git history (`docs/netbird-migration.md` for the
design summary).

Prereqs on your workstation:
- `gcloud`, `kubectl`, `docker`, `jq` installed.
- `gcloud auth login` as `dan@humata.ai`.
- `gcloud container clusters get-credentials <cluster> --region us-central1`
  so `kubectl` targets `conceptsos-prd`.

---

## Build & push the runtime image

```bash
IMAGE=us-central1-docker.pkg.dev/conceptsos-prd/conceptsos/vpn
docker build -t "$IMAGE:v6-nb-only" .
docker push "$IMAGE:v6-nb-only"
```

Sanity:

```bash
docker run --rm "$IMAGE:v6-nb-only" netbird version
```

## Google Workspace OIDC (only needed when we flip mgmt off `none`)

In `console.cloud.google.com` under the `humata.ai` GCP project:

1. APIs & Services → Credentials → **Create OAuth client ID** →
   *Web app*.
   - Name: `NetBird management (conceptsos)`
   - Authorized redirect URIs:
     - `https://nb.conceptsos.com/auth/callback`
     - `https://nb.conceptsos.com/silent-auth`
2. Create a service account `netbird-directory-sync@…iam.gserviceaccount.com`,
   generate a JSON key.
3. Workspace Admin → Security → API controls → **Domain-wide
   delegation** → add the service account with scopes:
   ```
   https://www.googleapis.com/auth/admin.directory.user.readonly
   https://www.googleapis.com/auth/admin.directory.group.readonly
   ```
4. Note the Workspace **Customer ID** (Admin console → Account
   settings).

Then locally:

```bash
cp k8s/overlays/netbird-prod/oidc.env.example k8s/overlays/netbird-prod/oidc.env
$EDITOR k8s/overlays/netbird-prod/oidc.env   # fill in client id/secret + customer id

SA_B64=$(base64 -w0 < /path/to/netbird-directory-sync.json)
sed -i "s|^GOOGLE_SERVICE_ACCOUNT_JSON=.*|GOOGLE_SERVICE_ACCOUNT_JSON=$SA_B64|" \
  k8s/overlays/netbird-prod/oidc.env

[ -f k8s/overlays/netbird-prod/turn.env ] || \
  echo "TURN_SHARED_SECRET=$(openssl rand -hex 32)" > k8s/overlays/netbird-prod/turn.env
```

Both files are `.gitignore`d.

## DNS

| Host                          | Points at              |
|-------------------------------|------------------------|
| `nb.conceptsos.com`           | Service `netbird/netbird-management` (LB IP, ports 443 + 33073) |
| `signal.nb.conceptsos.com`    | Service `netbird/netbird-signal`     (LB IP, port 10000) |
| `turn.conceptsos.com`         | Service `netbird/coturn`             (LB IP, port 3478 udp+tcp) |

## Deploy / update the control plane

```bash
kubectl apply -k k8s/overlays/netbird-prod/

kubectl -n netbird get svc
kubectl -n netbird get pods
curl -fsS https://nb.conceptsos.com/api/health   # 200
```

## Provision a tenant

```bash
export NB_API_URL=https://nb.conceptsos.com
export NB_API_TOKEN=$(pass show humata/netbird/service-user-token)

bin/provision-nb.sh <customer>

kubectl -n cust-<customer>-nb get pods -w
kubectl -n cust-<customer>-nb exec deploy/conceptsos-node -- \
  netbird status --json | jq .
```

From your laptop / phone:
- Install the NetBird client (iOS / macOS / Linux).
- Sign in with your `@humata.ai` Google account (device flow or PKCE),
  or use a setup key while mgmt is in `IdpManagerConfig=none`.
- `curl -f http://<customer>.vpn.conceptsos.com:3000/api/health` → 200.

## Apply ACLs

```bash
bin/apply-policies.sh --dry-run   # inspect
bin/apply-policies.sh
```

Verify default-deny: from a peer *not* in `cust-<customer>`,
`curl http://<customer>.vpn.conceptsos.com:3000/` should time out.

## Legacy teardown (one-shot, if not yet done)

Once every tenant is on the NetBird overlay:

```bash
kubectl delete ns conceptsos-control      # old Headscale control plane
kubectl delete ns cust-dans-computer      # old Tailscale tenant
# Remove hs.conceptsos.com DNS at Vercel.
```

The repo-side removal of the legacy image variants / manifests /
provisioner already landed with the `v6-nb-only` commit.
