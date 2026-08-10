// Anthropic per-user key management.
//
// Two modes:
//
//   * "workspace" mode — ANTHROPIC_ADMIN_KEY is set. We mint a real
//     per-user API key via Anthropic's Admin API, scoped to a shared
//     workspace, and return the actual key value (only visible once).
//
//   * "shared-key" mode — ANTHROPIC_ADMIN_KEY is unset. We fall back to
//     handing every user the same ANTHROPIC_API_KEY. Documented as V1
//     degraded mode; the api still records anthropic_key_id = "shared".
//
// The actual key value is only ever held in memory inside this service
// and inside the k8s Secret we project into the user's pod. It never
// touches the Supabase DB.

import { env } from "./env";

export interface MintedKey {
  keyId: string;        // stored in public.vms.anthropic_key_id
  keyValue: string;     // stored in k8s Secret user-<uid>-anthropic
  mode: "workspace" | "shared";
}

export async function mintUserKey(userId: string): Promise<MintedKey> {
  const admin = env.anthropicAdminKey();
  const shared = env.anthropicSharedKey();

  if (!admin) {
    if (!shared) {
      throw new Error(
        "no Anthropic credentials configured: set ANTHROPIC_ADMIN_KEY (preferred) " +
          "or ANTHROPIC_API_KEY (shared-key fallback)",
      );
    }
    return { keyId: "shared", keyValue: shared, mode: "shared" };
  }

  // Real per-user minting.
  //
  // Anthropic's Admin API surface (as of late 2024) exposes /v1/organizations/
  // api_keys with workspace scoping. The exact shape is likely to shift; we
  // isolate it here so upgrades are one-file.
  const workspaceId = env.anthropicWorkspaceId();
  const body: Record<string, unknown> = {
    name: `conceptsos-user-${userId}`,
  };
  if (workspaceId) body.workspace_id = workspaceId;

  const res = await fetch("https://api.anthropic.com/v1/organizations/api_keys", {
    method: "POST",
    headers: {
      "x-api-key": admin,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`anthropic mint failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { id?: string; api_key?: string; key?: string };
  const keyValue = json.api_key ?? json.key;
  if (!json.id || !keyValue) {
    throw new Error(`anthropic mint returned unexpected shape: ${JSON.stringify(json)}`);
  }
  return { keyId: json.id, keyValue, mode: "workspace" };
}

export async function revokeUserKey(keyId: string): Promise<void> {
  if (keyId === "shared") return; // nothing to do in shared-key mode
  const admin = env.anthropicAdminKey();
  if (!admin) return;
  await fetch(`https://api.anthropic.com/v1/organizations/api_keys/${keyId}`, {
    method: "DELETE",
    headers: { "x-api-key": admin, "anthropic-version": "2023-06-01" },
  }).catch(() => {
    /* best effort */
  });
}
