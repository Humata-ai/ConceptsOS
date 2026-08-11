# ConceptsOS iOS

Native SwiftUI iOS app. Welcome screen → **Sign in with Apple** →
provisions a per-user ConceptsOS-VM pod on our GKE cluster → the app
**automatically installs and connects an in-app WireGuard tunnel**
(no separate WireGuard client needed) → the app loads their pod
inside a WKWebView.

Deployment target: iOS 16.0. Bundle id: `ai.humata.ConceptsOS`. Ships
via TestFlight.

## App state machine

```
ContentView.swift picks one of:

  auth.session == nil                          → WelcomeView
  session, but VM not ready                    → ProvisioningView
  VM ready, tunnel not installed               → InstallTunnelView    (in-app WG install + connect)
  tunnel installed but currently disconnected  → VPNDisconnectedView  (Reconnect / Open Settings)
  tunnel installed AND connected               → WebAppView           (WKWebView on 10.10.0.1:3000)
```

`vmState.tunnelInstalled` records whether we've ever completed the
first-run install-and-connect flow. The *live* connection state comes
from the shared `TunnelManager` env object — if iOS reports the
tunnel isn't up (user toggled VPN off, iOS tore it down, profile
deleted…), ContentView renders `VPNDisconnectedView` instead of a
broken WKWebView pointed at an unreachable 10.10.0.1.


State lives in two `@StateObject`s at the App level:

- `AuthManager` (`Auth/AuthManager.swift`) — Sign in with Apple ↔
  Supabase JWT. Persists the session to Keychain via `SessionStorage`.
- `VMStateStore` (`VMStateStore.swift`) — the wg config, the pod URL,
  and a `tunnelInstalled` bool. Persisted to `UserDefaults` because
  none of it is secret — the wg private key is separately in Keychain.

## Layout

```
iOS/ConceptsOS/ConceptsOS/
├── ConceptsOSApp.swift               @main
├── ContentView.swift                 state machine
├── AppConfig.swift                   URLs + anon Supabase key (public)
├── VMStateStore.swift                UserDefaults-backed VM state
├── ConceptsOS.entitlements           com.apple.developer.applesignin
├── Info.plist                        ATS exceptions, encryption exempt
├── Auth/
│   ├── AuthManager.swift             Sign in with Apple ↔ Supabase
│   ├── Nonce.swift                   CryptoKit random + sha256
│   └── SessionStorage.swift          Keychain persistence
├── API/
│   └── ConceptsAPI.swift             POST /api/signup, GET /api/vm
├── WireGuard/
│   ├── WireGuardKeys.swift           Curve25519 keypair + Keychain
│   ├── WGQuickParser.swift           tiny wg-quick → TunnelConfiguration parser (shared with extension)
│   └── TunnelManager.swift           NETunnelProviderManager wrapper (install + connect)
├── Views/
│   ├── WelcomeView.swift             SignInWithAppleButton
│   ├── ProvisioningView.swift        polls /api/vm every 2s
│   ├── InstallTunnelView.swift       auto-installs the VPN profile,
│                                     handles the iOS "Allow VPN" prompt,
│                                     starts the tunnel
│   ├── VPNDisconnectedView.swift     shown when the tunnel is installed
│                                     but not currently connected —
│                                     Reconnect / Open Settings / Sign out
│   └── WebAppView.swift              WKWebView
└── WebView.swift                     UIViewRepresentable wrapper

iOS/ConceptsOS/ConceptsOSWGTunnel/          # Packet Tunnel Provider extension
├── PacketTunnelProvider.swift              subclass of NEPacketTunnelProvider,
│                                           drives WireGuardKit's WireGuardAdapter
├── Info.plist                              NSExtensionPointIdentifier = com.apple.networkextension.packet-tunnel
└── ConceptsOSWGTunnel.entitlements         com.apple.developer.networking.networkextension = [packet-tunnel-provider]
```

## Baked-in WireGuard

WireGuard runs **inside the app** via a Network Extension
(`ConceptsOSWGTunnel.appex`) backed by `WireGuardKit` +
`wireguard-go`. Users no longer install the standalone WireGuard
iOS app — the first time we have a VM to connect to, iOS shows the
system `AllowVPN Configuration` prompt and the tunnel comes up
automatically.

Key pieces:

