# Doppel mobile: rules for humans and coding agents

Read the repository's [AGENTS.md](../AGENTS.md) first; its rules apply here too. This directory is the Expo shell
around the Doppel web app. What it is, why it is a WebView and what was not verified: [docs/MOBILE.md](../docs/MOBILE.md).

- **No finance code here.** The web app is the only source of numbers. The shell shows it; it never computes, caches
  or re-implements twin logic.
- **Expo changes with every SDK.** Before touching an Expo or React Native API, read the docs for the SDK in
  `package.json` (`https://docs.expo.dev/versions/v<major>.0.0/`, index at `https://docs.expo.dev/llms.txt`) and the
  types in `node_modules`. Do not write these APIs from memory.
- **Add packages with `npx expo install <package>`**, never `npm install`, so native module versions match the SDK.
  Only modules that Expo Go bundles can be used; anything else needs a development build (see docs/MOBILE.md).
- **`src/lib/` and `src/i18n/` stay free of React Native imports** (except `storage.ts` and `check.ts`), import each
  other with the `.ts` extension, and use only erasable TypeScript syntax, because `npm test` runs them in plain Node.
- **Strings** live in `src/i18n/{en,de,fr,tr}.ts`; `en.ts` is the source of truth. The language rules of the root
  AGENTS.md §4 apply and `npm test` checks them.
- **The injected script** (`src/lib/bridge.ts`) is a string, because Hermes cannot serialise functions. Every change to
  it needs a case in `tests/bridge.test.ts`.
- No `ios/` or `android/` directories: they are generated. Configure native behaviour in `app.json`.

Gates before a PR, all from `mobile/`:

```bash
npm run typecheck      # app and tests
npm test               # pure helpers, dictionaries, the injected script
npm run doctor         # expo-doctor
npm run bundle:check   # Metro bundles for Android (writes dist/, ignored)
```

None of these runs the app. Say in the PR what you did and did not try on a phone.
