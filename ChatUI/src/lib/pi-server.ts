// Server-side singleton that owns real Pi AgentSessions.
//
// Kept in a module scope so it survives across Next.js requests
// (in dev the module cache holds it; in prod one Node process holds it).
//
// Each browser "chat" maps to a Pi AgentSession we create on demand.

import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";

// Lazy import to avoid loading the heavy SDK at edge/build time.
type PiModule = typeof import("@earendil-works/pi-coding-agent");
let piModulePromise: Promise<PiModule> | null = null;
function loadPi(): Promise<PiModule> {
  if (!piModulePromise) piModulePromise = import("@earendil-works/pi-coding-agent");
  return piModulePromise;
}

export interface PiSessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

interface PiSessionEntry {
  id: string;
  session: AgentSession;
  meta: PiSessionMeta;
  // A tail of events we've observed, capped, so late subscribers can replay.
  events: AgentSessionEvent[];
  listeners: Set<(e: AgentSessionEvent) => void>;
  unsubscribe: () => void;
}

const g = globalThis as unknown as { __chatuiPi?: {
  sessions: Map<string, PiSessionEntry>;
  order: string[]; // recency
} };
if (!g.__chatuiPi) {
  g.__chatuiPi = { sessions: new Map(), order: [] };
}
const store = g.__chatuiPi;

function nowId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const MAX_TAIL = 2000;

function attach(session: AgentSession, entry: PiSessionEntry) {
  entry.unsubscribe = session.subscribe((event) => {
    entry.events.push(event);
    if (entry.events.length > MAX_TAIL) entry.events.splice(0, entry.events.length - MAX_TAIL);
    // Update meta lightly
    if (event.type === "turn_end" || event.type === "message_end" || event.type === "agent_end") {
      entry.meta.updatedAt = Date.now();
      entry.meta.messageCount = session.messages?.length ?? entry.meta.messageCount;
    }
    for (const l of entry.listeners) {
      try { l(event); } catch { /* ignore */ }
    }
  });
}

export async function createPiSession(opts?: { title?: string }): Promise<PiSessionMeta> {
  const pi = await loadPi();
  const { createAgentSession, SessionManager } = pi;
  const { session } = await createAgentSession({
    sessionManager: SessionManager.create(process.cwd()),
  });
  const id = nowId();
  const meta: PiSessionMeta = {
    id,
    title: opts?.title ?? "New chat",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messageCount: 0,
  };
  const entry: PiSessionEntry = {
    id, session, meta,
    events: [], listeners: new Set(),
    unsubscribe: () => {},
  };
  attach(session, entry);
  store.sessions.set(id, entry);
  store.order.unshift(id);
  return meta;
}

export function listPiSessions(): PiSessionMeta[] {
  return store.order
    .map(id => store.sessions.get(id)?.meta)
    .filter((m): m is PiSessionMeta => !!m);
}

export function getPiSession(id: string): PiSessionEntry | undefined {
  return store.sessions.get(id);
}

export async function disposePiSession(id: string) {
  const e = store.sessions.get(id);
  if (!e) return;
  try { e.unsubscribe(); } catch {}
  try { e.session.dispose(); } catch {}
  store.sessions.delete(id);
  store.order = store.order.filter(x => x !== id);
}

export interface StreamHandle {
  detach: () => void;
}

export function subscribe(id: string, listener: (e: AgentSessionEvent) => void): StreamHandle | null {
  const entry = store.sessions.get(id);
  if (!entry) return null;
  entry.listeners.add(listener);
  return { detach: () => entry.listeners.delete(listener) };
}

export async function promptSession(id: string, text: string): Promise<void> {
  const entry = store.sessions.get(id);
  if (!entry) throw new Error("session not found");
  const first = entry.meta.messageCount === 0;
  if (first) entry.meta.title = titleFrom(text);
  entry.meta.updatedAt = Date.now();
  if (entry.session.isStreaming) {
    await entry.session.prompt(text, { streamingBehavior: "followUp" });
  } else {
    await entry.session.prompt(text);
  }
}

export async function abortSession(id: string): Promise<void> {
  const entry = store.sessions.get(id);
  if (!entry) return;
  try { await entry.session.abort(); } catch {}
}

export interface SessionSnapshot {
  meta: PiSessionMeta;
  messages: Array<{ role: string; content: string; toolCalls?: unknown[] }>;
  isStreaming: boolean;
}

export function snapshotSession(id: string): SessionSnapshot | null {
  const entry = store.sessions.get(id);
  if (!entry) return null;
  const raw = entry.session.messages ?? [];
  const messages = raw.map(m => {
    // AgentMessage from pi-agent-core: normalize to {role,content}
    const anyM = m as any;
    const role = anyM.role as string;
    let content = "";
    if (typeof anyM.content === "string") content = anyM.content;
    else if (Array.isArray(anyM.content)) {
      content = anyM.content
        .map((c: any) => c?.type === "text" ? c.text
          : c?.type === "thinking" ? "" // hide thinking blocks here
          : "")
        .join("");
    }
    return { role, content };
  });
  return { meta: entry.meta, messages, isStreaming: !!entry.session.isStreaming };
}

function titleFrom(text: string): string {
  const first = text.split("\n").find(l => l.trim().length) || text;
  return first.trim().slice(0, 60);
}
