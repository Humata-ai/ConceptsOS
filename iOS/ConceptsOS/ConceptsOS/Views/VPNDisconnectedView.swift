// Shown when the VPN profile has been installed (so we've already been
// through the AllowVPN prompt in the past), but the tunnel is not
// currently `.connected` — e.g. the user toggled VPN off in Settings,
// iOS tore down the tunnel to save battery, the profile was deleted,
// or the extension failed to bring it back up on its own.
//
// The webview can't reach the pod without the tunnel (pod is on
// 10.10.0.1:3000, only reachable via wg), so instead of a broken
// WKWebView we render this page. It explains what happened and gives
// the user the two easiest recovery paths iOS actually allows from an
// app:
//
//   1. Reconnect in-app  → NETunnelProviderManager.connection.startVPNTunnel()
//                          Works if the VPN profile is still installed
//                          and enabled. The system doesn't re-prompt.
//   2. Open Settings     → UIApplication.openSettingsURLString.
//                          Sends them to the app's Settings page from
//                          which the system VPN toggle + "Delete VPN"
//                          are one tap away. Apple doesn't allow deep-
//                          linking directly to Settings → VPN from a
//                          third-party app on iOS 16+.
//
// If the profile has been removed entirely (state == .idle) we route
// the user back through InstallTunnelView via a "Reinstall tunnel"
// button, which drops `vmState.tunnelInstalled` so ContentView picks
// up the install flow again.

import SwiftUI
import NetworkExtension

struct VPNDisconnectedView: View {
    @EnvironmentObject var tunnel: TunnelManager
    @EnvironmentObject var vmState: VMStateStore
    @EnvironmentObject var auth: AuthManager

    @State private var reconnecting = false
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
                    // Profile is gone — re-run install flow.
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
                        Task { await reconnect() }
                    } label: {
                        HStack {
                            if reconnecting {
                                ProgressView()
                                    .progressViewStyle(.circular)
                                    .tint(.white)
                            }
                            Text(reconnecting ? "Connecting…" : "Reconnect")
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(reconnecting || tunnel.state == .connecting)
                    .accessibilityIdentifier("vpnReconnectButton")
                }

                Button {
                    openAppSettings()
                } label: {
                    Text("Open Settings")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("vpnOpenSettingsButton")
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
        // Keep our view of the world fresh — if the user flips the
        // system VPN toggle back on outside the app, ContentView will
        // observe .connected and swap to WebAppView on its own.
        .task { await tunnel.refresh() }
    }

    // MARK: - Copy

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
            return "Can’t reach your ConceptsOS computer"
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
            return "iOS reported: \(msg)\n\nTry Reconnect, or open Settings to check whether VPN is enabled."
        default:
            return "Your ConceptsOS-VM lives behind a private WireGuard VPN, and iOS reports that VPN isn’t currently connected. Tap Reconnect to bring it back up."
        }
    }

    // MARK: - Actions

    private func reconnect() async {
        localError = nil
        reconnecting = true
        defer { reconnecting = false }

        // If iOS quietly disabled or lost track of the profile, refresh
        // first so we have a live NETunnelProviderManager to poke.
        await tunnel.refresh()

        // If the profile got removed (state went to .idle) we can't
        // startVPNTunnel — kick the user back to the install flow.
        if tunnel.state == .idle {
            vmState.tunnelInstalled = false
            vmState.persist()
            return
        }

        do {
            try tunnel.connect()
        } catch {
            localError = error.localizedDescription
        }
    }

    private func openAppSettings() {
        // Best we can do from a third-party iOS app — Apple removed
        // deep-linking to Settings → General → VPN sub-pages.
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
