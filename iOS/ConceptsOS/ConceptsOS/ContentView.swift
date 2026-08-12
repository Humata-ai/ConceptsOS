// Top-level state machine for the app.
//
//   signed out                                      → WelcomeView
//   signed in, no VM ready                          → ProvisioningView  (polls /api/vm)
//   VM ready, tunnel not installed                  → InstallTunnelView (auto-installs +
//                                                                       connects the bundled
//                                                                       WG extension)
//   tunnel installed but currently disconnected     → VPNDisconnectedView
//   tunnel installed AND connected                  → WebAppView        (WKWebView on
//                                                                        10.10.0.1:3000)
//
// Note: `vmState.tunnelInstalled` only tracks whether we've ever
// completed the install-and-first-connect flow. The *live* connection
// state comes from the shared `TunnelManager` (`tunnel.state`). If iOS
// tears the tunnel down (user toggled VPN off, battery, profile
// deleted, etc.) we swap to VPNDisconnectedView instead of rendering
// a WKWebView that can't reach 10.10.0.1.

import SwiftUI

struct ContentView: View {
    @EnvironmentObject var auth: AuthManager
    @EnvironmentObject var vmState: VMStateStore
    @EnvironmentObject var tunnel: TunnelManager

    // Whether the user has seen and dismissed the one-time VPN
    // explainer screen that primes them for the iOS "Allow VPN
    // Configuration" system prompt. We persist this so a failed
    // tunnel install → retry doesn't loop back through the explainer.
    @AppStorage("vpnExplainerAcknowledged") private var vpnExplainerAcknowledged: Bool = false

    var body: some View {
        Group {
            if auth.session == nil {
                WelcomeView()
            } else if !isVMReady {
                ProvisioningView()
            } else if !vmState.tunnelInstalled && !vpnExplainerAcknowledged {
                VPNExplainerView(onContinue: { vpnExplainerAcknowledged = true })
            } else if !vmState.tunnelInstalled {
                InstallTunnelView()
            } else if isTunnelLive {
                WebAppView(url: URL(string: vmState.appURL ?? AppConfig.podURL)!)
            } else {
                VPNDisconnectedView()
            }
        }
        .animation(.easeInOut(duration: 0.2), value: auth.session)
        .animation(.easeInOut(duration: 0.2), value: vmState.tunnelInstalled)
        .animation(.easeInOut(duration: 0.2), value: vpnExplainerAcknowledged)
        .animation(.easeInOut(duration: 0.2), value: isTunnelLive)
        // Keep tunnel state fresh whenever the app comes back to the
        // foreground — the user may have toggled VPN in Settings while
        // we were backgrounded.
        .task {
            await tunnel.refresh()
            await assertOurPubkey()
        }
    }

    /// Re-POST /api/signup with THIS device's WireGuard pubkey.
    ///
    /// V1 multi-device is "last-device-wins": the server stores one WG
    /// pubkey per user, and whichever device most recently called
    /// /api/signup owns the peer slot on the gateway. Without this call
    /// on every launch, a second device (Dan's iPad after his iPhone)
    /// would:
    ///
    ///   - go through ProvisioningView once, POST its own pubkey, but
    ///     get device-1's cached config back (pre-fix bug), OR
    ///   - after the server-side pubkey-rotation fix lands, still be
    ///     stuck on a stale VMStateStore that skips ProvisioningView
    ///     on every subsequent launch → the iPad never re-asserts and
    ///     stays black-screened whenever the phone was opened last.
    ///
    /// Idempotent — no-op on the server when the pubkey already matches.
    private func assertOurPubkey() async {
        guard let jwt = auth.session?.access_token else { return }
        let keys = WireGuardKeyStore.loadOrCreate()
        do {
            _ = try await ConceptsAPI().signup(jwt: jwt, wgPubkey: keys.publicKeyBase64)
        } catch {
            // Non-fatal: if the network is down or the API is unreachable
            // we'll just try again next launch. The user's stale tunnel
            // will look broken until then, but sign-out/sign-in is a
            // recoverable fallback.
            print("[ContentView] assertOurPubkey failed: \(error.localizedDescription)")
        }
    }

    private var isVMReady: Bool {
        vmState.appURL != nil && vmState.wg != nil
    }

    /// True iff the WireGuard tunnel is currently up (or racing up).
    /// We treat `.connecting` as "live" so we don't flash the
    /// disconnected page every time iOS reasserts the tunnel.
    private var isTunnelLive: Bool {
        switch tunnel.state {
        case .connected, .connecting: return true
        default: return false
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(AuthManager())
        .environmentObject(VMStateStore())
        .environmentObject(TunnelManager())
}
