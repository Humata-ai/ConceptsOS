# NetBird Migration — Design & History

Status: Implemented (repo-side). Cluster teardown of the legacy stack
pending — see `docs/netbird-p0-runbook.md`.
Owner: Dan
Tracking: `GTD/projects/active_projects/ConceptsOS/migrate_to_netbird.md`

## Goal (achieved)

Replaced Headscale + Tailscale end-to-end with NetBird (AGPL-3,
WireGuard), including iOS, so every layer of the ConceptsOS overlay is
open source.

## Scope

- In: per-tenant `conceptsos-node` pods, single-region NetBird mgmt plane,
  OIDC SSO, MagicDNS-equivalent hostnames, ACLs.
- Out: other Humata services, HA multi-region control plane, overlay IP
  preservation, kernel WireGuard, custom TURN.

## Final architecture

- Runtime image (`conceptsos-vpn:v6-nb-only`) ships only the `netbird`
  binary + Next.js. Interface `wt0` (WireGuard).
- `netbird` namespace runs: `netbird-management` (with a PVC for state),
  `netbird-signal`, `netbird-dashboard`, `coturn` (UDP + TCP as
  separate Services).
- Public hosts: `nb.conceptsos.com` (mgmt + dashboard, port 33073 for
  mgmt gRPC/HTTP), `signal.nb.conceptsos.com`, `turn.conceptsos.com`.
- Tenant pod: `NET_ADMIN`, `NET_RAW`, `/dev/net/tun`,
  `strategy: Recreate`, no Service. Entrypoint waits for
  `netbird status --json` → `WgIP`, then execs
  `HOSTNAME=<wg-ip> node /app/server.js`.
- Overlay CIDR `100.92.0.0/16`. MTU 1280.
- Private DNS zone `vpn.conceptsos.com` served by the mgmt service —
  no public A records. Peer example: `dans-computer.vpn.conceptsos.com`.
- All Services `externalTrafficPolicy: Cluster`.

## Authentication / SSO

**Google Workspace OIDC** as the initial IdP (see the trade-off
analysis in git history for the Zitadel/Authentik options considered).
NetBird mgmt is currently deployed with `IdpManagerConfig=none`
(P0-simplification); flip to `google` once external signup is needed.

Exit criteria for revisiting (→ Zitadel self-hosted):
- First paying customer whose users are not in `humata.ai` Google
  Workspace.
- SCIM-style deprovisioning that Google Admin SDK sync can't cover.
- Compliance mandate that the IdP live on infra we operate.

## Networking & DNS

- NAT traversal: ICE + coturn, short-lived HMAC creds handed out by
  the mgmt service.
- No subnet routes, no exit nodes.
- `vpn.conceptsos.com` served only over the overlay.

## Policy / ACLs

`docs/acl-netbird.yaml` is the source of truth. Applied idempotently
via the NetBird API from `bin/apply-policies.sh`.

## Rollout (completed)

- **P0:** built `conceptsos-vpn:v5-nb` dual-stack; deployed mgmt +
  signal + dashboard + coturn; wired mgmt PVC; DNS.
- **P1:** parallel overlay `cust-dans-computer-nb`; verified reachable
  at `http://dans-computer.vpn.conceptsos.com:3000`.
- **P2:** per-customer cutover to the NetBird overlay.
- **P3:** legacy Headscale + Tailscale removed from the repo
  (`k8s/base/{control,node,all-in-one}`, `docker/headscale.yaml.tmpl`,
  `bin/provision.sh`). Image collapsed to `v6-nb-only`. Cluster-side
  teardown (`kubectl delete ns conceptsos-control`, retire
  `hs.conceptsos.com` DNS) is the one open step — see the runbook.

## Rollback

- Repo: `git revert` the `v6-nb-only` commit to restore the dual-stack
  image + legacy manifests.
- Cluster: as long as the legacy namespaces still exist, re-apply the
  reverted overlays. Once they're deleted, rollback becomes
  redeploy-from-scratch (~30 min MTTR).
- No user data lives in either control plane; setup keys and peer
  registrations are disposable.

## Validation

- `netbird version` prints the pinned version; image size within
  current + 30MB.
- Mgmt pod `/api/health` returns 200; coturn answers STUN probes from
  in-cluster and out-of-cluster clients.
- CI: throwaway `netbird` client joins via a short-lived setup key on
  every image build.
- Reachability: in-group peer can
  `curl -f http://<peer>.vpn.conceptsos.com:3000/api/health` → 200;
  out-of-group peer times out.
- iOS E2E: Google OIDC sign-in → peer visible in dashboard in <5s →
  Safari loads the tenant app.
- Failure modes: kill mgmt (existing peers stay connected ≥24h), kill
  coturn (direct peers keep working), pod re-create (new peer joins
  in <60s with the same DNS name).
