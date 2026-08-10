// Shown right after sign-in. Sends the WireGuard pubkey to the api,
// polls GET /api/vm until status == "ready", then transitions to
// SetupTunnelView (first time) or WebAppView (returning users with
// tunnel already installed).

import SwiftUI

struct ProvisioningView: View {
    @EnvironmentObject var auth: AuthManager
    @EnvironmentObject var vmState: VMStateStore

    @State private var status: String = "starting"
    @State private var statusReason: String?
    @State private var pollTask: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            ProgressView()
                .scaleEffect(1.5)
            Text(headline(for: status))
                .font(.title3.weight(.semibold))
                .multilineTextAlignment(.center)
            if let reason = statusReason {
                Text(reason)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }
            Text(subhead(for: status))
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            Spacer()

            Button(role: .destructive) {
                pollTask?.cancel()
                auth.signOut()
            } label: {
                Text("Cancel & sign out").font(.footnote)
            }
            .padding(.bottom, 24)
        }
        .task { await beginProvisioning() }
        .onDisappear { pollTask?.cancel() }
    }

    // MARK: - Flow

    private func beginProvisioning() async {
        guard let jwt = auth.session?.access_token else { return }

        let keys = WireGuardKeyStore.loadOrCreate()
        let api = ConceptsAPI()

        do {
            let signup = try await api.signup(jwt: jwt, wgPubkey: keys.publicKeyBase64)
            status = signup.status
            if let wg = signup.wg {
                vmState.wg = wg
                vmState.persist()
            }
        } catch {
            statusReason = "signup failed: \(error.localizedDescription)"
            return
        }

        // Poll until ready.
        pollTask = Task {
            while !Task.isCancelled {
                do {
                    let vm = try await api.vm(jwt: jwt)
                    await MainActor.run {
                        self.status = vm.status
                        self.statusReason = vm.statusReason
                        if let wg = vm.wg { self.vmState.wg = wg }
                        self.vmState.appURL = vm.appURL
                        self.vmState.persist()
                    }
                    if vm.status == "ready" { break }
                    if vm.status == "error" { break }
                } catch {
                    await MainActor.run {
                        self.statusReason = "poll: \(error.localizedDescription)"
                    }
                }
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }

    private func headline(for status: String) -> String {
        switch status {
        case "starting":       return "Setting things up…"
        case "pending":        return "Reserving your address…"
        case "provisioning":   return "Booting your ConceptsOS-VM…"
        case "ready":          return "Ready!"
        case "error":          return "Something went wrong."
        default:               return "Getting ready…"
        }
    }

    private func subhead(for status: String) -> String {
        switch status {
        case "ready":  return "Bringing you in."
        case "error":  return "Please try again. If it keeps happening, sign out and back in."
        default:       return "This normally takes about 30 seconds on first launch."
        }
    }
}
