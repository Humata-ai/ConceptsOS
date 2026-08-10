import SwiftUI
import WebKit

struct WebView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.bounces = true
        // We already ignore safe area at the SwiftUI level (see
        // WebAppView + ConceptsOSApp), which extends the WKWebView
        // frame edge-to-edge. WKWebView's default
        // `contentInsetAdjustmentBehavior = .automatic` then ALSO
        // insets the layout viewport by the safe-area top+bottom,
        // which shrinks the CSS viewport to ~860pt on iPhone Pro
        // Max even though the frame is 956pt. That mismatch makes
        // `height: 100svh` resolve to less than the visible area
        // and pushes the chat composer 34pt below the bottom of the
        // screen (Dan's 2026-08-10 bug report). Disable the auto
        // inset so the CSS viewport matches the visible frame; the
        // web app itself handles safe-area via `env(safe-area-inset-*)`.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        if webView.url != url {
            // Force a network fetch on every app launch. iOS WKWebView
            // will otherwise happily serve stale HTML from disk cache
            // (and even the back/forward cache) despite the server's
            // `Cache-Control: no-store`, which meant Dan's 2026-08-10
            // safe-area fix (viewport-fit=cover, commit 1242ea0) kept
            // rendering the pre-fix layout on his phone even after we
            // rolled his ConceptsOS-VM pod to the fixed image. The
            // wrapper is a thin shell around a remote URL, so there's
            // no benefit to caching the shell HTML.
            var req = URLRequest(url: url)
            req.cachePolicy = .reloadIgnoringLocalCacheData
            webView.load(req)
        }
    }
}
