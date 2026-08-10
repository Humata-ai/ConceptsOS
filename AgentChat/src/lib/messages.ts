/**
 * Pure conversion helpers between pi-agent-core `AgentMessage[]` (as stored
 * in session JSONL) and the UI-shaped `UiMessage[]` the React components
 * render. Kept as a standalone module so we can unit-test without spinning
 * up Next.js or the pi SDK.
 */
import type { UiMessage, UiToolCall } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMessage = any;

/**
 * Normalize a raw user message into a session title: take the first 60
 * chars, collapse runs of whitespace to a single space, and trim. Returns
 * "" if the input yields nothing usable — callers pick their own fallback.
 */
export function deriveTitle(text: string): string {
  return text.slice(0, 60).replace(/\s+/g, " ").trim();
}

/** Flatten a message `content` field (string or content-block array) to plain text. */
export function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (c): c is { type: "text"; text: string } =>
          !!c && c.type === "text" && typeof c.text === "string",
      )
      .map((c) => c.text)
      .join("");
  }
  return "";
}

/**
 * Convert a list of `AgentMessage`s (from `SessionManager.buildSessionContext()`)
 * into `UiMessage[]`. Tool results are folded into the matching `toolCall`
 * on the preceding assistant message by `toolCallId`.
 *
 * Unhandled roles (bashExecution, custom, branch/compaction summaries) are
 * skipped for now — surface as needed later.
 */
export function agentMessagesToUi(messages: AnyMessage[]): UiMessage[] {
  const out: UiMessage[] = [];
  const toolIndex = new Map<string, { msgIdx: number; toolIdx: number }>();

  for (const m of messages) {
    if (m.role === "user") {
      out.push({
        id: `u-${out.length}`,
        role: "user",
        text: contentToText(m.content),
        toolCalls: [],
      });
    } else if (m.role === "assistant") {
      const text: string[] = [];
      const thinking: string[] = [];
      const toolCalls: UiToolCall[] = [];
      for (const block of m.content ?? []) {
        if (block.type === "text") text.push(block.text ?? "");
        else if (block.type === "thinking") thinking.push(block.thinking ?? "");
        else if (block.type === "toolCall") {
          toolCalls.push({
            id: block.id,
            name: block.name,
            input: block.arguments ?? {},
            output: "",
            isError: false,
            done: true,
          });
        }
      }
      const msgIdx = out.length;
      out.push({
        id: `a-${msgIdx}`,
        role: "assistant",
        text: text.join(""),
        thinking: thinking.length ? thinking.join("") : undefined,
        toolCalls,
      });
      toolCalls.forEach((tc, toolIdx) => {
        toolIndex.set(tc.id, { msgIdx, toolIdx });
      });
    } else if (m.role === "toolResult") {
      const loc = toolIndex.get(m.toolCallId);
      if (!loc) continue;
      const parent = out[loc.msgIdx];
      const tc = parent.toolCalls[loc.toolIdx];
      parent.toolCalls[loc.toolIdx] = {
        ...tc,
        output: contentToText(m.content),
        isError: Boolean(m.isError),
        done: true,
      };
    }
    // Other roles intentionally skipped.
  }
  return out;
}
