import { describe, it, expect } from "vitest";
import { teeAnthropicUsage } from "./anthropic-usage";
import { generateApiKey, hashApiKey, keyPrefix } from "./apikey";
import type { LogMeta } from "./log";

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

async function drain(s: ReadableStream<Uint8Array>): Promise<string> {
  const reader = s.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += dec.decode(value);
  }
  return out;
}

describe("apikey", () => {
  it("generates a cos_-prefixed key", () => {
    const k = generateApiKey();
    expect(k.startsWith("cos_")).toBe(true);
    expect(k.length).toBeGreaterThan(30);
  });

  it("hash is deterministic + differs for different keys", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(hashApiKey(a)).toBe(hashApiKey(a));
    expect(hashApiKey(a)).not.toBe(hashApiKey(b));
    expect(hashApiKey(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("prefix is short", () => {
    const k = generateApiKey();
    expect(keyPrefix(k).length).toBe(12);
    expect(keyPrefix(k)).toBe(k.slice(0, 12));
  });
});

describe("teeAnthropicUsage — SSE", () => {
  it("extracts input/output tokens from message_start + message_delta", async () => {
    // Realistic Anthropic SSE frames, split across chunks to exercise buffering.
    const frames = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"m1","usage":{"input_tokens":123,"output_tokens":1}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":456}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];
    // Split into oddly-sized chunks to test the buffered frame parser.
    const combined = frames.join("");
    const chunks: string[] = [];
    for (let i = 0; i < combined.length; i += 37) chunks.push(combined.slice(i, i + 37));

    const log: LogMeta = {};
    const teed = teeAnthropicUsage(streamFromChunks(chunks), log);
    const out = await drain(teed);

    // Bytes pass through unchanged.
    expect(out).toBe(combined);
    expect(log.inputTokens).toBe(123);
    expect(log.outputTokens).toBe(456);
  });
});

describe("teeAnthropicUsage — JSON", () => {
  it("extracts usage from non-streaming JSON response", async () => {
    const body = JSON.stringify({
      id: "m1",
      type: "message",
      content: [{ type: "text", text: "hi" }],
      usage: { input_tokens: 10, output_tokens: 20 },
    });
    const log: LogMeta = {};
    const teed = teeAnthropicUsage(streamFromChunks([body]), log);
    const out = await drain(teed);
    expect(out).toBe(body);
    expect(log.inputTokens).toBe(10);
    expect(log.outputTokens).toBe(20);
  });

  it("silently no-ops on garbage body", async () => {
    const log: LogMeta = {};
    const teed = teeAnthropicUsage(streamFromChunks(["not json at all"]), log);
    await drain(teed);
    expect(log.inputTokens).toBeUndefined();
    expect(log.outputTokens).toBeUndefined();
  });
});
