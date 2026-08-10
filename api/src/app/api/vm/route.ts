// GET /api/vm
//
// Called by the iOS app on a 2s poll after signup until status=ready.
// Also called on subsequent launches to double-check the VM is live.

import { NextResponse } from "next/server";
import { authUserId, adminClient } from "@/lib/supabase";
import { buildClientConfig } from "@/lib/wg";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const uid = await authUserId(req);
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = adminClient();
  const { data: row, error } = await db.from("vms").select("*").eq("user_id", uid).maybeSingle();
  if (error) return NextResponse.json({ error: "db_read_failed" }, { status: 500 });
  if (!row) return NextResponse.json({ status: "none" });

  const wg =
    row.wg_client_ip && row.wg_server_pubkey && row.wg_preshared_key && row.wg_endpoint
      ? buildClientConfig({
          clientIp: row.wg_client_ip,
          serverPubkey: row.wg_server_pubkey,
          presharedKey: row.wg_preshared_key,
          endpoint: row.wg_endpoint,
        })
      : null;

  return NextResponse.json({
    status: row.status,
    status_reason: row.status_reason,
    wg,
    pod: {
      name: row.pod_name,
      namespace: row.pod_namespace,
      service_cluster_ip: row.service_cluster_ip,
      ready_at: row.ready_at,
    },
    // Convenience for the iOS app: the URL to load inside the WKWebView
    // once the tunnel is up. The user's pod is reachable at their own
    // wg client IP being NATed to the pod by the gateway.
    // Every pod is reachable at the SAME address inside the tunnel:
    // http://10.10.0.1:3000/. The gateway routes by *source* IP (the
    // phone's wg address) to the right pod, so users can't reach
    // each other's pods even though they all dial the same destination.
    app_url: row.status === "ready" ? "http://10.10.0.1:3000/" : null,
  });
}
