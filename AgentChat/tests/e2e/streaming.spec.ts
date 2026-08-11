import { test, expect, Page } from "@playwright/test";

/**
 * E2E tests for the streaming UI (reasoning, tool cards, cursor, typing dots).
 *
 * Strategy: instead of running a real model, we install a `window.fetch` shim
 * before the app loads that intercepts POST /api/chat and streams back a
 * scripted sequence of Server-Sent Events with real setTimeout delays. This
 * lets us deterministically exercise every streaming UI state (mid-stream
 * cursor, running tool spinner, thinking shimmer, etc.) without a network
 * dependency or a live LLM.
 *
 * The shim exposes `window.__setMockStream(events)` where `events` is an
 * array of `[delayMs, eventName, dataObject]`. The next POST /api/chat call
 * consumes the queue.
 */

type MockEvent = [number, string, Record<string, unknown>];

async function installMockChatStream(page: Page) {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.__mockStreamQueue = [];
    w.__setMockStream = (events: unknown[]) => {
      w.__mockStreamQueue.push(events);
    };
    const origFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.endsWith("/api/chat") && (init?.method ?? "GET") === "POST") {
        const script = w.__mockStreamQueue.shift();
        if (!script) {
          return new Response("no mock stream queued", { status: 500 });
        }
        const enc = new TextEncoder();
        const body = new ReadableStream({
          async start(ctrl) {
            for (const [delay, event, data] of script as [
              number,
              string,
              Record<string, unknown>,
            ][]) {
              if (delay > 0) await new Promise((r) => setTimeout(r, delay));
              const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
              ctrl.enqueue(enc.encode(chunk));
            }
            ctrl.close();
          },
        });
        return new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      return origFetch(input, init);
    };
  });
}

async function queueMock(page: Page, events: MockEvent[]) {
  await page.evaluate((ev) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__setMockStream(ev);
  }, events);
}

/**
 * Load the app in a clean state and wait for it to be ready to send.
 * Must be called BEFORE queueMock — queueMock persists on the current page.
 *
 * We deliberately create a *fresh* session via POST /api/sessions and pin it
 * via localStorage before the app loads. Without this, the app boots into
 * whatever session happens to be first in the dev server's DB, and the
 * message list is polluted with real prior chats — which then blows up every
 * strict-mode locator like getByTestId("assistant-message").
 */
async function bootChatUI(page: Page) {
  // Land on the origin so we can talk to same-origin localStorage/APIs.
  await page.goto("/");
  // Mint a brand-new session server-side and pin it as the active one.
  const freshId = await page.evaluate(async () => {
    window.localStorage.clear();
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const data = (await res.json()) as { session: { id: string } };
    window.localStorage.setItem("chatui-active", data.session.id);
    return data.session.id;
  });
  // Reload so the app picks up chatui-active on mount and hydrates the
  // (empty) fresh session instead of falling back to sessions[0].
  await page.goto("/");
  const input = page.getByPlaceholder("Send a message…");
  await expect(input).toBeVisible();
  // Wait until the send button becomes enabled after typing — this proves
  // the sessions bootstrap has completed and activeId is set.
  await input.fill("warmup");
  await expect(page.getByRole("button", { name: "send" })).toBeEnabled();
  await input.fill("");
  // Belt-and-braces: assert we really are on the fresh empty session, not
  // a polluted one, so failures later in the test are actionable.
  await expect(page.getByTestId("assistant-message")).toHaveCount(0);
  await expect(page.getByTestId("user-message")).toHaveCount(0);
  return freshId;
}

async function sendPrompt(page: Page, text: string) {
  const input = page.getByPlaceholder("Send a message…");
  await input.fill(text);
  await page.getByRole("button", { name: "send" }).click();
}

