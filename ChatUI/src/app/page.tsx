"use client";

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import MenuIcon from "@mui/icons-material/Menu";
import AddIcon from "@mui/icons-material/Add";
import SendIcon from "@mui/icons-material/ArrowUpward";
import StopIcon from "@mui/icons-material/Stop";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import DarkIcon from "@mui/icons-material/DarkMode";
import LightIcon from "@mui/icons-material/LightMode";
import { ColorModeContext } from "@/components/ThemeRegistry";
import ToolCard from "@/components/ToolCard";
import Markdown from "@/components/Markdown";
import usePreventIOSContentScroll from "@/lib/usePreventIOSContentScroll";
import type { ChatEvent, SessionSummary, UiMessage, UiToolCall } from "@/lib/types";

const DRAWER_WIDTH = 280;

type ChatState = {
  messages: UiMessage[];
  streaming: boolean;
};

const emptyChat = (): ChatState => ({ messages: [], streaming: false });

export default function Page() {
  const { mode, toggle } = useContext(ColorModeContext);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [chats, setChats] = useState<Record<string, ChatState>>({});
  const [input, setInput] = useState("");
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // iOS Safari: prevent focus from scrolling the header off-screen and
  // resize the content container as the software keyboard opens/closes.
  const { contentRef } = usePreventIOSContentScroll();

  // Load sessions on mount
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/sessions");
      const data = await res.json();
      const list: SessionSummary[] = data.sessions ?? [];
      setSessions(list);
      if (list.length === 0) {
        await newChat();
      } else {
        setActiveId((prev) => prev ?? list[0].id);
      }
    })().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore last active from localStorage
  useEffect(() => {
    const last = localStorage.getItem("chatui-active");
    if (last) setActiveId(last);
  }, []);
  useEffect(() => {
    if (activeId) localStorage.setItem("chatui-active", activeId);
  }, [activeId]);

  // Autoscroll
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chats, activeId]);

  const activeChat = activeId ? chats[activeId] ?? emptyChat() : emptyChat();

  const newChat = useCallback(async () => {
    const res = await fetch("/api/sessions", { method: "POST", body: "{}" });
    const data = await res.json();
    const s: SessionSummary = data.session;
    setSessions((prev) => [s, ...prev.filter((x) => x.id !== s.id)]);
    setChats((prev) => ({ ...prev, [s.id]: emptyChat() }));
    setActiveId(s.id);
    setDrawerOpen(false);
    return s.id;
  }, []);

  const deleteChat = useCallback(
    async (id: string) => {
      await fetch(`/api/sessions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      setSessions((prev) => prev.filter((x) => x.id !== id));
      setChats((prev) => {
        const c = { ...prev };
        delete c[id];
        return c;
      });
      if (activeId === id) {
        setActiveId(null);
      }
    },
    [activeId],
  );

  const updateActive = useCallback(
    (id: string, mut: (c: ChatState) => ChatState) => {
      setChats((prev) => ({ ...prev, [id]: mut(prev[id] ?? emptyChat()) }));
    },
    [],
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    let id = activeId;
    if (!id) id = await newChat();
    if (!id) return;
    setInput("");

    const userMsg: UiMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      text,
      toolCalls: [],
    };
    updateActive(id, (c) => ({
      ...c,
      streaming: true,
      messages: [...c.messages, userMsg],
    }));

    // Update session title in sidebar
    setSessions((prev) =>
      prev.map((s) =>
        s.id === id && s.title === "New chat"
          ? { ...s, title: text.slice(0, 60).replace(/\s+/g, " ").trim() || s.title }
          : s,
      ),
    );

    const ac = new AbortController();
    abortRef.current = ac;

    let currentAssistant: UiMessage | null = null;
    const ensureAssistant = () => {
      if (currentAssistant) return currentAssistant;
      currentAssistant = {
        id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: "assistant",
        text: "",
        toolCalls: [],
      };
      const msg = currentAssistant;
      updateActive(id!, (c) => ({ ...c, messages: [...c.messages, msg] }));
      return currentAssistant;
    };

    const patchAssistant = (mut: (m: UiMessage) => UiMessage) => {
      const target = ensureAssistant();
      updateActive(id!, (c) => ({
        ...c,
        messages: c.messages.map((m) => (m.id === target.id ? mut(m) : m)),
      }));
    };

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, text }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      for await (const ev of readSse(res.body)) {
        handleEvent(ev);
      }

      function handleEvent(ev: ChatEvent) {
        switch (ev.type) {
          case "message_start":
            currentAssistant = null;
            break;
          case "message_end":
            currentAssistant = null;
            break;
          case "text_delta":
            patchAssistant((m) => ({ ...m, text: m.text + ev.delta }));
            break;
          case "thinking_delta":
            patchAssistant((m) => ({ ...m, thinking: (m.thinking ?? "") + ev.delta }));
            break;
          case "tool_start": {
            const tc: UiToolCall = {
              id: ev.id,
              name: ev.name,
              input: ev.input,
              output: "",
              isError: false,
              done: false,
            };
            patchAssistant((m) => ({ ...m, toolCalls: [...m.toolCalls, tc] }));
            break;
          }
          case "tool_update":
            patchAssistant((m) => ({
              ...m,
              toolCalls: m.toolCalls.map((t) =>
                t.id === ev.id ? { ...t, output: t.output + ev.delta } : t,
              ),
            }));
            break;
          case "tool_end":
            patchAssistant((m) => ({
              ...m,
              toolCalls: m.toolCalls.map((t) =>
                t.id === ev.id
                  ? { ...t, output: ev.output || t.output, isError: ev.isError, done: true }
                  : t,
              ),
            }));
            break;
          case "error":
            patchAssistant((m) => ({
              ...m,
              text: m.text + `\n\n[error] ${ev.message}`,
            }));
            break;
        }
      }
    } catch (err) {
      const msg = (err as Error).message;
      if (msg !== "The user aborted a request.") {
        patchAssistant((m) => ({ ...m, text: m.text + `\n\n[error] ${msg}` }));
      }
    } finally {
      abortRef.current = null;
      updateActive(id!, (c) => ({ ...c, streaming: false }));
    }
  }, [input, activeId, newChat, updateActive]);

  const abort = useCallback(async () => {
    if (!activeId) return;
    await fetch("/api/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: activeId }),
    });
    abortRef.current?.abort();
  }, [activeId]);

  const streaming = activeChat.streaming;

  const sidebar = (
    <Box sx={{ width: DRAWER_WIDTH, display: "flex", flexDirection: "column", height: "100%" }}>
      <Box sx={{ p: 1.5, display: "flex", alignItems: "center", gap: 1 }}>
        <Typography variant="h6" sx={{ flex: 1 }}>ChatUI</Typography>
        <Tooltip title="New chat">
          <IconButton size="small" onClick={newChat}><AddIcon fontSize="small" /></IconButton>
        </Tooltip>
      </Box>
      <Divider />
      <List sx={{ flex: 1, overflowY: "auto", py: 0.5 }} dense>
        {sessions.map((s) => (
          <ListItemButton
            key={s.id}
            selected={s.id === activeId}
            onClick={() => {
              setActiveId(s.id);
              setDrawerOpen(false);
            }}
            sx={{ mx: 1, my: 0.25 }}
          >
            <ListItemText
              primary={s.title}
              primaryTypographyProps={{
                noWrap: true,
                fontSize: 13,
                fontWeight: s.id === activeId ? 600 : 400,
              }}
            />
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                deleteChat(s.id);
              }}
              sx={{ opacity: 0.5, "&:hover": { opacity: 1 } }}
            >
              <DeleteIcon fontSize="inherit" />
            </IconButton>
          </ListItemButton>
        ))}
      </List>
      <Divider />
      <Box sx={{ p: 1, display: "flex", alignItems: "center", gap: 1 }}>
        <IconButton size="small" onClick={toggle} aria-label="toggle theme">
          {mode === "dark" ? <LightIcon fontSize="small" /> : <DarkIcon fontSize="small" />}
        </IconButton>
        <Typography variant="caption" color="text.secondary">
          {mode === "dark" ? "dark" : "light"}
        </Typography>
      </Box>
    </Box>
  );

  return (
    <Box
      sx={{
        display: "flex",
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        // 100dvh shrinks when Safari's URL bar is visible, so the input
        // doesn't disappear behind the URL bar chrome on iOS.
        height: "100dvh",
        overflow: "hidden",
        bgcolor: "background.default",
      }}
    >
      {/* Desktop sidebar */}
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: "none", md: "block" },
          "& .MuiDrawer-paper": {
            width: DRAWER_WIDTH,
            boxSizing: "border-box",
            borderRight: (t) => `1px solid ${t.palette.divider}`,
            backgroundImage: "none",
          },
        }}
      >
        {sidebar}
      </Drawer>
      {/* Mobile drawer */}
      <Drawer
        variant="temporary"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{ display: { xs: "block", md: "none" } }}
      >
        {sidebar}
      </Drawer>

      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <AppBar
          position="static"
          color="transparent"
          sx={{
            flexShrink: 0,
            borderBottom: (t) => `1px solid ${t.palette.divider}`,
            bgcolor: "background.default",
          }}
        >
          <Toolbar variant="dense" sx={{ minHeight: 48 }}>
            <IconButton
              edge="start"
              size="small"
              onClick={() => setDrawerOpen(true)}
              sx={{ mr: 1, display: { md: "none" } }}
            >
              <MenuIcon fontSize="small" />
            </IconButton>
            <Typography variant="body2" sx={{ flex: 1, color: "text.secondary" }} noWrap>
              {sessions.find((s) => s.id === activeId)?.title ?? "New chat"}
            </Typography>
          </Toolbar>
        </AppBar>

        {/* Outer box holds the flex slot; inner absolute box is what the
            iOS keyboard hook resizes/shifts. Absolute positioning lets the
            hook's inline height/bottom take effect without fighting flex. */}
        <Box
          sx={{
            flex: 1,
            position: "relative",
            overflow: "hidden",
          }}
        >
        <Box
          ref={contentRef}
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            transition: "height 0.25s cubic-bezier(0.32, 0.72, 0, 1), bottom 0.25s cubic-bezier(0.32, 0.72, 0, 1)",
          }}
        >
          <Box
            ref={scrollerRef}
            sx={{
              flex: 1,
              overflowY: "auto",
              px: { xs: 1.5, md: 3 },
              py: 2,
            }}
          >
            <Box sx={{ maxWidth: 780, mx: "auto" }}>
              {activeChat.messages.length === 0 && (
                <Typography color="text.secondary" sx={{ mt: 4, textAlign: "center" }}>
                  Ask anything.
                </Typography>
              )}
              <Stack spacing={2}>
                {activeChat.messages.map((m) => (
                  <MessageView key={m.id} message={m} />
                ))}
              </Stack>
            </Box>
          </Box>

          <Box
            sx={{
              borderTop: (t) => `1px solid ${t.palette.divider}`,
              px: 1.5,
              pt: 1.5,
              pb: "calc(12px + env(safe-area-inset-bottom))",
              flexShrink: 0,
            }}
          >
          <Paper
            variant="outlined"
            sx={{
              maxWidth: 780,
              mx: "auto",
              display: "flex",
              alignItems: "flex-end",
              gap: 1,
              px: 1.5,
              py: 1,
              borderRadius: 2,
            }}
          >
            <InputBase
              multiline
              maxRows={8}
              value={input}
              placeholder="Send a message…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!streaming) send();
                }
              }}
              sx={{ flex: 1, fontSize: 16 }}
            />
            {streaming ? (
              <IconButton color="primary" onClick={abort} aria-label="stop">
                <StopIcon />
              </IconButton>
            ) : (
              <IconButton
                color="primary"
                onClick={send}
                disabled={!input.trim()}
                aria-label="send"
              >
                <SendIcon />
              </IconButton>
            )}
          </Paper>
          </Box>
        </Box>
        </Box>
      </Box>
    </Box>
  );
}

function MessageView({ message }: { message: UiMessage }) {
  const isUser = message.role === "user";
  return (
    <Box sx={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
      <Box
        sx={{
          maxWidth: isUser ? "80%" : "100%",
          width: isUser ? "auto" : "100%",
        }}
      >
        {isUser ? (
          <Paper
            variant="outlined"
            sx={{
              px: 1.5,
              py: 1,
              borderRadius: 2,
              bgcolor: (t) => (t.palette.mode === "dark" ? "#1b1d22" : "#f0f4ff"),
              borderColor: (t) => t.palette.divider,
            }}
          >
            <Typography component="pre" sx={{ whiteSpace: "pre-wrap", fontSize: 14 }}>
              {message.text}
            </Typography>
          </Paper>
        ) : (
          <Box>
            {message.toolCalls.map((t) => (
              <ToolCard key={t.id} tool={t} />
            ))}
            {message.text && <Markdown>{message.text}</Markdown>}
          </Box>
        )}
      </Box>
    </Box>
  );
}

async function* readSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<ChatEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLine = chunk
        .split("\n")
        .find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const json = dataLine.slice(5).trim();
      if (!json) continue;
      try {
        yield JSON.parse(json) as ChatEvent;
      } catch {
        /* ignore */
      }
    }
  }
}
