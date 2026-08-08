# ConceptsOS iOS

A minimal SwiftUI iOS app whose entire UI is a `WKWebView` pointed at Dan's
Next.js dev server on the LAN:

    http://192.168.1.230:3000

That's the "Hello Next.js" server. If Dan's IP moves, change the `url`
constant in [`ConceptsOS/ContentView.swift`](ConceptsOS/ConceptsOS/ContentView.swift).

The bundle identifier is `ai.humata.ConceptsOS` and the deployment target is
iOS 16.0.

## Project layout

```
iOS/
└── ConceptsOS/
    ├── ConceptsOS.xcodeproj/       # Xcode project
    └── ConceptsOS/
        ├── ConceptsOSApp.swift     # @main entry point
        ├── ContentView.swift       # Hosts the WebView
        ├── WebView.swift           # UIViewRepresentable around WKWebView
        ├── Info.plist              # NSAppTransportSecurity allows http://192.168.1.230
        ├── Assets.xcassets/
        └── Preview Content/
```

## Running locally (needs a Mac)

iOS apps can only be built on macOS with Xcode. From a Mac:

```bash
git pull
cd ConceptsOS/iOS/ConceptsOS
open ConceptsOS.xcodeproj
```

Then in Xcode:

1. Select the **ConceptsOS** scheme.
2. Pick a simulator (e.g. iPhone 15) or a connected device.
3. Press ⌘R.

Make sure the Next.js dev server is actually running on Dan's machine and
listening on `0.0.0.0` (not just `127.0.0.1`) so the phone/simulator can reach
it. From the ConceptsOS Next.js app dir:

```bash
next dev -H 0.0.0.0 -p 3000
```

The iPhone must be on the same Wi-Fi network as Dan's dev box (`192.168.1.230`).
On first launch iOS will prompt for **Local Network** permission — allow it.

## TestFlight submission (needs a Mac + Apple Developer account)

This can't be done from Linux. Steps for the Mac:

### One-time setup

1. Enroll in the [Apple Developer Program](https://developer.apple.com/programs/)
   ($99/yr) under the Humata org (or Dan's personal account).
2. In [App Store Connect](https://appstoreconnect.apple.com/) → **My Apps** →
   **+** → **New App**:
   - Platform: iOS
   - Name: ConceptsOS
   - Primary language: English (U.S.)
   - Bundle ID: `ai.humata.ConceptsOS` (create it in the Developer portal first
     if needed, under **Certificates, Identifiers & Profiles → Identifiers**)
   - SKU: `conceptsos-ios`
3. In Xcode, open the project and select the **ConceptsOS** target →
   **Signing & Capabilities**. Set **Team** to the Humata / Dan team. Xcode
   should auto-manage signing.

### Every build

1. In Xcode, bump `MARKETING_VERSION` (e.g. `1.0`) and/or
   `CURRENT_PROJECT_VERSION` (build number) in the target's build settings.
   TestFlight requires each upload to have a new build number.
2. Set the run destination to **Any iOS Device (arm64)**.
3. **Product → Archive**. When it finishes, the Organizer opens.
4. Click **Distribute App → App Store Connect → Upload**. Accept the defaults
   (automatic signing, symbols, manage version). Xcode uploads the `.ipa`.
5. Wait ~5–15 min for App Store Connect to finish processing (you'll get an
   email). The build appears under **TestFlight → iOS Builds**.
6. On that build, fill in the **Export Compliance** answer (this app uses only
   HTTPS/system crypto → "No" for encryption beyond exempt).
7. Add yourself (and any other testers) under
   **TestFlight → Internal Testing → + group → Testers**. Internal testers
   (up to 100) get access as soon as the build finishes processing — no
   Apple review needed.
8. Install the **TestFlight** app on your iPhone, sign in with the same Apple
   ID, accept the invite, install ConceptsOS.

### Command-line alternative (once signing is set up)

```bash
cd ConceptsOS/iOS/ConceptsOS
xcodebuild -project ConceptsOS.xcodeproj \
  -scheme ConceptsOS \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath build/ConceptsOS.xcarchive \
  archive

xcodebuild -exportArchive \
  -archivePath build/ConceptsOS.xcarchive \
  -exportPath build/export \
  -exportOptionsPlist ExportOptions.plist   # see Apple docs

xcrun altool --upload-app -f build/export/ConceptsOS.ipa \
  -t ios -u <apple-id> -p <app-specific-password>
```

## Notes / gotchas

- The `Info.plist` has `NSAppTransportSecurity.NSAllowsArbitraryLoads = true`
  plus a specific exception for `192.168.1.230`. Apple will accept this for
  TestFlight; for a public App Store release you'd want HTTPS or a documented
  ATS justification.
- `NSLocalNetworkUsageDescription` is set so iOS 14+ won't silently block
  requests to the LAN.
- If the app is white/blank on launch, either (a) Dan's dev server isn't
  running, (b) it's bound to `127.0.0.1` only, or (c) the phone is on
  cellular / a different Wi-Fi than `192.168.1.230`.
