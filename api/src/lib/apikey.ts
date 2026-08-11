// Per-user API keys.
//
// Format: `cos_` + 32 bytes of base64url randomness (~43 chars). Stored
// hashed (sha256 hex) in public.api_keys. The raw key is also persisted on
// the vms row so reconcile can project it into the pod env — same trust
// level as wg_preshared_key.

import { randomBytes, createHash } from "node:crypto";
import { adminClient } from "./supabase";

const PREFIX = "cos_";

export function generateApiKey(): string {
  const rand = randomBytes(32).toString("base64url");
  return `${PREFIX}${rand}`;
}

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function keyPrefix(raw: string): string {
  return raw.slice(0, 12);
}

/**
 * Ensure the given user has an active API key. If they already have one,
 * we return the raw key from vms.pod_api_key (idempotent — safe to call on
 * every signup/reconcile). If not, we mint one, store the hash in
 * api_keys, and stash the raw value on the vms row.
 */
export async function ensureUserApiKey(userId: string): Promise<string> {
  const db = adminClient();

  // Fast path: raw key already stashed on vms row.
  const { data: vm } = await db
    .from("vms")
    .select("pod_api_key")
    .eq("user_id", userId)
    .maybeSingle();
  if (vm?.pod_api_key) return vm.pod_api_key;

  // Mint a fresh key.
  const raw = generateApiKey();
  const hash = hashApiKey(raw);
  const prefix = keyPrefix(raw);

  const { error: insErr } = await db
    .from("api_keys")
    .insert({ user_id: userId, key_hash: hash, key_prefix: prefix });
  if (insErr) throw new Error(`api_keys insert: ${insErr.message}`);

  // Stash on vms row so reconcile can project it into pod env.
  const { error: updErr } = await db
    .from("vms")
    .update({ pod_api_key: raw })
    .eq("user_id", userId);
  if (updErr) throw new Error(`vms update: ${updErr.message}`);

  return raw;
}

export interface ApiKeyOwner {
  userId: string;
  email: string | null;
}

/**
 * Look up an API key by raw value. Returns owner info or null if the key
 * is unknown or revoked. Updates last_used_at on hit (best-effort).
 */
export async function lookupApiKey(raw: string): Promise<ApiKeyOwner | null> {
  if (!raw || !raw.startsWith(PREFIX)) return null;
  const hash = hashApiKey(raw);
  const db = adminClient();

  const { data: row } = await db
    .from("api_keys")
    .select("user_id, revoked_at")
    .eq("key_hash", hash)
    .maybeSingle();
  if (!row || row.revoked_at) return null;

  // Best-effort touch — don't block the request path on this.
  void db
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("key_hash", hash);

  // Resolve email from auth.users via the admin API.
  let email: string | null = null;
  try {
    const { data: u } = await db.auth.admin.getUserById(row.user_id);
    email = u?.user?.email ?? null;
  } catch {
    /* email is best-effort */
  }

  return { userId: row.user_id, email };
}
