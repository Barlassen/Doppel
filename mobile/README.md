# Doppel mobile

Doppel on an Android phone, inside [Expo Go](https://play.google.com/store/apps/details?id=host.exp.exponent). The app
is a small native shell (server address, bottom bar, loading and failure states) around the Doppel web app in a
WebView, so the phone always shows the current twin. Why it is built this way, the alternatives and the limits:
[docs/MOBILE.md](../docs/MOBILE.md).

Nothing in this directory has been run on a real phone or an emulator yet. See "Not verified on a device" in
docs/MOBILE.md before you rely on a specific behaviour.

## Run it

You need Node 22.18 or newer, Expo Go from the Play Store on the phone, and the phone and the computer on the same Wi-Fi.

1. Start Doppel on the computer (repository root). The production server is the one to use for a phone:

   ```bash
   npm run build && npm start        # http://localhost:3000, also reachable on the computer's LAN address
   ```

2. Start the app's development server:

   ```bash
   cd mobile
   npm install
   npx expo start
   ```

   The terminal shows a QR code. On the phone, open **Expo Go → Scan QR code** and scan it. The project uses Expo
   SDK 58. If Expo Go says the project is incompatible, update Expo Go in the Play Store or install the SDK 58 build
   from <https://expo.dev/go>.

3. The app asks for the Doppel server address. In a second terminal:

   ```bash
   cd mobile
   npm run qr                              # this computer's LAN address, port 3000
   npm run qr -- 3410                      # another port
   npm run qr -- http://192.168.1.20:3000  # exactly this address
   ```

   In the app tap **Scan QR code** and point the phone at the terminal, or type the address
   (`http://<computer's IP>:3000`). The app calls `GET <address>/api/twin` and keeps the address only if Doppel
   answers. Change it later under the gear button → **Change address**.

To skip the question on a known network, start with a default:

```bash
EXPO_PUBLIC_DOPPEL_URL=http://192.168.1.20:3000 npx expo start
```

or set `expo.extra.doppelUrl` in `app.json`. Do not commit an address that is only valid on your network.

## When the phone cannot reach the computer

University, hotel and event networks often isolate clients from each other. Two things must then be reachable from the
phone: the Expo development server (port 8081) and the Doppel server (port 3000).

- **Simplest: the phone's hotspot.** Connect the computer to the phone's hotspot. Both are on one network again and the
  steps above work unchanged.
- **Tunnels.** `npx expo start --tunnel` (or `npm run tunnel`) makes the development server reachable; Expo asks once
  to install `@expo/ngrok`. This does not expose port 3000. Doppel needs its own tunnel, for example
  `npx ngrok http 3000` or `cloudflared tunnel --url http://localhost:3000`, and the app gets that `https://…`
  address (`npm run qr -- https://…`). A tunnel puts the Doppel server, including its model gateway, on the public
  internet for as long as it runs; stop it after the demo.
- **USB.** With `adb` installed: `adb reverse tcp:8081 tcp:8081 && adb reverse tcp:3000 tcp:3000`, then use
  `http://localhost:3000` as the address. Not tried here; this machine has no `adb`.

The twin lives in the WebView's localStorage, which is kept per address. A different address (a new IP after joining
another network, a tunnel URL) starts with an empty twin; going back to the old address brings the old twin back.

## What is where

| Path | What |
|---|---|
| `App.tsx` | boot → setup → main |
| `src/components/SetupScreen.tsx`, `QrScanner.tsx` | first run and "change address": manual entry, QR scan, validation |
| `src/components/BrowserScreen.tsx` | the WebView, loading line, pull to refresh, back button, failure states |
| `src/components/BottomBar.tsx`, `SettingsSheet.tsx`, `FailureView.tsx` | Dashboard / Play / settings; address, reload, versions; what went wrong |
| `src/lib/serverUrl.ts`, `routes.ts`, `probe.ts` | pure helpers: address normalisation, which link leaves the app, route mapping, the `/api/twin` contract |
| `src/lib/bridge.ts` | the script injected into the page (path, colour scheme, pull gesture, camera permission for file inputs) |
| `src/i18n/` | EN / DE / FR / TR strings and the locale pick |
| `scripts/qr.mjs` | `npm run qr` |
| `scripts/make-icons.mjs` | `npm run icons`: draws icon, adaptive icon and splash from the D mark, no dependencies |
| `tests/` | `npm test` (Node's test runner, no extra packages) |

## Checks

```bash
npm run typecheck
npm test
npm run doctor
npm run bundle:check
```
