-- ConceptsOS V1 schema.
--
-- Apply to a Supabase project (SQL editor or `supabase db push`).
-- Supabase owns the `auth` schema; everything below is in `public`.

-- ---------------------------------------------------------------------------
-- profiles: per-user app metadata. One row per auth.users row.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id                     uuid primary key references auth.users(id) on delete cascade,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  display_name           text,
  -- V1: null == unlimited. Set a numeric cap to enforce a monthly budget.
  llm_monthly_cap_usd    numeric,
  -- Rolling total for the current calendar month. Reset by a monthly job.
  llm_usage_month_usd    numeric not null default 0
);

-- Auto-create a profile row whenever a new auth.users row lands.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- vms: per-user ConceptsOS-VM pod state. One row per user.
-- Written by the api service; read by the api service and (via RLS) by
-- the owning user (so iOS can poll status).
-- ---------------------------------------------------------------------------
create table if not exists public.vms (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  status              text not null default 'pending'
                      check (status in ('pending','provisioning','ready','error','deleted')),
  status_reason       text,
  -- WireGuard: iOS generates the keypair; we only ever see the pubkey.
  wg_pubkey           text,
  wg_client_ip        inet,               -- e.g. 10.10.0.42, assigned by controller
  wg_server_pubkey    text,               -- gateway pubkey (same for all users)
  wg_endpoint         text,               -- e.g. api.conceptsos.com:51820
  wg_preshared_key    text,               -- one PSK per user, server-generated
  -- Anthropic per-user key metadata (the actual key value never leaves the
  -- api service and the pod's k8s Secret — we only store the id for revoke).
  anthropic_key_id    text,
  -- Kubernetes bookkeeping.
  pod_name            text,
  pod_namespace       text,
  service_cluster_ip  inet,
  -- Timing.
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  ready_at            timestamptz
);

-- ---------------------------------------------------------------------------
-- llm_usage: per-user, per-day Anthropic usage roll-up.
-- Written by the hourly usage sweep. profiles.llm_usage_month_usd is a
-- denormalized rolling sum kept in sync by the same job.
-- ---------------------------------------------------------------------------
create table if not exists public.llm_usage (
  id             bigserial primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  day            date not null,
  input_tokens   bigint not null default 0,
  output_tokens  bigint not null default 0,
  cost_usd       numeric not null default 0,
  updated_at     timestamptz not null default now(),
  unique (user_id, day)
);

create index if not exists llm_usage_user_day_idx on public.llm_usage(user_id, day desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers.
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists vms_touch on public.vms;
create trigger vms_touch before update on public.vms
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security. Users see only their own rows; writes are done by
-- the api service using the service_role key (which bypasses RLS).
-- ---------------------------------------------------------------------------
alter table public.profiles  enable row level security;
alter table public.vms       enable row level security;
alter table public.llm_usage enable row level security;

drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
  for select using (auth.uid() = id);

drop policy if exists vms_self_select on public.vms;
create policy vms_self_select on public.vms
  for select using (auth.uid() = user_id);

drop policy if exists llm_usage_self_select on public.llm_usage;
create policy llm_usage_self_select on public.llm_usage
  for select using (auth.uid() = user_id);

-- No user-facing write policies. All writes go through the api service.
