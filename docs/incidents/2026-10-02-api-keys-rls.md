# conceptsos-prd: API-key table exposed without RLS

## Status

**Fix prepared and locally tested; production application is pending approval.**
Committing or merging this change does not apply SQL to production. This repository
had no database deployment workflow at investigation time; the added Database
security workflow only validates disposable fixtures. Do not use Mosaic's
migration pipeline for this separate project or alter a migration ledger.

## Confirmed metadata (2026-10-02)

Target: ConceptsOS Supabase project `emkhiqufwtevsiworiqv` (`conceptsos-prd`).
The September 27 Security Advisor alert was still valid:

- `public.api_keys`: RLS disabled, zero policies. Both `anon` and `authenticated`
  held SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, and TRIGGER grants;
  the ID sequence also granted client access. No column-level ACLs were present.
- `profiles`, `vms`, and `llm_usage`: RLS enabled, each with an owner-only SELECT
  policy (`auth.uid() = id` or `auth.uid() = user_id`). Their policies were not
  permissive all-row policies. Existing broad grants, including TRUNCATE (which
  RLS does not govern), remain a separate least-privilege follow-up.
- `service_role` bypasses RLS; neither client role does.
- Only catalog metadata was queried. No production key values or user rows were
  retrieved, and no exploit or production write test was attempted.

The original investigation began in Mosaic, whose local schema already had RLS
on API keys. That did not describe ConceptsOS: production here has four public
tables, not Mosaic's 75. The project is independently identified in this repo's
README and iOS AppConfig.

## Cause and compatibility

`sql/0003_api_keys.sql` created the table and sequence but omitted RLS and grant
restrictions. Supabase's defaults granted API client roles access.

`api/src/lib/apikey.ts` provisions keys, looks them up, and touches usage through
`adminClient()` (`service_role`). There are no direct client API-key table callers
in the repository. Hashes are stored in `api_keys`; the server also stores raw
pod keys in `vms.pod_api_key`, protected by the owning-user SELECT policy.

New append-only migration `sql/0005_api_keys_rls.sql`:

- Enables RLS with no client policies (deny all rows).
- Revokes all table and ID-sequence grants from PUBLIC, anon, and authenticated.
- Explicitly preserves service-role CRUD and sequence allocation.
- Does not rewrite data, rotate keys, change the other tables' policies, or change
  the running app. No app redeployment is required for this access-control fix.
- Must run in one transaction: 5s lock timeout and 60s statement timeout. The
  ALTER takes an exclusive table lock briefly; there is no row scan/backfill.

## Validation

Run `bash bin/test-api-keys-rls.sh` against the isolated local Supabase Postgres at
`127.0.0.1:55322`. The script creates uniquely named disposable databases and
cleans them up. It never changes the existing app database or accepts a hosted
connection. CI supplies a PostgreSQL 17 service with Supabase role fixtures.
Auth is a minimal fixture, not a full GoTrue/PostgREST installation.

Passed locally:

- Fresh schema and populated upgrade from 0001–0004, preserving keys and VM state.
- Actual anon/authenticated role denial for SELECT, INSERT, UPDATE, DELETE,
  TRUNCATE, and sequence allocation, including inherited PUBLIC grants.
- RLS still hides all rows and prevents mutations if table grants return.
- Service-role insert, lookup, usage update, revocation, and delete still work.
- Owning-user reads on the other three tables remain isolated; anon sees no rows.
- Injected transaction failure rolls back the migration; retry and replay succeed.

## Production application boundary

Owner approval for a **manual transactional application of this exact migration**
is needed because there is no automated ConceptsOS deployment pipeline. The old
schema documents SQL-editor/manual migration application, not a validated
production runner. Do not silently route around Mosaic's unrelated protections.

After approval:

1. Verify the target ref above independently; recheck `api_keys` columns, policies,
   table/sequence ACLs and service-role bypass. Stop on unexpected schema/policies.
2. Apply only `sql/0005_api_keys_rls.sql` in a single transaction using an approved
   production connection and `ON_ERROR_STOP`. Do not replay 0001–0004, use reset,
   repair a ledger, or add a production-write option to `db:query`.
3. Run `sql/verify_api_keys_rls.sql` through the read-only query helper with the
   same explicitly validated project. Expect RLS true, zero policies, zero client
   CRUD/TRUNCATE/sequence grants, service-role CRUD/sequence grants intact, and
   zero public tables without RLS. Recheck Security Advisor.
4. Confirm an existing authorized app session can still use the LLM proxy and
   provisioning. Do not print bearer tokens or insert test users/keys in production.
5. Record the applied commit/hash and verification result here. If a timeout or
   connection failure occurs, verify metadata before retrying. Do not restore
   public grants or disable RLS as a rollback; investigate and fix forward.

## Incident follow-up

No conclusion about exploitation can be drawn from catalog metadata. Publicly
writable key hashes can allow forged key ownership, not just disclosure of hashes;
securing the table does not invalidate potentially attacker-created records.
Review available access/LLM/provisioning logs and key issuance integrity. Plan
coordinated key rotation/reissuance if warranted, including `vms.pod_api_key` and
running pod configuration. Do not mass-revoke or rotate automatically: that would
interrupt legitimate pods and requires its own approved recovery plan.
