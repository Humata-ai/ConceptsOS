// DELETE /api/account
//
// Fully wipes a user account:
//   1. Revoke their Anthropic key (best-effort).
//   2. Delete their k8s pod / statefulset / service / secret (best-effort).
//   3. Remove their wg peer from the gateway (best-effort).
//   4. Delete their auth.users row — which cascades to profiles, vms,
//      and llm_usage via `on delete cascade`.
//
// Auth: normally, only the user themselves (Authorization: Bearer <jwt>).
//
// Escape hatch: the same shared bearer used by the usage-sweep cron
// (ADMIN_SWEEP_TOKEN) may target any user by passing
// `?userId=<uuid>`. This is intended for one-off ops (e.g. blowing away
// a test account so we can re-run the signup flow) and is deliberately
// gated behind the service_role-level shared secret.

import { NextResponse } from "next/server";
import { adminClient, authUserId } from "@/lib/supabase";
import { revokeUserKey } from "@/lib/anthropic";
import { deleteUserPod } from "@/lib/k8s";
import { removePeer } from "@/lib/gateway";
import { withLogging } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const DELETE = withLogging("account", async (req: Request) => {
  const url = new URL(req.url);
  const overrideUserId = url.searchParams.get("userId");

  // Resolve the target user id, enforcing auth.
  let uid: string | null = null;
  if (overrideUserId) {
    const token = process.env.ADMIN_SWEEP_TOKEN ?? "";
    const provided = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token || provided !== token) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    uid = overrideUserId;
  } else {
    uid = await authUserId(req);
    if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = adminClient();
  const errors: Record<string, string> = {};

  // Look up VM metadata BEFORE we delete anything, so we know what to tear down.
  const { data: vm } = await db
    .from("vms")
    .select("user_id, anthropic_key_id, pod_name, pod_namespace")
    .eq("user_id", uid)
    .maybeSingle();

  if (vm?.anthropic_key_id) {
    try {
      await revokeUserKey(vm.anthropic_key_id);
    } catch (e: any) {
      errors.anthropic = String(e?.message ?? e);
    }
  }

  if (vm) {
    try {
      await deleteUserPod(uid);
    } catch (e: any) {
      errors.k8s = String(e?.message ?? e);
    }
    try {
      await removePeer(uid);
    } catch (e: any) {
      errors.gateway = String(e?.message ?? e);
    }
  }

  // Delete the auth.users row. `on delete cascade` handles profiles / vms /
  // llm_usage. Using the service_role client under the hood.
  const { error: authErr } = await db.auth.admin.deleteUser(uid);
  if (authErr) {
    return NextResponse.json(
      { error: "auth_delete_failed", detail: authErr.message, partial_errors: errors },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    deleted_user_id: uid,
    had_vm: !!vm,
    ...(Object.keys(errors).length ? { non_fatal_errors: errors } : {}),
  });
});
