// A tiny wg-quick config parser that turns the server-provided template
// (see api/src/lib/wg.ts::buildClientConfig) into a WireGuardKit
// TunnelConfiguration.
//
// WireGuardKit itself ships a full parser at
// wireguard-apple/Sources/Shared/Model/TunnelConfiguration+WgQuickConfig.swift
// but it isn't exported through the Swift Package (only through the
// app targets in that repo). Rather than vendor the entire Shared/
// tree we just parse the tiny subset of wg-quick we actually emit
// server-side:
//
//   [Interface]
//   PrivateKey = <base64>
//   Address    = <cidr>[, <cidr> …]
//   DNS        = <ip>[, <ip> …]           (optional)
//
//   [Peer]
//   PublicKey            = <base64>
//   PresharedKey         = <base64>       (optional)
//   Endpoint             = host:port
//   AllowedIPs           = <cidr>[, <cidr> …]
//   PersistentKeepalive  = <seconds>      (optional)
//
// If the server ever grows to emit more we'll grow this alongside it.
// This file is deliberately shared with the ConceptsOSWGTunnel target
// so both sides parse identically.

import Foundation
import WireGuardKit

enum WGQuickParserError: Error, LocalizedError {
    case missingSection(String)
    case missingField(String)
    case invalidBase64(String)
    case invalidAddress(String)
    case invalidEndpoint(String)

    var errorDescription: String? {
        switch self {
        case .missingSection(let s): return "wg-quick: missing [\(s)] section"
        case .missingField(let f):   return "wg-quick: missing \(f)"
        case .invalidBase64(let f):  return "wg-quick: invalid base64 in \(f)"
        case .invalidAddress(let a): return "wg-quick: invalid address \"\(a)\""
        case .invalidEndpoint(let e): return "wg-quick: invalid endpoint \"\(e)\""
        }
    }
}

enum WGQuickParser {
    static func parse(_ text: String, name: String) throws -> TunnelConfiguration {
        var currentSection: String?
        var iface: [String: String] = [:]
        var peers: [[String: String]] = []

        for rawLine in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("#") { continue }

            if line.hasPrefix("[") && line.hasSuffix("]") {
                currentSection = String(line.dropFirst().dropLast())
                    .trimmingCharacters(in: .whitespaces)
                    .lowercased()
                if currentSection == "peer" { peers.append([:]) }
                continue
            }

            guard let eq = line.firstIndex(of: "=") else { continue }
            let key = line[..<eq].trimmingCharacters(in: .whitespaces).lowercased()
            let val = line[line.index(after: eq)...].trimmingCharacters(in: .whitespaces)

            switch currentSection {
            case "interface": iface[key] = val
            case "peer":      peers[peers.count - 1][key] = val
            default:          break
            }
        }

        // --- Interface ---
        guard let privB64 = iface["privatekey"] else {
            throw WGQuickParserError.missingField("PrivateKey")
        }
        guard let privData = Data(base64Encoded: privB64), privData.count == 32 else {
            throw WGQuickParserError.invalidBase64("PrivateKey")
        }
        var interface = InterfaceConfiguration(privateKey: PrivateKey(rawValue: privData)!)

        if let addr = iface["address"] {
            interface.addresses = try parseIPRanges(addr, fieldName: "Address")
        }
        if let dns = iface["dns"] {
            interface.dns = dns
                .split(separator: ",")
                .compactMap { DNSServer(from: $0.trimmingCharacters(in: .whitespaces)) }
        }
        if let mtu = iface["mtu"], let m = UInt16(mtu) {
            interface.mtu = m
        }
        if let lp = iface["listenport"], let p = UInt16(lp) {
            interface.listenPort = p
        }

        // --- Peers ---
        if peers.isEmpty {
            throw WGQuickParserError.missingSection("Peer")
        }
        let peerConfigs: [PeerConfiguration] = try peers.map { p in
            guard let pubB64 = p["publickey"] else {
                throw WGQuickParserError.missingField("PublicKey")
            }
            guard let pubData = Data(base64Encoded: pubB64), pubData.count == 32 else {
                throw WGQuickParserError.invalidBase64("PublicKey")
            }
            var peer = PeerConfiguration(publicKey: PublicKey(rawValue: pubData)!)

            if let pskB64 = p["presharedkey"] {
                guard let pskData = Data(base64Encoded: pskB64), pskData.count == 32 else {
                    throw WGQuickParserError.invalidBase64("PresharedKey")
                }
                peer.preSharedKey = PreSharedKey(rawValue: pskData)
            }
            if let ep = p["endpoint"] {
                guard let endpoint = Endpoint(from: ep) else {
                    throw WGQuickParserError.invalidEndpoint(ep)
                }
                peer.endpoint = endpoint
            }
            if let allowed = p["allowedips"] {
                peer.allowedIPs = try parseIPRanges(allowed, fieldName: "AllowedIPs")
            }
            if let ka = p["persistentkeepalive"], let s = UInt16(ka) {
                peer.persistentKeepAlive = s
            }
            return peer
        }

        return TunnelConfiguration(name: name, interface: interface, peers: peerConfigs)
    }

    private static func parseIPRanges(_ csv: String, fieldName: String) throws -> [IPAddressRange] {
        return try csv
            .split(separator: ",")
            .map { part -> IPAddressRange in
                let trimmed = part.trimmingCharacters(in: .whitespaces)
                guard let r = IPAddressRange(from: trimmed) else {
                    throw WGQuickParserError.invalidAddress(trimmed)
                }
                return r
            }
    }
}
