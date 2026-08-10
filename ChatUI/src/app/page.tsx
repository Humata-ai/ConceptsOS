"use client";

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import SwipeableDrawer from "@mui/material/SwipeableDrawer";
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
import { useGlobalSwipeToOpen } from "@/lib/useGlobalSwipeToOpen";
import { readSse } from "@/lib/sse";
import {
  applyChatEvent,
  beginStream,
  emptyChat,
  endStream,
  type ChatState,
} from "@/lib/chatReducer";
import type { SessionSummary, UiMessage } from "@/lib/types";
import { StickToBottom } from "use-stick-to-bottom";

const DRAWER_WIDTH = 280;

// iOS gets slightly different SwipeableDrawer tuning: Safari's back-swipe
// conflicts with the drawer's "discovery" nudge, and iOS's own drawers
// don't fade the backdrop separately from the panel.
const iOS =
  typeof window !== "undefined" &&
  /iPad|iPhone|iPod/.test(navigator.userAgent) &&
  !("MSStream" in window);

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

  // Perplexity-style follow-finger swipe from *anywhere* on the screen to
  // open the sidebar. MUI's SwipeableDrawer only listens near the left
  // edge; this hook complements it by imperatively translating the drawer
  // paper to track the finger, then handing off to MUI's Slide transition
  // on release for the last few pixels.
  useGlobalSwipeToOpen({
    onOpen: () => setDrawerOpen(true),
    drawerWidth: DRAWER_WIDTH,
    disabled: drawerOpen,
  });

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

  // Lazily hydrate persisted message history the first time a session is
  // selected (or when returning to one whose messages haven't been loaded).
  const hydratedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!activeId) return;
    if (hydratedRef.current.has(activeId)) return;
    if (chats[activeId]?.messages.length) {
      hydratedRef.current.add(activeId);
      return;
    }
    hydratedRef.current.add(activeId);
    (async () => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(activeId)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { messages: UiMessage[] };
        if (!data.messages?.length) return;
        setChats((prev) => ({
          ...prev,
          [activeId]: { messages: data.messages, streaming: false },
        }));
      } catch (err) {
        console.error(err);
      }
    })();
  }, [activeId, chats]);

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
      {/* Mobile drawer — swipeable from the left edge */}
      <SwipeableDrawer
        anchor="left"
        open={drawerOpen}
        onOpen={() => setDrawerOpen(true)}
        onClose={() => setDrawerOpen(false)}
        // ⚠️ MUI's `disableSwipeToOpen` defaults to `iOS` — i.e. swipe-to-open
        // is disabled by default on iPhones/iPads to avoid conflicting with
        // Safari's own back-swipe. We *want* the gesture, so force it on.
        // Our SwipeableDrawer sits at the root of the app (no browser-history
        // navigation to conflict with), so re-enabling is safe.
        disableSwipeToOpen={false}
        // iOS: skip Safari's "discovery" nudge so the edge feels native,
        // and keep the backdrop transition since iOS's own drawers fade.
        // Non-iOS: use MUI defaults, which feel snappier on Android/desktop.
        disableBackdropTransition={!iOS}
        disableDiscovery={iOS}
        // Widen the hit area from the default 20px so a finger swipe from
        // the very left edge reliably grabs the drawer (matches iOS ~30px).
        swipeAreaWidth={32}
        ModalProps={{ keepMounted: true }}
        SlideProps={{
          // Native-feeling ease-out curve (Apple's stock deceleration).
          easing: {
            enter: "cubic-bezier(0.32, 0.72, 0, 1)",
            exit: "cubic-bezier(0.32, 0.72, 0, 1)",
          },
        }}
        PaperProps={{
          sx: {
            width: DRAWER_WIDTH,
            backgroundImage: "none",
          },
        }}
        sx={{ display: { xs: "block", md: "none" } }}
      >
        {sidebar}
      </SwipeableDrawer>

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
                  alignItems: "center",
                  gap: 1,
                  px: 1.5,
                  py: 0.5,
                  borderRadius: 2,
                  willChange: "transform, box-shadow, border-color",
                  transformOrigin: "center bottom",
                  transition: (t) =>
                    t.transitions.create(
                      ["transform", "box-shadow", "border-color", "background-color"],
                      {
                        duration: 180,
                        easing: "cubic-bezier(0.2, 0, 0, 1)",
                      },
                    ),
                  "&:focus-within": {
                    transform: "translateY(-2px)",
                    boxShadow: (t) =>
                      `0 8px 24px -8px ${
                        t.palette.mode === "dark"
                          ? "rgba(0,0,0,0.6)"
                          : "rgba(17,24,39,0.18)"
                      }`,
                  },
                  "@media (prefers-reduced-motion: reduce)": {
                    transition: "none",
                    "&:focus-within": { transform: "none" },
                  },
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
                  sx={{
                    flex: 1,
                    fontSize: 16,
                    // Center the text vertically within the composer row
                    // (MUI's default multiline textarea has asymmetric padding).
                    "& textarea": { py: 0.25 },
                  }}
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
