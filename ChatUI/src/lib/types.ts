export interface PiSessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export type MsgRole = "user" | "assistant" | "tool" | "thinking";

export interface UiMessage {
  id: string;
  role: MsgRole;
  content: string;
  streaming?: boolean;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: string;
  toolError?: boolean;
}

export interface SessionSnapshot {
  meta: PiSessionMeta;
  messages: Array<{ role: string; content: string }>;
  isStreaming: boolean;
}
