import "server-only";
import { homedir } from "node:os";
import { rm } from "node:fs/promises";
import type { ChatEvent, SessionSummary, UiMessage } from "./types";
import { agentMessagesToUi, deriveTitle } from "./messages";
import { mapAgentEvent } from "./agentEventMap";

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
  // Shared, provider-configured ModelRuntime. See getModelRuntime().
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  modelRuntime?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  modelRuntimeInit?: Promise<any>;
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

/**
 * Build (once) a ModelRuntime that has the ConceptsOS anthropic proxy
 * pre-registered.
 *
 * Why not just the extension? `createAgentSession()` (the SDK API we use)
 * loads extensions but does NOT apply their pendingProviderRegistrations to
 * the ModelRuntime — that step only exists in pi's own CLI init flow
 * (core/agent-session-services.ts). So the baked-in
 * ~/.pi/agent/extensions/conceptsos-provider.ts is inert here, and we have
 * to register the provider in-process ourselves.
 *
 * Env is populated by k8s (api/src/lib/k8s.ts):
 *   CONCEPTSOS_BASE_URL = http://conceptsos-api.…/api/llm
 *   CONCEPTSOS_API_KEY  = <per-user cos_… key>
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getModelRuntime(): Promise<any> {
  if (store.modelRuntime) return store.modelRuntime;
  if (!store.modelRuntimeInit) {
    store.modelRuntimeInit = (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sdkAny = (await loadSdk()) as any;
      const ModelRuntime = sdkAny.ModelRuntime;
      if (!ModelRuntime?.create) {
        throw new Error(
          "pi-coding-agent does not export ModelRuntime.create — SDK version mismatch",
        );
      }
      const rt = await ModelRuntime.create({});
      const baseUrl = process.env.CONCEPTSOS_BASE_URL;
      const apiKey = process.env.CONCEPTSOS_API_KEY;
      if (baseUrl && apiKey) {
        rt.registerProvider("anthropic", {
          baseUrl,
          // Placeholder — real auth is the Authorization header below. The
          // proxy strips x-api-key before forwarding to Anthropic.
          apiKey: "unused",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });
      } else {
        console.warn(
          "[pi-server] CONCEPTSOS_BASE_URL / CONCEPTSOS_API_KEY not set; anthropic provider will fall back to pi defaults and likely fail auth.",
        );
      }
      store.modelRuntime = rt;
      return rt;
    })();
  }
  return store.modelRuntimeInit;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function hydrateSession(sm: any): Promise<ServerSession> {
  const { createAgentSession } = await loadSdk();
  const modelRuntime = await getModelRuntime();
  const { session } = await createAgentSession({
    cwd: AGENT_CWD,
    sessionManager: sm,
    modelRuntime,
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
        deriveTitle((info.firstMessage as string | undefined) ?? "") ||
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
  const ctx = s.sessionManager.buildSessionContext();
  return agentMessagesToUi(ctx.messages ?? []);
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
      const title = deriveTitle(text);
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
      for (const ev of mapAgentEvent(event, toolBuffers)) push(ev);
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
