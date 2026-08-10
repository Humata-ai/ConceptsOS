import { defineConfig, devices } from "@playwright/test";

const PORT = 3050;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
    },
    {
      // Mobile project for touch-gesture tests (drawer swipe, etc.).
      // Uses Pixel 5 (Chromium + hasTouch) instead of iPhone (WebKit) so we
      // don't need to `sudo playwright install-deps` for libicu/libflite. It
      // still catches the class of bug we care about here: a capture-phase
      // touch handler calling preventDefault() and eating the swipe.
      name: "mobile",
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
