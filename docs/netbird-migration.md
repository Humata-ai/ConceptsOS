# NetBird Migration Design

Status: Draft
Owner: Dan
Tracking: `GTD/projects/active_projects/ConceptsOS/migrate_to_netbird.md`

## Goal

Replace Headscale + Tailscale end-to-end with NetBird (AGPL-3, WireGuard),
including iOS, so that every layer of the ConceptsOS overlay is open
source.

## Scope

- In: per-tenant `conceptsos-node` pods, single-region NetBird mgmt plane,
  OIDC SSO, MagicDNS-equivalent hostnames, ACLs.
- Out: other Humata services, HA multi-region control plane, overlay IP
  preservation, kernel WireGuard, custom TURN.

## Architecture

- Runtime image drops `headscale` + `tailscale`, installs a single
  `netbird` binary. Interface renamed `tailscale0` → `wt0`.
- New `netbird` namespace running: `netbird-management`,
  `netbird-signal`, `netbird-dashboard`, `coturn`.
- Public hosts: `nb.conceptsos.com` (mgmt + dashboard),
  `turn.conceptsos.com` (STUN/TURN). `hs.conceptsos.com` retired at P3.
- Tenant pod shape unchanged: `NET_ADMIN`, `NET_RAW`, `/dev/net/tun`,
  `strategy: Recreate`, no Service. Entrypoint waits for
  `netbird status --json` → `WgIP`, then execs
  `HOSTNAME=<wg-ip> node /app/server.js`.
- Overlay CIDR `100.92.0.0/16` (disjoint from current `100.64.0.0/10`
  so both stacks can run side-by-side during cutover). MTU 1280.
- MagicDNS-equivalent base domain: `netbird.conceptsos.com` (private,
  no public A records). Peer `dans-computer.ts.conceptsos.com` becomes
  `dans-computer.netbird.conceptsos.com`.
- `:3478/udp` moves out of the tenant image and into the coturn
  deployment.

## Authentication / SSO Migration

### Decision

**Use Google Workspace as the OIDC IdP for NetBird in P0/P1.** Revisit
before opening signup to external (non-Humata) customers, at which point
we migrate to Zitadel self-hosted in the `netbird` namespace.

### Options considered

| Option           | License       | Hosting          | Time-to-live | External signup | Notes |
|------------------|---------------|------------------|--------------|-----------------|-------|
| Google Workspace | proprietary   | SaaS (existing)  | hours        | no (Google-only)| Already the source of truth for `@humata.ai`; NetBird mgmt integrates with the Google OIDC + Admin SDK for user sync. Zero new infra. |
| Zitadel          | Apache-2.0    | self-host (k8s)  | ~1 week      | yes             | First-class NetBird integration, multi-tenant, passkeys, SCIM. Adds a Postgres dep and an extra public hostname (`id.conceptsos.com`). |
| Authentik        | MIT           | self-host (k8s)  | ~1 week      | yes             | Flexible flows, but heavier (Redis + Postgres + worker + server), Python stack, historically more churn on NetBird integration guides. |

### Why Google Workspace first

1. **Fastest path to P0/P1 milestones.** All current users are already
   in the `humata.ai` Google Workspace tenant; login is one OAuth
   consent screen away. No new database, no new public hostname, no new
   backup/DR surface.
2. **Aligned with today's threat model.** Only Humata employees and a
   handful of design-partner accounts need overlay access before P3.
   Google Workspace already gates that population with hardware-key
   2FA and device policies we trust.
3. **Reversible.** NetBird's IdP is configured per-account; swapping
   Google → Zitadel later is a mgmt-plane config change and a one-time
   re-enrollment (setup keys are disposable, per the project's rollback
   plan). It does not touch the runtime image or the tenant pods.
4. **Keeps the open-source scorecard honest.** The data plane
   (WireGuard + NetBird agent + coturn) and the control plane
   (management, signal, dashboard) are 100% AGPL. Only the *identity*
   layer stays SaaS, and only until we need external signup — which is
   the exact trigger to move to Zitadel.

### Why not Zitadel now

Zitadel is the intended long-term home, but it's a strict superset of
what P0/P1 needs. Standing it up before we have a customer who cannot
sign in via Google would front-load ~1 week of infra work (Postgres,
backup policy, `id.conceptsos.com` cert + DNS, SMTP for verification
mails) with no user-visible benefit and would push out the P1 pilot
deadline.

### Why not Authentik