test.describe("streaming UI", () => {
  test.beforeEach(async ({ page }) => {
    await installMockChatStream(page);
  });

  test("plain text stream shows blinking cursor mid-stream, cleared after", async ({
    page,
  }) => {
    await bootChatUI(page);
    await queueMock(page, [
      [0, "message_start", { type: "message_start" }],
      [100, "text_delta", { type: "text_delta", delta: "Hello " }],
      [400, "text_delta", { type: "text_delta", delta: "there " }],
      [400, "text_delta", { type: "text_delta", delta: "world." }],
      [200, "message_end", { type: "message_end" }],
      [50, "done", { type: "done" }],
    ]);
    await sendPrompt(page, "hi");

    // User bubble should show immediately.
    await expect(page.getByTestId("user-message")).toContainText("hi");

    // Mid-stream: cursor visible, streaming=true.
    const cursor = page.getByTestId("streaming-cursor");
    await expect(cursor).toBeVisible();
    const assistant = page.getByTestId("assistant-message");
    await expect(assistant).toHaveAttribute("data-streaming", "true");

    // End: text complete, cursor gone, streaming=false.
    await expect(assistant).toHaveAttribute("data-streaming", "false", {
      timeout: 5000,
    });
    await expect(page.getByTestId("assistant-text")).toContainText(
      "Hello there world.",
    );
    await expect(cursor).toHaveCount(0);
  });

  test("typing indicator shows before first token", async ({ page }) => {
    await bootChatUI(page);
    await queueMock(page, [
      [0, "message_start", { type: "message_start" }],
      // Long delay before any content so the typing dots are stable.
      [1500, "text_delta", { type: "text_delta", delta: "ok" }],
      [50, "message_end", { type: "message_end" }],
      [50, "done", { type: "done" }],
    ]);
    await sendPrompt(page, "wait for it");

    // Between message_start and first delta: typing indicator visible.
    await expect(page.getByTestId("typing-indicator")).toBeVisible();

    // Once text arrives, typing indicator goes away.
    await expect(page.getByTestId("typing-indicator")).toHaveCount(0, {
      timeout: 5000,
    });
    await expect(page.getByTestId("assistant-text")).toContainText("ok");
  });

  test("reasoning block: shimmer + timer while thinking, collapses after text arrives", async ({
    page,
  }) => {
    await bootChatUI(page);
    await queueMock(page, [
      [0, "message_start", { type: "message_start" }],
      [100, "thinking_delta", { type: "thinking_delta", delta: "Let me " }],
      [400, "thinking_delta", { type: "thinking_delta", delta: "consider this " }],
      [400, "thinking_delta", { type: "thinking_delta", delta: "carefully." }],
      // Give the timer a moment to tick past 1s.
      [800, "text_delta", { type: "text_delta", delta: "The answer is 42." }],
      [200, "message_end", { type: "message_end" }],
      [50, "done", { type: "done" }],
    ]);
    await sendPrompt(page, "think then answer");

    const reasoning = page.getByTestId("reasoning");
    await expect(reasoning).toBeVisible();

    // While thinking, the header should read "Thinking..."
    await expect(reasoning).toHaveAttribute(
      "data-reasoning-streaming",
      "true",
    );
    await expect(page.getByTestId("reasoning-status")).toContainText(/Thinking/);

    // After text arrives, streaming flips off and label switches to "Thought".
    await expect(reasoning).toHaveAttribute(
      "data-reasoning-streaming",
      "false",
      { timeout: 5000 },
    );
    await expect(page.getByTestId("reasoning-status")).toContainText(/Thought/);
    await expect(page.getByTestId("assistant-text")).toContainText(
      "The answer is 42.",
    );
  });

  test("tool card cycles running → done, and shows check icon", async ({
    page,
  }) => {
    await bootChatUI(page);
    await queueMock(page, [
      [0, "message_start", { type: "message_start" }],
      [
        50,
        "tool_start",
        {
          type: "tool_start",
          id: "t1",
          name: "bash",
          input: { command: "ls /etc | head -3" },
        },
      ],
      // Simulate streaming tool output for a while so the "running" state
      // is observable.
      [600, "tool_update", { type: "tool_update", id: "t1", delta: "adjtime\n" }],
      [400, "tool_update", { type: "tool_update", id: "t1", delta: "aliases\n" }],
      [400, "tool_update", { type: "tool_update", id: "t1", delta: "bash.bashrc\n" }],
      [
        400,
        "tool_end",
        {
          type: "tool_end",
          id: "t1",
          output: "adjtime\naliases\nbash.bashrc\n",
          isError: false,
        },
      ],
      [300, "text_delta", { type: "text_delta", delta: "I listed /etc." }],
      [200, "message_end", { type: "message_end" }],
      [50, "done", { type: "done" }],
    ]);
    await sendPrompt(page, "run ls");

    const card = page.getByTestId("tool-card");
    await expect(card).toBeVisible();
    // Initially running.
    await expect(card).toHaveAttribute("data-tool-status", "running");
    await expect(card).toHaveAttribute("data-tool-name", "bash");

    // Eventually done.
    await expect(card).toHaveAttribute("data-tool-status", "done", {
      timeout: 5000,
    });
    await expect(page.getByTestId("assistant-text")).toContainText(
      "I listed /etc.",
    );
  });

  test("tool card surfaces error state", async ({ page }) => {
    await bootChatUI(page);
    await queueMock(page, [
      [0, "message_start", { type: "message_start" }],
      [
        50,
        "tool_start",
        {
          type: "tool_start",
          id: "t1",
          name: "bash",
          input: { command: "false" },
        },
      ],
      [
        400,
        "tool_end",
        {
          type: "tool_end",
          id: "t1",
          output: "exit code 1",
          isError: true,
        },
      ],
      [200, "text_delta", { type: "text_delta", delta: "That failed." }],
      [100, "message_end", { type: "message_end" }],
      [50, "done", { type: "done" }],
    ]);
    await sendPrompt(page, "fail please");

    const card = page.getByTestId("tool-card");
    await expect(card).toHaveAttribute("data-tool-status", "error", {
      timeout: 5000,
    });
  });

  test("desktop sidebar reserves flex space and doesn't overlay content", async ({
    page,
  }) => {
    await bootChatUI(page);
    await queueMock(page, [
      [0, "message_start", { type: "message_start" }],
      [
        50,
        "text_delta",
        {
          type: "text_delta",
          delta: "## Files\n\nHere are three entries:\n\n- alpha\n- beta\n",
        },
      ],
      [50, "message_end", { type: "message_end" }],
      [50, "done", { type: "done" }],
    ]);
    await sendPrompt(page, "layout check");
    await expect(page.getByTestId("assistant-text")).toContainText("Files");

    // The assistant heading's left edge must sit strictly to the right of
    // the desktop drawer's right edge. If the drawer overlays content (the
    // MUI docked-drawer footgun where the paper is fixed and the root has
    // no width), the heading's x will be < drawerRight and the first ~30px
    // of every message get clipped by the sidebar.
    const geom = await page.evaluate(() => {
      const drawer = document.querySelector(
        ".MuiDrawer-docked .MuiDrawer-paper",
      ) as HTMLElement | null;
      const h2 = document.querySelector(
        '[data-testid="assistant-text"] h2',
      ) as HTMLElement | null;
      return {
        drawerRight: drawer?.getBoundingClientRect().right ?? -1,
        h2Left: h2?.getBoundingClientRect().left ?? -1,
      };
    });
    expect(geom.h2Left).toBeGreaterThanOrEqual(geom.drawerRight);
  });

  test("full flow: thinking + tool call + markdown answer, one screenshot per stage", async ({
    page,
  }, testInfo) => {
    await bootChatUI(page);
    await queueMock(page, [
      [0, "message_start", { type: "message_start" }],
      [100, "thinking_delta", { type: "thinking_delta", delta: "I should run ls." }],
      [
        400,
        "tool_start",
        {
          type: "tool_start",
          id: "t1",
          name: "bash",
          input: { command: "ls /etc | head -3" },
        },
      ],
      [500, "tool_update", { type: "tool_update", id: "t1", delta: "adjtime\n" }],
      [
        500,
        "tool_end",
        {
          type: "tool_end",
          id: "t1",
          output: "adjtime\naliases\nbash.bashrc\n",
          isError: false,
        },
      ],
      [
        300,
        "text_delta",
        {
          type: "text_delta",
          delta:
            "## Files\n\nHere are three entries under `/etc`:\n\n- adjtime\n- aliases\n- bash.bashrc\n\n```bash\nls /etc | head -3\n```\n",
        },
      ],
      [200, "message_end", { type: "message_end" }],
      [50, "done", { type: "done" }],
    ]);
    await sendPrompt(page, "list /etc please");

    // Stage 1: while streaming — capture reasoning + running tool card.
    await expect(page.getByTestId("tool-card")).toHaveAttribute(
      "data-tool-status",
      "running",
    );
    const stage1 = await page.screenshot({ fullPage: true });
    await testInfo.attach("stage1-streaming.png", {
      body: stage1,
      contentType: "image/png",
    });
    await require("node:fs/promises").writeFile(
      "tests/e2e/screenshots/stage1-streaming.png",
      stage1,
    );

    // Stage 2: final state.
    await expect(page.getByTestId("tool-card")).toHaveAttribute(
      "data-tool-status",
      "done",
      { timeout: 5000 },
    );
    await expect(page.getByTestId("assistant-text")).toContainText("Files");
    await expect(page.getByTestId("streaming-cursor")).toHaveCount(0);
    const stage2 = await page.screenshot({ fullPage: true });
    await testInfo.attach("stage2-final.png", {
      body: stage2,
      contentType: "image/png",
    });
    await require("node:fs/promises").writeFile(
      "tests/e2e/screenshots/stage2-final.png",
      stage2,
    );
  });
});
