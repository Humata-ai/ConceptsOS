// Client for api.conceptsos.com.
//
// Two endpoints for the V1 iOS app:
//   POST /api/signup — one-shot: send our WireGuard pubkey, get back a
//                      config template (with a <FILL_IN_ON_DEVICE>
//                      placeholder for the private key).
//   GET  /api/vm     — poll until status == "ready".

import Foundation

struct VMResponse: Codable {
    let status: String
    let statusReason: String?
    let wg: WGConfig?
    let appURL: String?

    enum CodingKeys: String, CodingKey {
        case status
        case statusReason = "status_reason"
        case wg
        case appURL = "app_url"
    }
}

struct WGConfig: Codable {
    let address: String
    let serverPubkey: String
    let presharedKey: String
    let endpoint: String
    let allowedIps: String
    let configTemplate: String
}

struct ConceptsAPIError: Error, LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

@MainActor
final class ConceptsAPI {
    private let base: URL
    init(base: URL = URL(string: AppConfig.apiBaseURL)!) { self.base = base }

    /// POST /api/signup. Idempotent — call as many times as you like.
    func signup(jwt: String, wgPubkey: String) async throws -> VMResponse {
        var req = URLRequest(url: base.appendingPathComponent("api/signup"))
        req.httpMethod = "POST"
        req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["wgPubkey": wgPubkey])
        return try await run(req)
    }

    /// GET /api/vm.
    func vm(jwt: String) async throws -> VMResponse {
        var req = URLRequest(url: base.appendingPathComponent("api/vm"))
        req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
        return try await run(req)
    }

    private func run(_ req: URLRequest) async throws -> VMResponse {
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw ConceptsAPIError(message: "no HTTP response")
        }
        guard (200..<300).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw ConceptsAPIError(message: "HTTP \(http.statusCode): \(body)")
        }
        return try JSONDecoder().decode(VMResponse.self, from: data)
    }
}
