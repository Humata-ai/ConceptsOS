// Debug override for iOS WKWebView e2e reproduction. Copied over
// iOS/ConceptsOS/ConceptsOS/WebView.swift by verify-fix.sh, then
// restored. Do NOT check this into the ConceptsOS iOS target.
//
// Differences from production WebView.swift:
//   1. WKUserScript that pipes console.{log,warn,error,info},
//      window.onerror, unhandledrejection, and a 2s layout probe
//      through window.webkit.messageHandlers.dbg into os_log
//      (subsystem = "ai.humata.ConceptsOS", category = "WKWebView").
//   2. `isInspectable = true` on iOS 16.4+ so Safari Web Inspector /
//      Appium remote-debugging can attach if you want richer DOM
//      access than the setInterval probe gives you.
//   3. `.systemYellow` / `.systemRed` backgrounds on the WKWebView so
//      SwiftUI-parent vs web-content boundaries are visible in
//      screenshots — makes it obvious when the composer is rendered
//      outside the CSS viewport.
//
// Production still gets `contentInsetAdjustmentBehavior = .never`
// because that's the actual bug fix; the debug harness ships the
// same setting so the harness matches production.
import SwiftUI
import WebKit
import os

private let webLog = Logger(subsystem: "ai.humata.ConceptsOS", category: "WKWebView")

final class DebugBridge: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    func userContentController(_ ucc: WKUserContentController, didReceive msg: WKScriptMessage) {
        guard let body = msg.body as? [String: Any] else { return }
        let kind = body["kind"] as? String ?? "?"
        let text = body["text"] as? String ?? ""
        webLog.log("\(kind, privacy: .public): \(text, privacy: .public)")
    }
    func webView(_ w: WKWebView, didFinish nav: WKNavigation!) {
        webLog.log("didFinishNavigation url=\(String(describing: w.url), privacy: .public)")
    }
    func webView(_ w: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError err: Error) {
        webLog.log("didFailProvisionalNavigation error=\(err.localizedDescription, privacy: .public)")
    }
    func webView(_ w: WKWebView, didFail nav: WKNavigation!, withError err: Error) {
        webLog.log("didFail error=\(err.localizedDescription, privacy: .public)")
    }
}

struct WebView: UIViewRepresentable {
    let url: URL

    final class Coordinator {
        let bridge = DebugBridge()
    }
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()

        let ucc = WKUserContentController()
        ucc.add(context.coordinator.bridge, name: "dbg")
        let hookJS = """
        (function () {
          function post(kind, args) {
            try {
              var parts = Array.prototype.map.call(args, function (a) {
                if (a && a.stack) return a.stack;
                try { return typeof a === 'string' ? a : JSON.stringify(a); } catch (e) { return String(a); }
              });
              window.webkit.messageHandlers.dbg.postMessage({ kind: kind, text: parts.join(' ') });
            } catch (e) {}
          }
          ['log','warn','error','info'].forEach(function (m) {
            var orig = console[m];
            console[m] = function () { post('console.' + m, arguments); if (orig) orig.apply(console, arguments); };
          });
          window.addEventListener('error', function (e) {
            post('window.error', [e.message + ' @ ' + (e.filename||'') + ':' + (e.lineno||0)]);
          });
          window.addEventListener('unhandledrejection', function (e) {
            post('unhandledrejection', [String(e.reason && (e.reason.stack || e.reason.message || e.reason))]);
          });
          post('boot', ['ua=' + navigator.userAgent + ' innerH=' + innerHeight + ' innerW=' + innerWidth + ' vv=' + (visualViewport && visualViewport.height)]);
          setInterval(function () {
            try {
              var ta = document.querySelector('textarea');
              var paper = ta && ta.closest('.MuiPaper-root');
              var r = paper && paper.getBoundingClientRect();
              var appBar = document.querySelector('header.MuiAppBar-root');
              var ar = appBar && appBar.getBoundingClientRect();
              var abcs = appBar && getComputedStyle(appBar);
              // Probe env(safe-area-inset-top) directly.
              var probe = document.createElement('div');
              probe.style.cssText = 'position:fixed;top:0;left:0;padding-top:env(safe-area-inset-top);visibility:hidden;pointer-events:none;';
              document.body.appendChild(probe);
              var saTop = getComputedStyle(probe).paddingTop;
              probe.remove();
              post('layout', [
                'body.children=' + (document.body ? document.body.children.length : -1),
                'html.h=' + document.documentElement.getBoundingClientRect().height,
                'body.h=' + (document.body ? document.body.getBoundingClientRect().height : -1),
                'ta=' + !!ta,
                'paper=' + (paper ? (Math.round(r.x)+','+Math.round(r.y)+' '+Math.round(r.width)+'x'+Math.round(r.height)) : 'null'),
                'appbar=' + (appBar ? (Math.round(ar.x)+','+Math.round(ar.y)+' '+Math.round(ar.width)+'x'+Math.round(ar.height)) : 'null'),
                'appbar.pt=' + (abcs ? abcs.paddingTop : 'null'),
                'safeArea.top=' + saTop
              ]);
            } catch (e) { post('layout.err', [String(e)]); }
          }, 2000);
        })();
        """
        ucc.addUserScript(WKUserScript(source: hookJS, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        config.userContentController = ucc

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator.bridge
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.bounces = true
        // MUST match production. This is the actual bug fix — see
        // tests/ios-wkwebview/README.md.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        webView.underPageBackgroundColor = .systemRed
        webView.backgroundColor = .systemYellow
        webView.isOpaque = false
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        if webView.url != url {
            webView.load(URLRequest(url: url))
        }
    }
}
