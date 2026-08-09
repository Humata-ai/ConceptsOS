"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { SessionSidebar } from "@/components/SessionSidebar";
import { ModelDropdown } from "@/components/ModelDropdown";
import { Settings } from "@/components/Settings";
import { FileBrowser } from "@/components/FileBrowser";
import { Markdown } from "@/components/Markdown";
import {
  IconMenu, IconSettings, IconMic, IconSend, IconStop, IconAttach,
  IconCommand, IconFolder, IconArrowDown, IconCopy, IconClose,
} from "@/components/Icons";
import { Message, Session, ThinkingLevel, MODELS } from "@/lib/types";
import { loadSessions, saveSessions, newSession, newMessage, titleFrom } from "@/lib/store";
import { ThemeId, getInitialTheme, applyTheme } from "@/lib/themes";

const THINKING_LEVELS: ThinkingLevel[] = ["off", "low", "medium", "high"];

export default function Home() {
  // ── State ────────────────────────────────────────────────
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [fileOpen, setFileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeId, setThemeId] = useState<ThemeId>("night");
  const [model, setModel] = useState<string>(MODELS[0].id);
  const [thinking, setThinking] = useState<ThinkingLevel>("off");
  const [showThinking, setShowThinking] = useState(true);
  const [autoCompact, setAutoCompact] = useState(true);
  const [queued, setQueued] = useState<string[]>([]);
  const [scrollBtn, setScrollBtn] = useState(false);
  const [newMsgBadge, setNewMsgBadge] = useState(false);
  const [micOn, setMicOn] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recogRef = useRef<any>(null);

  // ── Hydrate from localStorage ────────────────────────────
  useEffect(() => {
    const t = getInitialTheme();
    setThemeId(t);
    applyTheme(t);
    const s = loadSessions();
    setSessions(s);
    if (s.length > 0) setCurrentId(s[0].id);
    try {
      const m = localStorage.getItem("chatui-model");
      if (m) setModel(m);
      const th = localStorage.getItem("chatui-thinking") as ThinkingLevel | null;
      if (th) setThinking(th);
    } catch {}
  }, []);

  useEffect(() => { saveSessions(sessions); }, [sessions]);
  useEffect(() => { try { localStorage.setItem("chatui-model", model); } catch {} }, [model]);
  useEffect(() => { try { localStorage.setItem("chatui-thinking", thinking); } catch {} }, [thinking]);

  const current = useMemo(
    () => sessions.find(s => s.id === currentId) ?? null,
    [sessions, currentId]
  );

  // ── Scroll handling ──────────────────────────────────────
  const scrollToBottom = useCallback((smooth = true) => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    setNewMsgBadge(false);
  }, []);

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      setScrollBtn(!near);
      if (near) setNewMsgBadge(false);
    };
    el.addEventListener("scroll", onScroll);
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [currentId]);

  useEffect(() => {
    // auto-scroll on new session change
    scrollToBottom(false);
  }, [currentId, scrollToBottom]);

  // ── Actions ──────────────────────────────────────────────
  const createSession = useCallback(() => {
    const s = newSession(model, thinking);
    setSessions(prev => [s, ...prev]);
    setCurrentId(s.id);
    setSidebarOpen(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [model, thinking]);

  const upsertMessage = useCallback((sessionId: string, msg: Message) => {
    setSessions(prev => prev.map(s => {
      if (s.id !== sessionId) return s;
      const idx = s.messages.findIndex(m => m.id === msg.id);
      const messages = idx === -1
        ? [...s.messages, msg]
        : s.messages.map(m => m.id === msg.id ? msg : m);
      return { ...s, messages, updatedAt: Date.now() };
    }));
  }, []);

  const patchMessage = useCallback((sessionId: string, msgId: string, patch: Partial<Message>) => {
    setSessions(prev => prev.map(s => {
      if (s.id !== sessionId) return s;
      const messages = s.messages.map(m => m.id === msgId ? { ...m, ...patch } : m);
      return { ...s, messages, updatedAt: Date.now() };
    }));
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    let sess = current;
    if (!sess) {
      const s = newSession(model, thinking);
      setSessions(prev => [s, ...prev]);
      setCurrentId(s.id);
      sess = s;
    }

    const userMsg = newMessage("user", text);
    const assistantMsg = newMessage("assistant", "", { streaming: true });
    let thinkingMsg: Message | null = null;
    if (thinking !== "off" && showThinking) {
      thinkingMsg = newMessage("thinking", "", { streaming: true });
    }

    const sessionId = sess.id;
    setSessions(prev => prev.map(s => {
      if (s.id !== sessionId) return s;
      const isFirst = s.messages.length === 0;
      const added: Message[] = [userMsg];
      if (thinkingMsg) added.push(thinkingMsg);
      added.push(assistantMsg);
      return {
        ...s,
        title: isFirst ? titleFrom(text) : s.title,
        messages: [...s.messages, ...added],
        updatedAt: Date.now(),
      };
    }));

    setStreaming(true);
    const ac = new AbortController();
    abortRef.current = ac;

    const history = [...(sess.messages || []), userMsg]
      .filter(m => m.role === "user" || m.role === "assistant")
      .map(m => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, model, thinking }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error("Bad response");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let assistantText = "";
      let thinkingText = "";
      let stage: "thinking" | "answer" = thinkingMsg ? "thinking" : "answer";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const evt = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = evt.split("\n").find(l => l.startsWith("data: "));
          if (!line) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "thinking" && thinkingMsg) {
              thinkingText += data.delta;
              patchMessage(sessionId, thinkingMsg.id, { content: thinkingText });
            } else if (data.type === "thinking_end" && thinkingMsg) {
              patchMessage(sessionId, thinkingMsg.id, { streaming: false });
              stage = "answer";
            } else if (data.type === "delta") {
              assistantText += data.delta;
              patchMessage(sessionId, assistantMsg.id, { content: assistantText });
              if (messagesRef.current) {
                const el = messagesRef.current;
                const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
                if (near) scrollToBottom(false);
                else setNewMsgBadge(true);
              }
            } else if (data.type === "done") {
              patchMessage(sessionId, assistantMsg.id, { streaming: false });
            }
          } catch { /* ignore */ }
        }
      }
      patchMessage(sessionId, assistantMsg.id, { streaming: false });
      if (thinkingMsg) patchMessage(sessionId, thinkingMsg.id, { streaming: false });
    } catch (e: any) {
      if (e?.name === "AbortError") {
        patchMessage(sessionId, assistantMsg.id, {
          content: (assistantMsg.content || "") + "\n\n_(aborted)_",
          streaming: false,
        });
      } else {
        patchMessage(sessionId, assistantMsg.id, {
          content: "Error: " + (e?.message ?? "unknown"),
          streaming: false,
        });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [current, model, thinking, showThinking, patchMessage, scrollToBottom]);

  // Drain queued messages once streaming ends
  useEffect(() => {
    if (streaming) return;
    if (queued.length === 0) return;
    const [next, ...rest] = queued;
    setQueued(rest);
    void sendMessage(next);
  }, [streaming, queued, sendMessage]);

  const onSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    if (streaming) {
      setQueued(q => [...q, text]);
    } else {
      void sendMessage(text);
    }
  }, [input, streaming, sendMessage]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // ── Keyboard shortcuts ───────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = document.activeElement instanceof HTMLInputElement
        || document.activeElement instanceof HTMLTextAreaElement;
      if (e.key === "Escape") {
        if (streaming) { abort(); e.preventDefault(); }
        else if (settingsOpen) { setSettingsOpen(false); }
      }
      if (e.key === "/" && !inField) {
        textareaRef.current?.focus();
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [streaming, abort, settingsOpen]);

  // ── Voice input (Web Speech API) ─────────────────────────
  const toggleMic = useCallback(() => {
    const W = window as any;
    const Rec = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!Rec) { alert("Web Speech API not supported in this browser"); return; }
    if (recogRef.current && micOn) {
      recogRef.current.stop();
      setMicOn(false);
      return;
    }
    const rec = new Rec();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    let base = input;
    rec.onresult = (e: any) => {
      let transcript = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript;
      }
      setInput((base + " " + transcript).trim());
    };
    rec.onend = () => setMicOn(false);
    rec.onerror = () => setMicOn(false);
    recogRef.current = rec;
    rec.start();
    setMicOn(true);
  }, [micOn, input]);

  // ── Token/cost demo values ───────────────────────────────
  const totalTokens = current
    ? current.messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0)
    : 0;
  const ctxMax = 200_000;
  const usedPct = Math.min(100, Math.round((totalTokens / ctxMax) * 100));
  const estCost = (totalTokens / 1000 * 0.003).toFixed(4);

  // ── Handlers for children ────────────────────────────────
  const cycleThinking = () => {
    const i = THINKING_LEVELS.indexOf(thinking);
    setThinking(THINKING_LEVELS[(i + 1) % THINKING_LEVELS.length]);
  };
  const copyText = (t: string) => navigator.clipboard?.writeText(t).catch(() => {});
  const deleteMessage = (id: string) => {
    if (!current) return;
    setSessions(prev => prev.map(s =>
      s.id !== current.id ? s : { ...s, messages: s.messages.filter(m => m.id !== id) }
    ));
  };

  return (
    <div className="app-layout">
      <SessionSidebar
        sessions={sessions}
        currentId={currentId}
        onSelect={setCurrentId}
        onNew={createSession}
        onRefresh={() => setSessions(loadSessions())}
        search={search}
        onSearch={setSearch}
        open={sidebarOpen}
        onCloseMobile={() => setSidebarOpen(false)}
      />

      <div className="main">
        <div className="header">
          <div className="header-left">
            <button className="sidebar-toggle" onClick={() => setSidebarOpen(o => !o)} title="Toggle sidebar">
              <IconMenu />
            </button>
            <ModelDropdown value={model} onChange={setModel} />
            <button className="thinking-tag" onClick={cycleThinking} title="Cycle thinking level">
              {thinking}
            </button>
          </div>
          <div className="header-right">
            <div className="pill session-cost" title="Session cost">${estCost}</div>
            <div className="pill token-usage" title="Context usage">
              {totalTokens.toLocaleString()} / {ctxMax.toLocaleString()} · {usedPct}%
            </div>
            <div className="status">
              <span className="status-indicator connected" />
              <span className="status-text">Ready</span>
            </div>
            <button className="icon-btn" title="Files" onClick={() => setFileOpen(o => !o)}>
              <IconFolder />
            </button>
            <button className="settings-btn" title="Settings" onClick={() => setSettingsOpen(true)}>
              <IconSettings />
            </button>
          </div>
        </div>

        <div className="messages" ref={messagesRef}>
          {(!current || current.messages.length === 0) && (
            <div className="welcome">
              <div className="welcome-icon">
                <Image src="/icons/tau-192.png" alt="τ" width={64} height={64} className="tau-icon-welcome" />
              </div>
              <p>Welcome to ChatUI</p>
              <p className="hint">Type a message below to start chatting, or select a session from the sidebar.</p>
              <div className="shortcuts-hint">
                <span>/ Focus input</span>
                <span>Esc Abort</span>
                <span>Shift+Enter Newline</span>
              </div>
            </div>
          )}

          {current?.messages.map(m => (
            <MessageView
              key={m.id}
              m={m}
              showThinking={showThinking}
              onCopy={copyText}
              onDelete={deleteMessage}
            />
          ))}
        </div>

        {scrollBtn && (
          <button className="scroll-bottom-btn" onClick={() => scrollToBottom(true)}>
            {newMsgBadge && (
              <span className="scroll-bottom-badge">
                New <IconArrowDown size={10} />
              </span>
            )}
            <span className="scroll-bottom-icon"><IconArrowDown /></span>
          </button>
        )}

        <div className="input-area">
          {queued.length > 0 && (
            <div className="queued-messages">
              {queued.map((q, i) => (
                <div key={i} className="queued-message">
                  <span>{q}</span>
                  <button onClick={() => setQueued(qs => qs.filter((_, j) => j !== i))}>
                    <IconClose size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={onSubmit}>
            <div className="input-left-actions">
              <button type="button" className="input-icon-btn" title="Commands" tabIndex={-1}
                onClick={() => alert("Slash commands: /new, /clear, /theme — hook up here")}>
                <IconCommand />
              </button>
              <button type="button" className="input-icon-btn" title="Attach image" tabIndex={-1}
                onClick={() => alert("Image attach demo — wire to real upload here")}>
                <IconAttach />
              </button>
            </div>
            <div className="input-bubble">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onSubmit(e as any);
                  }
                }}
                placeholder={streaming ? "Message will be queued…" : "Type a message… (Enter to send, Shift+Enter for newline)"}
                rows={2}
                autoComplete="off"
              />
              <button
                type="button"
                className={"input-mic-btn" + (micOn ? " recording" : "")}
                title="Voice input"
                tabIndex={-1}
                onClick={toggleMic}
              >
                <IconMic />
              </button>
            </div>
            <div className="input-actions">
              {!streaming ? (
                <button type="submit" id="send-btn" title="Send message" tabIndex={-1}>
                  <span className="send-icon"><IconSend /></span>
                </button>
              ) : (
                <button type="button" id="abort-btn" title="Abort (Esc)" onClick={abort} tabIndex={-1}>
                  <IconStop />
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      <FileBrowser
        open={fileOpen}
        onClose={() => setFileOpen(false)}
        onInsertPath={p => {
          setInput(v => v + (v ? " " : "") + p);
          textareaRef.current?.focus();
        }}
      />

      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        themeId={themeId}
        setThemeId={setThemeId}
        thinking={thinking}
        setThinking={setThinking}
        showThinking={showThinking}
        setShowThinking={setShowThinking}
        autoCompact={autoCompact}
        setAutoCompact={setAutoCompact}
      />
    </div>
  );
}

function MessageView({
  m, showThinking, onCopy, onDelete,
}: {
  m: Message;
  showThinking: boolean;
  onCopy: (t: string) => void;
  onDelete: (id: string) => void;
}) {
  if (m.role === "thinking") {
    if (!showThinking) return null;
    return (
      <div className="message thinking">
        <div className="message-label">Thinking</div>
        <div className="message-content">
          {m.content || (m.streaming ? "…" : "")}
          {m.streaming && <span className="typing-dot" />}
        </div>
      </div>
    );
  }

  if (m.role === "user") {
    return (
      <div className="message user">
        <div className="message-actions">
          <button className="msg-action" title="Copy" onClick={() => onCopy(m.content)}><IconCopy /></button>
          <button className="msg-action" title="Delete" onClick={() => onDelete(m.id)}><IconClose size={12} /></button>
        </div>
        <div className="message-content">
          <Markdown>{m.content}</Markdown>
        </div>
      </div>
    );
  }

  return (
    <div className="message assistant">
      <div className="message-actions">
        <button className="msg-action" title="Copy" onClick={() => onCopy(m.content)}><IconCopy /></button>
      </div>
      <div className="message-content">
        {m.content ? <Markdown>{m.content}</Markdown> : null}
        {m.streaming && <span className="typing-dot" />}
      </div>
    </div>
  );
}
