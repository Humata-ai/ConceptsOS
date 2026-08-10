import { NextResponse } from "next/server";
import { getSession, loadUiMessages } from "@/lib/pi-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession(id);
  if (!s) return NextResponse.json({ error: "not found" }, { status: 404 });
  const messages = (await loadUiMessages(id)) ?? [];
  const title =
    (s.sessionManager.getSessionName?.() as string | undefined) ?? "New chat";
  return NextResponse.json({ id: s.id, title, messages });
}
