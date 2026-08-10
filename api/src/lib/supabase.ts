// Supabase clients.
//
// We keep two long-lived clients on the server:
//
//   * `adminClient()`   — service_role key, bypasses RLS. Used by the api
//                         routes and reconcile loop for all writes.
//   * `userClient(jwt)` — anon key + user's JWT. Used only to validate an
//                         incoming Authorization header and get the user's
//                         id. RLS applies, so this cannot be abused to
//                         read/write other users' rows.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let _admin: SupabaseClient | null = null;

export function adminClient(): SupabaseClient {
  if (_admin) return _admin;
  _admin = createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _admin;
}

export function userClient(jwt: string): SupabaseClient {
  return createClient(env.supabaseUrl(), env.supabaseAnonKey(), {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Verifies an Authorization: Bearer <jwt> header and returns the caller's
// auth.users.id, or null if the token is missing/invalid.
export async function authUserId(req: Request): Promise<string | null> {
  const h = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!h || !h.toLowerCase().startsWith("bearer ")) return null;
  const jwt = h.slice(7).trim();
  if (!jwt) return null;
  const { data, error } = await userClient(jwt).auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}
