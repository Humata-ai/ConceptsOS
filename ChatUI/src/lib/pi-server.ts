import "server-only";
import { randomUUID } from "node:crypto";
import type { ChatEvent, SessionSummary } from "./types";

// Lazy import so Next doesn't try to bundle the SDK.
type PiSdk = typeof import("@earendil-works/pi-coding-agent");

type ServerSession = {
  id: string;
  title: string;
  createdAt: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: any;
  disposed: boolean;
};

type Store = {
  sessions: Map<string, ServerSession>;
  sdk?: PiSdk;
  sdkInit?: Promise<PiSdk>;
};

// Survive Next.js dev HMR by pinning to globalThis.
const g = globalThis as unknown as { __chatuiStore?: Store };
if (!g.__chatuiStore) {
  g.__chatuiStore = { sessions: new Map() };
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

export async function createSession(title?: string): Promise<SessionSummary> {
  const sdk = await loadSdk();
  const { createAgentSession, SessionManager } = sdk;
  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
  });
  const id = randomUUID();
  const entry: ServerSession = {
    id,
    title: title || "New chat",
    createdAt: Date.now(),
    session,
    disposed: false,
  };
  store.sessions.set(id, entry);
  return summarize(entry);
}

export function listSessions(): SessionSummary[] {
  return [...store.sessions.values()]
    .filter((s) => !s.disposed)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(summarize);
}

export function getSession(id: string): ServerSession | undefined {
  const s = store.sessions.get(id);
  if (!s || s.disposed) return undefined;
  return s;
}

export async function deleteSession(id: string): Promise<boolean> {
  const s = store.sessions.get(id);
  if (!s) return false;
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
  store.sessions.delete(id);
  return true;
}

export async function abortSession(id: string): Promise<boolean> {
  const s = getSession(id);
  if (!s) return false;
  try {
    await s.session.abort();
    return true;
  } catch {
    return false;
  }
}

function summarize(s: ServerSession): SessionSummary {
  return {
    id: s.id,
    title: s.title,
    createdAt: s.createdAt,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messageCount: (s.session.messages as any[])?.length ?? 0,
  };
}

/**
 * Prompt the agent and stream events. Returns an async iterable of ChatEvent.
 */
export async function* streamPrompt(
  id: string,
  text: string,
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const server = getSession(id);
  if (!server) {
    yield { type: "error", message: "Session not found" };
    return;
  }
  // Auto-title from first user message
  if (server.title === "New chat") {
    server.title = text.slice(0, 60).replace(/\s+/g, " ").trim() || "New chat";
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
          const tid = event.toolCallId ?? event.id ?? randomUUID();
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
