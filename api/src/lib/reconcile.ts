// Reconcile loop.
//
// Runs in the api pod as a background timer. On each tick:
//
//   1. Fetch all vms rows in status={pending,provisioning,error}.
//   2. For each: ensure the k8s StatefulSet + Service + Secret exist,
//      mint an Anthropic key if we haven't yet, push a peer to wg-gateway,
//      and update the row.
//
// Idempotent by design — safe to run in parallel with itself (though we
// don't; there's a single interval in this process).

import { adminClient } from "./supabase";
import { ensureUserPod, deleteUserPod } from "./k8s";
import { upsertPeer, removePeer } from "./gateway";
import { ensureUserApiKey } from "./apikey";
import { env } from "./env";

const log = (...args: unknown[]) => console.log("[reconcile]", ...args);

let running = false;
let timer: ReturnType<typeof setInterval> | null = null;

export function startReconcileLoop(): void {
  if (!env.reconcileEnabled()) {
    log("disabled via RECONCILE_ENABLED=false");
    return;
  }
  if (timer) return;
  const interval = env.reconcileIntervalMs();
  log(`starting; interval=${interval}ms`);
  timer = setInterval(tick, interval);
  // Kick immediately.
  void tick();
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await reconcileOnce();
  } catch (e) {
    log("tick failed:", (e as Error).message);
  } finally {
    running = false;
  }
}

export async function reconcileOnce(): Promise<void> {
  const db = adminClient();

  // Provision anything not-yet-ready.
  const { data: pending, error: e1 } = await db
    .from("vms")
    .select("*")
    .in("status", ["pending", "provisioning", "error"]);
  if (e1) throw new Error(`select vms: ${e1.message}`);

  for (const row of pending ?? []) {
    try {
      await reconcileOne(row);
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      log(`user ${row.user_id}: reconcile failed:`, msg);
      await db
        .from("vms")
        .update({ status: "error", status_reason: msg.slice(0, 500) })
        .eq("user_id", row.user_id);
    }
  }

  // Cleanup: anything marked 'deleted' that still has k8s resources.
  const { data: dead } = await db
    .from("vms")
    .select("user_id")
    .eq("status", "deleted");
  for (const row of dead ?? []) {
    try {
      await deleteUserPod(row.user_id);
      await removePeer(row.user_id).catch(() => undefined);
    } catch (e) {
      log(`cleanup ${row.user_id} failed:`, (e as Error).message);
    }
  }
}

async function reconcileOne(row: any): Promise<void> {
  const db = adminClient();
  const uid: string = row.user_id;

  if (!row.wg_pubkey) {
    // Signup hasn't posted a pubkey yet.
    return;
  }

  // Mark provisioning while we work.
  if (row.status !== "provisioning") {
    await db
      .from("vms")
      .update({ status: "provisioning", status_reason: null })
      .eq("user_id", uid);
  }

  // Ensure the user has a ConceptsOS API key. Idempotent — returns
  // the raw key from vms.pod_api_key on subsequent calls.
  const apiKey = row.pod_api_key ?? (await ensureUserApiKey(uid));

  // Ensure k8s objects. Anthropic access is via the api service's
  // /api/llm proxy; the pod authenticates to the proxy with its own
  // per-user API key (projected as $CONCEPTSOS_API_KEY).
  const k8sResult = await ensureUserPod({
    userId: uid,
    wgClientIp: row.wg_client_ip,
    apiKey,
  });

  await db
    .from("vms")
    .update({
      pod_name: k8sResult.podName,
      pod_namespace: k8sResult.namespace,
      service_cluster_ip: k8sResult.serviceClusterIp,
    })
    .eq("user_id", uid);

  // Push wg peer to gateway. We only push once the pod's Service has
  // a ClusterIP; without one there's nothing to DNAT to.
  if (!k8sResult.serviceClusterIp) {
    log(`user ${uid}: awaiting service ClusterIP`);
    return;
  }

  await upsertPeer({
    userId: uid,
    wgPubkey: row.wg_pubkey,
    presharedKey: row.wg_preshared_key,
    clientIp: row.wg_client_ip,
    podServiceIp: k8sResult.serviceClusterIp,
    podPort: 3000,
  });

  // Poll the pod's readiness. For V1 we just trust the pod's readiness
  //    probe — if k8s says the pod is Ready, we flip to ready.
  const { isPodReady } = await import("./k8s");
  const podReady = await isPodReady(k8sResult.namespace, k8sResult.podName);
  if (podReady) {
    await db
      .from("vms")
      .update({ status: "ready", status_reason: null, ready_at: new Date().toISOString() })
      .eq("user_id", uid);
    log(`user ${uid}: ready`);
  }
}


