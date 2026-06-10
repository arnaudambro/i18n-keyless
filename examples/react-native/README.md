# i18n-keyless · React Native (CLI)

A native app (no SSR). The interesting part is the **storage adapter**: i18n-keyless
persists translations through whatever storage you pass to `init()`.

- [`src/i18n.ts`](./src/i18n.ts) — `init()` with **`react-native-mmkv`**. The MMKV instance
  exposes `getString` / `set` / `delete`, which i18n-keyless resolves automatically (the
  same adapter handles `localStorage`'s `getItem`/`setItem` and AsyncStorage's async API).
  A commented snippet shows the AsyncStorage variant.
- [`App.tsx`](./App.tsx) — `<I18nKeylessText>` (inside `<Text>`, as RN requires),
  `getTranslation()` + `context`, and a language switcher with two screens.

Primary language is **`fr`**.

## Use it

This folder contains the **JS/TS integration code**. Drop `App.tsx` + `src/` into a React
Native project (`npx @react-native-community/cli init MyApp`), then:

```bash
npm install --legacy-peer-deps   # RN's strict peer matrix
npm run ios   # or npm run android
```

## Test

```bash
npm test
```

Runs in the React Native runtime (`react-native` jest preset) and asserts translation +
`context` resolve natively. (React is pinned to 18.3 to match RN 0.77.)

- `<I18nKeylessText>` must be rendered **inside a `<Text>`** (it outputs a string).
- For the offline mock backend from a device/emulator, set `API_URL` to your machine's LAN
  IP (or `http://10.0.2.2:8787` on the Android emulator) instead of `localhost`.

Consumes the library via `file:../../packages/*`.
