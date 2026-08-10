import { NextResponse } from "next/server";
import { createSession, deleteSession, listSessions } from "@/lib/pi-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ sessions: await listSessions() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const s = await createSession(body?.title);
  return NextResponse.json({ session: s });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const ok = await deleteSession(id);
  return NextResponse.json({ ok });
}
