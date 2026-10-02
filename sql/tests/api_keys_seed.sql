-- Synthetic users/keys only, inside the disposable test database.
INSERT INTO auth.users (id, email) VALUES
  ('10000000-0000-0000-0000-000000000001', 'first@example.invalid'),
  ('10000000-0000-0000-0000-000000000002', 'second@example.invalid');
INSERT INTO public.vms (user_id, pod_api_key) VALUES
  ('10000000-0000-0000-0000-000000000001', 'synthetic-pod-key-1'),
  ('10000000-0000-0000-0000-000000000002', 'synthetic-pod-key-2');
INSERT INTO public.llm_usage (user_id, day) VALUES
  ('10000000-0000-0000-0000-000000000001', '2026-09-27'),
  ('10000000-0000-0000-0000-000000000002', '2026-09-27');
INSERT INTO public.api_keys (user_id, key_hash, key_prefix) VALUES
  ('10000000-0000-0000-0000-000000000001', 'synthetic-hash-1', 'synthetic-1'),
  ('10000000-0000-0000-0000-000000000002', 'synthetic-hash-2', 'synthetic-2');
