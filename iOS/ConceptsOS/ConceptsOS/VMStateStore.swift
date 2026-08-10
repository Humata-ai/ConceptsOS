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

    private let defaults = UserDefaults.standard
    private let key = "conceptsos.vm-state.v1"

    init() { load() }

    func persist() {
        let payload = SnapshotV1(
            wg: wg,
            appURL: appURL,
            tunnelInstalled: tunnelInstalled,
        )
        if let data = try? JSONEncoder().encode(payload) {
            defaults.set(data, forKey: key)
        }
    }

    func clear() {
        wg = nil
        appURL = nil
        tunnelInstalled = false
        defaults.removeObject(forKey: key)
    }

    private func load() {
        guard let data = defaults.data(forKey: key),
              let snap = try? JSONDecoder().decode(SnapshotV1.self, from: data)
        else { return }
        self.wg = snap.wg
        self.appURL = snap.appURL
        self.tunnelInstalled = snap.tunnelInstalled
    }

    private struct SnapshotV1: Codable {
        let wg: WGConfig?
        let appURL: String?
        let tunnelInstalled: Bool
    }
}
