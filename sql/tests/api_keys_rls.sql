BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

CREATE FUNCTION pg_temp.check_ok(ok boolean, message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', message; END IF;
END;
$$;
CREATE FUNCTION pg_temp.denied(statement text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'Expected insufficient_privilege: %', statement;
EXCEPTION WHEN insufficient_privilege THEN NULL;
END;
$$;

SELECT pg_temp.check_ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.api_keys'::regclass),
  'api_keys RLS must be enabled');
SELECT pg_temp.check_ok(
  NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.api_keys'::regclass),
  'api_keys must have no client policies');
SELECT pg_temp.check_ok(count(*) = 2 AND bool_and(key_hash LIKE 'synthetic-hash-%'),
  'Migration must preserve existing API keys') FROM public.api_keys;
SELECT pg_temp.check_ok(count(*) = 2 AND bool_and(pod_api_key LIKE 'synthetic-pod-key-%'),
  'Migration must preserve VM key configuration') FROM public.vms;

-- Server-side provisioning, lookup, touch, revocation, and deletion still work.
SET LOCAL ROLE service_role;
INSERT INTO public.api_keys (user_id, key_hash, key_prefix)
VALUES ('10000000-0000-0000-0000-000000000001', 'synthetic-new-hash', 'synthetic-new');
SELECT pg_temp.check_ok(count(*) = 1, 'Server lookup failed')
FROM public.api_keys WHERE key_hash = 'synthetic-new-hash' AND revoked_at IS NULL;
UPDATE public.api_keys SET last_used_at = now(), revoked_at = now()
WHERE key_hash = 'synthetic-new-hash';
SELECT pg_temp.check_ok(count(*) = 1, 'Server touch/revocation failed')
FROM public.api_keys WHERE key_hash = 'synthetic-new-hash' AND last_used_at IS NOT NULL AND revoked_at IS NOT NULL;
DELETE FROM public.api_keys WHERE key_hash = 'synthetic-new-hash';
SELECT pg_temp.check_ok(count(*) = 2, 'Server deletion failed') FROM public.api_keys;
RESET ROLE;

-- Test both unauthenticated and signed-in clients using actual database roles.
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    PERFORM pg_temp.check_ok(
      NOT has_table_privilege(role_name, 'public.api_keys', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
      role_name || ' retains a table grant');
    PERFORM pg_temp.check_ok(
      NOT has_sequence_privilege(role_name, 'public.api_keys_id_seq', 'USAGE,SELECT,UPDATE'),
      role_name || ' retains a sequence grant');
    PERFORM set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
    EXECUTE format('SET LOCAL ROLE %I', role_name);
    PERFORM pg_temp.denied('SELECT * FROM public.api_keys');
    PERFORM pg_temp.denied('INSERT INTO public.api_keys (user_id,key_hash,key_prefix) VALUES (''10000000-0000-0000-0000-000000000001'',''forged-hash'',''forged'')');
    PERFORM pg_temp.denied('UPDATE public.api_keys SET revoked_at = NULL');
    PERFORM pg_temp.denied('DELETE FROM public.api_keys');
    PERFORM pg_temp.denied('TRUNCATE public.api_keys');
    PERFORM pg_temp.denied('SELECT nextval(''public.api_keys_id_seq'')');
    RESET ROLE;
  END LOOP;
END;
$$;

-- Defense in depth: RLS still denies all rows if grants accidentally return.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_keys TO anon, authenticated;
GRANT USAGE ON public.api_keys_id_seq TO anon, authenticated;
DO $$
DECLARE role_name text; affected bigint;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', role_name);
    PERFORM pg_temp.check_ok((SELECT count(*) = 0 FROM public.api_keys), 'RLS leaked keys');
    PERFORM pg_temp.denied('INSERT INTO public.api_keys (user_id,key_hash,key_prefix) VALUES (''10000000-0000-0000-0000-000000000001'',''forged-hash'',''forged'')');
    UPDATE public.api_keys SET revoked_at = NULL;
    GET DIAGNOSTICS affected = ROW_COUNT;
    PERFORM pg_temp.check_ok(affected = 0, 'RLS allowed updates');
    DELETE FROM public.api_keys;
    GET DIAGNOSTICS affected = ROW_COUNT;
    PERFORM pg_temp.check_ok(affected = 0, 'RLS allowed deletion');
    RESET ROLE;
  END LOOP;
END;
$$;

-- Existing owning-user reads on the other three tables remain intact.
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_ok(count(*) = 1 AND bool_and(id = auth.uid()), 'Profile isolation regressed') FROM public.profiles;
SELECT pg_temp.check_ok(count(*) = 1 AND bool_and(user_id = auth.uid()), 'VM isolation regressed') FROM public.vms;
SELECT pg_temp.check_ok(count(*) = 1 AND bool_and(user_id = auth.uid()), 'Usage isolation regressed') FROM public.llm_usage;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);
SET LOCAL ROLE anon;
SELECT pg_temp.check_ok(count(*) = 0, 'Anonymous profile leak') FROM public.profiles;
SELECT pg_temp.check_ok(count(*) = 0, 'Anonymous VM leak') FROM public.vms;
SELECT pg_temp.check_ok(count(*) = 0, 'Anonymous usage leak') FROM public.llm_usage;
RESET ROLE;
ROLLBACK;
