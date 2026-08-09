import { NextResponse } from "next/server";
import { getSession } from "@/lib/pi-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = getSession(id);
  if (!s) return NextResponse.json({ error: "not found" }, { status: 404 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages = (s.session.messages as any[]) ?? [];
  return NextResponse.json({ id: s.id, title: s.title, messages });
}
