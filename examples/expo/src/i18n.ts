import { init } from "i18n-keyless-react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const PRIMARY = "fr";
export const SUPPORTED_LANGUAGES = ["fr", "en", "es"] as const;

// AsyncStorage has an async getItem/setItem/removeItem — i18n-keyless's storage adapter
// supports async stores out of the box, so you can pass it straight to `init`.
// (Prefer react-native-mmkv for synchronous, faster storage if you add the native module.)
export function initI18n() {
  const apiKey = process.env.EXPO_PUBLIC_I18N_KEYLESS_API_KEY;
  return init({
    API_KEY: apiKey || "demo",
    ...(apiKey ? {} : { API_URL: "http://localhost:8787" }),
    languages: { primary: PRIMARY, supported: [...SUPPORTED_LANGUAGES] },
    storage: AsyncStorage,
  });
}
