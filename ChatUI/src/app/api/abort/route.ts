import { NextRequest } from "next/server";
import { abortSession } from "@/lib/pi-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id: string = body?.sessionId;
  if (!id) return Response.json({ error: "missing sessionId" }, { status: 400 });
  await abortSession(id);
  return Response.json({ ok: true });
}
