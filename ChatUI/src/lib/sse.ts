import type { ChatEvent } from "./types";

/**
 * Parse a Server-Sent Events response body into a stream of ChatEvents.
 * Each SSE frame is expected to have a single `data: <json>` line whose
 * payload is a ChatEvent. Malformed JSON frames are silently skipped.
 */
export async function* readSse(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLine = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const json = dataLine.slice(5).trim();
      if (!json) continue;
      try {
        yield JSON.parse(json) as ChatEvent;
      } catch {
        /* ignore */
      }
    }
  }
}
