// Reusable authentication utilities for API routes.
//
// Two schemes so far:
//
//   * Supabase JWT — user-facing endpoints called from the iOS app.
//     Header: `Authorization: Bearer <supabase jwt>`. See lib/supabase.ts.
//
//   * ConceptsOS API key — machine-to-machine endpoints called from inside
//     a user pod (currently only the LLM proxy). Header:
//     `Authorization: Bearer <cos_...>`. Keys live in public.api_keys and
//     are minted by ensureUserApiKey() at signup.
//
// Both helpers either return the caller identity or a ready-to-return
// 401 Response, so routes stay flat.

import { lookupApiKey, type ApiKeyOwner } from "./apikey";
import type { LogMeta } from "./log";

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!h) return null;
  if (!h.toLowerCase().startsWith("bearer ")) return null;
  const v = h.slice(7).trim();
  return v.length > 0 ? v : null;
}

function unauthorized(reason: string): Response {
  return new Response(
    JSON.stringify({ type: "error", error: { type: "authentication_error", message: reason } }),
    { status: 401, headers: { "content-type": "application/json", "www-authenticate": "Bearer" } },
  );
}

/**
 * Require a valid ConceptsOS API key on the request. On success, populates
 * `log.userId` / `log.email` for the request log line and returns the
 * owner. On failure, returns a 401 Response the caller should return as-is.
 */
export async function requireApiKey(
  req: Request,
  log?: LogMeta,
): Promise<ApiKeyOwner | Response> {
  const raw = bearer(req);
  if (!raw) return unauthorized("missing_api_key");
  const owner = await lookupApiKey(raw);
  if (!owner) return unauthorized("invalid_api_key");
  if (log) {
    log.userId = owner.userId;
    log.email = owner.email;
  }
  return owner;
}
