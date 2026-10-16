# Building and releasing

## Requirements

- Node.js 22 and npm
- Desktop installers: run on the target OS (or use CI)
- Android: JDK 21 and the Android SDK
- iOS: macOS with Xcode

```bash
npm ci
```

## Desktop (Electron)

```bash
npm start            # run locally
npm run dist:win     # NSIS installer + portable, x64
npm run dist:mac     # universal DMG
npm run dist:linux   # AppImage + .deb, x64
```

Output goes to `dist/` (git-ignored). Put icons in `build/` first; see [build/README.md](../build/README.md). Packaging settings live under `"build"` in `package.json`; macOS entitlements are in `build/entitlements.mac.plist`.

## Android (Capacitor)

The Android project is committed under `android/` and already registers `MakeCodeBridgePlugin` in `MainActivity.java`.

```bash
npx cap sync android
cd android
./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/
```

Create `android/local.properties` with `sdk.dir=/path/to/Android/sdk` if Gradle can't find the SDK. If you regenerate the platform, follow [native-plugins/README.md](../native-plugins/README.md).

## iOS (Capacitor)

`ios/` is **not committed**. CI generates it each run with `npx cap add ios`, then:

1. Patches `AppDelegate.swift` to make the bridge WebView transparent.
2. Copies `native-plugins/ios/*` into `ios/App/App/Plugins/MakeCodeBridge/`.
3. Runs `.github/scripts/add_ios_plugin.rb` to add them to the Xcode project (with the `-ObjC` linker flag).
4. Builds for the simulator, and, if signing secrets exist, archives, exports and optionally uploads to TestFlight.

To build locally, repeat those steps by hand on a Mac. The workflow file is the reference.

## CI: `.github/workflows/build.yml`

Runs on **GitHub Release created** or **manual dispatch**. It does not run on plain pushes.

| Job | Output |
|---|---|
| windows | `.exe` installer and portable |
| macos | universal `.dmg` |
| linux | `.AppImage`, `.deb` |
| android | debug `.apk` |
| ios | simulator `.tar.gz`; signed `.ipa` when secrets are set |
| release | attaches all artifacts to the Release, then purges the Actions artifacts |

### Optional secrets

| Secret | Enables |
|---|---|
| `IOS_CERTIFICATE_P12`, `IOS_CERTIFICATE_PASSWORD`, `IOS_PROVISIONING_PROFILE`, `IOS_TEAM_ID` | Signed iOS IPA |
| `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_API_KEY` | TestFlight upload (needs the iOS secrets too) |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Windows code signing |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | macOS code signing |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | macOS notarization |

Full instructions for creating each value are in the header comment of the workflow file. The iOS build number uses `github.run_number` so TestFlight uploads never collide.

## Cutting a release

1. Bump `version` in `package.json` and commit.
2. Create a GitHub Release with a matching tag.
3. Wait for **Build All Platforms** to finish. Binaries appear on the Release page.
