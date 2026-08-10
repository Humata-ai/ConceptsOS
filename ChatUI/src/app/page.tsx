"use client";

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import MenuIcon from "@mui/icons-material/Menu";
import SendIcon from "@mui/icons-material/ArrowUpward";
import StopIcon from "@mui/icons-material/Stop";
import { ColorModeContext } from "@/components/ThemeRegistry";
import MessageView from "@/components/MessageView";
import ScrollToBottomButton from "@/components/ScrollToBottomButton";
import Sidebar from "@/components/Sidebar";
import usePreventIOSContentScroll from "@/lib/usePreventIOSContentScroll";
import { readSse } from "@/lib/sse";
import {
  applyChatEvent,
  beginStream,
  emptyChat,
  endStream,
  type ChatState,
} from "@/lib/chatReducer";
import type { SessionSummary } from "@/lib/types";
import { StickToBottom } from "use-stick-to-bottom";

const DRAWER_WIDTH = 280;

export default function Page() {
  const { mode, toggle } = useContext(ColorModeContext);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [chats, setChats] = useState<Record<string, ChatState>>({});
  const [input, setInput] = useState("");
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

    updateActive(id, (c) => beginStream(c, text));

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

    let streamError: string | undefined;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, text }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      for await (const ev of readSse(res.body)) {
        updateActive(id, (c) => applyChatEvent(c, ev));
      }
    } catch (err) {
      const msg = (err as Error).message;
      if (msg !== "The user aborted a request.") streamError = msg;
    } finally {
      updateActive(id, (c) => endStream(c, streamError));
      abortRef.current = null;
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

  const selectChat = useCallback((id: string) => {
    setActiveId(id);
    setDrawerOpen(false);
  }, []);

  const sidebar = (
    <Sidebar
      width={DRAWER_WIDTH}
      sessions={sessions}
      activeId={activeId}
      mode={mode}
      onNew={newChat}
      onSelect={selectChat}
      onDelete={deleteChat}
      onToggleTheme={toggle}
    />
  );

  return (
    <Box
      sx={{
        display: "flex",
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        // svh is the *small* viewport height, computed as if Safari's URL bar
        // is always visible. It's stable across URL bar show/hide on iOS 26
        // (where dvh can lag behind), so the input never tucks under the bar.
        height: "100svh",
        overflow: "hidden",
        bgcolor: "background.default",
      }}
    >
      {/* Desktop sidebar */}
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: "none", md: "block" },
          // Reserve flex space so the fixed-position paper doesn't overlay
          // the content column. Without these two lines the sidebar visually
          // covers the leftmost ~DRAWER_WIDTH pixels of every message.
          width: DRAWER_WIDTH,
          flexShrink: 0,
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
        <Box sx={{ flex: 1, position: "relative", overflow: "hidden" }}>
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
              transition:
                "height 0.25s cubic-bezier(0.32, 0.72, 0, 1), bottom 0.25s cubic-bezier(0.32, 0.72, 0, 1)",
            }}
          >
            <StickToBottom
              className="chatui-scroller"
              style={{ flex: 1, minHeight: 0, position: "relative" }}
              resize="smooth"
              initial="instant"
            >
              <StickToBottom.Content
                className="chatui-scroller-content"
                style={{ padding: "16px 12px" }}
              >
                <Box sx={{ maxWidth: 780, mx: "auto", px: { xs: 0, md: 1.5 } }}>
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
              </StickToBottom.Content>
              <ScrollToBottomButton />
            </StickToBottom>

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
