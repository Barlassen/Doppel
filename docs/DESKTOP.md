# Doppel as a desktop app

`desktop/` wraps Doppel in an Electron shell, so it starts with a double-click: no terminal, no Node, no browser. The app starts the Doppel production server inside itself, waits until it answers, and opens one window on it. Without a key it runs fully offline, like the web app.

It is the same web app, unchanged. Nothing under `src/` knows about the shell.

## Use it

| | |
|---|---|
| macOS | Open `Doppel-<version>-mac-x64.dmg` (Intel) or `…-mac-arm64.dmg` (Apple silicon), drag **Doppel** to Applications, open it. |
| Windows | Run `Doppel-Setup-<version>.exe`. It installs for the current user and starts Doppel. |

The menu has **Dashboard** (⌘1 / Ctrl+1), **Play** (⌘2), **Reload** (⌘R), **Open data folder** and **Assistant settings…** (⌘,), plus the standard Edit and Window items. Closing the window quits the app, on every platform.

### First launch of an unsigned build

The builds are not signed with an Apple Developer ID or a Windows certificate, and not notarized. A copy you built yourself opens directly. A copy that was downloaded or sent to you is stopped once:

- **macOS 15 and later:** open Doppel, dismiss the "Apple could not verify…" dialog, then go to System Settings → Privacy & Security, scroll to "Doppel was blocked…" and choose **Open Anyway**. On older versions: right-click the app → Open → Open. In a terminal the same is `xattr -dr com.apple.quarantine /Applications/Doppel.app`.
- **Windows:** SmartScreen shows "Windows protected your PC". Choose **More info** → **Run anyway**.

### Assistant (optional)

**Assistant settings…** opens a small window with the same choices as `.env.example`: offline, OpenRouter (one key), or any OpenAI-compatible endpoint (a local Ollama, LM Studio, Groq…), the two model names and the daily limits. **Save and restart** writes them to `doppel.env` in the data folder and restarts the built-in server; the page reloads and the dashboard shows "connected". Your data stays, it lives in the window, not in the server.

- No key ships with the app. `doppel.env` is created on first launch with comments only.
- The key is stored in plain text in `doppel.env` (file mode 600), on this computer only. It is passed to the server process and from there to the endpoint you chose. The settings window can replace or remove it but is never given it back, and it is never written to the log.
- You can also edit `doppel.env` in a text editor (**Open data folder**). The app notices the change within two seconds and restarts the server. Only `OPENROUTER_API_KEY` and `DOPPEL_*` lines are read.
- "Configured" in the settings window means a key and model are set. Whether the key is valid shows with the first question.

### Where things are

| | macOS | Windows |
|---|---|---|
| Data folder | `~/Library/Application Support/Doppel` | `%APPDATA%\Doppel` |
| Settings | `doppel.env` in the data folder | same |
| Log | `logs/doppel.log` in the data folder (rotated at 1 MB) | same |
| Your accounts, statements, games | the window's localStorage, inside the data folder | same |

To start from scratch, quit Doppel and delete the data folder.

## How it works

```
desktop/app/main.mjs      windows, menu, single-instance lock, the stable origin, quit
desktop/app/server.mjs    the Doppel server as an Electron utility process on 127.0.0.1:<free port>
desktop/app/envFile.mjs   doppel.env: read, line-preserving update
desktop/app/preload.js    bridge for the shell's own two pages only (settings, error)
desktop/app/ui/           splash, settings and error pages
scripts/desktop-stage.mjs builds and stages the server (desktop/.stage/server)
scripts/desktop-smoke.mjs drives the app with Playwright and checks everything below
scripts/desktop-icon.mjs  renders assets/icon.svg into desktop/build/icon.{png,icns,ico}
```

- **The server** is Next's standalone build (`DOPPEL_STANDALONE=1 next build`, an opt-in in `next.config.ts`) plus `public/` (with the Tesseract assets) and `.next/static`. It runs on Electron's own Node as a utility process, bound to `127.0.0.1` on a port the operating system picks. The shell polls `GET /api/twin` and shows a splash until it answers; if it does not, an error window shows the reason, the log path and the last log lines.
- **One origin, whatever the port.** The window always loads `http://doppel.localhost`. The shell answers requests to that origin by forwarding them to `127.0.0.1:<port>` and refuses every other http host. So localStorage (accounts, statements, the Play game) survives relaunches although the port differs each time. The server is told the same name (`X-Forwarded-Host`, `DOPPEL_ALLOWED_ORIGINS`), so the same-origin check on `POST /api/twin` still applies.
- **No orphan server.** Quitting stops the server process and waits for it. Because it is a utility process, Chromium also ends it when the app is killed.
- **The renderer is a plain web page:** no `nodeIntegration`, `contextIsolation` on, sandboxed, no preload. Navigation is limited to the app's origin; other links open in the system browser. Camera and microphone are allowed for the app's own pages (document capture, dictation), every other permission is refused.
- **The app never writes into itself.** Settings, log and window state go to the data folder; the server keeps its page cache in memory (`isrFlushToDisk: false` in the opt-in build), so the app also runs from a read-only disk image and its signature seal stays intact.
- **Single instance.** A second start focuses the running window. Window size and position are remembered (`window-state.json`).

