# i18n-keyless · Expo (Expo Router)

A native Expo app with file-based routing. Like the React Native example, the focus is the
**storage adapter** — here using **AsyncStorage**.

- [`src/i18n.ts`](./src/i18n.ts) — `init()` with `@react-native-async-storage/async-storage`.
  Its async `getItem`/`setItem`/`removeItem` are supported by i18n-keyless's adapter as-is.
- [`app/_layout.tsx`](./app/_layout.tsx) calls `initI18n()` on boot; `app/index.tsx` and
  `app/about.tsx` are the two routes (Expo Router), using `<I18nKeylessText>` (inside
  `<Text>`), `getTranslation()` + `context`, and the language switcher.

Primary language is **`fr`**.

## Use it

This folder is the Expo Router source. To run it as a standalone app, scaffold an Expo
project (`npx create-expo-app`) and copy `app/` + `src/` in, or wire these files into your
existing app, then:

```bash
npm install --legacy-peer-deps   # Expo's strict peer matrix
npx expo start
```

## Test

```bash
npm test
```

Runs in the React Native runtime (`jest-expo`) and asserts translation + `context` resolve
natively. (React is pinned to 18.3 to match Expo SDK 52 / RN 0.77.)

- `<I18nKeylessText>` must be inside a `<Text>`.
- For the offline mock backend from a device, set `API_URL` to your machine's LAN IP.
- Expo Router also supports server output (SSR) — for server-rendered translations there,
  follow the TanStack Start / Remix pattern (`runWithI18nKeyless` in the server entry).

Consumes the library via `file:../../packages/*`.
