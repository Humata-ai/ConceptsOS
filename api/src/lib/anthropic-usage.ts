// Best-effort extraction of token usage from an Anthropic response stream.
//
// Handles two shapes:
//
//   * SSE (streaming): Anthropic emits `message_start` (with input tokens
//     and an initial output count) and `message_delta` (with cumulative
//     output tokens). We parse the `data: {...}` JSON lines, keep the
//     latest values, and write them to `log` when the stream closes.
//
//   * JSON (non-streaming): a single `{"usage": { input_tokens, output_tokens }}`
//     blob. We accumulate the whole body (small) and parse at end.
//
// Failure is silent — we never throw from inside the tee. The upstream
// bytes pass through untouched either way.

import type { LogMeta } from "./log";

export function teeAnthropicUsage(source: ReadableStream<Uint8Array>, log: LogMeta): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let sseBuf = "";
  let bodyBuf = "";
  let sawSse = false;
  let input = 0;
  let output = 0;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = source.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          controller.enqueue(value);
          try {
            const chunk = decoder.decode(value, { stream: true });
            if (!sawSse && chunk.includes("event:")) sawSse = true;
            if (sawSse) {
              sseBuf += chunk;
              // Anthropic SSE frames are separated by "\n\n". Parse
              // complete frames only, keep the trailing partial.
              let idx: number;
              while ((idx = sseBuf.indexOf("\n\n")) !== -1) {
                const frame = sseBuf.slice(0, idx);
                sseBuf = sseBuf.slice(idx + 2);
                parseSseFrame(frame, (i, o) => {
                  if (i > 0) input = i;
                  if (o > 0) output = o;
                });
              }
            } else {
              // Non-streaming: keep body but cap to avoid unbounded growth.
              if (bodyBuf.length < 1_000_000) bodyBuf += chunk;
            }
          } catch {
            /* parsing is best-effort */
          }
        }
      } catch (e) {
        controller.error(e);
        return;
      } finally {
        try {
          if (!sawSse && bodyBuf) {
            const j = JSON.parse(bodyBuf);
            input = j?.usage?.input_tokens ?? input;
            output = j?.usage?.output_tokens ?? output;
          }
        } catch {
          /* ignore */
        }
        if (input || output) {
          log.inputTokens = input;
          log.outputTokens = output;
        }
        controller.close();
      }
    },
  });
}

function parseSseFrame(frame: string, onUsage: (input: number, output: number) => void): void {
  // A frame looks like:
  //   event: message_start
  //   data: {"type":"message_start","message":{"usage":{...}}}
  let data = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data || data === "[DONE]") return;
  let obj: any;
  try {
    obj = JSON.parse(data);
  } catch {
    return;
  }
  const t = obj?.type;
  if (t === "message_start") {
    const u = obj?.message?.usage;
    onUsage(u?.input_tokens ?? 0, u?.output_tokens ?? 0);
  } else if (t === "message_delta") {
    const u = obj?.usage;
    onUsage(u?.input_tokens ?? 0, u?.output_tokens ?? 0);
  }
}
