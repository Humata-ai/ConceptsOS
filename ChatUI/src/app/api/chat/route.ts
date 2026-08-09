import { NextRequest } from "next/server";

export const runtime = "nodejs";

interface InMsg { role: string; content: string; }

// Simple mock streaming endpoint. Streams a plausible markdown answer
// token-by-token so the UI feels alive. Replace with your real backend
// (OpenAI/Anthropic/etc.) by swapping the generator.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const messages: InMsg[] = body?.messages ?? [];
  const model: string = body?.model ?? "mock";
  const thinking: string = body?.thinking ?? "off";

  const lastUser = [...messages].reverse().find(m => m.role === "user")?.content ?? "";

  const reply = buildReply(lastUser, model, thinking);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // If thinking is on, emit a short thinking block first.
      if (thinking !== "off") {
        const think = `Considering "${lastUser.slice(0, 80)}"…\nBreaking this into steps and drafting a response.`;
        for (const chunk of chunkify(think, 6)) {
          controller.enqueue(encoder.encode(sse({ type: "thinking", delta: chunk })));
          await sleep(15);
        }
        controller.enqueue(encoder.encode(sse({ type: "thinking_end" })));
      }

      for (const chunk of chunkify(reply, 4)) {
        controller.enqueue(encoder.encode(sse({ type: "delta", delta: chunk })));
        await sleep(12);
      }
      controller.enqueue(encoder.encode(sse({ type: "done" })));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}

function sse(obj: unknown) { return `data: ${JSON.stringify(obj)}\n\n`; }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function chunkify(s: string, size: number): string[] {
  const out: string[] = [];
  // Split preserving whitespace/newlines
  const tokens = s.match(/\S+\s*|\s+/g) ?? [s];
  let buf = "";
  for (const t of tokens) {
    buf += t;
    if (buf.length >= size) { out.push(buf); buf = ""; }
  }
  if (buf) out.push(buf);
  return out;
}

function buildReply(user: string, model: string, thinking: string): string {
  const trimmed = user.trim();
  if (!trimmed) {
    return "I didn't catch a message — what would you like to talk about?";
  }
  const lower = trimmed.toLowerCase();
  if (/^(hi|hello|hey)\b/.test(lower)) {
    return `Hey! I'm a mock assistant running inside **ChatUI** (a Next.js port of Tau).\n\nAsk me anything — I'll stream back a demo response. Try:\n\n- \`show me a code sample\`\n- \`give me a table\`\n- \`explain streaming\``;
  }
  if (lower.includes("code")) {
    return "Here's a small TypeScript example that streams tokens from a fetch call:\n\n```ts\nconst res = await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ messages }) });\nconst reader = res.body!.getReader();\nconst dec = new TextDecoder();\nlet buf = '';\nwhile (true) {\n  const { done, value } = await reader.read();\n  if (done) break;\n  buf += dec.decode(value, { stream: true });\n  // parse SSE lines here…\n}\n```\n\nThat pattern powers the message streaming you're seeing right now.";
  }
  if (lower.includes("table")) {
    return "Sure — here's a quick comparison table:\n\n| Feature | ChatUI | Tau |\n| --- | --- | --- |\n| Framework | Next.js + React | Vanilla JS |\n| Themes | 6 | 6 |\n| Streaming | ✅ | ✅ |\n| PWA | ✅ | ✅ |\n";
  }
  return [
    `You said:\n\n> ${trimmed.split("\n").join("\n> ")}`,
    "",
    `Here's a mock response from **${model}** (thinking: \`${thinking}\`).`,
    "",
    "This is a demo of the ChatUI shell — the UI mirrors Tau's look and feel: sidebar sessions, model dropdown, thinking-level pill, token usage, file browser, and streaming markdown output.",
    "",
    "Swap `/api/chat/route.ts` with a real provider (OpenAI, Anthropic, local Pi extension, …) and everything else keeps working.",
  ].join("\n");
}
