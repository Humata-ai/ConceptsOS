"use client";
import { Session, Message, ThinkingLevel } from "./types";

const KEY = "chatui-sessions";

function nowId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function loadSessions(): Session[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Session[];
  } catch { return []; }
}

export function saveSessions(sessions: Session[]) {
  try { localStorage.setItem(KEY, JSON.stringify(sessions)); } catch {}
}

export function newSession(model: string, thinking: ThinkingLevel = "off"): Session {
  const t = Date.now();
  return {
    id: nowId(),
    title: "New chat",
    createdAt: t,
    updatedAt: t,
    messages: [],
    model,
    thinking,
  };
}

export function newMessage(role: Message["role"], content: string, extra: Partial<Message> = {}): Message {
  return {
    id: nowId(),
    role,
    content,
    createdAt: Date.now(),
    ...extra,
  };
}

export function titleFrom(text: string): string {
  const first = text.split("\n").find(l => l.trim().length) || text;
  return first.trim().slice(0, 60);
}
