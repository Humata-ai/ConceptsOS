# ConceptsOS iOS

Native SwiftUI iOS app. Welcome screen → **Sign in with Apple** →
provisions a per-user ConceptsOS-VM pod on our GKE cluster → user
imports the WireGuard config into the WireGuard iOS app → the app
loads their pod inside a WKWebView.

Deployment target: iOS 16.0. Bundle id: `ai.humata.ConceptsOS`. Ships
via TestFlight.

## App state machine

```
ContentView.swift picks one of:

  auth.session == nil                  → WelcomeView
  session, but VM not ready            → ProvisioningView
  VM ready, tunnel not yet installed   → SetupTunnelView   (QR + copy)
  VM ready, tunnel installed           → WebAppView         (WKWebView on 10.10.0.1:3000)
```

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
│   └── WireGuardKeys.swift           Curve25519 keypair + Keychain
├── Views/
│   ├── WelcomeView.swift             SignInWithAppleButton
│   ├── ProvisioningView.swift        polls /api/vm every 2s
│   ├── SetupTunnelView.swift         QR + config + "I'm connected"
│   └── WebAppView.swift              WKWebView
└── WebView.swift                     UIViewRepresentable wrapper
```

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

You can preview individual views on Mac. Full end-to-end testing needs
a real device (or simulator) with the WireGuard app installed and the
config imported. Simulator is fine for the auth + provisioning flow
since it can reach `api.conceptsos.com` over regular HTTPS.

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