## Build it

```bash
npm ci                    # the web app (postinstall copies the Tesseract assets)
npm run desktop:install   # Electron and electron-builder, in desktop/node_modules

npm run desktop:dev       # build + stage the server, then run the app unpackaged
npm run desktop:build     # build + stage, then package for this operating system → desktop/dist/
npm run desktop:smoke -- --app desktop/dist/mac/Doppel.app   # check the packaged app (omit --app for the unpackaged one)
```

- `desktop:dev` and `desktop:build` run `next build` with `DOPPEL_STANDALONE=1`, so they **replace `.next`** with a build that also contains `.next/standalone`. `npm run start` still works on it; run `npm run build` again for the plain build. The normal `npm run build` is not changed by any of this.
- macOS output: `desktop/dist/mac/Doppel.app` and `Doppel-<version>-mac-x64.dmg`, `desktop/dist/mac-arm64/Doppel.app` and `…-mac-arm64.dmg`. The apps get an ad-hoc signature (Apple silicon requires one); nothing is signed with a personal certificate.
- Windows: `npm --prefix desktop run build:win` writes `desktop/dist/Doppel-Setup-<version>.exe` (NSIS, per user, x64). electron-builder can build it on macOS without Wine.
- The staged server is plain JavaScript: the image optimiser (`sharp`, the only native module Next traces) is removed because Doppel uses no `next/image`. One stage therefore serves every target.
- `scripts/desktop-stage.mjs` removes env files from the stage and fails if any key known to the build machine (environment or `.env*`) or any OpenRouter-shaped key appears in a staged file.
- An unpackaged run keeps its data in `Doppel-dev`, apart from the installed app. `DOPPEL_DESKTOP_DATA_DIR` points either at another folder; the smoke script uses a temporary one and shows its windows without taking the keyboard focus (`DOPPEL_DESKTOP_QUIET=1`).
- The icons in `desktop/build/` are generated from `assets/icon.svg` by `node scripts/desktop-icon.mjs` and committed. Rerun it after changing the SVG.

## What was checked, and what was not

Checked on an Intel Mac (macOS, Darwin 25), with `scripts/desktop-smoke.mjs` against the packaged x64 app, 31 checks: the dashboard and `/play` load, `GET /api/twin` answers 200 in the window, a sample statement is imported, the Tesseract worker and language data load, localStorage and the window bounds survive quit and relaunch on a different port, a second instance exits, saving settings and editing `doppel.env` restart the server, the key is not handed back or logged, external links leave the app, nothing is left running after quit, and the bundle is byte-for-byte untouched afterwards. Also by hand: start through `open` (launched by launchd) and with an empty environment, start from the mounted read-only disk image, no process left after `SIGTERM` and after `SIGKILL` of the app, and one live question with a real OpenRouter key.

Not checked:

- **Windows.** The installer builds on macOS, but it was never installed or run. `%APPDATA%` paths, the SmartScreen step and the menu on Windows are as documented by Electron, not observed.
- **Apple silicon.** The arm64 app and disk image build and their ad-hoc signature verifies, but an Intel Mac cannot run them.
- **The Gatekeeper dialog.** The steps above are Apple's documented flow; the builds were only run from the machine that built them, where no quarantine applies.
- **Camera and microphone** in the packaged app (document capture, dictation, hand control). The usage descriptions and permission handler are in place; no device was used.
- **OCR end to end.** The worker and its assets load through the app's origin; a full receipt scan was not run in the app.
- Code signing, notarization and auto-update are not set up.

## Next

- Sign and notarize (Apple Developer ID, a Windows certificate), then the first-launch step disappears.
- Lock the Electron fuses (`runAsNode`, the Node inspect arguments) once signing is in place; they are left at their defaults so Playwright can drive the packaged app.
- Keep the key in the operating system's keychain (`safeStorage`) instead of a plain file.
- The app icon comes from `assets/icon.svg` ("HG" on indigo), which does not match the red "D" mark in the web app's header. Replace the SVG and rerun `scripts/desktop-icon.mjs` if the header mark is the intended brand.
