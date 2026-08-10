// WireGuard Curve25519 keypair, generated locally with CryptoKit.
//
// The private key never leaves the device — we stash it in the iOS
// Keychain and only ship the base64 pubkey to the server.
//
// WireGuard uses Curve25519 raw keys, base64-encoded. CryptoKit's
// `Curve25519.KeyAgreement.PrivateKey` produces the exact 32-byte
// scalar WireGuard expects.

import CryptoKit
import Foundation
import Security

struct WireGuardKeyPair {
    let privateKeyBase64: String
    let publicKeyBase64: String

    static func generate() -> WireGuardKeyPair {
        let priv = Curve25519.KeyAgreement.PrivateKey()
        let pub = priv.publicKey
        return WireGuardKeyPair(
            privateKeyBase64: priv.rawRepresentation.base64EncodedString(),
            publicKeyBase64: pub.rawRepresentation.base64EncodedString(),
        )
    }
}

// Keychain persistence for the private key. Once we generate a keypair
// at first signup we never rotate it in V1 — the server also stores it
// keyed on user id, so rotating without a re-signup would strand us.
enum WireGuardKeyStore {
    private static let service = "ai.humata.ConceptsOS.wg"
    private static let account = "device-private-key"

    static func save(_ pair: WireGuardKeyPair) {
        let data = Data(pair.privateKeyBase64.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        var attrs = query
        attrs[kSecValueData as String] = data
        attrs[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(attrs as CFDictionary, nil)
    }

    static func loadPrivateKeyBase64() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &out)
        guard status == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Return the persisted keypair, generating and saving one if none exists.
    static func loadOrCreate() -> WireGuardKeyPair {
        if let priv = loadPrivateKeyBase64(),
           let privData = Data(base64Encoded: priv),
           let key = try? Curve25519.KeyAgreement.PrivateKey(rawRepresentation: privData) {
            return WireGuardKeyPair(
                privateKeyBase64: priv,
                publicKeyBase64: key.publicKey.rawRepresentation.base64EncodedString(),
            )
        }
        let fresh = WireGuardKeyPair.generate()
        save(fresh)
        return fresh
    }
}
