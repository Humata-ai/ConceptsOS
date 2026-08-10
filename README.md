# ConceptsOS

Your personal AI-native computer. Sign in on iPhone → get your own
always-on ConceptsOS-VM pod with an Anthropic-powered coding agent
inside → work with it over a private WireGuard tunnel.

## What's in this repo

```
api/                  Next.js TS provisioning API + reconcile loop
                      (deploys to GKE as api.conceptsos.com)
AgentChat/            The in-pod Next.js app (chat UI + pi coding agent)
ConceptsOS-VM/        Dockerfile for the per-user pod image
docker/
  entrypoint.sh       ConceptsOS-VM entrypoint (external|embedded wg modes)
  wg-gateway/         Shared WireGuard endpoint pod (Dockerfile + admin API)
iOS/ConceptsOS/       Native SwiftUI iOS app (TestFlight)
k8s/
  namespaces.yaml     conceptsos-system + users
  gateway/            wg-gateway Deployment + LB Service
  api/                api Deployment + Ingress + RBAC + CronJob
sql/                  Supabase schema migrations
terraform/            GCP project, GKE cluster, GAR repo, static IP,
                      users node pool, Secret Manager
bin/build-and-push.sh Build & push api / wg-gateway / vm images to GAR
docs/                 V1_ARCHITECTURE.md + SECURITY.md
```

## The V1 architecture in one paragraph

Anyone can download the iOS app, sign in with Apple, and immediately
get a personal always-on Kubernetes pod running the `AgentChat`
Next.js app plus the pi coding agent — reachable only over their
own WireGuard tunnel. Auth is Supabase Cloud. Provisioning is a
Next.js service (`api/`) at `api.conceptsos.com` that runs both the
public HTTP API and a background reconcile loop against `public.vms`
in Supabase. All user pods share one WireGuard gateway; each user's
tunnel IP is source-based DNATed to their own pod's ClusterIP. Every
user gets an Anthropic API key minted from a shared workspace (or a
fallback shared key while `ANTHROPIC_ADMIN_KEY` is missing); usage
is rolled up hourly.

Full design + decisions: [`docs/V1_ARCHITECTURE.md`](docs/V1_ARCHITECTURE.md).
Security roadmap (E2EE V2 plan): [`docs/SECURITY.md`](docs/SECURITY.md).

## Live deployment

- **Cluster:** `conceptsos-cluster` in `conceptsos-prd` (GKE, `us-central1-a`)
- **Public UDP:** `35.253.153.78:51820` (wg-gateway LoadBalancer)
- **Public HTTPS:** `api.conceptsos.com` → static IP `136.68.31.184`
  (GCE Ingress + Google-managed cert)
- **Supabase project:** `emkhiqufwtevsiworiqv` (us-west-2)
- **iOS TestFlight:** build `1786351829` (v1.1)

## Quick deploy loop

```bash
# 1. Build & push images
bin/build-and-push.sh              # all three: api, wg-gateway, vm
bin/build-and-push.sh api          # just one

# 2. Apply k8s
kubectl apply -f k8s/namespaces.yaml
kubectl apply -f k8s/gateway/
kubectl apply -f k8s/api/
```

## Local dev

```bash
cd api && npm install && cp .env.example .env.local
# fill in Supabase + wg secrets, then:
RECONCILE_ENABLED=false npm run dev    # http://localhost:3100
```

The api needs `SUPABASE_*`, `WG_SERVER_PUBKEY`, `WG_ENDPOINT`,
`USER_POD_IMAGE`, and either `ANTHROPIC_ADMIN_KEY` or `ANTHROPIC_API_KEY`.
See `api/.env.example`.

## Self-hosting (single-user)

The single-tenant "one pod is my personal appliance" model still
works — run the `ConceptsOS-VM` image with `CONCEPTSOS_WG=embedded`
and a `wg0.conf` mounted at `/etc/wireguard-src/wg0.conf`. The
`docker/entrypoint.sh` will bring up `wg0` and bind Next.js to the
tunnel IP. See `bin/wg-bootstrap.sh` for peer setup.

## License

MIT.
