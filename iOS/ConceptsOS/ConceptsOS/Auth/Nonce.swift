// Cryptographic nonce helpers for Sign in with Apple.
//
// Apple's Sign in with Apple requires you to include a hashed nonce in
// the request; the ID token they return has the hash in its `nonce`
// claim. Supabase verifies the (raw) nonce matches by re-hashing it,
// which prevents an attacker from replaying a captured token.

import CryptoKit
import Foundation

enum Nonce {
    /// URL-safe random string. 32 chars is what Apple's own sample uses.
    static func random(length: Int) -> String {
        precondition(length > 0)
        let alphabet: [Character] = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._")
        var result = ""
        result.reserveCapacity(length)
        var buf = [UInt8](repeating: 0, count: length)
        _ = SecRandomCopyBytes(kSecRandomDefault, buf.count, &buf)
        for byte in buf {
            result.append(alphabet[Int(byte) % alphabet.count])
        }
        return result
    }

    static func sha256(_ input: String) -> String {
        let data = Data(input.utf8)
        let hash = SHA256.hash(data: data)
        return hash.compactMap { String(format: "%02x", $0) }.joined()
    }
}
