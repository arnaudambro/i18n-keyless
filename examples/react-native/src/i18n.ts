import { init } from "i18n-keyless-react";
import { MMKV } from "react-native-mmkv";

export const PRIMARY = "fr";
export const SUPPORTED_LANGUAGES = ["fr", "en", "es"] as const;

// react-native-mmkv exposes getString / set / delete — i18n-keyless's storage adapter
// resolves those automatically (the same way it handles localStorage's getItem/setItem
// and AsyncStorage's async getItem). Pass the MMKV instance directly as `storage`.
const mmkv = new MMKV();

export function initI18n() {
  // On native there's no env var convention here — read your key from your config/secrets.
  const apiKey = process.env.I18N_KEYLESS_API_KEY;
  return init({
    API_KEY: apiKey || "demo",
    // Without a key, point at the local mock backend (use your machine's LAN IP from a
    // device, or 10.0.2.2 from the Android emulator).
    ...(apiKey ? {} : { API_URL: "http://localhost:8787" }),
    languages: { primary: PRIMARY, supported: [...SUPPORTED_LANGUAGES] },
    storage: mmkv,
  });
}

// To use AsyncStorage instead of MMKV:
//   import AsyncStorage from "@react-native-async-storage/async-storage";
//   storage: AsyncStorage   // its async getItem/setItem are supported too
