/**
 * Pure mapping from pi-agent-core session events (as emitted by
 * `session.subscribe`) to the `ChatEvent`s the UI consumes over SSE.
 *
 * Stateful only via `toolBuffers`, a caller-owned map from `toolCallId` to
 * the accumulated streamed output so far. That lets us fall back to the
 * buffered text on `tool_execution_end` when the SDK's final `result` is
 * missing structured content.
 */
import type { ChatEvent } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentEvent = any;

/**
 * Translate a single agent event into 0-or-more ChatEvents. Unrecognized
 * event types return `[]`. Callers should wrap this in try/catch and emit
 * a `{ type: "error" }` if it throws, since the SDK's event shape is
 * loosely typed.
 */
export function mapAgentEvent(
  event: AgentEvent,
  toolBuffers: Map<string, string>,
): ChatEvent[] {
  switch (event.type) {
    case "message_start":
      return [{ type: "message_start" }];
    case "message_end":
      return [{ type: "message_end" }];
    case "message_update": {
      const me = event.assistantMessageEvent;
      if (!me) return [];
      if (me.type === "text_delta") return [{ type: "text_delta", delta: me.delta ?? "" }];
      if (me.type === "thinking_delta")
        return [{ type: "thinking_delta", delta: me.delta ?? "" }];
      return [];
    }
    case "tool_execution_start": {
      const tid = event.toolCallId ?? event.id ?? crypto.randomUUID();
      toolBuffers.set(tid, "");
      return [
        {
          type: "tool_start",
          id: tid,
          name: event.toolName ?? "tool",
          input: event.args ?? event.input ?? event.parameters ?? {},
        },
      ];
    }
    case "tool_execution_update": {
      const tid = event.toolCallId ?? event.id;
      if (!tid) return [];
      const delta =
        event.delta ??
        event.output ??
        (typeof event.partialResult === "string" ? event.partialResult : "");
      if (!delta) return [];
      toolBuffers.set(tid, (toolBuffers.get(tid) ?? "") + String(delta));
      return [{ type: "tool_update", id: tid, delta: String(delta) }];
    }
    case "tool_execution_end": {
      const tid = event.toolCallId ?? event.id;
      if (!tid) return [];
      let output = toolBuffers.get(tid) ?? "";
      const result = event.result;
      if (result?.content && Array.isArray(result.content)) {
        const texts = result.content
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((c: any) => c.type === "text")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((c: any) => c.text)
          .join("");
        if (texts) output = texts;
      }
      toolBuffers.delete(tid);
      return [
        {
          type: "tool_end",
          id: tid,
          output,
          isError: Boolean(event.isError),
        },
      ];
    }
    case "turn_end":
      return [{ type: "turn_end" }];
    default:
      return [];
  }
}
