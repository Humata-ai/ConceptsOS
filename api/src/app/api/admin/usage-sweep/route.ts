// POST /api/admin/usage-sweep
//
// Called hourly by a Kubernetes CronJob (see k8s/api/cronjob.yaml).
//
// This used to attribute Anthropic usage per user by minting per-user
// workspace keys via the Admin API and reading their spend. That model
// is dead: user pods now hit our LLM reverse proxy (`/api/llm/v1/*`)
// with the org's shared key, and per-user attribution is done at the
// proxy layer (see `lib/anthropic-usage.ts`) — not here.
//
// The endpoint is kept as a no-op so the CronJob keeps 200-ing while
// we design the new metering pipeline.
//
// Auth: shared bearer token from ADMIN_SWEEP_TOKEN env.

import { NextResponse } from "next/server";
import { withLogging } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = withLogging("admin.usage-sweep", async (req: Request) => {
  const token = process.env.ADMIN_SWEEP_TOKEN ?? "";
  const provided = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || provided !== token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    mode: "noop",
    note: "per-user metering now runs at the LLM proxy layer; sweep is a no-op",
  });
});
