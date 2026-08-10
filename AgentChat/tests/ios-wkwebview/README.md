# iOS WKWebView regression harness

Playwright + Chromium can't catch iOS-Safari-only bugs, and even the
`appium` skill's mobile-Safari flow doesn't catch bugs that only appear
inside a **WKWebView** (i.e. the ConceptsOS iOS wrapper app). This
directory holds a small harness that drives the *real* production
wrapper on Dan's Mac Mini so those bugs are catchable.

## Class of bug this catches

- Composer / textarea rendered off-screen because `100svh` disagrees
  with the WKWebView's insetted layout viewport (Dan's 2026-08-10 bug).
- Any layout that depends on `env(safe-area-inset-*)` matching the
  actual visible frame.
- WKWebView-only viewport-meta / `visualViewport` quirks.
- JS console errors / unhandled rejections inside the WKWebView (the
  bridge in `verify-fix.sh` streams them to `os_log`).

## What runs where

- **Linux box (this repo):** Next.js dev server on `0.0.0.0:3050`, plus
  this script that SSHes into `mac-mini`.
- **Mac Mini (`mac-mini`, macOS 15.7+, Xcode 26.6):** builds the
  ConceptsOS iOS app for the iPhone 17 Pro Max Simulator, installs it,
  launches it against the dev server on Tailscale, screenshots the
  result, and streams the WKWebView's DOM/layout via a temporary JS
  bridge (`window.webkit.messageHandlers.dbg`) into `os_log`.

## Prereqs

- `mac-mini` reachable over SSH (see the `xcode` skill for its setup).
- Login keychain unlocked on the Mac (`security unlock-keychain`).
- iPhone 17 Pro Max sim booted at UDID
  `657C55A5-D024-4BCD-93A3-4BB4CACFFF8B` (edit `UDID` in the script if
  yours differs — `xcrun simctl list devices available` shows current
  IDs).
- Tailscale up between the Linux box and the Mac Mini. This repo lives
  at `dans-linux-mini` = `100.69.188.4`. If you're running from a
  different host, change `DEV_URL` accordingly and add an ATS exception
  for that IP.
- Next dev server running on the Linux box:

      npm run dev   # binds 0.0.0.0:3050

## Running

    ./tests/ios-wkwebview/verify-fix.sh

Takes ~90s from cold. Produces:

- `/tmp/wk_empty.png` on the Mac — the empty-state screenshot pulled
  back to the Linux box as `test-results/ios-wkwebview/wk_empty.png`.
- `/tmp/dbg.log` on the Mac — os_log stream containing `boot:`,
  `didFinishNavigation`, and 2s-interval `layout:` lines with
  composer position.
- Non-zero exit if the composer's bottom edge is below the visible
  viewport height (i.e. Dan's bug is back).

## How the harness works

1. Copies `iOS-overrides/DebugContentView.swift` over the app's
   `ContentView.swift`, which bypasses auth / VM / tunnel and points
   the wrapper straight at the Linux dev server.
2. Copies `iOS-overrides/WebView.swift` over the app's `WebView.swift`,
   which adds:
   - `isInspectable = true` (iOS 16.4+) — for optional Safari Web
     Inspector attach from the Mac
   - `.systemYellow`/`.systemRed` background — makes WKWebView vs
     SwiftUI-parent boundaries pop in screenshots
   - A `WKUserContentController` `console.log` / `window.onerror` /
     `unhandledrejection` bridge routed to `os_log`, plus a
     `setInterval` layout probe (`body.h`, composer rect)
3. Adds an ATS `NSExceptionDomains` entry for `100.69.188.4` so the
   sim's WKWebView can hit `http://` on the tailnet.
4. `xcodebuild` for the iOS Simulator, `simctl install`, `simctl
   launch`, screenshot at ~10s, `simctl log stream` to capture the
   bridge output.
5. Restores the three iOS files to their pristine state so the working
   copy is clean.

## The bug this harness first caught

Dan sent a screenshot on 2026-08-10 showing the ConceptsOS iOS app
with the composer missing. `verify-fix.sh` reproduces it at commit
`<BEFORE_FIX_SHA>`:

    boot:  innerH=2129 innerW=980   ← default 980 layout viewport
    layout: body.h=860 paper=12,894 416x50
    #                  ^^^^^^^^^^^^^^^^^^^^
    #                  composer at y=894 inside a 860pt body → 34pt off-screen

Fix: set `webView.scrollView.contentInsetAdjustmentBehavior = .never`
in `iOS/ConceptsOS/ConceptsOS/WebView.swift`. After the fix:

    layout: body.h=956 paper=12,894 416x50
    #                  composer at y=894 inside a 956pt body → visible

The reason: SwiftUI already applies `.ignoresSafeArea()` on the
`WebAppView`, so the `WKWebView` frame extends edge-to-edge. Leaving
`contentInsetAdjustmentBehavior` on `.automatic` makes the scroll view
*also* subtract the safe-area top+bottom from the layout viewport,
shrinking it to 860pt — and the app's `height: 100svh` then resolves
to that smaller value while the visible frame is still 956pt.
