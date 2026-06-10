/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The library is linked via file:../../packages/* and pulls React through its own
  // dependency tree; dedupe ensures a single React instance (avoids "invalid hook call").
  resolve: { dedupe: ["react", "react-dom"] },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    // The library is symlinked (file:), so inline it + zustand so they resolve the SAME
    // React as the test (otherwise zustand reads a second React instance → invalid hook call).
    server: { deps: { inline: ["i18n-keyless-react", "i18n-keyless-core", "zustand"] } },
  },
});
