// Persistent record of the user's VM: WG config and pod URL.
//
// Written once we've fetched them from the api. Persisted so returning
// users don't re-poll if they already have a tunnel installed.

import Foundation
import Combine

@MainActor
final class VMStateStore: ObservableObject {
    @Published var wg: WGConfig?
    @Published var appURL: String?
    @Published var tunnelInstalled: Bool = false
    /// Bumped whenever we need to force everyone back through
    /// SetupTunnelView on next launch — e.g. after retiring the legacy
    /// single-tenant WireGuard gateway (34.41.131.163) in favor of the
    /// multi-tenant one (35.253.153.78). Compared against
    /// `Self.currentTunnelSchemaVersion` on load; if the persisted value
    /// is lower we drop `tunnelInstalled` so the migration copy in
    /// SetupTunnelView is shown.
    @Published var tunnelSchemaVersion: Int = Self.currentTunnelSchemaVersion

    /// Bump this any time we retire a WireGuard endpoint / gateway.
    ///   1 — pre-multi-tenant (LB 34.41.131.163, `default/conceptsos`).
    ///   2 — multi-tenant (LB 35.253.153.78, `conceptsos-system/wg-gateway`).
    static let currentTunnelSchemaVersion = 2

    private let defaults = UserDefaults.standard
    private let key = "conceptsos.vm-state.v1"

    init() { load() }

    func persist() {
        let payload = SnapshotV1(
            wg: wg,
            appURL: appURL,
            tunnelInstalled: tunnelInstalled,
            tunnelSchemaVersion: tunnelSchemaVersion,
        )
        if let data = try? JSONEncoder().encode(payload) {
            defaults.set(data, forKey: key)
        }
    }

    func clear() {
        wg = nil
        appURL = nil
        tunnelInstalled = false
        tunnelSchemaVersion = Self.currentTunnelSchemaVersion
        defaults.removeObject(forKey: key)
    }

    private func load() {
        guard let data = defaults.data(forKey: key),
              let snap = try? JSONDecoder().decode(SnapshotV1.self, from: data)
        else { return }
        self.wg = snap.wg
        self.appURL = snap.appURL
        self.tunnelInstalled = snap.tunnelInstalled
        self.tunnelSchemaVersion = snap.tunnelSchemaVersion ?? 1
        // Migration: if the persisted schema is older than what the app
        // now speaks, drop tunnelInstalled so the user is walked back
        // through SetupTunnelView (which explains what to delete/reimport
        // in the WireGuard app). Also clear the stale wg + appURL so
        // ProvisioningView re-fetches from the current api.
        if self.tunnelSchemaVersion < Self.currentTunnelSchemaVersion {
            self.tunnelInstalled = false
            self.wg = nil
            self.appURL = nil
            self.tunnelSchemaVersion = Self.currentTunnelSchemaVersion
            persist()
        }
    }

    private struct SnapshotV1: Codable {
        let wg: WGConfig?
        let appURL: String?
        let tunnelInstalled: Bool
        // Absent in pre-2026-08-10 snapshots — defaults to 1 on decode.
        let tunnelSchemaVersion: Int?
    }
}
