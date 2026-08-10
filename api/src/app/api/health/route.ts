// Public health probe. Returns 200 as long as the process is up. Used by
// the k8s readiness/liveness probes and by uptime monitors.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ ok: true, ts: Date.now() });
}
