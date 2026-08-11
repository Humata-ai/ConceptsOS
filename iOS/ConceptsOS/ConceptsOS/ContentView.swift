// Top-level state machine for the app.
//
//   signed out                    → WelcomeView
//   signed in, no VM ready        → ProvisioningView  (polls /api/vm)
//   VM ready, tunnel not connected → InstallTunnelView (auto-installs +
//                                                       connects the
//                                                       bundled WG
//                                                       extension)
//   fully set up                   → WebAppView        (WKWebView on
//                                                       10.10.0.1:3000)

import SwiftUI

struct ContentView: View {
    @EnvironmentObject var auth: AuthManager
    @EnvironmentObject var vmState: VMStateStore

    var body: some View {
        Group {
            if auth.session == nil {
                WelcomeView()
            } else if !isVMReady {
                ProvisioningView()
            } else if !vmState.tunnelInstalled {
                InstallTunnelView()
            } else {
                WebAppView(url: URL(string: vmState.appURL ?? AppConfig.podURL)!)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: auth.session)
        .animation(.easeInOut(duration: 0.2), value: vmState.tunnelInstalled)
    }

    private var isVMReady: Bool {
        vmState.appURL != nil && vmState.wg != nil
    }
}

#Preview {
    ContentView()
        .environmentObject(AuthManager())
        .environmentObject(VMStateStore())
}
