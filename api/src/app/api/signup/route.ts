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
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  wgPubkey: z.string().min(40).max(50), // wg pubkeys are 44 chars b64
});

export async function POST(req: Request) {
  const uid = await authUserId(req);
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

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
}

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
