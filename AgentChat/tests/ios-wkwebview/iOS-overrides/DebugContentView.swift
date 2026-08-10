// Debug override for iOS WKWebView e2e reproduction. Copied over
// iOS/ConceptsOS/ConceptsOS/ContentView.swift by verify-fix.sh, then
// restored. Do NOT check this into the ConceptsOS iOS target.
//
// Bypasses auth + VM provisioning + tunnel and drops straight into a
// WKWebView pointed at the AgentChat dev server on the tailnet
// (100.69.188.4:3050 = dans-linux-mini). Explicit `.frame(maxWidth/Height:
// .infinity)` before `.ignoresSafeArea()` mirrors what production
// WebAppView needs so the WKWebView doesn't collapse to zero size in
// SwiftUI's layout.
import SwiftUI

struct ContentView: View {
    @EnvironmentObject var auth: AuthManager
    @EnvironmentObject var vmState: VMStateStore

    var body: some View {
        WebView(url: URL(string: "http://100.69.188.4:3050")!)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .ignoresSafeArea()
    }
}
