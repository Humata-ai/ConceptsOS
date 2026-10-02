-- Metadata only; safe for db:query --prod --file. Never returns key material.
SELECT c.relrowsecurity AS rls_enabled,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count,
       r.role_name,
       has_table_privilege(r.role_name, c.oid, 'SELECT') AS can_select,
       has_table_privilege(r.role_name, c.oid, 'INSERT') AS can_insert,
       has_table_privilege(r.role_name, c.oid, 'UPDATE') AS can_update,
       has_table_privilege(r.role_name, c.oid, 'DELETE') AS can_delete,
       has_table_privilege(r.role_name, c.oid, 'TRUNCATE') AS can_truncate,
       has_sequence_privilege(r.role_name, 'public.api_keys_id_seq', 'USAGE') AS can_allocate_id,
       (SELECT count(*) FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relkind IN ('r', 'p') AND NOT t.relrowsecurity) AS public_tables_without_rls
FROM pg_class c CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) r(role_name)
WHERE c.oid = 'public.api_keys'::regclass
ORDER BY r.role_name;
