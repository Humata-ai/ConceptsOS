// Public health probe. Returns 200 as long as the process is up. Used by
// the k8s readiness/liveness probes and by uptime monitors.

import { NextResponse } from "next/server";
import { withLogging } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withLogging("health", async () => {
  return NextResponse.json({ ok: true, ts: Date.now() });
});
