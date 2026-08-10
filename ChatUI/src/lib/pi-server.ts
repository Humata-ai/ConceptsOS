import "server-only";
import { homedir } from "node:os";
import { rm } from "node:fs/promises";
import type { ChatEvent, SessionSummary, UiMessage, UiToolCall } from "./types";

// Lazy import so Next doesn't try to bundle the SDK.
type PiSdk = typeof import("@earendil-works/pi-coding-agent");

/** Working directory used for every agent session in ChatUI. */
const AGENT_CWD = homedir();

type ServerSession = {
  /** Stable id we expose to the UI == SessionManager.getSessionId(). */
  id: string;
  /** Full path to the JSONL file. */
  path: string;
  createdAt: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sessionManager: any;
  disposed: boolean;
};

type Store = {
  /** Live in-process cache of hydrated AgentSessions, keyed by session id. */
  live: Map<string, ServerSession>;
  sdk?: PiSdk;
  sdkInit?: Promise<PiSdk>;
};

// Survive Next.js dev HMR by pinning to globalThis.
const g = globalThis as unknown as { __chatuiStore?: Store };
if (!g.__chatuiStore) {
  g.__chatuiStore = { live: new Map() };
}
const store = g.__chatuiStore;

async function loadSdk(): Promise<PiSdk> {
  if (store.sdk) return store.sdk;
  if (!store.sdkInit) {
    store.sdkInit = import("@earendil-works/pi-coding-agent").then((m) => {
      store.sdk = m;
      return m;
    });
  }
  return store.sdkInit;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function hydrateSession(sm: any): Promise<ServerSession> {
  const { createAgentSession } = await loadSdk();
  const { session } = await createAgentSession({
    cwd: AGENT_CWD,
    sessionManager: sm,
  });
  const id: string = sm.getSessionId();
  const path: string = sm.getSessionFile() ?? "";
  const entry: ServerSession = {
    id,
    path,
    createdAt: Date.now(),
    session,
    sessionManager: sm,
    disposed: false,
  };
  store.live.set(id, entry);
  return entry;
}

/** Create a new persisted session under ~/.pi/agent/sessions/--home-…--/. */
export async function createSession(title?: string): Promise<SessionSummary> {
  const { SessionManager } = await loadSdk();
  const sm = SessionManager.create(AGENT_CWD);
  const entry = await hydrateSession(sm);
  if (title && title.trim()) {
    try {
      sm.appendSessionInfo(title.trim());
    } catch {
      /* ignore */
    }
  }
  return summarizeLive(entry, title);
}

/** List all sessions on disk for the ChatUI bucket (~/.pi/agent/sessions/--home-…--/). */
export async function listSessions(): Promise<SessionSummary[]> {
  const { SessionManager } = await loadSdk();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const infos: any[] = await SessionManager.list(AGENT_CWD);
  return infos
    .map((info) => ({
      id: info.id as string,
      title:
        (info.name as string | undefined)?.trim() ||
        (info.firstMessage as string | undefined)?.slice(0, 60).replace(/\s+/g, " ").trim() ||
        "New chat",
      createdAt: new Date(info.created).getTime(),
      messageCount: info.messageCount as number,
      path: info.path as string,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Get (or lazily hydrate) a live AgentSession by id. */
export async function getSession(id: string): Promise<ServerSession | undefined> {
  const cached = store.live.get(id);
  if (cached && !cached.disposed) return cached;

  const { SessionManager } = await loadSdk();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const infos: any[] = await SessionManager.list(AGENT_CWD);
  const info = infos.find((i) => i.id === id);
  if (!info) return undefined;
  const sm = SessionManager.open(info.path);
  return hydrateSession(sm);
}

export async function deleteSession(id: string): Promise<boolean> {
  const s = store.live.get(id);
  let path: string | undefined = s?.path;
  if (s) {
    try {
      await s.session.abort?.();
    } catch {
      /* ignore */
    }
    try {
      s.session.dispose?.();
    } catch {
      /* ignore */
    }
    s.disposed = true;
    store.live.delete(id);
  }
  if (!path) {
    const { SessionManager } = await loadSdk();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const infos: any[] = await SessionManager.list(AGENT_CWD);
    path = infos.find((i) => i.id === id)?.path;
  }
  if (path) {
    try {
      await rm(path, { force: true });
    } catch {
      /* ignore */
    }
  }
  return true;
}

export async function abortSession(id: string): Promise<boolean> {
  const s = await getSession(id);
  if (!s) return false;
  try {
    await s.session.abort();
    return true;
  } catch {
    return false;
  }
}

function summarizeLive(s: ServerSession, title?: string): SessionSummary {
  const name = s.sessionManager.getSessionName?.() as string | undefined;
  return {
    id: s.id,
    title: (name || title || "New chat").trim() || "New chat",
    createdAt: s.createdAt,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messageCount: (s.session.messages as any[])?.length ?? 0,
  };
}

/** Rebuild UI-shaped messages from a session's persisted entries. */
export async function loadUiMessages(id: string): Promise<UiMessage[] | undefined> {
  const s = await getSession(id);
  if (!s) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = s.sessionManager.buildSessionContext();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msgs: any[] = ctx.messages ?? [];
  const out: UiMessage[] = [];
  const toolIndex = new Map<string, { msgIdx: number; toolIdx: number }>();

  const contentToText = (content: unknown): string => {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((c: any) => c && c.type === "text" && typeof c.text === "string")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((c: any) => c.text)
        .join("");
    }
    return "";
  };

  for (const m of msgs) {
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
  }
  return out;
}

/**
 * Prompt the agent and stream events. Returns an async iterable of ChatEvent.
 */
export async function* streamPrompt(
  id: string,
  text: string,
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const server = await getSession(id);
  if (!server) {
    yield { type: "error", message: "Session not found" };
    return;
  }

  // Auto-title the session from its first user message if unnamed.
  try {
    const existing = server.sessionManager.getSessionName?.();
    if (!existing) {
      const title = text.slice(0, 60).replace(/\s+/g, " ").trim();
      if (title) server.sessionManager.appendSessionInfo(title);
    }
  } catch {
    /* ignore */
  }

  const queue: ChatEvent[] = [];
  let resolve: (() => void) | null = null;
  const wake = () => {
    if (resolve) {
      const r = resolve;
      resolve = null;
      r();
    }
  };
  const push = (e: ChatEvent) => {
    queue.push(e);
    wake();
  };

  let done = false;
  const toolBuffers = new Map<string, string>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const unsubscribe = server.session.subscribe((event: any) => {
    try {
      switch (event.type) {
        case "message_start":
          push({ type: "message_start" });
          break;
        case "message_end":
          push({ type: "message_end" });
          break;
        case "message_update": {
          const me = event.assistantMessageEvent;
          if (!me) return;
          if (me.type === "text_delta") push({ type: "text_delta", delta: me.delta ?? "" });
          else if (me.type === "thinking_delta")
            push({ type: "thinking_delta", delta: me.delta ?? "" });
          break;
        }
        case "tool_execution_start": {
          const tid = event.toolCallId ?? event.id ?? crypto.randomUUID();
          toolBuffers.set(tid, "");
          push({
            type: "tool_start",
            id: tid,
            name: event.toolName ?? "tool",
            input: event.args ?? event.input ?? event.parameters ?? {},
          });
          break;
        }
        case "tool_execution_update": {
          const tid = event.toolCallId ?? event.id;
          if (!tid) return;
          const delta =
            event.delta ??
            event.output ??
            (typeof event.partialResult === "string"
              ? event.partialResult
              : "");
          if (delta) {
            toolBuffers.set(tid, (toolBuffers.get(tid) ?? "") + String(delta));
            push({ type: "tool_update", id: tid, delta: String(delta) });
          }
          break;
        }
        case "tool_execution_end": {
          const tid = event.toolCallId ?? event.id;
          if (!tid) return;
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
          push({
            type: "tool_end",
            id: tid,
            output,
            isError: Boolean(event.isError),
          });
          toolBuffers.delete(tid);
          break;
        }
        case "turn_end":
          push({ type: "turn_end" });
          break;
      }
    } catch (err) {
      push({ type: "error", message: (err as Error).message });
    }
  });

  const onAbort = () => {
    server.session.abort().catch(() => {});
  };
  signal.addEventListener("abort", onAbort);

  const runPromise = (async () => {
    try {
      await server.session.prompt(text);
    } catch (err) {
      push({ type: "error", message: (err as Error).message });
    } finally {
      done = true;
      push({ type: "done" });
    }
  })();

  try {
    while (true) {
      if (queue.length === 0) {
        if (done) break;
        await new Promise<void>((r) => (resolve = r));
      }
      while (queue.length > 0) {
        const ev = queue.shift()!;
        yield ev;
        if (ev.type === "done") {
          await runPromise;
          return;
        }
      }
    }
    await runPromise;
  } finally {
    signal.removeEventListener("abort", onAbort);
    unsubscribe();
  }
}
