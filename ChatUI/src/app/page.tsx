"use client";
import * as React from "react";
import {
  AppBar, Box, CircularProgress, Divider, Drawer, IconButton, InputBase,
  List, ListItemButton, ListItemText, Paper, Stack, Toolbar, Tooltip,
  Typography, useMediaQuery, useTheme,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import AddIcon from "@mui/icons-material/Add";
import SendIcon from "@mui/icons-material/ArrowUpward";
import StopIcon from "@mui/icons-material/Stop";
import LightModeIcon from "@mui/icons-material/LightMode";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import RefreshIcon from "@mui/icons-material/Refresh";
import { Markdown } from "@/components/Markdown";
import { ToolCard } from "@/components/ToolCard";
import { useMode } from "@/components/ThemeRegistry";
import type { PiSessionMeta, UiMessage } from "@/lib/types";

const SIDEBAR_WIDTH = 260;

function nowId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

interface StreamEvent {
  type: string;
  delta?: string;
  name?: string;
  input?: unknown;
  id?: string;
  output?: string;
  isError?: boolean;
  message?: string;
}

export default function Home() {
  const theme = useTheme();
  const { mode, setMode } = useMode();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const [sessions, setSessions] = React.useState<PiSessionMeta[]>([]);
  const [currentId, setCurrentId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<UiMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [streaming, setStreaming] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [loadingList, setLoadingList] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Load session list on mount
  const refresh = React.useCallback(async () => {
    setLoadingList(true);
    try {
      const r = await fetch("/api/sessions");
      const j = await r.json();
      setSessions(j.sessions ?? []);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoadingList(false);
    }
  }, []);

  React.useEffect(() => { void refresh(); }, [refresh]);

  // When switching sessions, load snapshot
  React.useEffect(() => {
    if (!currentId) { setMessages([]); return; }
    (async () => {
      try {
        const r = await fetch(`/api/sessions/${currentId}`);
        if (!r.ok) return;
        const snap = await r.json();
        const msgs: UiMessage[] = (snap.messages || [])
          .filter((m: any) => m.role === "user" || m.role === "assistant")
          .filter((m: any) => (m.content || "").trim().length > 0)
          .map((m: any) => ({ id: nowId(), role: m.role, content: m.content }));
        setMessages(msgs);
      } catch {}
    })();
  }, [currentId]);

  React.useEffect(() => {
    // Autoscroll on new content
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (near) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const newSession = React.useCallback(async () => {
    try {
      const r = await fetch("/api/sessions", { method: "POST" });
      const j = await r.json();
      if (j.error) { setError(j.error); return; }
      setSessions(prev => [j.session, ...prev.filter(s => s.id !== j.session.id)]);
      setCurrentId(j.session.id);
      setMessages([]);
      setDrawerOpen(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }, []);

  const sendMessage = React.useCallback(async (text: string) => {
    let sid = currentId;
    if (!sid) {
      // Auto-create a session
      const r = await fetch("/api/sessions", { method: "POST" });
      const j = await r.json();
      if (j.error) { setError(j.error); return; }
      sid = j.session.id as string;
      setSessions(prev => [j.session, ...prev.filter(s => s.id !== sid)]);
      setCurrentId(sid);
    }

    const userMsg: UiMessage = { id: nowId(), role: "user", content: text };
    const assistantMsg: UiMessage = { id: nowId(), role: "assistant", content: "", streaming: true };
    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setStreaming(true);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid, message: text }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      // Currently open tool cards, keyed by tool call id
      const openTools = new Map<string, string>(); // toolCallId -> uiMessageId

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const dl = line.split("\n").find(l => l.startsWith("data: "));
          if (!dl) continue;
          let evt: StreamEvent;
          try { evt = JSON.parse(dl.slice(6)); } catch { continue; }
          applyEvent(evt, assistantMsg.id, openTools);
        }
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        setMessages(prev => prev.map(m =>
          m.id === assistantMsg.id ? { ...m, content: (m.content || "") + `\n\n**Error:** ${e?.message ?? e}`, streaming: false } : m
        ));
      } else {
        setMessages(prev => prev.map(m => m.id === assistantMsg.id ? { ...m, streaming: false } : m));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      // Refresh titles from server (first message sets it)
      void refresh();
    }

    function applyEvent(evt: StreamEvent, assistantId: string, openTools: Map<string, string>) {
      switch (evt.type) {
        case "delta":
          if (evt.delta) {
            setMessages(prev => prev.map(m =>
              m.id === assistantId ? { ...m, content: (m.content || "") + evt.delta! } : m
            ));
          }
          break;
        case "tool_start": {
          const uiId = nowId();
          if (evt.id) openTools.set(evt.id, uiId);
          setMessages(prev => {
            // Insert tool card *after* the current assistant streaming msg to keep order
            const idx = prev.findIndex(m => m.id === assistantId);
            const toolMsg: UiMessage = {
              id: uiId, role: "tool",
              content: "",
              toolName: evt.name ?? "tool",
              toolInput: evt.input,
              streaming: true,
            };
            // Close current assistant text bubble so next text starts fresh
            const newAssistant: UiMessage = { id: nowId(), role: "assistant", content: "", streaming: true };
            const before = prev.slice(0, idx + 1);
            const after = prev.slice(idx + 1);
            return [
              ...before.map(m => m.id === assistantId ? { ...m, streaming: false } : m),
              toolMsg,
              newAssistant,
              ...after,
            ];
          });
          break;
        }
        case "tool_end": {
          const uiId = evt.id ? openTools.get(evt.id) : undefined;
          if (!uiId) break;
          setMessages(prev => prev.map(m =>
            m.id === uiId ? { ...m, toolOutput: evt.output ?? "", toolError: !!evt.isError, streaming: false } : m
          ));
          break;
        }
        case "error":
          setMessages(prev => prev.map(m =>
            m.streaming ? { ...m, content: (m.content || "") + `\n\n**Error:** ${evt.message}`, streaming: false } : m
          ));
          break;
        case "done":
          setMessages(prev => prev.map(m => m.streaming ? { ...m, streaming: false } : m));
          break;
        default: break;
      }
    }
  }, [currentId, refresh]);

  const onSend = () => {
    const t = input.trim();
    if (!t || streaming) return;
    setInput("");
    void sendMessage(t);
  };

  const onAbort = async () => {
    if (!currentId) return;
    abortRef.current?.abort();
    try { await fetch("/api/abort", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: currentId }) }); } catch {}
  };

  // Keyboard shortcuts
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && streaming) { onAbort(); }
      const inField = document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA";
      if ((e.metaKey || e.ctrlKey) && e.key === "n") { e.preventDefault(); void newSession(); }
      if (e.key === "/" && !inField) { e.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [streaming, newSession, onAbort]);

  const sidebar = (
    <Box sx={{ width: SIDEBAR_WIDTH, height: "100%", display: "flex", flexDirection: "column", bgcolor: "background.paper" }}>
      <Toolbar variant="dense" sx={{ px: 2, gap: 1, minHeight: 52 }}>
        <Typography variant="body2" sx={{ flex: 1, fontWeight: 600, letterSpacing: "-0.01em" }}>
          Chats
        </Typography>
        <Tooltip title="Refresh">
          <IconButton onClick={refresh}><RefreshIcon fontSize="small" /></IconButton>
        </Tooltip>
        <Tooltip title="New chat (⌘N)">
          <IconButton onClick={newSession}><AddIcon fontSize="small" /></IconButton>
        </Tooltip>
      </Toolbar>
      <Divider />
      <Box sx={{ flex: 1, overflowY: "auto", py: 1 }}>
        {loadingList && sessions.length === 0 && (
          <Box sx={{ px: 3, py: 4, textAlign: "center", color: "text.secondary" }}>
            <CircularProgress size={16} />
          </Box>
        )}
        {!loadingList && sessions.length === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", px: 3, py: 2 }}>
            No chats yet. Press <b>+</b> to start.
          </Typography>
        )}
        <List dense disablePadding>
          {sessions.map(s => (
            <ListItemButton
              key={s.id}
              selected={s.id === currentId}
              onClick={() => { setCurrentId(s.id); setDrawerOpen(false); }}
            >
              <ListItemText
                primary={s.title}
                primaryTypographyProps={{ noWrap: true, variant: "body2" }}
                secondary={new Date(s.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                secondaryTypographyProps={{ variant: "caption" }}
              />
            </ListItemButton>
          ))}
        </List>
      </Box>
      <Divider />
      <Box sx={{ px: 2, py: 1.5, display: "flex", alignItems: "center", gap: 1 }}>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
          real pi
        </Typography>
        <IconButton onClick={() => setMode(mode === "dark" ? "light" : "dark")}>
          {mode === "dark" ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
        </IconButton>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", height: "100dvh", bgcolor: "background.default" }}>
      {isMobile ? (
        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} PaperProps={{ sx: { border: 0 } }}>
          {sidebar}
        </Drawer>
      ) : (
        <Box sx={{ borderRight: 1, borderColor: "divider", flexShrink: 0 }}>
          {sidebar}
        </Box>
      )}

      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <AppBar position="static">
          <Toolbar variant="dense" sx={{ gap: 1, minHeight: 52, borderBottom: 1, borderColor: "divider" }}>
            {isMobile && (
              <IconButton onClick={() => setDrawerOpen(true)}><MenuIcon fontSize="small" /></IconButton>
            )}
            <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }} noWrap>
              {sessions.find(s => s.id === currentId)?.title ?? "ChatUI"}
            </Typography>
            {streaming && (
              <Stack direction="row" spacing={1} alignItems="center">
                <CircularProgress size={12} />
                <Typography variant="caption" color="text.secondary">thinking…</Typography>
              </Stack>
            )}
          </Toolbar>
        </AppBar>

        <Box ref={scrollRef} sx={{ flex: 1, overflowY: "auto", px: { xs: 2, md: 4 }, py: 3 }}>
          <Box sx={{ maxWidth: 780, mx: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
            {messages.length === 0 && (
              <Box sx={{ textAlign: "center", color: "text.secondary", py: 8 }}>
                <Typography variant="h6" sx={{ mb: 1, fontWeight: 500 }}>ChatUI</Typography>
                <Typography variant="body2" color="text.secondary">
                  Talk to a real Pi agent session, in your browser.
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
                  cwd: <code>{typeof window !== "undefined" ? "" : ""}pi from server</code> · press <kbd>/</kbd> to focus, <kbd>Esc</kbd> to abort
                </Typography>
              </Box>
            )}

            {messages.map(m => (
              <MessageRow key={m.id} m={m} />
            ))}
            {error && (
              <Paper variant="outlined" sx={{ p: 1.5, borderColor: "error.main", color: "error.main" }}>
                <Typography variant="body2">{error}</Typography>
              </Paper>
            )}
          </Box>
        </Box>

        <Box sx={{ borderTop: 1, borderColor: "divider", px: { xs: 2, md: 4 }, py: 1.5 }}>
          <Paper
            variant="outlined"
            sx={{
              maxWidth: 780,
              mx: "auto",
              px: 1.5, py: 0.5,
              display: "flex",
              alignItems: "flex-end",
              gap: 1,
              borderRadius: 3,
            }}
          >
            <InputBase
              inputRef={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); }
              }}
              placeholder={streaming ? "Streaming…" : "Message Pi"}
              multiline
              minRows={1}
              maxRows={10}
              sx={{ flex: 1, fontSize: 14, py: 1 }}
              disabled={false}
            />
            {streaming ? (
              <Tooltip title="Stop (Esc)">
                <IconButton onClick={onAbort} sx={{ mb: 0.5 }}>
                  <StopIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : (
              <Tooltip title="Send (Enter)">
                <span>
                  <IconButton
                    onClick={onSend}
                    disabled={!input.trim()}
                    sx={{
                      mb: 0.5,
                      bgcolor: input.trim() ? "text.primary" : "transparent",
                      color: input.trim() ? "background.paper" : "text.disabled",
                      "&:hover": { bgcolor: input.trim() ? "text.primary" : "transparent", opacity: 0.85 },
                    }}
                  >
                    <SendIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            )}
          </Paper>
        </Box>
      </Box>
    </Box>
  );
}

function MessageRow({ m }: { m: UiMessage }) {
  if (m.role === "tool") {
    return (
      <ToolCard
        name={m.toolName ?? "tool"}
        input={m.toolInput}
        output={m.toolOutput}
        error={m.toolError}
        running={m.streaming}
      />
    );
  }
  if (m.role === "user") {
    return (
      <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
        <Paper
          variant="outlined"
          sx={{
            px: 2, py: 1.25,
            maxWidth: "80%",
            borderRadius: 3,
            bgcolor: (t) => t.palette.mode === "dark" ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
          }}
        >
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{m.content}</Typography>
        </Paper>
      </Box>
    );
  }
  // assistant
  if (!m.content && !m.streaming) return null;
  return (
    <Box sx={{ pl: 0.5 }}>
      <div className="md">
        {m.content ? <Markdown>{m.content}</Markdown> : null}
        {m.streaming && <span className="cursor" />}
      </div>
    </Box>
  );
}
