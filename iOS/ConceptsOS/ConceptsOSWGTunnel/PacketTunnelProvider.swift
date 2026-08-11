// PacketTunnelProvider is the entry point for the WireGuard Network
// Extension baked into ConceptsOS. It runs in a separate process from
// the main app, launched on demand by iOS whenever the VPN profile is
// activated.
//
// The main app packages a WireGuard config (address, private key,
// server pubkey, preshared key, endpoint, allowed IPs, DNS) into the
// NETunnelProviderProtocol's `providerConfiguration` dictionary, saves
// it to the system's VPN preferences, and calls `startVPNTunnel()`.
// iOS then spawns this extension and invokes `startTunnel(options:)`.
//
// We delegate all the actual WireGuard heavy lifting to WireGuardKit
// (which itself wraps wireguard-go). This class is basically a wrapper
// that translates our `[String: String]` provider config into a
// `TunnelConfiguration` and hands it off.

import Foundation
import NetworkExtension
import WireGuardKit
import os

final class PacketTunnelProvider: NEPacketTunnelProvider {
    private lazy var adapter: WireGuardAdapter = {
        WireGuardAdapter(with: self) { level, message in
            os_log("wg: %{public}s", log: OSLog(subsystem: "ai.humata.ConceptsOS.WGTunnel", category: "wireguard"), type: .default, message)
        }
    }()

    override func startTunnel(options: [String: NSObject]?, completionHandler: @escaping (Error?) -> Void) {
        guard
            let proto = protocolConfiguration as? NETunnelProviderProtocol,
            let providerConfig = proto.providerConfiguration,
            let wgQuickConfig = providerConfig["wgQuickConfig"] as? String
        else {
            completionHandler(PacketTunnelProviderError.savedProtocolConfigurationIsInvalid)
            return
        }

        let tunnelConfiguration: TunnelConfiguration
        do {
            tunnelConfiguration = try TunnelConfiguration(fromWgQuickConfig: wgQuickConfig, called: "ConceptsOS")
        } catch {
            completionHandler(PacketTunnelProviderError.savedProtocolConfigurationIsInvalid)
            return
        }

        adapter.start(tunnelConfiguration: tunnelConfiguration) { adapterError in
            if let adapterError = adapterError {
                completionHandler(adapterError)
            } else {
                completionHandler(nil)
            }
        }
    }

    override func stopTunnel(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        adapter.stop { _ in
            completionHandler()
        }
    }

    override func handleAppMessage(_ messageData: Data, completionHandler: ((Data?) -> Void)?) {
        completionHandler?(nil)
    }
}

enum PacketTunnelProviderError: Error {
    case savedProtocolConfigurationIsInvalid
    case couldNotStartBackend
}
