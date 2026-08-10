import { describe, expect, test } from "vitest";
import {
  applyChatEvent,
  beginStream,
  emptyChat,
  endStream,
} from "@/lib/chatReducer";
import type { ChatEvent } from "@/lib/types";

const play = (events: ChatEvent[]) =>
  events.reduce((s, e) => applyChatEvent(s, e), emptyChat());

describe("chatReducer", () => {
  test("emptyChat has no messages and is not streaming", () => {
    expect(emptyChat()).toEqual({ messages: [], streaming: false });
  });

  test("beginStream appends a user message and flips streaming on", () => {
    const s = beginStream(emptyChat(), "hi there");
    expect(s.streaming).toBe(true);
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]).toMatchObject({ role: "user", text: "hi there" });
  });

  test("text_delta creates an assistant message and appends deltas", () => {
    const s = play([
      { type: "message_start" },
      { type: "text_delta", delta: "Hello " },
      { type: "text_delta", delta: "world" },
    ]);
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]).toMatchObject({
      role: "assistant",
      text: "Hello world",
      streaming: true,
    });
  });

  test("thinking_delta populates .thinking and sets thinkingStartedAt", () => {
    const s = play([
      { type: "message_start" },
      { type: "thinking_delta", delta: "reasoning…" },
    ]);
    const m = s.messages[0];
    expect(m.thinking).toBe("reasoning…");
    expect(m.thinkingStartedAt).toBeTypeOf("number");
    expect(m.thinkingEndedAt).toBeUndefined();
  });

  test("first text_delta after thinking marks thinkingEndedAt", () => {
    const s = play([
      { type: "message_start" },
      { type: "thinking_delta", delta: "hmm" },
      { type: "text_delta", delta: "answer" },
    ]);
    const m = s.messages[0];
    expect(m.thinking).toBe("hmm");
    expect(m.thinkingEndedAt).toBeTypeOf("number");
  });

  test("message_end finalizes the current assistant (streaming=false)", () => {
    const s = play([
      { type: "message_start" },
      { type: "text_delta", delta: "hi" },
      { type: "message_end" },
    ]);
    expect(s.messages[0].streaming).toBe(false);
    expect(s.currentAssistantId).toBeUndefined();
  });

  test("tool_start/update/end lifecycle produces a done tool call", () => {
    const s = play([
      { type: "message_start" },
      { type: "tool_start", id: "t1", name: "bash", input: { command: "ls" } },
      { type: "tool_update", id: "t1", delta: "a\n" },
      { type: "tool_update", id: "t1", delta: "b\n" },
      { type: "tool_end", id: "t1", output: "", isError: false },
    ]);
    const tc = s.messages[0].toolCalls[0];
    expect(tc).toMatchObject({
      id: "t1",
      name: "bash",
      output: "a\nb\n",
      isError: false,
      done: true,
    });
  });

  test("tool_end with output replaces the streamed buffer", () => {
    const s = play([
      { type: "message_start" },
      { type: "tool_start", id: "t", name: "bash", input: {} },
      { type: "tool_update", id: "t", delta: "partial" },
      { type: "tool_end", id: "t", output: "FINAL", isError: false },
    ]);
    expect(s.messages[0].toolCalls[0].output).toBe("FINAL");
  });

  test("tool_end with isError=true propagates", () => {
    const s = play([
      { type: "message_start" },
      { type: "tool_start", id: "t", name: "bash", input: {} },
      { type: "tool_end", id: "t", output: "boom", isError: true },
    ]);
    expect(s.messages[0].toolCalls[0].isError).toBe(true);
  });

  test("error event appends [error] tag to current assistant text", () => {
    const s = play([
      { type: "message_start" },
      { type: "text_delta", delta: "hi" },
      { type: "error", message: "network down" },
    ]);
    expect(s.messages[0].text).toContain("[error] network down");
  });

  test("endStream sets streaming=false and finalizes", () => {
    const started = beginStream(emptyChat(), "hi");
    const mid = applyChatEvent(started, {
      type: "text_delta",
      delta: "hello",
    });
    const done = endStream(mid);
    expect(done.streaming).toBe(false);
    expect(done.messages.at(-1)?.streaming).toBe(false);
  });

  test("endStream with an error injects the error into the assistant", () => {
    const started = beginStream(emptyChat(), "hi");
    const done = endStream(started, "boom");
    // beginStream adds a user msg; endStream("boom") should create+finalize
    // an assistant with the error tag.
    const assistant = done.messages.find((m) => m.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant!.text).toContain("[error] boom");
    expect(assistant!.streaming).toBe(false);
  });

  test("multiple message_start/message_end cycles produce multiple assistants", () => {
    const s = play([
      { type: "message_start" },
      { type: "text_delta", delta: "one" },
      { type: "message_end" },
      { type: "message_start" },
      { type: "text_delta", delta: "two" },
      { type: "message_end" },
    ]);
    const assistants = s.messages.filter((m) => m.role === "assistant");
    expect(assistants.map((m) => m.text)).toEqual(["one", "two"]);
    expect(assistants.every((m) => !m.streaming)).toBe(true);
  });

  test("full end-to-end streaming turn", () => {
    let s = beginStream(emptyChat(), "run ls");
    s = [
      { type: "message_start" },
      { type: "thinking_delta", delta: "planning" },
      { type: "tool_start", id: "t1", name: "bash", input: { command: "ls" } },
      { type: "tool_update", id: "t1", delta: "a\nb\n" },
      { type: "tool_end", id: "t1", output: "", isError: false },
      { type: "text_delta", delta: "Done." },
      { type: "message_end" },
      { type: "done" },
    ].reduce<typeof s>((acc, ev) => applyChatEvent(acc, ev as ChatEvent), s);
    s = endStream(s);

    expect(s.streaming).toBe(false);
    expect(s.messages).toHaveLength(2);
    expect(s.messages[0]).toMatchObject({ role: "user", text: "run ls" });
    expect(s.messages[1]).toMatchObject({
      role: "assistant",
      text: "Done.",
      streaming: false,
    });
    expect(s.messages[1].thinking).toBe("planning");
    expect(s.messages[1].toolCalls[0]).toMatchObject({
      output: "a\nb\n",
      done: true,
    });
  });
});
