import { NextResponse } from "next/server";
import { getRunStatus } from "@/lib/pi-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lets a reconnecting client (e.g. after the DesktopUI iframe reloaded) find
// out whether a session's agent turn is still running, and from which event
// cursor it should resume streaming.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }
  return NextResponse.json(getRunStatus(id));
}
