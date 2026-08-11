// TunnelManager owns the app-side lifecycle of the built-in WireGuard
// tunnel exposed through the ConceptsOSWGTunnel packet-tunnel extension.
//
// Flow:
//   1. `install(config:)` — build a wg-quick style config string from
//      the server-provided `WGConfig` + the device's local private key
//      and store it into a fresh (or existing) `NETunnelProviderManager`.
//      This is what triggers iOS's one-time "AllowVPN Configuration"
//      permission prompt. That prompt is exactly what the user sees
//      instead of having to install the standalone WireGuard app and
//      import a config by QR.
//   2. `connect()` — kick off `startVPNTunnel()`. Publishes `status`
//      updates via KVO so the SwiftUI view can show "Connecting…" →
//      "Connected".
//   3. `disconnect()` — for signout / debugging.
//
// The extension bundle id is derived by appending `.WGTunnel` to the
// app's bundle id. See AppConfig / ConceptsOSApp for that convention.

import Foundation
import NetworkExtension
import Combine

@MainActor
final class TunnelManager: ObservableObject {
    enum State: Equatable {
        case idle              // no VPN profile installed yet
        case installing        // saving profile / awaiting user's "Allow" tap
        case installed         // profile exists but not connected
        case connecting
        case connected
        case disconnecting
        case failed(String)
    }

    @Published private(set) var state: State = .idle
    @Published private(set) var lastError: String?

    /// Reverse-DNS extension bundle id. Must match the extension target
    /// in the Xcode project + its Info.plist NSExtensionPointIdentifier.
    static let tunnelBundleId = "ai.humata.ConceptsOS.WGTunnel"

    private var manager: NETunnelProviderManager?
    private var statusObserver: NSObjectProtocol?

    init() {
        Task { await refresh() }
    }

    deinit {
        if let obs = statusObserver {
            NotificationCenter.default.removeObserver(obs)
        }
    }

    // MARK: - Public API

    /// Load whatever is already saved in system VPN preferences. If we
    /// find our managed profile, remember it and reflect its current
    /// connection status; otherwise stay `.idle`.
    func refresh() async {
        do {
            let managers = try await NETunnelProviderManager.loadAllFromPreferences()
            if let ours = managers.first(where: {
                ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == Self.tunnelBundleId
            }) {
                self.manager = ours
                observeStatus(on: ours.connection)
                self.state = Self.mapState(ours.connection.status, installed: true)
            } else {
                self.state = .idle
            }
        } catch {
            self.state = .failed("load preferences: \(error.localizedDescription)")
        }
    }

    /// Save (or update) the VPN profile with the given WireGuard config
    /// text. First save shows the iOS permission alert.
    func install(wgQuickConfig: String, serverAddress: String) async throws {
        state = .installing

        let manager = self.manager ?? NETunnelProviderManager()

        let proto = NETunnelProviderProtocol()
        proto.providerBundleIdentifier = Self.tunnelBundleId
        proto.serverAddress = serverAddress
        proto.providerConfiguration = ["wgQuickConfig": wgQuickConfig]
        // Route everything the profile says to route through the tunnel.
        proto.disconnectOnSleep = false

        manager.protocolConfiguration = proto
        manager.localizedDescription = "ConceptsOS"
        manager.isEnabled = true

        // Two saves are recommended by Apple: the first can silently
        // create the config but not persist properly if the load isn't
        // reloaded from disk. We follow the WireGuardApp reference
        // pattern: save → load → save if needed.
        try await manager.saveToPreferences()
        try await manager.loadFromPreferences()

        self.manager = manager
        observeStatus(on: manager.connection)
        state = .installed
    }

    /// Start the tunnel. Must be called after `install`.
    func connect() throws {
        guard let manager = manager else {
            throw NSError(domain: "TunnelManager", code: 1, userInfo: [NSLocalizedDescriptionKey: "no VPN profile installed"])
        }
        state = .connecting
        try manager.connection.startVPNTunnel()
    }

    func disconnect() {
        manager?.connection.stopVPNTunnel()
    }

    /// Make sure our profile is the *selected* VPN configuration in
    /// system settings (`isEnabled = true`) and re-saved. When the user
    /// opens Settings → VPN, ours is the one with the check mark next
    /// to it, so a single tap of the master switch brings us back up.
    /// Also a no-op speed bump if the profile is already enabled.
    func ensureSelected() async throws {
        guard let manager = manager else { return }
        if manager.isEnabled { return }
        manager.isEnabled = true
        try await manager.saveToPreferences()
        try await manager.loadFromPreferences()
    }

    /// Remove the VPN profile entirely — used for full signout.
    func uninstall() async {
        guard let manager = manager else { return }
        try? await manager.removeFromPreferences()
        self.manager = nil
        self.state = .idle
    }

    // MARK: - Internals

    private func observeStatus(on connection: NEVPNConnection) {
        if let obs = statusObserver {
            NotificationCenter.default.removeObserver(obs)
        }
        statusObserver = NotificationCenter.default.addObserver(
            forName: .NEVPNStatusDidChange,
            object: connection,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.state = Self.mapState(connection.status, installed: true)
            }
        }
    }

    private static func mapState(_ s: NEVPNStatus, installed: Bool) -> State {
        switch s {
        case .invalid:       return installed ? .installed : .idle
        case .disconnected:  return installed ? .installed : .idle
        case .connecting:    return .connecting
        case .connected:     return .connected
        case .reasserting:   return .connecting
        case .disconnecting: return .disconnecting
        @unknown default:    return .installed
        }
    }
}

// MARK: - wg-quick config assembly

extension TunnelManager {
    /// Build the wg-quick-style config string the extension expects.
    /// Takes the server-provided template (with `<FILL_IN_ON_DEVICE>`
    /// placeholder for our private key) and injects the local key.
    static func buildWgQuickConfig(from wg: WGConfig, privateKeyBase64: String) -> String {
        return wg.configTemplate.replacingOccurrences(
            of: "<FILL_IN_ON_DEVICE>",
            with: privateKeyBase64,
        )
    }
}
