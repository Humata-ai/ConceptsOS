export type ChatEvent =
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  | { type: "message_start" }
  | { type: "message_end" }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | { type: "tool_update"; id: string; delta: string }
  | { type: "tool_end"; id: string; output: string; isError: boolean }
  | { type: "turn_end" }
  | { type: "done" }
  | { type: "error"; message: string };

export type UiMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  thinking?: string;
  toolCalls: UiToolCall[];
};

export type UiToolCall = {
  id: string;
  name: string;
  input: unknown;
  output: string;
  isError: boolean;
  done: boolean;
};

export type SessionSummary = {
  id: string;
  title: string;
  createdAt: number;
  messageCount: number;
};
