import { NextRequest } from "next/server";
import { getPiSession, promptSession, subscribe } from "@/lib/pi-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

// POST { sessionId, message } → SSE stream of normalized events.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sessionId: string = body?.sessionId;
  const message: string = body?.message ?? "";
  if (!sessionId) return new Response("missing sessionId", { status: 400 });
  if (!message.trim()) return new Response("empty message", { status: 400 });
  const entry = getPiSession(sessionId);
  if (!entry) return new Response("session not found", { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch { closed = true; }
      };

      const handle = subscribe(sessionId, (event) => {
        // Normalize pi events into a compact form for the UI.
        switch (event.type) {
          case "message_update": {
            const e = event.assistantMessageEvent;
            if (e.type === "text_delta") send({ type: "delta", delta: e.delta });
            else if (e.type === "thinking_delta") send({ type: "thinking", delta: (e as any).delta });
            break;
          }
          case "message_start":
            send({ type: "message_start" });
            break;
          case "message_end":
            send({ type: "message_end" });
            break;
          case "tool_execution_start":
            send({
              type: "tool_start",
              name: (event as any).toolName,
              input: (event as any).args,
              id: (event as any).toolCallId,
            });
            break;
          case "tool_execution_end":
            send({
              type: "tool_end",
              id: (event as any).toolCallId,
              isError: (event as any).isError,
              output: safeToolOutput((event as any).result),
            });
            break;
          case "agent_start":
            send({ type: "agent_start" });
            break;
          case "agent_end":
            send({ type: "agent_end" });
            break;
          default:
            break;
        }
      });

      // Kick the agent.
      try {
        await promptSession(sessionId, message);
      } catch (e: any) {
        send({ type: "error", message: String(e?.message ?? e) });
      }

      // Wait for the agent to go idle, then close.
      try {
        await entry.session.waitForIdle();
      } catch {}
      send({ type: "done" });

      handle?.detach();
      closed = true;
      try { controller.close(); } catch {}
    },
    cancel() { /* drop stream */ },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function safeToolOutput(r: any): string {
  try {
    if (!r) return "";
    if (typeof r === "string") return r;
    if (r.content) {
      return r.content
        .map((c: any) => c?.type === "text" ? c.text : "")
        .join("");
    }
    return JSON.stringify(r).slice(0, 4000);
  } catch { return ""; }
}
