// POST /api/admin/usage-sweep
//
// Called hourly by a Kubernetes CronJob (see k8s/api/cronjob.yaml).
//
// Per user with a real Anthropic key:
//   1. Fetch their usage from Anthropic's Admin API.
//   2. Upsert today's rollup into public.llm_usage.
//   3. Compute month-to-date and store on profiles.llm_usage_month_usd.
//   4. Decrement profiles.credit_usd_remaining by the *delta* since
//      last sweep (we compare today's cost against what we already
//      recorded for today).
//   5. If credit hits 0, revoke the Anthropic key. The pod stays up so
//      the user keeps their data; only LLM calls fail.
//
// Auth: shared bearer token from ADMIN_SWEEP_TOKEN env.

import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase";
import { revokeUserKey } from "@/lib/anthropic";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const token = process.env.ADMIN_SWEEP_TOKEN ?? "";
  const provided = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || provided !== token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = env.anthropicAdminKey();
  if (!admin) {
    return NextResponse.json({
      ok: true,
      mode: "shared",
      note: "per-user usage attribution requires ANTHROPIC_ADMIN_KEY",
    });
  }

  const db = adminClient();
  const { data: vms, error } = await db
    .from("vms")
    .select("user_id, anthropic_key_id")
    .not("anthropic_key_id", "is", null)
    .neq("anthropic_key_id", "shared");
  if (error) {
    return NextResponse.json({ error: "db_read_failed", detail: error.message }, { status: 500 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const results: Array<{ user: string; ok: boolean; detail?: string; revoked?: boolean }> = [];

  for (const row of vms ?? []) {
    try {
      const usage = await fetchAnthropicUsage(admin, row.anthropic_key_id!);

      // How much cost is already recorded for today? The *delta* between
      // Anthropic's running total and our recorded total is what we
      // subtract from the user's credit balance this sweep.
      const { data: prev } = await db
        .from("llm_usage")
        .select("cost_usd")
        .eq("user_id", row.user_id)
        .eq("day", today)
        .maybeSingle();
      const prevCost = Number(prev?.cost_usd ?? 0);
      const deltaCost = Math.max(0, usage.costUsd - prevCost);

      // Upsert today's row (running totals; overwrite).
      const { error: upErr } = await db.from("llm_usage").upsert(
        {
          user_id: row.user_id,
          day: today,
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
          cost_usd: usage.costUsd,
        },
        { onConflict: "user_id,day" },
      );
      if (upErr) throw upErr;

      // Month-to-date rollup.
      const monthStart = today.slice(0, 7) + "-01";
      const { data: month } = await db
        .from("llm_usage")
        .select("cost_usd")
        .eq("user_id", row.user_id)
        .gte("day", monthStart);
      const monthTotal = (month ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);

      // Decrement credit by the delta and check for cutoff.
      const { data: profile } = await db
        .from("profiles")
        .select("credit_usd_remaining")
        .eq("id", row.user_id)
        .maybeSingle();
      const prevCredit = Number(profile?.credit_usd_remaining ?? 0);
      const newCredit = Math.max(0, prevCredit - deltaCost);

      await db
        .from("profiles")
        .update({
          llm_usage_month_usd: monthTotal,
          credit_usd_remaining: newCredit,
        })
        .eq("id", row.user_id);

      let revoked = false;
      if (prevCredit > 0 && newCredit === 0) {
        // Just crossed the cutoff. Revoke the Anthropic key so we stop
        // accruing charges. Mark the key id as "revoked" so the reconcile
        // loop doesn't try to reuse it if the pod restarts.
        await revokeUserKey(row.anthropic_key_id!);
        await db
          .from("vms")
          .update({ anthropic_key_id: "revoked-out-of-credit" })
          .eq("user_id", row.user_id);
        revoked = true;
      }

      results.push({ user: row.user_id, ok: true, revoked });
    } catch (e: any) {
      results.push({ user: row.user_id, ok: false, detail: String(e?.message ?? e) });
    }
  }

  return NextResponse.json({ ok: true, count: results.length, results });
}

interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

// TODO(v1.1): wire to the real Anthropic Admin usage endpoint:
// https://docs.anthropic.com/en/api/admin-api/usage-cost/get-usage-report-messages
// Until then we return zeroes so the pipeline is exercised but no user
// actually gets debited.
async function fetchAnthropicUsage(_admin: string, _keyId: string): Promise<Usage> {
  return { inputTokens: 0, outputTokens: 0, costUsd: 0 };
}
