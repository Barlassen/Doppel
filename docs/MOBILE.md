# Doppel on a phone

The request was: "I have Expo Go on my Android phone; make a mobile app for it, or a better option if there is one."

`mobile/` is the answer to the first half: an Expo app (managed workflow, TypeScript) that runs in Expo Go and shows the Doppel web app in a WebView, with a small native shell around it. This document explains the choice, compares it with the alternatives, and lists what the shell does, where it is limited, and what nobody has tried on a real device yet.

**Status: not run on a phone or an emulator.** The machine it was written on has no Android device, emulator or `adb`. Types, unit tests, `expo-doctor`, the Android bundle and the Metro manifest were checked; see [Checks](#checks). Everything that needs a device is listed under [Not verified on a device](#not-verified-on-a-device).

How to run it: [mobile/README.md](../mobile/README.md).

## Why a WebView shell and not a native rewrite

1. **It runs in Expo Go today.** No build service, no Expo account, no Android SDK. `react-native-webview`, `expo-camera`, AsyncStorage and the other modules it uses are bundled in Expo Go.
2. **One finance engine.** AGENTS.md §2 says every number comes from `src/lib/finance/`. A native rewrite would be a second copy of the engine and the UI that can drift; `pocket/` shows what keeping a port honest costs (a parity test over 2'679 values). The shell has no finance code: statement import, decisions, outlook, economy, assistant and `/play` are the web app itself, always in its current version.
3. **The web UI is already built for a phone.** It is responsive and tested at 320 px.

The cost: the app is only as available as the server it points to, and it inherits the limits of an Android WebView on a plain `http://` address (see [Limits](#limits)).

## Expo SDK

**SDK 58** (`expo` 58.0.26, React Native 0.88.1, React 19.3.0), created with `npx create-expo-app` and extended only with `npx expo install`, so every native module has the version the SDK expects.

Why 58, from Expo's own sources read on 2026-11-22:

- [Expo Go version mismatch](https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/): "Each build of Expo Go includes one Expo SDK version. […] The project and Expo Go SDK versions must match." So the project must use exactly the SDK of the installed Expo Go.
- Expo's public versions endpoint (`https://api.expo.dev/v2/versions/latest`, the one Expo CLI reads) reports `expoGoSdkVersion: 58.0.0` and an Android Expo Go client `58.0.5` for SDK 58. SDK 58 is also the newest stable SDK (`npm view expo dist-tags`: `latest` = 58.0.26).
- [SDK reference](https://docs.expo.dev/versions/latest/): SDK 58 ↔ React Native 0.88, Android 7+, Node 22.13+.
- [react-native-webview](https://docs.expo.dev/versions/latest/sdk/webview/): "Included in Expo Go", recommended version 14.0.1, which is what `npx expo install` picked.

One caveat from the same page: "The Google Play version can also lag behind a new SDK release." The Play Store listing itself could not be opened from here. If Expo Go on the phone reports an incompatible project, update it in the Play Store, or install the SDK 58 build from <https://expo.dev/go>.

## What the shell does

| Requirement | How |
|---|---|
| Server address on first run | `SetupScreen`: type it or scan a QR code (`expo-camera`). The address is normalised (`src/lib/serverUrl.ts`), checked with `GET <address>/api/twin` (must answer `{ ok: true, configured: boolean }`) and stored in AsyncStorage only when Doppel answered. Optional default: env `EXPO_PUBLIC_DOPPEL_URL` or `expo.extra.doppelUrl`. Changeable under the gear button. |
| The web app | `react-native-webview` on that address, DOM storage and cache on, not incognito. |
| Android back | Back in the page's history; leaves the app only at the root. Closes the settings sheet and the scanner first. |
| Pull to refresh | See [Limits](#limits), item 1: done in the injected script, drawn natively. |
| Safe areas, status bar | The app is edge-to-edge (the Android default in this SDK). The top inset is a painted strip, the bottom inset is inside the bar, the status bar icons follow the colour scheme. |
| Loading | A 2 px line in the accent colour at the top, driven by the WebView's load progress. |
| Other origins | A link to another origin, or to `mailto:` / `tel:`, opens in the system; the WebView stays on Doppel (`classifyNavigation`). |
| Keyboard | `KeyboardAvoidingView` with `behavior="padding"`, as the [Expo keyboard guide](https://docs.expo.dev/guides/keyboard-handling/) prescribes for edge-to-edge Android; the bottom bar hides while the keyboard is open. |
| Bottom bar | Dashboard (`/`), Play (`/play`), settings (address, change address, reload, versions). Palette from `src/app/globals.css`, light and dark. The bar follows the colour scheme the page itself reports, so the two never disagree. |
| Navigation between the two | Through the page's own link (`a[href="/play"]`, a client-side navigation without reload) when it exists, else a normal load. The active tab follows the page, also when the user taps the page's own nav. |
| File inputs | See [Limits](#limits), item 2. |
| Failure states | No network, server not reachable, not a Doppel server, page did not load; each names the address and offers "Try again" and "Change address". EN / DE / FR / TR by device language, default EN (`src/i18n/`). The WebView's own error and loading views are replaced by a blank view in the page colour, so there is no white screen behind them. |
| Storage | The twin is in the WebView's localStorage for the server's origin and stays there between starts. |
| QR helper | `npm run qr` prints the address as a terminal QR code and says whether Doppel answers there. |

The injected script (`src/lib/bridge.ts`) does four things: reports the path (Next.js navigates with `history.pushState`), reports the colour scheme, reads the pull gesture, and holds a photo input back until the camera permission is settled. It is installed once per document and sends five kinds of message, which the shell only accepts from the server's origin.

## Limits

Found by reading the code of `react-native-webview` 14.0.1 and the web app. None is confirmed on a device.

1. **Pull to refresh is not the library's.** On Android `pullToRefreshEnabled` is an empty method (`RNCWebViewManager.setPullToRefreshEnabled(...) {}`). The gesture is therefore read in the page: only when the page and every scrolled ancestor of the touch are at the top, never inside a dialog, a form control or a canvas, 24 px of slack and then 96 px to arm. The shell draws the indicator and reloads.
2. **File inputs.**
   - *Photo with `capture`* (`SnapPanel`): the library opens the camera app directly. If the host app declares the camera permission but does not hold it, which is Expo Go's state before the first grant, the library logs "there is no Camera permission" and never answers the page; the input would stay dead. The shell therefore asks for the permission on the first tap and replays the tap; after a refusal it removes `capture` for that tap so the normal file chooser opens. The replay may be dropped by the WebView when the permission dialog took longer than the page's user activation; then a second tap is needed.
   - *Statement files* (`ImportPanel`, `AccountWizard`): the library turns `accept` extensions into MIME types. `.csv`, `.txt` and `.xml` have one; `.sta`, `.mt940` and `.940` do not, so the Android picker may grey out MT940 files with those endings. Renaming the file to `.txt` avoids it (the web app accepts `.txt`).
   - A captured photo is handed over through the library's FileProvider, registered under Expo Go's package name. This should work in Expo Go and is not confirmed.
3. **A plain `http://` LAN address is not a secure context.** The page cannot use `getUserMedia` there (live camera, hand control). Dictation uses the Web Speech API, which is not expected to exist in an Android WebView on any address. Photos still work through the file input, which uses the system camera app. Over `https://` (a tunnel or a deployed server) the page is a secure context again.
4. **Downloads.** "Export game" on `/play` saves a `blob:` URL. The WebView has no download handling for that, so nothing is saved. Fixing it needs a small bridge or a change in the web app; neither was in scope.
5. **Storage is per address and belongs to Expo Go.** Another address (new IP, tunnel URL) is another origin with an empty twin. Clearing Expo Go's data clears every twin.
6. **Server version.** `/api/twin` reports whether the assistant is connected, the provider and the model names, but no version. The settings sheet shows the app version and Expo SDK, the assistant state, and "not reported by the server" for the version; if the route gains a `version` string, the sheet shows it without a change here.
7. **Icon and splash apply to a real build, not to Expo Go.** Inside Expo Go the project is an entry in Expo Go's list; [Expo's splash-screen page](https://docs.expo.dev/versions/latest/sdk/splash-screen/) says Expo Go shows the app icon instead of the configured splash. The assets are generated and configured so that an EAS build (option c) has them.
8. **The logo source.** `assets/icon.svg` and `public/icon.svg` in this repository are an indigo "HG" tile, not Doppel's mark. The icons were drawn from the mark the web header renders (`DoppelApp.tsx`: a rounded square in `--accent` with a white bold "D"), as geometry in `mobile/scripts/make-icons.mjs`. The web favicon is the owner's to fix.
9. **Android only.** The code has nothing Android-specific that would break iOS, but the App Store's Expo Go stops at SDK 54 according to the page cited above, so this project does not open there.
10. **Links that open a new window** (`target="_blank"`) go to the system browser, which is the library's default.

## A better option?

| | What it is | Works today for the owner | Needs | Strong point | Weak point |
|---|---|---|---|---|---|
| **a. Expo WebView shell** (built) | This app, opened in Expo Go | Yes | The computer running Metro (8081) and Doppel (3000), reachable from the phone | No account, no build, always the current twin, native address / failure handling | Lives inside Expo Go, no launcher icon; plain-http limits; not yet tried on a device |
| **b. PWA from Chrome** | "Install app" in Chrome on the web app itself | Not yet | HTTPS (a deployed URL or a tunnel); Chrome does not offer installation on `http://<LAN IP>`. In the Next app: `src/app/manifest.ts` (name, `start_url`, `display: "standalone"`, theme and background colours), PNG icons 192 and 512 plus a maskable one, and a service worker that caches the app shell for offline start | Zero app code, real Chrome instead of a WebView (file chooser, camera and downloads all work), secure context, own launcher icon, nothing to keep in sync | Needs hosting; the model gateway is then public and relies on its rate limit and budget |
| **c. EAS build of this app** | The same code as an installable APK | Not yet | An Expo account, `eas.json`, an `android.package` id, cloud build time; for `http://` LAN addresses also `usesCleartextTraffic` through `expo-build-properties` | Own icon, name and splash; no Expo Go; could be published | Account and build queue; still a WebView with the same limits as (a) |
| **d. `pocket/`** | The Kotlin Multiplatform app, native UI, engine ported with a parity test | Not without a toolchain | JDK 17, Android SDK, Gradle, `adb` to install | Fully offline, native feel | A second engine and UI to keep in step with the web app; its README covers what-if, the goal solver and QR-bill import, not statement import, decisions or `/play`; owned by another workstream |

**For the demo: (a).** It is the only option that works with what the owner has now (Expo Go and a laptop) and it shows the same twin the jury sees on the big screen. Rehearse it on the venue network: if clients are isolated, connect the laptop to the phone's hotspot.

**After the demo: (b).** Once Doppel is deployed on HTTPS, a PWA is the better phone app: no app code to maintain, no WebView limits, installable from the browser. Keep (c) for the case that a store listing or a native feature is wanted; `mobile/` is already the code for it. (d) stays the answer only if offline use matters more than feature parity.

## Checks

Run from `mobile/` on 2026-11-22 (macOS, Node 24.15):

| Check | Result |
|---|---|
| `npm run typecheck` (`tsc --noEmit` for the app and for the tests) | pass, no output |
| `npm test` | pass, 31 of 31 |
| `npx expo-doctor` | "20/20 checks passed. No issues detected!" |
| `npx expo export --platform android` | pass: "Android Bundled … index.ts (673 modules)", one asset (Feather.ttf), one Hermes bundle of 1.7 MB |
| `npx expo start --lan --port 8081`, then `curl` | manifest HTTP 200 `application/expo+json` (name Doppel, `sdkVersion` 58.0.0); development bundle HTTP 200; process stopped afterwards |
| Server contract | `GET /api/twin` on the running production server: HTTP 200, `{"ok":true,"configured":true,…}`, also over the LAN address; `/` and `/play` HTTP 200; a `POST` with the LAN origin is not rejected as cross-origin |
| `EXPO_PUBLIC_DOPPEL_URL` | the value is inlined into the exported bundle |

`npm test` covers address normalisation and validation, which navigation leaves the app, route mapping, the `/api/twin` parser and probe (with a fake `fetch`), the locale pick, key and placeholder parity of the four dictionaries, the language rules of AGENTS.md §4, and the injected script run against a stub page (path and scheme reports, camera hold-back, pull gesture).

## Not verified on a device

Nothing below has been observed; each is implemented from documentation and library source.

- The app opening in the Play Store's Expo Go at all (SDK match), and plain-http pages loading in Expo Go's WebView.
- Layout: safe areas with gesture and three-button navigation, the status bar, the bottom bar, the dark palette.
- Android back button: history back inside the page and leaving at the root.
- Pull to refresh: the gesture, the indicator, no false triggers while scrolling or in dialogs.
- Keyboard: inputs in the page staying visible while typing.
- File chooser for statements, including whether MT940 files are selectable.
- Camera capture from the photo input: the permission prompt, the replayed tap, the photo arriving in the page.
- QR scan of the server address from a terminal window, and the camera permission flow of the scanner.
- localStorage surviving an app restart and an Expo Go restart.
- The failure screens in real conditions (Wi-Fi off, server stopped, wrong port) and the four languages on a device set to each.
- Links to other origins opening in the browser.
- `npx expo start --tunnel` and the USB (`adb reverse`) route.
