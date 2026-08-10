-- V1 free credits.
--
-- Every user starts with $10 of Anthropic spend. Decremented by the
-- hourly usage sweep. When it hits $0 the api revokes their Anthropic
-- key so further LLM calls fail — the pod stays up so their data and
-- other pod features aren't lost.
--
-- We keep `llm_monthly_cap_usd` around for a future monthly plan;
-- credit_usd_remaining is a separate, additive concept.

alter table public.profiles
  add column if not exists credit_usd_remaining numeric not null default 10;

-- Backfill any existing signups to the same starting amount so early
-- testers don't accidentally have $0.
update public.profiles
   set credit_usd_remaining = 10
 where credit_usd_remaining is null
    or credit_usd_remaining = 0;

-- The existing on-signup trigger inserts only (id, display_name); the
-- column default takes care of credit. Nothing to change there.

-- RLS: users are already allowed to select their own profile row, which
-- means they can see their remaining credit. No new policy needed.
