# ChatUI

A Next.js + React re-implementation of [Tau](https://github.com/deflating/tau).

Tau is a web UI that mirrors a Pi terminal session in the browser.
ChatUI mirrors Tau's UX — sidebar sessions, model dropdown, thinking-level pill,
token/cost pills, file browser, streaming markdown, PWA, 6 themes — but built
from scratch in React with a mock streaming backend so it runs standalone.

## Quick start

```bash
npm install
npm run dev
# open http://localhost:3050
```

## Features

- Streaming chat via `/api/chat` (Server-Sent-Event style over `fetch`)
- Markdown + GFM + syntax highlighting (react-markdown + rehype-highlight)
- Session sidebar with search, persisted in `localStorage`
- Model dropdown with filter (`⌘`-style palette lite)
- Thinking-level pill (`off` / `low` / `medium` / `high`) — cycles on click
- Token-usage + session-cost pills (estimated)
- File-browser right sidebar (mock tree — click a file to insert its path)
- Voice input via Web Speech API (mic pulses red while recording)
- 6 themes (Dusk, Dawn, Midnight, Clean, Terracotta, Sage) — same palette as Tau
- Settings panel: theme, auto-compaction, thinking level, show-thinking
- Message queuing while the assistant is streaming
- Scroll-to-bottom button with "new" badge
- Keyboard: `/` focus input, `Esc` abort, `Shift+Enter` newline
- PWA manifest + icons

## Swap in a real model

The only mock is `src/app/api/chat/route.ts`. Replace `buildReply` with a real
provider call (OpenAI, Anthropic, or Dan's `openai` nushell CLI via a subprocess)
and keep the SSE-style event shape (`{type:"delta",delta:"..."}`,
`{type:"thinking",delta:"..."}`, `{type:"done"}`) and the client just works.

## Layout

```
src/
  app/
    layout.tsx     — root shell, theme bootstrapping, fonts
    page.tsx       — main chat page (all wiring lives here)
    style.css      — Tau's original stylesheet (verbatim)
    extra.css      — supplements for React-specific classes
    api/chat/      — mock streaming backend
  components/
    SessionSidebar.tsx
    ModelDropdown.tsx
    Settings.tsx
    FileBrowser.tsx
    Markdown.tsx
    Icons.tsx
  lib/
    themes.ts      — theme palette + apply()/getInitial()
    types.ts       — Session / Message / Model definitions
    store.ts       — localStorage session persistence
```

## Credits

- Original design & styles: [Tau](https://github.com/deflating/tau) by @deflating (MIT)
- This React port: MIT
