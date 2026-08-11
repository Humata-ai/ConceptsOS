-- Per-user API keys.
--
-- Each user gets one long-lived API key at signup. The pod is provisioned
-- with the raw key as $CONCEPTSOS_API_KEY (see api/src/lib/k8s.ts), and pi's
-- Anthropic proxy extension forwards it as `Authorization: Bearer <key>` to
-- our /api/llm reverse proxy. The proxy uses this to identify the calling
-- user for authz + usage attribution.
--
-- We store only the SHA-256 hash of the key at rest. The raw key is also
-- kept on the vms row (`pod_api_key`) so the reconcile loop can project it
-- into the StatefulSet env — same trust boundary as `wg_preshared_key`.

create table if not exists public.api_keys (
  id           bigserial primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  key_hash     text not null unique,       -- sha256(rawKey) hex
  key_prefix   text not null,              -- first ~12 chars, for display / debugging
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create index if not exists api_keys_user_id_idx on public.api_keys (user_id);
create index if not exists api_keys_active_idx  on public.api_keys (user_id) where revoked_at is null;

-- Raw key material lives on the vms row alongside the wg preshared key so
-- the reconcile loop can project it into the user pod's env. Nullable so
-- older rows (pre-migration) don't break; signup fills it in going forward.
alter table public.vms
  add column if not exists pod_api_key text;
