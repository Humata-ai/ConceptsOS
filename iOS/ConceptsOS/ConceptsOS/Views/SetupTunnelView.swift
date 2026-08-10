// First-time-only screen: show the WireGuard config as text + QR + copy
// button. User scans/imports it into the WireGuard iOS app once; from
// that point on their device has a durable VPN profile.
//
// Once they've enabled the tunnel, they tap "I'm connected" and we
// remember `tunnelInstalled = true` so this screen never shows again.
//
// V1 note: we don't programmatically install the tunnel via
// NetworkExtension yet — that requires an app extension target and
// the WireGuardKit Swift package, which is a bigger change. Manual
// import is a well-worn path and works fine as a bridge to V1.1.

import SwiftUI
import CoreImage.CIFilterBuiltins
import UIKit

struct SetupTunnelView: View {
    @EnvironmentObject var vmState: VMStateStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("One-time setup")
                    .font(.largeTitle.weight(.bold))
                Text("ConceptsOS runs your personal computer inside a private tunnel. Import this config into the WireGuard app once — after that everything works automatically.")
                    .foregroundStyle(.secondary)

                // Migration notice (2026-08-10): the pre-multi-tenant
                // deployment used a single shared LoadBalancer at
                // 34.41.131.163. The new setup gives each user their own
                // pod behind the shared wg-gateway at 35.253.153.78.
                // If a device still has the old tunnel active it will
                // silently talk to the legacy pod and see stale content.
                Text("New in this build: multi-tenant ConceptsOS. Each user runs in their own pod behind a shared WireGuard gateway (endpoint 35.253.153.78). If you already have an older “ConceptsOS” profile in the WireGuard app pointing at 34.41.131.163, delete it before importing the new one below — otherwise your phone will keep hitting the retired legacy tunnel.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(12)
                    .background(Color.yellow.opacity(0.15))
                    .clipShape(RoundedRectangle(cornerRadius: 8))

                if let cfg = fullConfigText {
                    if let qrImage = qr(from: cfg) {
                        HStack {
                            Spacer()
                            Image(uiImage: qrImage)
                                .interpolation(.none)
                                .resizable()
                                .scaledToFit()
                                .frame(width: 220, height: 220)
                                .padding(.vertical, 4)
                            Spacer()
                        }
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Steps")
                            .font(.headline)
                        Label("Install the free “WireGuard” app from the App Store.", systemImage: "1.circle.fill")
                        Label("Delete any older “ConceptsOS” profile first (endpoint 34.41.131.163 — that’s the retired legacy tunnel).", systemImage: "2.circle.fill")
                        Label("Tap +, then “Create from QR code” and scan the code above.", systemImage: "3.circle.fill")
                        Label("Toggle the new profile ON.", systemImage: "4.circle.fill")
                        Label("Return here and tap “I'm connected”.", systemImage: "5.circle.fill")
                    }

                    Button {
                        UIPasteboard.general.string = cfg
                    } label: {
                        Label("Copy config", systemImage: "doc.on.doc")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)

                    Button {
                        vmState.tunnelInstalled = true
                        vmState.persist()
                    } label: {
                        Label("I'm connected", systemImage: "checkmark.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                } else {
                    ProgressView("Fetching your config…")
                }
            }
            .padding(24)
        }
    }

    // MARK: - Config assembly

    /// Substitute the device's WG private key into the server-provided
    /// template. The template ships with `PrivateKey = <FILL_IN_ON_DEVICE>`.
    private var fullConfigText: String? {
        guard let template = vmState.wg?.configTemplate,
              let priv = WireGuardKeyStore.loadPrivateKeyBase64()
        else { return nil }
        return template.replacingOccurrences(of: "<FILL_IN_ON_DEVICE>", with: priv)
    }

    // MARK: - QR generation

    private func qr(from string: String) -> UIImage? {
        let ctx = CIContext()
        let filter = CIFilter.qrCodeGenerator()
        filter.setValue(Data(string.utf8), forKey: "inputMessage")
        filter.setValue("M", forKey: "inputCorrectionLevel")
        guard let output = filter.outputImage else { return nil }
        let scale = CGAffineTransform(scaleX: 8, y: 8)
        guard let cg = ctx.createCGImage(output.transformed(by: scale), from: output.extent.applying(scale)) else {
            return nil
        }
        return UIImage(cgImage: cg)
    }
}
