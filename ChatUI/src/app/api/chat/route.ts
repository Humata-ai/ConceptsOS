import { streamPrompt } from "@/lib/pi-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { id, text } = (await req.json()) as { id: string; text: string };
  if (!id || !text) {
    return new Response("missing id or text", { status: 400 });
  }

  const encoder = new TextEncoder();
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
        for await (const ev of streamPrompt(id, text, ac.signal)) {
          write(ev.type, ev);
        }
      } catch (err) {
        write("error", { type: "error", message: (err as Error).message });
      } finally {
        controller.close();
      }
    },
    cancel() {
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
