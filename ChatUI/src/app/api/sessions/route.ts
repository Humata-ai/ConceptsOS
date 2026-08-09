import { NextRequest } from "next/server";
import { createPiSession, listPiSessions, disposePiSession } from "@/lib/pi-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ sessions: listPiSessions() });
}

export async function POST() {
  try {
    const meta = await createPiSession();
    return Response.json({ session: meta });
  } catch (e: any) {
    return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return Response.json({ error: "missing id" }, { status: 400 });
  await disposePiSession(id);
  return Response.json({ ok: true });
}