Same "not yet" reasoning as Zitadel, plus: heavier component count,
Python worker + broker, and NetBird's docs treat Zitadel as the
reference self-hosted IdP. If we're going to eat self-hosted-IdP
complexity, we should eat it on the path with better upstream support.

### Google Workspace integration checklist (P0)

- [ ] Create OAuth 2.0 client in the `humata.ai` GCP project:
      redirect URIs `https://nb.conceptsos.com/auth/callback` and
      `https://nb.conceptsos.com/silent-auth`.
- [ ] Create a service account with Admin SDK Directory API read-only
      scopes (`admin.directory.user.readonly`,
      `admin.directory.group.readonly`) and domain-wide delegation
      granted by a Workspace super-admin.
- [ ] Wire the client ID / secret and the service-account JSON into
      the NetBird management config
      (`management.json` → `IdpManagerConfig` = `google`).
- [ ] Restrict OIDC to the `humata.ai` hosted domain
      (`hd=humata.ai`, enforced in mgmt config).
- [ ] Verify admin login end-to-end at `https://nb.conceptsos.com`
      before proceeding to P1.

### Exit criteria for revisiting

Move to Zitadel when **any** of the following is true:
- We onboard the first paying customer whose users are not in
  `humata.ai` Google Workspace.
- We need SCIM-style deprovisioning that Google's Admin SDK sync
  cannot cover.
- Compliance requires that the IdP live on infra we operate.

## Networking & DNS

- NAT traversal: ICE + coturn, with short-lived HMAC creds handed out
  by the management service.
- v1 has no subnet routes and no exit nodes.
- `netbird.conceptsos.com` is a private DNS zone served by the NetBird
  management service; no records leak into public DNS.

## Policy / ACL Migration

- Translate current Headscale HuJSON policy into NetBird
  source-group → destination-group policies.
- Mapping rules:
  - Headscale `user` → NetBird `group`.
  - Headscale `tag:*` → NetBird `group`.
  - Per-user autogroups → single-member NetBird group + policy.
  - SSH ACL → NetBird SSH gated by the equivalent policy.
- Author `docs/acl-netbird.yaml`, apply idempotently via the NetBird
  API from `bin/apply-policies.sh`, and verify default-deny between
  customer groups in the P1 pilot.

## Rollout

- **P0 (prep):** build `conceptsos-vpn:v5-nb` with both clients
  installed side-by-side; deploy mgmt + signal + dashboard + coturn;
  wire Google Workspace OIDC; smoke-test admin login.
- **P1 (pilot):** stand up a parallel overlay
  `cust-dans-computer-nb`; iOS app + Google OIDC sign-in; verify app
  reachable at `http://dans-computer.netbird.conceptsos.com:3000`;
  run side-by-side with the Headscale overlay for 1 week.
- **P2 (per-customer cutover):** for each tenant, add the NetBird
  overlay next to the old one → verify → delete the old one. Order:
  internal → friendlies → paid.
- **P3 (decommission):** confirm Headscale idle → delete Headscale and
  `hs.conceptsos.com` → ship `v6-nb-only` image with `tailscale` removed.

## Rollback

- P0–P1: delete the `netbird` namespace and its DNS entries; no
  user-visible impact.
- P2: re-apply the previous customer overlay from git (both stacks
  stay live for a week to make this a config revert, not a rebuild).
- Post-P3: git-revert the Dockerfile and redeploy Headscale (~30 min
  MTTR).
- No user data lives in either control plane; setup keys and peer
  registrations are disposable.

## Validation

- Image: `netbird version` prints the pinned version; image size is at
  most current + 30MB.
- Mgmt pod `/api/health` returns 200; coturn answers STUN probes from
  in-cluster and out-of-cluster clients.
- CI: throwaway `netbird` client joins via a short-lived setup key on
  every image build.
- Reachability: an in-group peer can `curl -f
  http://<peer>.netbird.conceptsos.com:3000/api/health` → 200; an
  out-of-group peer times out.
- iOS E2E: Google OIDC sign-in → peer visible in dashboard in <5s →
  Safari loads the tenant app.
- Failure modes: kill mgmt (existing peers stay connected ≥24h), kill
  coturn (direct peers keep working), pod re-create (new peer joins
  in <60s with the same DNS name).
- Load: 50 concurrent peers, p95 API latency <200ms.
- Rollback drill executed in a scratch namespace; MTTR measured and
  recorded here.
