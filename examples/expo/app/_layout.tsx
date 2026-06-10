import { Stack } from "expo-router";
import { initI18n } from "../src/i18n";

// Start i18n-keyless once when the app boots.
initI18n();

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#0f1115" },
        headerTintColor: "#e8eaed",
        contentStyle: { backgroundColor: "#0f1115" },
      }}
    />
  );
}
