// Shown when the VPN profile has been installed (so we've already been
// through the AllowVPN prompt in the past), but the tunnel is not
// currently `.connected` — e.g. iOS tore the tunnel down, the profile
// was disabled, or the extension is racing to come back up.
//
// The webview can't reach the pod without the tunnel (pod is on
// 10.10.0.1:3000, only reachable via wg), so instead of a broken
// WKWebView we render this page.
//
// Recovery behavior:
//   * On appear we `refresh()` state from system prefs, mark our
//     profile as the *selected* VPN configuration (isEnabled=true),
//     and fire `startVPNTunnel()`. In practice this is enough — iOS
//     brings the tunnel back up in a second or two.
//   * `NEVPNStatusDidChange` is observed by TunnelManager. The moment
//     the tunnel is `.connected` (whether we reconnected it, or the
//     user flipped the system VPN toggle from Settings) ContentView
//     swaps this view out for WebAppView automatically. So there's no
//     manual "Reconnect" button — it happens live.
//   * "Open VPN Settings" tries the `App-Prefs:root=General&path=VPN`
//     deep link (works on most iOS versions) and falls back to the
//     app's own Settings page (`UIApplication.openSettingsURLString`)
//     if iOS refuses the private URL.
//   * If the profile has been removed entirely (state == .idle) we
//     drop `tunnelInstalled=false` so ContentView routes back to
//     InstallTunnelView.

import SwiftUI
import NetworkExtension

struct VPNDisconnectedView: View {
    @EnvironmentObject var tunnel: TunnelManager
    @EnvironmentObject var vmState: VMStateStore
    @EnvironmentObject var auth: AuthManager

    @State private var localError: String?

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            Image(systemName: iconName)
                .font(.system(size: 56, weight: .regular))
                .foregroundStyle(iconColor)
                .padding(.bottom, 20)
                .accessibilityIdentifier("vpnStatusIcon")

            Text(headline)
                .font(.title2.weight(.semibold))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .accessibilityIdentifier("vpnDisconnectedHeadline")

            Text(subhead)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.top, 12)
                .accessibilityIdentifier("vpnDisconnectedSubhead")

            if isReconnecting {
                ProgressView()
                    .padding(.top, 20)
                    .accessibilityIdentifier("vpnReconnectingSpinner")
            }

            if let localError {
                Text(localError)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                    .padding(.top, 16)
                    .accessibilityIdentifier("vpnDisconnectedError")
            }

            Spacer()

            VStack(spacing: 12) {
                if tunnel.state == .idle {
                    // Profile was removed — send them back through the
                    // install flow.
                    Button {
                        vmState.tunnelInstalled = false
                        vmState.persist()
                    } label: {
                        Text("Reinstall VPN")
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 6)
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("vpnReinstallButton")
                } else {
                    Button {
                        openVPNSettings()
                    } label: {
                        Text("Open VPN Settings")
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 6)
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("vpnOpenSettingsButton")
                }
            }
            .padding(.horizontal, 32)

            Button(role: .destructive) {
                Task {
                    await tunnel.uninstall()
                    auth.signOut()
                }
            } label: {
                Text("Sign out").font(.footnote)
            }
            .padding(.top, 20)
            .padding(.bottom, 32)
            .accessibilityIdentifier("vpnSignOutButton")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
        .accessibilityIdentifier("vpnDisconnectedView")
        .task { await autoReconnect() }
    }

    // MARK: - Derived state

    private var isReconnecting: Bool {
        switch tunnel.state {
        case .connecting, .disconnecting: return true
        default: return false
        }
    }

    private var iconName: String {
        switch tunnel.state {
        case .connecting, .disconnecting: return "arrow.triangle.2.circlepath"
        case .idle:                        return "lock.slash"
        case .failed:                      return "exclamationmark.triangle.fill"
        default:                           return "wifi.exclamationmark"
        }
    }

    private var iconColor: Color {
        switch tunnel.state {
        case .failed: return .red
        case .connecting, .disconnecting: return .accentColor
        default: return .orange
        }
    }

    private var headline: String {
        switch tunnel.state {
        case .idle:
            return "VPN profile removed"
        case .connecting:
            return "Reconnecting to your VM…"
        case .disconnecting:
            return "Disconnecting…"
        case .failed:
            return "VPN connection failed"
        default:
            return "Reconnecting to your ConceptsOS computer…"
        }
    }

    private var subhead: String {
        switch tunnel.state {
        case .idle:
            return "The ConceptsOS VPN profile is no longer installed on this device. Reinstall it to reconnect to your personal computer."
        case .connecting:
            return "Bringing the WireGuard tunnel back up. This usually takes a few seconds."
        case .disconnecting:
            return "One moment…"
        case .failed(let msg):
            return "iOS reported: \(msg)\n\nTap Open VPN Settings and make sure the ConceptsOS VPN is selected and switched on."
        default:
            return "Your ConceptsOS-VM lives behind a private WireGuard VPN. We’re trying to bring it back up automatically — if this takes more than a few seconds, open VPN Settings and flip ConceptsOS back on."
        }
    }

    // MARK: - Actions

    /// Called on appear. Refreshes tunnel state, makes our profile the
    /// selected VPN configuration in system prefs, and asks iOS to
    /// bring the tunnel up. The NEVPNStatusDidChange observer inside
    /// TunnelManager will flip `state` to `.connected` the instant it
    /// comes online, at which point ContentView routes back to
    /// WebAppView — no user tap required.
    private func autoReconnect() async {
        localError = nil
        await tunnel.refresh()

        if tunnel.state == .idle {
            // Profile got fully removed — bail to the install flow.
            vmState.tunnelInstalled = false
            vmState.persist()
            return
        }

        do {
            try await tunnel.ensureSelected()
            try tunnel.connect()
        } catch {
            localError = error.localizedDescription
        }
    }

    /// Try to deep-link to Settings → General → VPN so the ConceptsOS
    /// VPN row is one tap away. `App-Prefs:` is an undocumented but
    /// widely-used private URL scheme; if iOS refuses (or on a future
    /// version that locks it down), fall back to our app's own
    /// Settings page, from which the "VPN" row is reachable via the
    /// Settings back-button.
    private func openVPNSettings() {
        let deepLinks = [
            "App-Prefs:root=General&path=VPN",
            "App-Prefs:root=VPN",
            "prefs:root=General&path=VPN",
        ]
        for s in deepLinks {
            if let url = URL(string: s), UIApplication.shared.canOpenURL(url) {
                UIApplication.shared.open(url)
                return
            }
        }
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }
}

#Preview {
    VPNDisconnectedView()
        .environmentObject(TunnelManager())
        .environmentObject(VMStateStore())
        .environmentObject(AuthManager())
}
