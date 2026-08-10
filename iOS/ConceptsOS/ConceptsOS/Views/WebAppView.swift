// Once the tunnel is up, the app is just a WKWebView pointed at the
// user's pod on the tunnel IP.

import SwiftUI

struct WebAppView: View {
    let url: URL

    var body: some View {
        WebView(url: url)
            .ignoresSafeArea()
    }
}
