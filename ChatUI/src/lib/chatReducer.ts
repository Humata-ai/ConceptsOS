import type { ChatEvent, UiMessage, UiToolCall } from "./types";

/**
 * Chat state for a single session, driven by the SSE event stream.
 *
 * `currentAssistantId` tracks which message is the "live" streaming
 * assistant so that subsequent deltas/tool events know where to write.
 * It's cleared when the message finalizes (message_end / stream end).
 */
export type ChatState = {
  messages: UiMessage[];
  streaming: boolean;
  currentAssistantId?: string;
};

export const emptyChat = (): ChatState => ({ messages: [], streaming: false });

export function makeUserMessage(text: string): UiMessage {
  return { id: `u-${Date.now()}`, role: "user", text, toolCalls: [] };
}

function freshAssistantId(): string {
  return `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyAssistant(id: string): UiMessage {
  return { id, role: "assistant", text: "", toolCalls: [], streaming: true };
}

/** Ensure `state.currentAssistantId` points at a live streaming assistant. */
function ensureAssistant(state: ChatState): { state: ChatState; id: string } {
  if (state.currentAssistantId) {
    return { state, id: state.currentAssistantId };
  }
  const id = freshAssistantId();
  return {
    state: {
      ...state,
      currentAssistantId: id,
      messages: [...state.messages, emptyAssistant(id)],
    },
    id,
  };
}

function patch(
  state: ChatState,
  id: string,
  mut: (m: UiMessage) => UiMessage,
): ChatState {
  return {
    ...state,
    messages: state.messages.map((m) => (m.id === id ? mut(m) : m)),
  };
}

/** Mark the current streaming assistant (if any) as done. */
function finalize(state: ChatState): ChatState {
  const id = state.currentAssistantId;
  if (!id) return state;
  const now = Date.now();
  return {
    ...state,
    currentAssistantId: undefined,
    messages: state.messages.map((m) =>
      m.id === id
        ? {
            ...m,
            streaming: false,
            thinkingEndedAt:
              m.thinkingEndedAt ?? (m.thinking ? now : undefined),
          }
        : m,
    ),
  };
}

/** Append a user message and mark the chat as streaming. */
export function beginStream(state: ChatState, text: string): ChatState {
  return {
    ...state,
    streaming: true,
    messages: [...state.messages, makeUserMessage(text)],
  };
}

/**
 * End the stream: finalize any live assistant, optionally append an error
 * message to it first, and clear the streaming flag.
 */
export function endStream(state: ChatState, errorMessage?: string): ChatState {
  let s = state;
  if (errorMessage) {
    s = applyChatEvent(s, { type: "error", message: errorMessage });
  }
  s = finalize(s);
  return { ...s, streaming: false };
}

/** Apply a single SSE event to the chat state. Pure w.r.t. `state`/`ev`
 *  (uses `Date.now()` for timing, same as before). */
export function applyChatEvent(state: ChatState, ev: ChatEvent): ChatState {
  switch (ev.type) {
    case "message_start": {
      // Finalize any prior assistant, then eagerly create an empty
      // streaming assistant so the typing indicator can render while we
      // wait for the first real event.
      const finalized = finalize(state);
      return ensureAssistant(finalized).state;
    }
    case "message_end":
      return finalize(state);
    case "text_delta": {
      const { state: s, id } = ensureAssistant(state);
      const now = Date.now();
      return patch(s, id, (m) => ({
        ...m,
        text: m.text + ev.delta,
        // First text delta marks the end of the thinking phase.
        thinkingEndedAt:
          m.thinking && !m.thinkingEndedAt ? now : m.thinkingEndedAt,
      }));
    }
    case "thinking_delta": {
      const { state: s, id } = ensureAssistant(state);
      const now = Date.now();
      return patch(s, id, (m) => ({
        ...m,
        thinking: (m.thinking ?? "") + ev.delta,
        thinkingStartedAt: m.thinkingStartedAt ?? now,
      }));
    }
    case "tool_start": {
      const { state: s, id } = ensureAssistant(state);
      const tc: UiToolCall = {
        id: ev.id,
        name: ev.name,
        input: ev.input,
        output: "",
        isError: false,
        done: false,
      };
      return patch(s, id, (m) => ({ ...m, toolCalls: [...m.toolCalls, tc] }));
    }
    case "tool_update": {
      const { state: s, id } = ensureAssistant(state);
      return patch(s, id, (m) => ({
        ...m,
        toolCalls: m.toolCalls.map((t) =>
          t.id === ev.id ? { ...t, output: t.output + ev.delta } : t,
        ),
      }));
    }
    case "tool_end": {
      const { state: s, id } = ensureAssistant(state);
      return patch(s, id, (m) => ({
        ...m,
        toolCalls: m.toolCalls.map((t) =>
          t.id === ev.id
            ? { ...t, output: ev.output || t.output, isError: ev.isError, done: true }
            : t,
        ),
      }));
    }
    case "error": {
      const { state: s, id } = ensureAssistant(state);
      return patch(s, id, (m) => ({
        ...m,
        text: m.text + `\n\n[error] ${ev.message}`,
      }));
    }
    default:
      return state;
  }
}
