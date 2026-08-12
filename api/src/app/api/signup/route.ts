// POST /api/signup
//
// Called by the iOS app immediately after a successful Supabase login on
// a device that doesn't yet have a VM. The body carries the WireGuard
// public key the iOS app just generated (the private half stays on the
// device forever).
//
// Idempotent: if the caller already has a `vms` row, we return the same
// wg client config we handed them the first time.

import { NextResponse } from "next/server";
import { z } from "zod";
import { authUserId, adminClient } from "@/lib/supabase";
import { allocateClientIp, buildClientConfig, generatePreSharedKey } from "@/lib/wg";
import { ensureUserApiKey } from "@/lib/apikey";
import { upsertPeer } from "@/lib/gateway";
import { env } from "@/lib/env";
import { withLogging } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  wgPubkey: z.string().min(40).max(50), // wg pubkeys are 44 chars b64
});

export const POST = withLogging("signup", async (req, _ctx, log) => {
  const uid = await authUserId(req);
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  log.userId = uid;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e: any) {
    return NextResponse.json({ error: "bad_request", detail: String(e?.message ?? e) }, { status: 400 });
  }

  const db = adminClient();

  // Return existing config if we already provisioned this user.
  const { data: existing } = await db.from("vms").select("*").eq("user_id", uid).maybeSingle();
  if (existing?.wg_client_ip && existing.wg_server_pubkey && existing.wg_preshared_key) {
    // Backfill: ensure this user has an API key even if they signed up
    // before the api_keys migration landed.
    await ensureUserApiKey(uid);

    // Multi-device support (V1 last-device-wins): if the caller posted
    // a different WireGuard pubkey than the one currently on file, they
    // are almost certainly a second device (e.g. Dan's iPad after his
    // iPhone) that generated its own keypair in its own Keychain. If we
    // just returned the cached config the caller's private key wouldn't
    // match any peer on the gateway and the tunnel would silently drop
    // every packet — cue mysterious black WKWebView on 10.10.0.1:3000.
    //
    // So we update wg_pubkey on the row and re-push the peer to the
    // gateway inline. reconcileOne() won't do this for us because it
    // only touches rows in status={pending,provisioning,error} and this
    // user's row is 'ready'.
    //
    // Concurrent use of both devices is still not supported in V1 —
    // whichever device most recently called signup wins the peer slot.
    // The iOS client re-asserts on every launch so device switching
    // Just Works, but simultaneous connections will ping-pong.
    if (existing.wg_pubkey !== body.wgPubkey) {
      log.extra = {
        ...(log.extra ?? {}),
        pubkeyRotated: true,
        oldPubkeyPrefix: (existing.wg_pubkey ?? "").slice(0, 8),
        newPubkeyPrefix: body.wgPubkey.slice(0, 8),
      };
      const { error: updErr } = await db
        .from("vms")
        .update({ wg_pubkey: body.wgPubkey })
        .eq("user_id", uid);
      if (updErr) {
        return NextResponse.json({ error: "db_write_failed", detail: updErr.message }, { status: 500 });
      }
      // Only re-push to the gateway if the pod already has a service
      // ClusterIP — otherwise reconcile will handle the initial push.
      if (existing.service_cluster_ip) {
        try {
          await upsertPeer({
            userId: uid,
            wgPubkey: body.wgPubkey,
            presharedKey: existing.wg_preshared_key,
            clientIp: existing.wg_client_ip,
            podServiceIp: existing.service_cluster_ip,
            podPort: 3000,
          });
        } catch (e: any) {
          return NextResponse.json(
            { error: "gateway_upsert_failed", detail: String(e?.message ?? e) },
            { status: 502 },
          );
        }
      }
    }

    return NextResponse.json(vmResponse(existing));
  }

  // Fresh signup — allocate resources.
  const clientIp = await allocateClientIp(uid);
  const psk = generatePreSharedKey();
  const serverPubkey = env.wgServerPubkey();
  const endpoint = env.wgEndpoint();

  const { error } = await db.from("vms").upsert(
    {
      user_id: uid,
      status: "pending", // controller will move to provisioning/ready
      wg_pubkey: body.wgPubkey,
      wg_client_ip: clientIp,
      wg_server_pubkey: serverPubkey,
      wg_endpoint: endpoint,
      wg_preshared_key: psk,
    },
    { onConflict: "user_id" },
  );
  if (error) {
    return NextResponse.json({ error: "db_write_failed", detail: error.message }, { status: 500 });
  }

  // Mint the user's ConceptsOS API key. This will be projected into their
  // pod as $CONCEPTSOS_API_KEY and required by the LLM proxy.
  await ensureUserApiKey(uid);

  const cfg = buildClientConfig({
    clientIp,
    serverPubkey,
    presharedKey: psk,
    endpoint,
  });
  return NextResponse.json({
    status: "pending",
    wg: cfg,
  });
});

function vmResponse(row: any) {
  const cfg = buildClientConfig({
    clientIp: row.wg_client_ip,
    serverPubkey: row.wg_server_pubkey,
    presharedKey: row.wg_preshared_key,
    endpoint: row.wg_endpoint,
  });
  return {
    status: row.status,
    wg: cfg,
    pod: {
      name: row.pod_name,
      namespace: row.pod_namespace,
      ready_at: row.ready_at,
    },
  };
}
