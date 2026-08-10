import { test, expect, Page } from "@playwright/test";

/**
 * E2E: swipe from the left edge should open the mobile sidebar drawer.
 *
 * Motivation: `usePreventScroll` installs a capture-phase `touchmove` listener
 * with `passive: false` that calls `preventDefault()` on the document. If it
 * ever prevents the default on the very first touchmove of a horizontal
 * gesture, MUI's SwipeableDrawer (which bails on `event.defaultPrevented`)
 * never picks up the edge-swipe and the drawer stays shut.
 *
 * NOTE: This runs in Chromium (via the "mobile"/Pixel 5 project). Chromium
 * emulation is *not* a perfect iOS Safari clone \u2014 for the true iOS
 * reproduction we'd need the `appium` skill against a real iOS simulator.
 * But Chromium is enough to catch the class of bug where a document-level
 * touch handler eats the swipe entirely.
 *
 * Strategy:
 *   1. Open the drawer via the hamburger (control path).
 *   2. Swipe right\u2192left across the open drawer to close it.
 *      \u2192 If the close swipe fails, our `swipe()` helper itself is broken.
 *   3. Swipe left\u2192right from the edge to open it.
 *      \u2192 This is the assertion that actually catches the reported bug.
 */

async function swipe(
  page: Page,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  steps = 24,
  stepDelayMs = 12,
) {
  await page.evaluate(
    async ({ fromX, fromY, toX, toY, steps, stepDelayMs }) => {
      const startTarget = document.elementFromPoint(fromX, fromY) ?? document.body;
      const mk = (x: number, y: number, target: Element) =>
        new Touch({
          identifier: 1,
          target,
          clientX: x,
          clientY: y,
          pageX: x,
          pageY: y,
          screenX: x,
          screenY: y,
          radiusX: 10,
          radiusY: 10,
          rotationAngle: 0,
          force: 1,
        });

      const fire = (type: string, x: number, y: number) => {
        // Touches always carry the *original* target for the gesture, matching
        // real browser semantics. Dispatch on that target so capture-phase
        // listeners on document still fire.
        const touch = mk(x, y, startTarget);
        const ev = new TouchEvent(type, {
          cancelable: true,
          bubbles: true,
          composed: true,
          touches: type === "touchend" ? [] : [touch],
          targetTouches: type === "touchend" ? [] : [touch],
          changedTouches: [touch],
        });
        startTarget.dispatchEvent(ev);
      };

      fire("touchstart", fromX, fromY);
      await new Promise((r) => setTimeout(r, stepDelayMs));

      for (let i = 1; i <= steps; i++) {
        const x = fromX + ((toX - fromX) * i) / steps;
        const y = fromY + ((toY - fromY) * i) / steps;
        fire("touchmove", x, y);
        await new Promise((r) => setTimeout(r, stepDelayMs));
      }

      fire("touchend", toX, toY);
    },
    { fromX, fromY, toX, toY, steps, stepDelayMs },
  );
}

// Returns true if a mobile drawer paper is currently on-screen (left edge >= 0
// and it extends meaningfully into the viewport). We rely on bounding rects
// rather than CSS visibility because SwipeableDrawer animates transform.
async function drawerIsOpen(page: Page) {
  return await page.evaluate(() => {
    const papers = document.querySelectorAll(".MuiDrawer-paper");
    return Array.from(papers).some((p) => {
      const r = (p as HTMLElement).getBoundingClientRect();
      // On mobile there is no permanent drawer, so any paper that's mostly
      // inside the viewport implies the swipeable drawer is open.
      return r.left >= -1 && r.right > 100 && r.width > 100;
    });
  });
}

// Force an iPhone user-agent so the app's `iOS` module-level flag becomes
// true (which flips `disableDiscovery` on the SwipeableDrawer, matching
// production behavior on real devices). Without this, Chromium Pixel 5
// runs the non-iOS branch and doesn't exercise the code path Dan hit.
test.use({
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});

