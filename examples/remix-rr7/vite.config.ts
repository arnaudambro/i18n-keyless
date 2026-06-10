/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { reactRouter } from "@react-router/dev/vite";

export default defineConfig(({ mode }) => ({
  // The React Router plugin can't be combined with the test runner; load it only for dev/build.
  plugins: mode === "test" ? [] : [reactRouter()],
  resolve: { dedupe: ["react", "react-dom"] },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./app/test-setup.ts"],
    include: ["app/**/*.test.tsx"],
    // file:-linked lib → inline it + zustand so they share the test's single React instance.
    server: { deps: { inline: ["i18n-keyless-react", "i18n-keyless-core", "zustand"] } },
  },
}));
