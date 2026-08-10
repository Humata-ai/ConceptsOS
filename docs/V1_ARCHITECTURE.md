# ConceptsOS V1 Architecture

Decisions locked in during the V1 design session. This is the source of truth;
if we deviate, update this file in the same PR.

## Product shape

- Anyone on the internet can sign up (no waitlist, no invite).
- iOS-first, distributed via **TestFlight** for V1 (App Store later).
- Native Sign in with Apple + Google Sign-In on the welcome screen.
  Email/password deferred.
- After signup, user gets a **dedicated always-on ConceptsOS-VM pod**.
- User reaches their pod over **WireGuard** from the iOS app. No public
  HTTPS to the pod.
- Inside the pod: `AgentChat` (Next.js) + pi coding agent, with an
  Anthropic API key scoped to that user.
- LLM usage is **unlimited for V1 but fully tracked**, so we can set
  per-user caps later without a schema change.

## Components

```
                                            ┌────────────────────────┐
   ┌──────────────┐   Supabase Auth         │  Supabase Cloud (GCP)  │
   │  iOS (Swift) │◄────────────────────────┤  auth.users            │
   │  WKWebView   │                         │  public.profiles       │
   │  + WG client │                         │  public.vms            │
   └───┬──────┬───┘                         │  public.llm_usage      │
       │      │                             └──────────┬─────────────┘
       │      │ HTTPS (Supabase JWT)                   │ Realtime / REST
       │      ▼                                        │
       │   api.conceptsos.com (Next.js in GKE)  ◄──────┘
       │      │  - /signup: mint wg keys*, mint Anthropic key,
       │      │             create profile row, kick controller
       │      │  - /vm:     poll status, fetch wg client config once
       │      │  - background reconcile loop → K8s API
       │      ▼
       │   ┌─────────────────────────────────────────────────┐
       │   │  GKE cluster (conceptsos-cluster)               │
       │   │                                                 │
       │   │   wg-gateway pod   ──►  user-<id> StatefulSet   │
       │   │   (1 public UDP IP,     (ConceptsOS-VM image,   │
       │   │    routes by pubkey)     wg=external mode,      │
       │   │                          10GB PVC,              │
       │   │                          ANTHROPIC_API_KEY env) │
       │   └─────────────────────────────────────────────────┘
       │
       └── WireGuard UDP ─► wg-gateway public IP ─► user's pod
```

`*` wg **private** key is generated on the iOS device and never leaves it.
iOS sends only the pubkey to `api`.

## Decisions

| # | Decision |
|---|---|
| Auth DB | **Supabase Cloud** (Pro, GCP region). Do not self-host in V1. |
| Auth providers | Sign in with Apple + Google. Native Swift, JWT bridged into WKWebView. |
| VM model | Per-user Kubernetes `StatefulSet` (replicas=1), **always on** in V1. Idle scale-to-zero is V2. |
| VM disk | 10GB PD-standard PVC per user. |
| VM image | Existing `ConceptsOS-VM/Dockerfile`, refactored to support `CONCEPTSOS_WG={embedded,external}`. `external` = our hosted mode (wg terminated at gateway). `embedded` = self-hosters. |
| Networking | **One** shared `wg-gateway` pod with **one** public UDP LoadBalancer. Routes to per-user pods by WireGuard pubkey. Users cannot reach each other. |
| wg keys | Generated on iOS device at signup. Private key stays in iOS Keychain. Server only sees pubkey. |
| wg client config | Returned to iOS **once at signup**, stored in Keychain. Not re-fetched on launch. |
| LLM provider | **Anthropic only** for V1. |
| LLM keys | **One shared Anthropic Workspace**, one API key per user, minted via Admin API at signup. Injected into pod as `ANTHROPIC_API_KEY` via K8s Secret. |
| LLM metering | Unlimited spend for V1. Hourly Cloud Run job pulls Anthropic usage API and writes to `public.llm_usage`. Cap enforcement wired up but set to ∞. |
| Provisioning API | New `api/` folder, Next.js TypeScript app, deployed to GKE, hostname `api.conceptsos.com`. |
| API ↔ K8s | Same Next.js app also runs the **reconcile loop** as a background process (watches Supabase `profiles` / `vms`, reconciles StatefulSets + wg peers via K8s API). Runs with a K8s ServiceAccount that has RBAC to create StatefulSets/Services/Secrets in the `users` namespace. |
| First-signup UX | iOS **polls** `GET /vm` every 2s until `status=ready` (~30–60s cold provision). Realtime push is V2. |
| DNS | `conceptsos.com` on Vercel DNS. Use `vercel` CLI to add the `api` A/AAAA record pointing at the GKE ingress IP. |
| Encryption at rest | **Deferred to V2.** Plain PVCs in V1. iOS already generates its own wg keypair so we're halfway to E2EE (see `SECURITY.md`). |

