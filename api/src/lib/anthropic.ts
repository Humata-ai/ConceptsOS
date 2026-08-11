// Anthropic access model.
//
// User pods do NOT receive an Anthropic API key. They point at the api
// service's reverse proxy (`/api/llm/v1/*`), which injects the org's
// ANTHROPIC_API_KEY server-side. See src/app/api/llm/v1/[...path]/route.ts.
//
// Why: Anthropic's Admin API has no create-api-key endpoint, so we can't
// mint real per-user keys. Handing every pod the same shared key is a
// non-starter — a user is root in their own pod and would exfiltrate it.
// So we keep the key in this service and proxy.

import { env } from "./env";

// Compat shim for the legacy `revokeUserKey` call on the delete-account
// path. Old vms rows may still have `anthropic_key_id` set to a real
// Anthropic key id from before the proxy migration; best-effort revoke
// those. Rows with `"shared"` or null are no-ops.
export async function revokeUserKey(keyId: string): Promise<void> {
  if (!keyId || keyId === "shared" || keyId === "proxied") return;
  const admin = env.anthropicAdminKey();
  if (!admin) return;
  await fetch(`https://api.anthropic.com/v1/organizations/api_keys/${keyId}`, {
    method: "POST",
    headers: {
      "x-api-key": admin,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ status: "inactive" }),
  }).catch(() => {
    /* best effort */
  });
}
