SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- API keys are server-only: api/src/lib/apikey.ts uses adminClient()
-- (service_role) for provisioning, lookup, and last_used_at updates.
-- No client policies: deny every row even if a table grant is reintroduced.
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.api_keys FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.api_keys_id_seq FROM PUBLIC, anon, authenticated;

-- Preserve the existing server API, including bigserial ID allocation.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.api_keys TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.api_keys_id_seq TO service_role;
