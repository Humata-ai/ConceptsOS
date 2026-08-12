import SwiftUI

@main
struct ConceptsOSApp: App {
    @StateObject private var auth = AuthManager()
    @StateObject private var vmState = VMStateStore()
    // App-wide so ContentView, InstallTunnelView, and
    // VPNDisconnectedView all observe the same live tunnel state.
    @StateObject private var tunnel = TunnelManager()

    var body: some Scene {
        WindowGroup {
            rootView
                .environmentObject(auth)
                .environmentObject(vmState)
                .environmentObject(tunnel)
                .ignoresSafeArea()
        }
    }

    /// Debug-only screen jump for iterating on individual onboarding
    /// screens (VPN explainer, etc.) without going through the whole
    /// auth + provisioning flow. Enabled by launch args, e.g.
    ///   xcrun simctl launch booted ai.humata.ConceptsOS -previewScreen vpnExplainer
    @ViewBuilder
    private var rootView: some View {
        #if DEBUG
        if let idx = CommandLine.arguments.firstIndex(of: "-previewScreen"),
           idx + 1 < CommandLine.arguments.count {
            let screen = CommandLine.arguments[idx + 1]
            switch screen {
            case "vpnExplainer":
                VPNExplainerView(onContinue: {})
            case "webApp":
                // Debug: point WKWebView at an arbitrary URL, bypassing
                // the auth+tunnel state machine. Usage:
                //   xcrun simctl launch booted ai.humata.ConceptsOS \
                //     -previewScreen webApp -webAppURL http://100.69.188.4:3000
                let url = (CommandLine.arguments.firstIndex(of: "-webAppURL")
                    .flatMap { i in i + 1 < CommandLine.arguments.count ? CommandLine.arguments[i + 1] : nil })
                    ?? "http://100.69.188.4:3000"
                WebAppView(url: URL(string: url)!)
            default:
                ContentView()
            }
        } else {
            ContentView()
        }
        #else
        ContentView()
        #endif
    }
}
