import { streamRun } from "@/lib/pi-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { id, text, cursor } = (await req.json()) as {
    id: string;
    // Omitted on a reconnect: just resume streaming an already-running turn.
    text?: string;
    // Event index to resume from (0 for a fresh send).
    cursor?: number;
  };
  if (!id) {
    return new Response("missing id", { status: 400 });
  }

  const encoder = new TextEncoder();
  // This controller only stops *streaming to this client*. It is intentionally
  // NOT wired to server.session.abort() — a dropped connection (browser reload)
  // must leave the agent turn running. Explicit stop goes through /api/abort.
  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      try {
        for await (const { index, event } of streamRun(
          id,
          text,
          cursor ?? 0,
          ac.signal,
        )) {
          // `_index` lets the client persist a resume cursor.
          write(event.type, { ...event, _index: index });
        }
      } catch (err) {
        write("error", { type: "error", message: (err as Error).message });
      } finally {
        controller.close();
      }
    },
    cancel() {
      // Client canceled: stop this stream only; the run keeps going.
      ac.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
