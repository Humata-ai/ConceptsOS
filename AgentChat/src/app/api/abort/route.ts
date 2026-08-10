import { NextResponse } from "next/server";
import { abortSession } from "@/lib/pi-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const id: string | undefined = body?.id;
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const ok = await abortSession(id);
  return NextResponse.json({ ok });
}