## Data model (Supabase / Postgres)

```sql
-- Supabase manages auth.users. Everything below is public schema.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  display_name text,
  -- LLM budget: null = unlimited (V1 default). Later: set a dollar cap.
  llm_monthly_cap_usd numeric,
  llm_usage_month_usd numeric not null default 0
);

create table public.vms (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null check (status in
    ('pending','provisioning','ready','error','deleted')),
  status_reason text,
  wg_pubkey text not null,                 -- from iOS
  wg_client_ip inet not null,              -- assigned by controller, e.g. 10.10.0.42
  wg_server_pubkey text not null,          -- gateway pubkey (same for all users)
  wg_endpoint text not null,               -- api.conceptsos.com:51820
  anthropic_key_id text,                   -- Anthropic-side key id, for revocation
  pod_name text,                           -- k8s StatefulSet name
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.llm_usage (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_usd numeric not null default 0,
  unique (user_id, day)
);
```

RLS: users can `select` their own `profiles` / `vms` / `llm_usage` rows; only
the `api` service role can `insert`/`update`.

## Repo layout after V1

```
/api/                    NEW — Next.js TS app, provisioning API + k8s controller
/AgentChat/              existing — in-pod Next.js UI
/ConceptsOS-VM/          existing — per-user pod image (add CONCEPTSOS_WG modes)
/iOS/ConceptsOS/         existing — native app, adds Supabase auth + wg import
/k8s/
  gateway/               NEW — shared wg-gateway Deployment + LB Service
  api/                   NEW — api.conceptsos.com Deployment + Ingress
  users/                 NEW — StatefulSet template rendered by controller
/terraform/              existing — add Secret Manager, Supabase provider,
                                    user node pool, ingress IP
/docs/
  V1_ARCHITECTURE.md     this file
  SECURITY.md            E2EE plan (V2)
```

## Critical path

Status as of first-cut deploy (build `1786351829`):

1. ✅ **Supabase project** `emkhiqufwtevsiworiqv` provisioned. Apple
   OAuth enabled with `client_id = ai.humata.ConceptsOS`. Tables +
   RLS applied via `sql/0001_init.sql`.
2. ✅ **`api/` Next.js app** deployed to GKE. `/api/signup`, `/api/vm`,
   `/api/health`, `/api/admin/usage-sweep` all live.
3. ✅ **`ConceptsOS-VM/Dockerfile`** refactored for
   `CONCEPTSOS_WG={embedded,external}`.
4. ✅ **`wg-gateway` pod** deployed; public UDP LB at `35.253.153.78:51820`.
5. ✅ **Reconcile loop** running in the `api` pod; verified end-to-end
   (test user got a Ready pod within ~30s, deletion tore everything
   down cleanly).
6. ⚠️  **Anthropic key minting** — code is in place, currently running
   in shared-key mode (falls back to `ANTHROPIC_API_KEY` because
   `ANTHROPIC_ADMIN_KEY` isn't set yet). Both secrets are placeholders
   in the k8s Secret; flip them to real values to unlock per-user keys.
7. ✅ **iOS** — native Sign in with Apple wired, Curve25519 keypair
   on-device, `POST /api/signup`, poll `GET /api/vm`, QR code for
   manual WireGuard import (V1), WKWebView on `10.10.0.1:3000`.
   Uploaded to TestFlight as build `1786351829` (v1.1).
8. ✅ **Hourly usage sweep** CronJob applied; scaffolded to Anthropic
   Admin API but returns 0 until `fetchAnthropicUsage()` is wired to
   the real endpoint (see TODO in `api/src/app/api/admin/usage-sweep`).
9. ✅ **TestFlight** push — auto-distributes to internal testers on
   processing.

### Still needing manual action (Dan)

- Provide an `ANTHROPIC_ADMIN_KEY` (Anthropic org admin API key) and
  `ANTHROPIC_WORKSPACE_ID`, then
  `kubectl -n conceptsos-system patch secret conceptsos-api-secrets`
  to flip out of shared-key mode.
- Verify Sign in with Apple **capability** is enabled on the
  `ai.humata.ConceptsOS` App ID in the Apple Developer portal (it's
  usually auto-added by Xcode auto-provisioning, but confirm).
- Add Google Sign-In in a follow-up (needs an iOS OAuth client id
  from GCP + Supabase provider config).

## Non-goals for V1

- Scale-to-zero / idle shutdown
- E2EE persistent volumes (Tier 1/2/3)
- Realtime push for provisioning status
- Email/password auth
- OpenAI or other LLM providers
- Enforced per-user spend caps (tracked but not enforced)
- Multi-region
- Reproducible / attested builds
