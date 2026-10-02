#!/usr/bin/env bash
# Only disposable databases on Mosaic's isolated local Supabase stack.
# No production credentials, Docker access, or changes to existing databases.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
db="conceptsos_rls_test_$$"
created=0
psql_local() {
  local database="$1"; shift
  env -i PATH="$PATH" PGPASSWORD=postgres PGPASSFILE=/dev/null \
    PGSERVICEFILE=/dev/null PGCONNECT_TIMEOUT=5 \
    psql -X -w -q -v ON_ERROR_STOP=1 \
    --dbname "postgresql://postgres@127.0.0.1:55322/${database}?sslmode=disable" "$@"
}
cleanup() {
  if [[ "$created" == 1 ]]; then
    psql_local postgres -c "DROP DATABASE \"$db\";"
    created=0
  fi
}
trap cleanup EXIT
for mode in fresh upgrade; do
  psql_local postgres -c "CREATE DATABASE \"$db\";"
  created=1
  # Minimal Supabase auth fixture; roles are supplied by the local stack.
  psql_local "$db" <<'SQL'
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
SQL
  for file in "$root"/sql/[0-9]*.sql; do
    if [[ "$mode" == upgrade && "$(basename "$file")" == 0005_api_keys_rls.sql ]]; then
      psql_local "$db" --single-transaction -f "$root/sql/tests/api_keys_seed.sql"
      # Reproduce the original exposure, including an inherited PUBLIC grant.
      psql_local "$db" -c "GRANT ALL ON public.api_keys TO PUBLIC; GRANT ALL ON public.api_keys_id_seq TO PUBLIC; SET ROLE anon; SELECT key_hash FROM public.api_keys;" >/dev/null
      # A failure after the DDL must roll back RLS and ACL changes together.
      if psql_local "$db" --single-transaction -f "$file" -c 'SELECT 1 / 0;' >/dev/null 2>&1; then
        echo 'Expected a failed migration transaction' >&2
        exit 1
      fi
      psql_local "$db" <<'SQL'
DO $$ BEGIN
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.api_keys'::regclass)
     OR NOT has_table_privilege('anon', 'public.api_keys', 'SELECT')
     OR NOT has_sequence_privilege('anon', 'public.api_keys_id_seq', 'USAGE')
     OR (SELECT count(*) FROM public.api_keys) <> 2 THEN
    RAISE EXCEPTION 'Failed migration did not roll back atomically';
  END IF;
END $$;
SQL
    fi
    psql_local "$db" --single-transaction -f "$file"
  done
  if [[ "$mode" == fresh ]]; then
    psql_local "$db" --single-transaction -f "$root/sql/tests/api_keys_seed.sql"
  fi
  psql_local "$db" -f "$root/sql/tests/api_keys_rls.sql" >/dev/null
  # Safe replay must leave data, service access, and client denial unchanged.
  psql_local "$db" --single-transaction -f "$root/sql/0005_api_keys_rls.sql"
  psql_local "$db" -f "$root/sql/tests/api_keys_rls.sql" >/dev/null
  echo "PASS: $mode, authorization checks, and replay"
  cleanup
done
