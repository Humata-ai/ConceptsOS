import { describe, expect, test } from "vitest";
import { agentMessagesToUi, contentToText } from "@/lib/messages";

describe("contentToText", () => {
  test("returns strings verbatim", () => {
    expect(contentToText("hello")).toBe("hello");
    expect(contentToText("")).toBe("");
  });

  test("joins TextContent blocks and drops non-text blocks", () => {
    expect(
      contentToText([
        { type: "text", text: "a" },
        { type: "image", data: "…", mimeType: "image/png" },
        { type: "text", text: "b" },
      ]),
    ).toBe("ab");
  });

  test("returns empty string for unknown shapes", () => {
    expect(contentToText(null)).toBe("");
    expect(contentToText(42)).toBe("");
    expect(contentToText({ nope: true })).toBe("");
  });
});

describe("agentMessagesToUi", () => {
  test("empty input → empty output", () => {
    expect(agentMessagesToUi([])).toEqual([]);
  });

  test("user + assistant text produces a user message and an assistant message", () => {
    const ui = agentMessagesToUi([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [{ type: "text", text: "Hello there." }],
      },
    ]);
    expect(ui).toHaveLength(2);
    expect(ui[0]).toMatchObject({ role: "user", text: "hi", toolCalls: [] });
    expect(ui[1]).toMatchObject({
      role: "assistant",
      text: "Hello there.",
      toolCalls: [],
    });
    expect(ui[1].thinking).toBeUndefined();
  });

  test("assistant thinking blocks are captured into .thinking", () => {
    const ui = agentMessagesToUi([
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Let me " },
          { type: "thinking", thinking: "check…" },
          { type: "text", text: "Done." },
        ],
      },
    ]);
    expect(ui[0].thinking).toBe("Let me check…");
    expect(ui[0].text).toBe("Done.");
  });

  test("tool calls surface as UiToolCalls and are populated by matching toolResult", () => {
    const ui = agentMessagesToUi([
      { role: "user", content: "list" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Running." },
          {
            type: "toolCall",
            id: "call_1",
            name: "bash",
            arguments: { command: "ls" },
          },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "bash",
        content: [{ type: "text", text: "a\nb\n" }],
        isError: false,
      },
    ]);

    expect(ui).toHaveLength(2); // toolResult is folded into assistant
    const assistant = ui[1];
    expect(assistant.toolCalls).toHaveLength(1);
    expect(assistant.toolCalls[0]).toMatchObject({
      id: "call_1",
      name: "bash",
      input: { command: "ls" },
      output: "a\nb\n",
      isError: false,
      done: true,
    });
  });

  test("toolResult with isError=true propagates", () => {
    const ui = agentMessagesToUi([
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "t", name: "bash", arguments: {} },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "t",
        content: [{ type: "text", text: "boom" }],
        isError: true,
      },
    ]);
    expect(ui[0].toolCalls[0].isError).toBe(true);
    expect(ui[0].toolCalls[0].output).toBe("boom");
  });

  test("orphan toolResult (no matching toolCall) is silently dropped", () => {
    const ui = agentMessagesToUi([
      { role: "user", content: "hi" },
      {
        role: "toolResult",
        toolCallId: "nope",
        content: [{ type: "text", text: "orphan" }],
        isError: false,
      },
    ]);
    expect(ui).toHaveLength(1);
    expect(ui[0].role).toBe("user");
  });

  test("multiple tool calls in one assistant + interleaved results", () => {
    const ui = agentMessagesToUi([
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "a", name: "read", arguments: { path: "/a" } },
          { type: "toolCall", id: "b", name: "read", arguments: { path: "/b" } },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "b",
        content: [{ type: "text", text: "B" }],
        isError: false,
      },
      {
        role: "toolResult",
        toolCallId: "a",
        content: [{ type: "text", text: "A" }],
        isError: false,
      },
    ]);
    const [tcA, tcB] = ui[0].toolCalls;
    expect(tcA.output).toBe("A");
    expect(tcB.output).toBe("B");
  });

  test("unknown roles (branchSummary, custom, bashExecution) are ignored", () => {
    const ui = agentMessagesToUi([
      { role: "user", content: "hi" },
      { role: "branchSummary", summary: "…" },
      { role: "compactionSummary", summary: "…" },
      { role: "bashExecution", command: "ls", output: "", exitCode: 0 },
      { role: "custom", customType: "x", content: "" },
    ]);
    expect(ui).toHaveLength(1);
    expect(ui[0].role).toBe("user");
  });

  test("user message with mixed content blocks joins only text", () => {
    const ui = agentMessagesToUi([
      {
        role: "user",
        content: [
          { type: "text", text: "look at " },
          { type: "image", data: "…", mimeType: "image/png" },
          { type: "text", text: "this" },
        ],
      },
    ]);
    expect(ui[0].text).toBe("look at this");
  });
});
