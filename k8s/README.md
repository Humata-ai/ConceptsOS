# k8s manifests

Applied in this order:

```
kubectl apply -f k8s/namespaces.yaml
kubectl apply -f k8s/gateway/
kubectl apply -f k8s/api/
```

The old single-tenant `_legacy-*.yaml` manifests were retired on
2026-08-10 — the hosted deployment is entirely multi-tenant now (each
user gets their own StatefulSet in the `users` namespace, all sharing
the wg-gateway in `conceptsos-system`). If you need the single-user
self-host path, run the `ConceptsOS-VM` image directly with
`CONCEPTSOS_WG=embedded` and a mounted `wg0.conf` — see the top-level
README's "Self-hosting" section.

## Layout

- `namespaces.yaml`     — `conceptsos-system` + `users`
- `gateway/`            — shared wg-gateway pod (1 public UDP IP)
- `api/`                — api.conceptsos.com + ServiceAccount/RBAC + Ingress

Per-user StatefulSets in the `users` namespace are **not** in this
directory — they're created at runtime by the reconcile loop in the api
service (see `api/src/lib/k8s.ts`).

## Secrets you must create by hand (once)

```bash
# api's Supabase creds + Anthropic admin key
kubectl -n conceptsos-system create secret generic conceptsos-api-secrets \
  --from-literal=SUPABASE_URL=... \
  --from-literal=SUPABASE_ANON_KEY=... \
  --from-literal=SUPABASE_SERVICE_ROLE_KEY=... \
  --from-literal=ANTHROPIC_ADMIN_KEY=... \
  --from-literal=ANTHROPIC_WORKSPACE_ID=... \
  --from-literal=WG_GATEWAY_TOKEN=$(openssl rand -hex 32) \
  --from-literal=WG_SERVER_PUBKEY=<filled-in-after-gateway-first-boot>

# wg-gateway's admin token (same value as WG_GATEWAY_TOKEN above)
kubectl -n conceptsos-system create secret generic wg-gateway-admin \
  --from-literal=token=<same value>
```

After the gateway comes up once and generates its keypair, grab the
pubkey and patch it into `conceptsos-api-secrets.WG_SERVER_PUBKEY`:

```bash
kubectl -n conceptsos-system exec deploy/wg-gateway -- cat /var/lib/wg-gateway/server.pub
```
