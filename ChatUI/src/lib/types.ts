export type Role = "user" | "assistant" | "system" | "tool" | "thinking";

export interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  streaming?: boolean;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
}

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  model: string;
  thinking: ThinkingLevel;
  favourite?: boolean;
  tags?: string[];
}

export type ThinkingLevel = "off" | "low" | "medium" | "high";

export interface ModelInfo {
  id: string;
  label: string;
  provider: string;
}

export const MODELS: ModelInfo[] = [
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", provider: "Anthropic" },
  { id: "claude-opus-4", label: "Claude Opus 4", provider: "Anthropic" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "Anthropic" },
  { id: "gpt-5", label: "GPT-5", provider: "OpenAI" },
  { id: "gpt-5-mini", label: "GPT-5 Mini", provider: "OpenAI" },
  { id: "gpt-4.1", label: "GPT-4.1", provider: "OpenAI" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "Google" },
  { id: "grok-4", label: "Grok 4", provider: "xAI" },
];