test.describe("mobile drawer swipe", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "mobile project only");
  });

  // Waits until MUI's SwipeArea is the topmost hit-test target at the given
  // left-edge point. After closing the drawer, the modal backdrop can linger
  // for a few frames while its fade-out transition runs, and while it's on
  // top of the SwipeArea, MUI's SwipeableDrawer will refuse to open again
  // (its handleBodyTouchStart bails when target !== swipeAreaRef).
  async function waitForSwipeAreaHittable(page: Page, y: number) {
    await expect
      .poll(
        () =>
          page.evaluate(
            (yy) =>
              document.elementFromPoint(4, yy)?.classList.contains(
                "PrivateSwipeArea-root",
              ) ?? false,
            y,
          ),
        { timeout: 3000, message: "SwipeArea never became hit-testable at the edge" },
      )
      .toBe(true);
  }

  test("edge-swipe from a fresh page opens the drawer", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/new chat|ask anything/i).first()).toBeVisible();

    const vp = page.viewportSize()!;
    await waitForSwipeAreaHittable(page, vp.height / 2);

    await swipe(page, 4, vp.height / 2, vp.width * 0.7, vp.height / 2);
    await expect
      .poll(() => drawerIsOpen(page), {
        timeout: 4000,
        message:
          "edge-swipe did not open the drawer on a fresh page \u2014 a document-level " +
          "touch handler is likely calling preventDefault() before MUI SwipeableDrawer sees it",
      })
      .toBe(true);
  });

  test("swipe from mid-screen (not edge) also opens the drawer", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/new chat|ask anything/i).first()).toBeVisible();

    const vp = page.viewportSize()!;
    // Start well past the 32px SwipeArea — this must be handled by our
    // custom useGlobalSwipeToOpen hook, not MUI's edge detection.
    await swipe(page, vp.width * 0.5, vp.height / 2, vp.width * 0.5 + 120, vp.height / 2);
    await expect
      .poll(() => drawerIsOpen(page), {
        timeout: 4000,
        message: "mid-screen horizontal swipe did not open the drawer",
      })
      .toBe(true);
  });

  test("swipe from the far right also opens the drawer", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/new chat|ask anything/i).first()).toBeVisible();

    const vp = page.viewportSize()!;
    // From near the right edge, swipe left-to-right by ~100px (as far as we
    // can before running off-screen). This is the Perplexity behavior Dan
    // called out explicitly.
    const fromX = vp.width - 40;
    await swipe(page, fromX, vp.height / 2, fromX - 100, vp.height / 2, 24, 10);
    // Wait a beat, then assert the drawer did NOT open (right-to-left swipe
    // should never open a left-anchored drawer).
    await page.waitForTimeout(500);
    expect(await drawerIsOpen(page)).toBe(false);

    // Now the actual test: swipe rightward from near the right side.
    await swipe(page, vp.width * 0.7, vp.height / 2, vp.width * 0.7 + 120, vp.height / 2);
    await expect
      .poll(() => drawerIsOpen(page), { timeout: 4000 })
      .toBe(true);
  });

  test("vertical scroll does not open the drawer", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/new chat|ask anything/i).first()).toBeVisible();

    const vp = page.viewportSize()!;
    // Straight-down swipe should scroll, not open the drawer.
    await swipe(page, vp.width / 2, 100, vp.width / 2, 400);
    await page.waitForTimeout(500);
    expect(await drawerIsOpen(page)).toBe(false);
  });

  test("swipe closes an open drawer, then swipe opens it again", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/new chat|ask anything/i).first()).toBeVisible();

    // --- 1. Open via the hamburger (control path). The invisible SwipeArea
    // overlay intercepts real pointer/tap events, so click the underlying
    // button directly via its `click()` method to bypass hit-testing. ---
    await page.locator("header button").first().evaluate((el) => (el as HTMLElement).click());
    await expect.poll(() => drawerIsOpen(page), { timeout: 3000 }).toBe(true);

    // --- 2. Swipe right \u2192 left across the drawer to close it. This is our
    // self-check on the swipe() helper: if this fails, the "open" assertion
    // below is meaningless. ---
    const vp = page.viewportSize()!;
    await swipe(page, vp.width * 0.6, vp.height / 2, 4, vp.height / 2);
    await expect
      .poll(() => drawerIsOpen(page), {
        timeout: 3000,
        message: "swipe helper failed to close an open drawer \u2014 helper is broken",
      })
      .toBe(false);

    // --- 3. The real test: swipe from the left edge to re-open. First wait
    // for the modal backdrop to fade out so the SwipeArea is the topmost
    // hit target again — otherwise MUI's touchstart handler bails out.
    await waitForSwipeAreaHittable(page, vp.height / 2);
    await swipe(page, 4, vp.height / 2, vp.width * 0.7, vp.height / 2);
    await expect
      .poll(() => drawerIsOpen(page), {
        timeout: 4000,
        message:
          "edge-swipe did not open the drawer \u2014 a document-level touch handler " +
          "is likely calling preventDefault() before MUI SwipeableDrawer sees it",
      })
      .toBe(true);

    await expect(page.getByRole("button", { name: /new chat/i }).first()).toBeVisible();
  });
});
