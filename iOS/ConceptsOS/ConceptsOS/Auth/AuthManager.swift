// AuthManager: native Sign in with Apple → Supabase JWT.
//
// Flow:
//   1. SignInWithAppleButton fires `onRequest` with a fresh
//      ASAuthorizationAppleIDRequest. We attach a hashed nonce so we
//      can prove the returned ID token wasn't replayed.
//   2. Apple returns the credential; we pull the identityToken (a JWT
//      signed by Apple) out of it.
//   3. POST that JWT + the raw nonce to Supabase's
//      /auth/v1/token?grant_type=id_token with provider=apple.
//      Supabase verifies the JWT against Apple's public keys and
//      checks that sha256(raw_nonce) matches the token's nonce claim.
//   4. Supabase returns its own session JWT; we persist it to the
//      Keychain via SessionStorage and publish it via @Published so
//      the SwiftUI tree flips to ProvisioningView.

import AuthenticationServices
import Foundation
import UIKit

@MainActor
final class AuthManager: ObservableObject {
    @Published var session: SupabaseSession?
    @Published var errorMessage: String?
    @Published var isAuthenticating = false

    private var currentNonce: String?

    private let supabaseURL: URL
    private let supabaseAnonKey: String

    init() {
        self.supabaseURL = URL(string: AppConfig.supabaseURL)!
        self.supabaseAnonKey = AppConfig.supabaseAnonKey
        if let s = SessionStorage.load() { self.session = s }
    }

    // MARK: - Called from SignInWithAppleButton

    func prepareAppleRequest(_ request: ASAuthorizationAppleIDRequest) {
        errorMessage = nil
        isAuthenticating = true
        let raw = Nonce.random(length: 32)
        currentNonce = raw
        request.requestedScopes = [.fullName, .email]
        request.nonce = Nonce.sha256(raw)
    }

    func handleAppleCompletion(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .success(let auth):
            guard let credential = auth.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = credential.identityToken,
                  let idToken = String(data: tokenData, encoding: .utf8),
                  let rawNonce = currentNonce
            else {
                errorMessage = "Apple did not return an ID token"
                isAuthenticating = false
                return
            }
            Task { await self.exchangeAppleIDToken(idToken, rawNonce: rawNonce) }

        case .failure(let error):
            let ns = error as NSError
            if ns.code == ASAuthorizationError.canceled.rawValue {
                // User backed out — not a real error.
                isAuthenticating = false
                return
            }
            errorMessage = "Apple sign-in failed: \(error.localizedDescription)"
            isAuthenticating = false
        }
    }

    func signOut() {
        session = nil
        SessionStorage.clear()
    }

    // MARK: - Supabase token exchange

    private func exchangeAppleIDToken(_ idToken: String, rawNonce: String) async {
        var url = supabaseURL.appendingPathComponent("auth/v1/token")
        var comps = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "grant_type", value: "id_token")]
        url = comps.url!

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        req.httpBody = try? JSONSerialization.data(withJSONObject: [
            "provider": "apple",
            "id_token": idToken,
            "nonce": rawNonce,
        ])

        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                let bodyText = String(data: data, encoding: .utf8) ?? "?"
                self.errorMessage = "Supabase auth failed: \(bodyText)"
                self.isAuthenticating = false
                return
            }
            let decoded = try JSONDecoder().decode(SupabaseSession.self, from: data)
            self.session = decoded
            SessionStorage.save(decoded)
            self.isAuthenticating = false
        } catch {
            self.errorMessage = "network: \(error.localizedDescription)"
            self.isAuthenticating = false
        }
    }
}

// MARK: - Types

struct SupabaseSession: Codable, Equatable {
    let access_token: String
    let refresh_token: String
    let token_type: String
    let expires_in: Int?
    let expires_at: Int?
    let user: SupabaseUser?
}

struct SupabaseUser: Codable, Equatable {
    let id: String
    let email: String?
}
