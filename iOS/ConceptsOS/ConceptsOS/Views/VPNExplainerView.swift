// Shown once, right before we ask iOS for VPN Configuration
// permission. Explains what the app is about to do — create a private,
// encrypted WireGuard tunnel from this iPhone to the user's remote
// ConceptsOS-VM — so the iOS system prompt has context.
//
// Flow: ProvisioningView → VPNExplainerView → [user taps Continue] →
// InstallTunnelView (which triggers the "Allow VPN Configuration"
// system alert on `.task`).
//
// Gated by @AppStorage("vpnExplainerAcknowledged") in ContentView, so
// the explainer only appears the first time. If tunnel install fails
// and the user retries, we don't loop back through the explainer.

import SwiftUI

struct VPNExplainerView: View {
    /// Called when the user taps "Continue". ContentView flips the
    /// acknowledged flag; the next render lands on InstallTunnelView.
    var onContinue: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)

            TunnelGraphic()
                .frame(height: 200)
                .padding(.horizontal, 20)

            VStack(spacing: 12) {
                Text("Your private tunnel")
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                    .multilineTextAlignment(.center)

                Text("ConceptsOS runs your personal computer as a remote VM. To reach it, this iPhone connects through a private, encrypted WireGuard tunnel — a secure network only you can use.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }
            .padding(.top, 8)

            Spacer(minLength: 20)

            VStack(alignment: .leading, spacing: 14) {
                BulletRow(
                    symbol: "lock.shield.fill",
                    tint: .green,
                    title: "End-to-end encrypted",
                    subtitle: "Traffic is sealed between this iPhone and your VM."
                )
                BulletRow(
                    symbol: "point.3.filled.connected.trianglepath.dotted",
                    tint: .blue,
                    title: "Only reaches your VM",
                    subtitle: "No general internet traffic is routed through us."
                )
                BulletRow(
                    symbol: "iphone.gen3",
                    tint: .orange,
                    title: "iOS will ask permission next",
                    subtitle: "You’ll see a system prompt to add a VPN configuration. Tap Allow."
                )
            }
            .padding(.horizontal, 28)

            Spacer(minLength: 24)

            Button(action: onContinue) {
                HStack(spacing: 8) {
                    Text("Continue")
                        .font(.headline)
                    Image(systemName: "arrow.right")
                }
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(Color.accentColor)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
            .accessibilityIdentifier("vpnExplainerContinueButton")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
        .accessibilityIdentifier("vpnExplainerView")
    }
}

// MARK: - Bullet row

private struct BulletRow: View {
    let symbol: String
    let tint: Color
    let title: String
    let subtitle: String

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: symbol)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 30, alignment: .center)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Text(subtitle)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Animated tunnel graphic
//
// iPhone (left)  ──[encrypted tunnel with a shield in the middle]──  Remote computer (right)
//
// Packets (colored circles) flow both directions along the tunnel.
// TimelineView drives the animation without any @State/timer churn.

private struct TunnelGraphic: View {
    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            let endpointSize: CGFloat = 92
            let midY = h / 2

            ZStack {
                // Left endpoint — iPhone
                Endpoint(
                    symbol: "iphone.gen3",
                    label: "This iPhone",
                    tint: .blue
                )
                .frame(width: endpointSize, height: endpointSize + 24)
                .position(x: endpointSize / 2 + 4, y: midY)

                // Right endpoint — remote VM
                Endpoint(
                    symbol: "desktopcomputer",
                    label: "Your VM",
                    tint: .purple
                )
                .frame(width: endpointSize, height: endpointSize + 24)
                .position(x: w - endpointSize / 2 - 4, y: midY)

                // Tunnel connecting the two, with packets + shield
                TunnelPipe(
                    from: CGPoint(x: endpointSize + 4, y: midY),
                    to: CGPoint(x: w - endpointSize - 4, y: midY)
                )
            }
        }
    }
}

private struct Endpoint: View {
    let symbol: String
    let label: String
    let tint: Color

    var body: some View {
        VStack(spacing: 6) {
            ZStack {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(tint.opacity(0.12))
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(tint.opacity(0.35), lineWidth: 1)
                Image(systemName: symbol)
                    .font(.system(size: 40, weight: .regular))
                    .foregroundStyle(tint)
            }
            .frame(width: 84, height: 84)

            Text(label)
                .font(.caption2.weight(.medium))
                .foregroundStyle(.secondary)
        }
    }
}

private struct TunnelPipe: View {
    let from: CGPoint
    let to: CGPoint

    var body: some View {
        let pipeHeight: CGFloat = 26
        let midX = (from.x + to.x) / 2

        ZStack {
            // Pipe background — subtle rounded rectangle
            Capsule()
                .fill(
                    LinearGradient(
                        colors: [Color.blue.opacity(0.15), Color.purple.opacity(0.15)],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .frame(width: to.x - from.x, height: pipeHeight)
                .position(x: midX, y: from.y)

            Capsule()
                .stroke(
                    LinearGradient(
                        colors: [Color.blue.opacity(0.5), Color.purple.opacity(0.5)],
                        startPoint: .leading,
                        endPoint: .trailing
                    ),
                    style: StrokeStyle(lineWidth: 1.5, dash: [4, 4])
                )
                .frame(width: to.x - from.x, height: pipeHeight)
                .position(x: midX, y: from.y)

            // Animated packets flowing both directions
            TimelineView(.animation(minimumInterval: 1.0 / 60.0)) { context in
                let t = context.date.timeIntervalSinceReferenceDate
                Canvas { ctx, _ in
                    let x0 = from.x + 6
                    let x1 = to.x - 6
                    let span = x1 - x0
                    let period: Double = 2.2

                    // Rightward packets (blue)
                    for i in 0..<3 {
                        let phase = (t / period + Double(i) / 3.0).truncatingRemainder(dividingBy: 1.0)
                        let x = x0 + CGFloat(phase) * span
                        let rect = CGRect(x: x - 4, y: from.y - 4, width: 8, height: 8)
                        ctx.opacity = fadeOpacity(phase)
                        ctx.fill(Path(ellipseIn: rect), with: .color(.blue))
                    }
                    // Leftward packets (purple)
                    for i in 0..<3 {
                        let phase = (t / period + Double(i) / 3.0 + 0.5).truncatingRemainder(dividingBy: 1.0)
                        let x = x1 - CGFloat(phase) * span
                        let rect = CGRect(x: x - 4, y: from.y - 4, width: 8, height: 8)
                        ctx.opacity = fadeOpacity(phase)
                        ctx.fill(Path(ellipseIn: rect), with: .color(.purple))
                    }
                }
            }

            // Shield/lock badge in the middle of the tunnel
            ZStack {
                Circle()
                    .fill(Color(.systemBackground))
                Circle()
                    .stroke(
                        LinearGradient(
                            colors: [.blue, .purple],
                            startPoint: .leading,
                            endPoint: .trailing
                        ),
                        lineWidth: 2
                    )
                Image(systemName: "lock.fill")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(
                        LinearGradient(
                            colors: [.blue, .purple],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
            }
            .frame(width: 40, height: 40)
            .position(x: midX, y: from.y)
        }
    }

    /// Fade packets in at start, out at end, so they don't visually
    /// pop out of the endpoints.
    private func fadeOpacity(_ phase: Double) -> Double {
        let edge = 0.12
        if phase < edge { return phase / edge }
        if phase > 1 - edge { return (1 - phase) / edge }
        return 1
    }
}

#Preview {
    VPNExplainerView(onContinue: {})
}
