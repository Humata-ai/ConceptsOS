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
