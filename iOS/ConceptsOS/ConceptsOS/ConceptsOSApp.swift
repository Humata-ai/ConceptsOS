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
            ContentView()
                .environmentObject(auth)
                .environmentObject(vmState)
                .environmentObject(tunnel)
                .ignoresSafeArea()
        }
    }
}
