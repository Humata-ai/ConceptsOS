// Replaces the old SetupTunnelView + external WireGuard-app dance with
// a fully in-app flow. On appear we:
//
//   1. Ask iOS to save our VPN profile into system preferences. This
//      triggers the one-time "AllowVPN Configuration" permission
//      alert (the second-most iconic iOS system prompt after
//      notifications). Appium/XCUITest can dismiss this with the
//      standard system-alert tapping API.
//   2. `startVPNTunnel()`. iOS spawns our packet-tunnel extension
//      (ai.humata.ConceptsOS.WGTunnel), which uses WireGuardKit under
//      the hood.
//   3. Wait for status == .connected, then flip vmState.tunnelInstalled
//      = true so ContentView routes to WebAppView.
//
// If saving fails (e.g. user denied the permission) we show the error
// and a Retry button.

import SwiftUI

struct InstallTunnelView: View {
    @EnvironmentObject var vmState: VMStateStore
    @EnvironmentObject var auth: AuthManager
    @EnvironmentObject var tunnel: TunnelManager

    @State private var errorMessage: String?
    @State private var didKickOff = false

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            ProgressView()
                .scaleEffect(1.5)
            Text(headline)
                .font(.title3.weight(.semibold))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
            Text(subhead)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            if let errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
                    .accessibilityIdentifier("tunnelErrorMessage")
                Button("Try again") { Task { await install() } }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("tunnelRetryButton")
            }
            Spacer()

            Button(role: .destructive) {
                Task {
                    await tunnel.uninstall()
                    auth.signOut()
                }
            } label: {
                Text("Cancel & sign out").font(.footnote)
            }
            .padding(.bottom, 24)
        }
        .task { await install() }
        .onChange(of: tunnel.state) { newState in
            if case .connected = newState {
                vmState.tunnelInstalled = true
                vmState.persist()
            }
            if case .failed(let msg) = newState {
                errorMessage = msg
            }
        }
        .accessibilityIdentifier("installTunnelView")
    }

    // MARK: - Copy

    private var headline: String {
        switch tunnel.state {
        case .idle, .installing:                    return "Setting up your private tunnel…"
        case .installed, .connecting:               return "Connecting to your ConceptsOS-VM…"
        case .connected:                            return "Connected!"
        case .disconnecting:                        return "Disconnecting…"
        case .failed:                               return "Couldn’t start the tunnel."
        }
    }

    private var subhead: String {
        switch tunnel.state {
        case .idle, .installing:
            return "When iOS asks, tap Allow. This is the private WireGuard connection to your personal computer — nothing leaves the tunnel."
        case .installed, .connecting:
            return "Bringing your VM online."
        case .connected:
            return "One moment…"
        case .disconnecting:
            return ""
        case .failed:
            return "You can retry, or sign out and back in."
        }
    }

    // MARK: - Flow

    private func install() async {
        errorMessage = nil
        guard let wg = vmState.wg,
              let priv = WireGuardKeyStore.loadPrivateKeyBase64()
        else {
            errorMessage = "Missing WireGuard config; try signing out and back in."
            return
        }

        let cfg = TunnelManager.buildWgQuickConfig(from: wg, privateKeyBase64: priv)

        await tunnel.refresh()
        do {
            try await tunnel.install(wgQuickConfig: cfg, serverAddress: wg.endpoint)
            try tunnel.connect()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
