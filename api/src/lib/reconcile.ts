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
import { mintUserKey } from "./anthropic";
import { ensureUserPod, deleteUserPod } from "./k8s";
import { upsertPeer, removePeer } from "./gateway";
import { env } from "./env";

const log = (...args: unknown[]) => console.log("[reconcile]", ...args);

let running = false;
let timer: ReturnType<typeof setInterval> | null = null;

// Cache the Anthropic key values in-process; we never persist them to
// Supabase. If the api pod restarts we re-mint (workspace mode) or reuse
// the same shared key (shared-key mode). In workspace mode, restart would
// orphan the old key — acceptable for V1; revocation happens on account
// delete.
const keyCache = new Map<string, string>();

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

  // 1. Anthropic key: mint or reuse.
  let anthropicKey = keyCache.get(uid);
  if (!anthropicKey) {
    const minted = await mintUserKey(uid);
    anthropicKey = minted.keyValue;
    keyCache.set(uid, anthropicKey);
    await db
      .from("vms")
      .update({ anthropic_key_id: minted.keyId })
      .eq("user_id", uid);
  }

  // 2. Mark provisioning while we work.
  if (row.status !== "provisioning") {
    await db
      .from("vms")
      .update({ status: "provisioning", status_reason: null })
      .eq("user_id", uid);
  }

  // 3. Ensure k8s objects.
  const k8sResult = await ensureUserPod({
    userId: uid,
    anthropicKey,
    wgClientIp: row.wg_client_ip,
  });

  await db
    .from("vms")
    .update({
      pod_name: k8sResult.podName,
      pod_namespace: k8sResult.namespace,
      service_cluster_ip: k8sResult.serviceClusterIp,
    })
    .eq("user_id", uid);

  // 4. Push wg peer to gateway. We only push once the pod's Service has
  //    a ClusterIP; without one there's nothing to DNAT to.
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

  // 5. Poll the pod's readiness. For V1 we just trust the pod's readiness
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


