// POST /api/admin/usage-sweep
//
// Called hourly by a Kubernetes CronJob (see k8s/api/cronjob.yaml).
// Pulls Anthropic usage for each user's key and writes daily rollups
// into public.llm_usage, updating profiles.llm_usage_month_usd.
//
// V1 note: budgets are TRACKED but not ENFORCED. When we're ready to
// enforce, this handler is the natural place to revoke keys that have
// blown past `profiles.llm_monthly_cap_usd`.
//
// Auth: shared bearer token from ADMIN_SWEEP_TOKEN env. The CronJob's
// Pod supplies it via an env-var from the same conceptsos-api-secrets.

import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase";
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
    // Shared-key mode: we can't attribute usage back to individual users
    // via the admin API. Nothing to do until per-user minting is enabled.
    return NextResponse.json({ ok: true, mode: "shared", note: "per-user usage attribution requires ANTHROPIC_ADMIN_KEY" });
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
  const results: Array<{ user: string; ok: boolean; detail?: string }> = [];

  for (const row of vms ?? []) {
    try {
      const usage = await fetchAnthropicUsage(admin, row.anthropic_key_id!);
      // Upsert today's row. We overwrite because Anthropic's usage API
      // reports running totals — we always take the latest reading.
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

      // Refresh the profile's monthly rollup.
      const monthStart = today.slice(0, 7) + "-01";
      const { data: month } = await db
        .from("llm_usage")
        .select("cost_usd")
        .eq("user_id", row.user_id)
        .gte("day", monthStart);
      const total = (month ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
      await db.from("profiles").update({ llm_usage_month_usd: total }).eq("id", row.user_id);

      results.push({ user: row.user_id, ok: true });
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

// Placeholder: Anthropic's admin usage API surface changes; wire the real
// endpoint here once we've verified it against the console. For V1 we
// return zeroes so the pipeline is wired end-to-end and the DB reflects
// "everything at 0" until you flip on real attribution.
async function fetchAnthropicUsage(_admin: string, _keyId: string): Promise<Usage> {
  // TODO(v1.1): implement against
  // https://docs.anthropic.com/en/api/admin-api/usage-cost/get-usage-report-messages
  return { inputTokens: 0, outputTokens: 0, costUsd: 0 };
}
