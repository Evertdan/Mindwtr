<!-- bmad:context -->
<!-- Verified 2026-08-23 against bd6be89fa. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## apps/mobile

Expo/React Native. Real JS entry: `index.js` (order-sensitive polyfill/module loading, contract-tested), not `app/index.tsx`.

## Policy

- `ios/`/`android/` are `expo prebuild` output — gitignored, regenerated. Native patches that must survive prebuild live in `plugins/`/`ios-native/`, never hand-edited in the generated trees.
- FOSS build (F-Droid/IzzyOnDroid) must not pull in Google/Play packages — checked by `scripts/verify_foss_no_google_services.py`. Gate Play-only/Google-only features behind `isFossBuild`.
- Core's default crypto is FORBIDDEN here — Hermes has no WebCrypto/Node crypto, pure-JS Argon2id blocks the JS thread for tens of seconds. Use `react-native-quick-crypto` (`lib/sync-crypto-native.ts`).
- `ANDROID_HOME` only — never `ANDROID_SDK_ROOT` (deprecated, causes conflicts).

## Running and verifying

- `npm run android`/`ios` won't pick up config-plugin changes on existing native dirs — run `npx expo prebuild --clean --platform android` first.
- Real Android release build: `ARCHS=arm64-v8a bash ./scripts/android_build.sh`, not `npm run android`.
- Tests run under Node, not jsdom/RN — `react-native` is aliased to a hand-written shim; native TurboModules never run under test.
- `react-hooks/exhaustive-deps` is `error` here, not the default `warn` (stale-closure bugs, #768).
- Dropbox OAuth needs `DROPBOX_APP_KEY` set before `bun mobile:start` and a dev/release build — doesn't work in Expo Go.

## Known pitfalls

- Local Whisper audio transcription: three separate production bugs (Android #95, #424; iOS #788) all stemmed from audio-format/container assumptions — see ADR 0019 before touching this code.
- Markdown editor: cursor-jump-on-tap, scroll-into-view, keyboard-height padding, and toolbar-sync desync have each shipped as production bugs before — any change needs regression tests for these specific failure modes.

<!-- /bmad:context -->
