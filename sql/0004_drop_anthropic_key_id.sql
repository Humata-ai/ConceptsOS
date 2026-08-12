-- 0004_drop_anthropic_key_id.sql
--
-- Drop the legacy per-user Anthropic-key column from public.vms.
--
-- We used to mint one Anthropic workspace API key per user via the
-- Admin API and hand it to their pod as a k8s Secret. That model was
-- retired: user pods now call our LLM reverse proxy (`/api/llm/v1/*`),
-- which injects the org's shared key server-side. See
-- api/src/app/api/llm/v1/[...path]/route.ts. The column has been dead
-- weight since that migration.

alter table public.vms
  drop column if exists anthropic_key_id;
