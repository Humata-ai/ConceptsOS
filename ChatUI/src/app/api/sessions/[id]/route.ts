import { NextRequest } from "next/server";
import { snapshotSession } from "@/lib/pi-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const snap = snapshotSession(id);
  if (!snap) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(snap);
}