- **Extension target**: `ConceptsOSWGTunnel`, bundle id
  `ai.humata.ConceptsOS.WGTunnel`. Ships alongside the main app in
  `ConceptsOS.app/PlugIns/`.
- **WireGuardKit** is added as a Swift Package pinned to our fork
  [`Humata-ai/wireguard-apple`](https://github.com/Humata-ai/wireguard-apple).
  The fork exists only to (1) bump `swift-tools-version` from 5.3 to
  5.9 (upstream declares 5.3 but uses `.iOS(.v15)`, which requires
  5.5+; Xcode 26 refuses to load the manifest as a result) and
  (2) `#include <sys/types.h>` in `WireGuardKitC.h` so it compiles
  under Xcode 26's stricter clang modules. All other code is
  upstream.
- **`wireguard-go` bridge** is built by a Run Script build phase on
  the extension target that CDs into the SPM checkout at
  `…/SourcePackages/checkouts/wireguard-apple/Sources/WireGuardKitGo`
  and runs `make`. Needs Go on PATH — installed at
  `/usr/local/go/bin/go` on the Mac Mini.
- **wg-quick parser**: WireGuardKit's Swift Package doesn't expose
  its parser, so we ship `WGQuickParser.swift` (~130 lines) shared
  between the app and the extension.
- **Entitlements**:
  - Main app: `com.apple.developer.applesignin`,
    `com.apple.developer.networking.networkextension = [packet-tunnel-provider]`.
  - Extension: `com.apple.developer.networking.networkextension = [packet-tunnel-provider]`.
  - No App Groups needed — the WireGuard config is shipped to the
    extension via `NETunnelProviderProtocol.providerConfiguration`,
    which the system persists in the VPN profile.
- **Apple Developer setup done for this**:
  - Registered bundle id `ai.humata.ConceptsOS.WGTunnel` (ID
    `G87FM6S5UF`).
  - Enabled `NETWORK_EXTENSIONS` capability on both `ai.humata.ConceptsOS`
    and `ai.humata.ConceptsOS.WGTunnel`.
  - `-allowProvisioningUpdates` handles the rest per build.

### Rebuilding the pbxproj

The extension target + SPM package + build phases are all created by
[`iOS/scripts/add-wg-extension.rb`](scripts/add-wg-extension.rb),
which uses the pure-Ruby `xcodeproj` gem. It's idempotent — rerun
after checking out an older revision to reapply. The generated
pbxproj is checked in so day-to-day builds just work.

## The auth flow (Sign in with Apple, native)

1. `SignInWithAppleButton.onRequest` is called. `AuthManager` generates
   a random raw nonce, stores it, and sets `request.nonce = sha256(raw)`.
2. Apple's system UI runs. On success, `onCompletion` gives us an
   `ASAuthorizationAppleIDCredential` with a signed `identityToken` JWT.
3. `AuthManager` POSTs to
   `https://<project>.supabase.co/auth/v1/token?grant_type=id_token`
   with `{ provider: "apple", id_token: <jwt>, nonce: <raw> }`.
4. Supabase verifies the JWT signature against Apple's public keys and
   checks that `sha256(raw) == token.nonce`. It returns its own
   `SupabaseSession` (access_token / refresh_token / user).
5. `SessionStorage` persists it to Keychain. `ContentView` observes
   `auth.session` and swaps to `ProvisioningView`.

The Supabase project's Apple provider is configured with
`client_id = ai.humata.ConceptsOS` (the app's bundle id). No client
secret / Services ID is needed for the native flow.

## The VM provisioning flow

1. `ProvisioningView.beginProvisioning` reads (or generates)
   a Curve25519 keypair via `WireGuardKeyStore.loadOrCreate`. The
   private key stays in the iOS Keychain forever.
2. It POSTs `{ wgPubkey: <b64> }` to `https://api.conceptsos.com/api/signup`
   with the Supabase JWT as `Authorization: Bearer`.
3. The api service:
   - allocates a client IP under `10.10.0.0/16`
   - generates a preshared key
   - writes a `public.vms` row with `status = "pending"`
   - returns a WG config template with `PrivateKey = <FILL_IN_ON_DEVICE>`
4. The api's background reconcile loop creates a `StatefulSet` +
   `Service` + `Secret` for the user in the `users` namespace, then
   pushes a peer to `wg-gateway` (which adds an `iptables` DNAT rule
   from this user's tunnel IP → their pod's ClusterIP:3000). Once
   the pod is Ready, `vms.status` flips to `"ready"`.
5. `ProvisioningView` polls `GET /api/vm` every 2 seconds until
   status is `"ready"` (typical: 30-60 seconds on first signup).
6. `SetupTunnelView` renders the completed WG config (private key
   filled in from Keychain) as a QR code. User imports it into the
   WireGuard iOS app once and taps **I'm connected**.
7. `WebAppView` loads `http://10.10.0.1:3000/` in a `WKWebView`. The
   wg-gateway sees traffic from this user's tunnel IP, DNATs it to
   their pod. Users cannot reach each other's pods.

## Build + TestFlight (headless from Linux)

Once code changes are pushed to `main`:

```bash
# Unlock keychain (once per Mac reboot)
MAC_PW=$(pass show "Mac password" | head -1)
ssh mac-mini "bash -c 'security unlock-keychain -p \"$MAC_PW\" ~/Library/Keychains/login.keychain-db && security set-keychain-settings ~/Library/Keychains/login.keychain-db'"

# Pull + archive + upload
ssh mac-mini 'bash -c "cd ~/github/Humata-ai/ConceptsOS && git pull --ff-only && bash /tmp/run-archive2.sh"'

# Watch progress
ssh mac-mini 'bash -c "tail -f /tmp/xcarchive.log"'
```

The internal testing group "Humata Team" has auto-distribution ON, so
every successful upload notifies all testers within ~15 minutes
(processing time on Apple's side).

See the [xcode skill](../.pi/agent/skills/xcode/SKILL.md) for the full
signing / Apple Developer setup.

## Wi-Fi install to a physical iPhone (skip TestFlight)

For iterating on the iOS wrapper without waiting 10-20 min for
TestFlight processing, install a dev-signed Debug build straight onto
a paired iPhone from the Mac. ~45s end-to-end after the first-time
setup.

One-time per phone:

1. Plug phone into the Mac via USB, tap **Trust This Computer**.
2. On the phone: **Settings → Privacy & Security → Developer Mode**
   → toggle ON, restart, confirm.
3. Register the phone's UDID with the developer portal:
   ```bash
   ssh mac-mini bash ~/github/Humata-ai/ConceptsOS/iOS/scripts/wifi-install.sh
   # First run will fail and print the classic UDID.
   ssh mac-mini "DEVICE_UDID=00008150-XXX DEVICE_NAME='My iPhone' \
     bash ~/github/Humata-ai/ConceptsOS/iOS/scripts/register-device.sh"
   ```

Every build after that (Wi-Fi is fine, USB not needed):

```bash
cd ~/github/Humata-ai/ConceptsOS && git push
MAC_PW=$(pass show "Mac password" | head -1)
ssh mac-mini "bash -c 'security unlock-keychain -p \"$MAC_PW\" \
  ~/Library/Keychains/login.keychain-db && \
  cd ~/github/Humata-ai/ConceptsOS && git pull --ff-only && \
  bash iOS/scripts/wifi-install.sh'"
```

All knobs (device id, team, bundle id, key path, …) are env-var
overridable — see the header comments in
[`iOS/scripts/wifi-install.sh`](scripts/wifi-install.sh) and
[`iOS/scripts/register-device.sh`](scripts/register-device.sh).

## Local dev (SwiftUI previews only)

You can preview individual views on Mac. Full end-to-end testing
requires a **physical iOS device** — the iOS Simulator can install a
VPN profile but doesn't actually route packets through the packet-
tunnel `utun` interface, so `10.10.0.1:3000` never becomes
reachable. Use `iOS/scripts/wifi-install.sh` to iterate on a real
phone.

## Notes / gotchas

- **The wg private key never leaves the device.** It's generated with
  CryptoKit at first signup and stored in the iOS Keychain
  (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`). If the user
  restores this device to a new phone, they'll get a fresh keypair
  and the server will accept it on the next `/api/signup` — the
  `vms` row is upserted, but the old wg peer stays registered on
  the gateway (harmless orphan). A V2 sweep can garbage-collect stale
  peers.
- **HTTP traffic to `10.10.0.1` is allowed** by an `NSExceptionDomain`
  in `Info.plist`. Everything else is HTTPS (Supabase, our api).
- **`ITSAppUsesNonExemptEncryption = false`** in `Info.plist` so every
  upload skips the export-compliance prompt in App Store Connect.
