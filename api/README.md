# conceptsos-api

Public entry point at **api.conceptsos.com**. Serves two roles in one process:

1. HTTP API for the iOS app — `POST /api/signup`, `GET /api/vm`,
   `GET /api/health`.
2. Background reconcile loop that watches Supabase `public.vms` and
   reconciles per-user Kubernetes resources + WireGuard peers.

## Local dev

```bash
cd api
npm install
cp .env.example .env.local     # then fill in Supabase + wg secrets
npm run dev                    # http://localhost:3100
```

Set `RECONCILE_ENABLED=false` in `.env.local` unless you also have a
kubeconfig pointing at a cluster with the `users` namespace and wg-gateway.

## Env vars

See `src/lib/env.ts`. Required for prod:

- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `WG_SERVER_PUBKEY`, `WG_ENDPOINT` (e.g. `api.conceptsos.com:51820`)
- `USER_POD_IMAGE`
- `ANTHROPIC_API_KEY` (org key injected by the `/api/llm/v1/*` reverse proxy)
- `WG_GATEWAY_URL`, `WG_GATEWAY_TOKEN`

## Deploy

Image is built and pushed by `bin/build-and-push.sh`, then applied via
`kubectl apply -f k8s/api/`.
